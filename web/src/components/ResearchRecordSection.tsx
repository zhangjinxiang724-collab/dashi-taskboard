import { useEffect, useState } from "react";

import { ApiError } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createResearchRecord,
  createCognitionUpdate,
  deleteResearchRecord,
  listResearchRecords,
  updateResearchRecord,
} from "../researchApi";
import type { CognitionUpdate, ResearchRecord, ResearchRecordDraft, TopicDetail } from "../researchTypes";
import { CognitionUpdateEditor } from "./CognitionUpdateEditor";
import {
  ResearchRecordEditor,
  researchRecordKindLabel,
  researchRecordProviderLabel,
} from "./ResearchRecordEditor";
import { ResearchRecordReader } from "./ResearchRecordReader";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sortRecords(records: ResearchRecord[]) {
  return [...records].sort((left, right) => {
    const occurred = right.occurredAt.localeCompare(left.occurredAt);
    if (occurred !== 0) return occurred;
    return right.id.localeCompare(left.id);
  });
}

export function ResearchRecordSection({
  topicId,
  onTopicChange,
  onCognitionChanged,
}: {
  topicId: string;
  onTopicChange: (topic: TopicDetail) => void;
  onCognitionChanged: () => void;
}) {
  const { text } = useTaskboardI18n();
  const [records, setRecords] = useState<ResearchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorRecord, setEditorRecord] = useState<ResearchRecord | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [readerRecord, setReaderRecord] = useState<ResearchRecord | null>(null);
  const [cognitionUpdate, setCognitionUpdate] = useState<CognitionUpdate | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listResearchRecords(topicId, controller.signal)
      .then((next) => {
        setRecords(next);
        setError(null);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [topicId]);

  async function save(draft: ResearchRecordDraft) {
    setPending(true);
    setError(null);
    try {
      if (editorRecord) {
        const updated = await updateResearchRecord(editorRecord, draft);
        setRecords((current) => sortRecords(current.map((record) => record.id === updated.id ? updated : record)));
      } else {
        const created = await createResearchRecord(topicId, draft);
        setRecords((current) => sortRecords([...current, created]));
      }
      setEditorRecord(undefined);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.code === "RESEARCH_RECORD_VERSION_CONFLICT") {
        setError(text("这条研究记录已在别处更新，请关闭编辑窗口并刷新页面后重试。", "This record changed elsewhere. Close the editor, refresh, and try again."));
      } else {
        setError(errorMessage(saveError));
      }
    } finally {
      setPending(false);
    }
  }

  async function remove(record: ResearchRecord) {
    if (!window.confirm(text(`确定删除“${record.title}”吗？删除后不会在主题中显示。`, `Delete “${record.title}”? It will no longer appear in this topic.`))) return;
    setPending(true);
    setError(null);
    try {
      await deleteResearchRecord(record);
      setRecords((current) => current.filter((candidate) => candidate.id !== record.id));
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setPending(false);
    }
  }

  async function startCognitionUpdate(record: ResearchRecord, sourceContentVersionId: string | null) {
    setPending(true);
    setError(null);
    try {
      const result = await createCognitionUpdate(topicId, record.id, sourceContentVersionId);
      setReaderRecord(null);
      setCognitionUpdate(result.update);
    } catch (createError) {
      setError(createError instanceof ApiError && createError.code === "RESEARCH_RECORD_UNCLASSIFIED"
        ? "请先把这条资料归入一个主题。"
        : errorMessage(createError));
    } finally {
      setPending(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    <section className="research-records-panel" data-testid="research-records">
      <div className="research-section-heading research-records-heading">
        <div>
          <span>{text("研究过程", "Research process")}</span>
          <h2>{text("研究记录", "Research Records")}</h2>
        </div>
        <button className="research-inline-action" type="button" onClick={() => setEditorRecord(null)}>
          + {text("添加记录", "Add record")}
        </button>
      </div>

      {error && editorRecord === undefined && <div className="research-error" role="alert">{error}</div>}
      {loading ? (
        <p className="research-empty-copy">{text("正在读取研究记录…", "Loading research records…")}</p>
      ) : records.length === 0 ? (
        <div className="research-records-empty">
          <p>{text("还没有保存研究记录。完成一次 AI 研究后，把入口和主要内容留在这里。", "No research records yet. After an AI research session, keep its link and main subject here.")}</p>
          <button className="button" type="button" onClick={() => setEditorRecord(null)}>{text("添加第一条记录", "Add the first record")}</button>
        </div>
      ) : (
        <div className="research-record-list">
          {records.map((record) => (
            <article className="research-record-row" key={record.id}>
              <time dateTime={record.occurredAt}>{dateFormatter.format(new Date(record.occurredAt))}</time>
              <div className="research-record-main">
                <div className="research-record-meta">
                  <span>{researchRecordProviderLabel(record.provider)}</span>
                  <span>{researchRecordKindLabel(record.kind)}</span>
                </div>
                <h3>{record.title}</h3>
                {record.summary && <p>{record.summary}</p>}
                {record.note && <p className="research-record-note">{record.note}</p>}
              </div>
              <div className="research-record-actions">
                <button type="button" disabled={pending} onClick={() => setReaderRecord(record)}>{text("查看内容", "View content")}</button>
                {record.url && (
                  <a href={record.url} target="_blank" rel="noopener noreferrer">{text("打开原对话 ↗", "Open original ↗")}</a>
                )}
                <button type="button" disabled={pending} onClick={() => setEditorRecord(record)}>{text("编辑", "Edit")}</button>
                <button type="button" disabled={pending} onClick={() => void remove(record)}>{text("删除", "Delete")}</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editorRecord !== undefined && (
        <ResearchRecordEditor
          record={editorRecord}
          pending={pending}
          error={error}
          onCancel={() => {
            setEditorRecord(undefined);
            setError(null);
          }}
          onSubmit={(draft) => void save(draft)}
        />
      )}
      {readerRecord && <ResearchRecordReader
        record={readerRecord}
        onClose={() => setReaderRecord(null)}
        actions={({ sourceContentVersionId }) => (
          <button className="button primary" type="button" disabled={pending} onClick={() => void startCognitionUpdate(readerRecord, sourceContentVersionId)}>
            更新认知
          </button>
        )}
      />}
      {cognitionUpdate && <CognitionUpdateEditor
        initialUpdate={cognitionUpdate}
        onClose={() => setCognitionUpdate(null)}
        onApplied={onTopicChange}
        onChanged={onCognitionChanged}
      />}
    </section>
  );
}
