import { useEffect, useState } from "react";

import { ApiError } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createResearchRecord,
  createCognitionUpdate,
  deleteResearchRecord,
  getResearchRecordContent,
  getResearchRecordSummary,
  listResearchRecords,
  listResearchRecordContentVersions,
  updateResearchRecord,
} from "../researchApi";
import type { CognitionUpdate, ResearchRecord, ResearchRecordDraft, ResearchRecordSummary, TopicDetail } from "../researchTypes";
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
  onCapture,
  onTopicChange,
  onCognitionChanged,
  onCountChange,
}: {
  topicId: string;
  onCapture: () => void;
  onTopicChange: (topic: TopicDetail) => void;
  onCognitionChanged: () => void;
  onCountChange?: (count: number) => void;
}) {
  const { text } = useTaskboardI18n();
  const [records, setRecords] = useState<ResearchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorRecord, setEditorRecord] = useState<ResearchRecord | null | undefined>(undefined);
  const [editorInitialContent, setEditorInitialContent] = useState("");
  const [pending, setPending] = useState(false);
  const [readerRecord, setReaderRecord] = useState<ResearchRecord | null>(null);
  const [cognitionUpdate, setCognitionUpdate] = useState<CognitionUpdate | null>(null);
  const [cognitionSourceTextComplete, setCognitionSourceTextComplete] = useState(true);
  const [readerNotice, setReaderNotice] = useState<string | null>(null);
  const [latestSummary, setLatestSummary] = useState<{ record: ResearchRecord; summary: ResearchRecordSummary } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listResearchRecords(topicId, controller.signal)
      .then(async (next) => {
        const sorted = sortRecords(next);
        setRecords(sorted);
        onCountChange?.(sorted.length);
        setError(null);
        const summaries = await Promise.all(sorted.map(async (record) => {
          try {
            const versions = await listResearchRecordContentVersions(record.id);
            const current = versions.find((version) => version.isCurrent) ?? versions[0];
            if (!current) return null;
            const summary = await getResearchRecordSummary(record.id, current.id);
            return summary ? { record, summary } : null;
          } catch { return null; }
        }));
        if (!controller.signal.aborted) setLatestSummary(summaries.find((item) => item !== null) ?? null);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onCountChange, topicId]);

  async function save(draft: ResearchRecordDraft) {
    setPending(true);
    setError(null);
    try {
      if (editorRecord) {
        const updated = await updateResearchRecord(editorRecord, draft);
        setRecords((current) => sortRecords(current.map((record) => record.id === updated.id ? updated : record)));
      } else {
        const created = await createResearchRecord(topicId, draft);
        setRecords((current) => {
          const next = sortRecords([...current, created]);
          onCountChange?.(next.length);
          return next;
        });
      }
      setEditorRecord(undefined);
      setEditorInitialContent("");
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

  async function editRecord(record: ResearchRecord) {
    if (record.captureAdapter !== "manual-v1") {
      setEditorInitialContent("");
      setEditorRecord(record);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const content = await getResearchRecordContent(record.id);
      const message = content?.content.messages[0];
      const body = typeof message?.text === "string"
        ? message.text
        : (message?.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
      setEditorInitialContent(body);
      setEditorRecord(record);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.code === "RESEARCH_RECORD_CONTENT_NOT_FOUND") {
        setEditorInitialContent("");
        setEditorRecord(record);
      } else {
        setError(errorMessage(loadError));
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
      setRecords((current) => {
        const next = current.filter((candidate) => candidate.id !== record.id);
        onCountChange?.(next.length);
        return next;
      });
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setPending(false);
    }
  }

  async function startCognitionUpdate(record: ResearchRecord, sourceContentVersionId: string | null, sourceTextComplete: boolean) {
    setPending(true);
    setError(null);
    try {
      const result = await createCognitionUpdate(topicId, record.id, sourceContentVersionId);
      setCognitionSourceTextComplete(sourceTextComplete);
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
          <h2>{text("研究资料", "Research Sources")}</h2>
          <p>{text("基于相关资料，阅读、总结关键内容，支撑你的判断。", "Read and summarise relevant sources to support your judgment.")}</p>
        </div>
        <button className="research-inline-action" type="button" onClick={() => { setEditorInitialContent(""); setEditorRecord(null); }}>
          {text("添加资料", "Add source")}
        </button>
      </div>

      {error && editorRecord === undefined && <div className="research-error" role="alert">{error}</div>}
      {loading ? (
        <p className="research-empty-copy">{text("正在读取研究记录…", "Loading research records…")}</p>
      ) : records.length === 0 ? (
        <div className="research-records-empty">
          <p>{text("这个主题还没有研究资料。可以先收进一条资料，也可以手动添加文章、对话或自己的笔记。", "This topic has no research sources yet. Capture one or add an article, conversation, or note manually.")}</p>
          <div className="research-records-empty-actions">
            <button className="button primary" type="button" onClick={onCapture}>{text("收一条资料", "Capture a source")}</button>
            <button className="button" type="button" onClick={() => { setEditorInitialContent(""); setEditorRecord(null); }}>{text("手动添加资料", "Add a source manually")}</button>
          </div>
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
                <button type="button" disabled={pending} onClick={() => { setReaderNotice(null); setReaderRecord(record); }}>{text("查看资料", "View source")}</button>
                <button className="research-record-summary-action" type="button" disabled={pending} onClick={() => { setReaderNotice(null); setReaderRecord(record); }}>{text("内容总结", "Summary")}</button>
                <details className="research-record-more"><summary aria-label={text("更多操作", "More actions")}>•••</summary><div>{record.url && <a href={record.url} target="_blank" rel="noopener noreferrer">{text("打开原对话 ↗", "Open original ↗")}</a>}<button type="button" disabled={pending} onClick={() => void editRecord(record)}>{text("编辑", "Edit")}</button><button type="button" disabled={pending} onClick={() => void remove(record)}>{text("删除", "Delete")}</button></div></details>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="research-latest-summary">
        <div><span>{text("最近总结", "Latest summary")}</span><h3>{latestSummary ? latestSummary.record.title : text("还没有资料总结", "No source summary yet")}</h3></div>
        {latestSummary ? <><p>{latestSummary.summary.oneLineSummary}</p><button className="button" type="button" onClick={() => { setReaderNotice(null); setReaderRecord(latestSummary.record); }}>{text("查看完整总结", "View full summary")}</button></> : <p>{text("完成一份资料总结后，最近的总结会出现在这里。", "Your latest saved summary will appear here.")}</p>}
      </section>

      {editorRecord !== undefined && (
        <ResearchRecordEditor
          record={editorRecord}
          initialContent={editorInitialContent}
          pending={pending}
          error={error}
          onCancel={() => {
            setEditorRecord(undefined);
            setEditorInitialContent("");
            setError(null);
          }}
          onSubmit={(draft) => void save(draft)}
        />
      )}
      {readerRecord && <ResearchRecordReader
        record={readerRecord}
        onClose={() => { setReaderNotice(null); setReaderRecord(null); }}
        actions={({ sourceContentVersionId, sourceTextComplete }) => (
          <div className="research-cognition-entry">
            {readerNotice && <p className="research-operation-success" role="status">{readerNotice}</p>}
            <h3>这份资料改变了你的判断吗？</h3>
            <div><button className="button" type="button" onClick={() => setReaderNotice("已记下这份资料")}>没有，先记下来</button><button className="button primary" type="button" disabled={pending} onClick={() => void startCognitionUpdate(readerRecord, sourceContentVersionId, sourceTextComplete)}>有，更新我的观点</button></div>
          </div>
        )}
      />}
      {cognitionUpdate && <CognitionUpdateEditor
        initialUpdate={cognitionUpdate}
        sourceTextComplete={cognitionSourceTextComplete}
        onClose={() => setCognitionUpdate(null)}
        onDraftSaved={() => setReaderNotice("认知草稿已保存")}
        onApplied={(topic) => { onTopicChange(topic); setReaderNotice("当前观点已更新"); }}
        onChanged={onCognitionChanged}
      />}
    </section>
  );
}
