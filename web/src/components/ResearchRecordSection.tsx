import { useEffect, useState } from "react";

import { ApiError } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createResearchRecord,
  deleteResearchRecord,
  listResearchRecords,
  updateResearchRecord,
  getResearchRecordContent,
} from "../researchApi";
import type { ResearchRecord, ResearchRecordContent, ResearchRecordDraft } from "../researchTypes";
import {
  ResearchRecordEditor,
  researchRecordKindLabel,
  researchRecordProviderLabel,
} from "./ResearchRecordEditor";

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

export function ResearchRecordSection({ topicId }: { topicId: string }) {
  const { text } = useTaskboardI18n();
  const [records, setRecords] = useState<ResearchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorRecord, setEditorRecord] = useState<ResearchRecord | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [content, setContent] = useState<ResearchRecordContent | null>(null);

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
                {record.captureAdapter === "chatgpt-export-v1" && (
                  <button type="button" disabled={pending} onClick={() => {
                    setPending(true);
                    getResearchRecordContent(record.id)
                      .then(setContent)
                      .catch((contentError) => setError(errorMessage(contentError)))
                      .finally(() => setPending(false));
                  }}>{text("查看内容", "View content")}</button>
                )}
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
      {content && (
        <div className="modal-backdrop research-content-backdrop" role="presentation">
          <section className="research-content-reader" role="dialog" aria-modal="true" aria-label={text("导入对话内容", "Imported conversation content")}>
            <header><div><span>ChatGPT</span><h2>{content.content.title}</h2></div><button type="button" onClick={() => setContent(null)} aria-label={text("关闭", "Close")}>×</button></header>
            <div className="research-content-meta">{content.messageCount} {text("条可见消息", "visible messages")}{content.omittedMessageCount > 0 ? ` · ${content.omittedMessageCount} ${text("条已省略", "omitted")}` : ""}</div>
            <div className="research-content-messages">
              {content.content.messages.map((message, index) => (
                <article key={message.id ?? index} className={`role-${message.role}`}>
                  <strong>{message.role === "user" ? text("我", "You") : "ChatGPT"}</strong>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
