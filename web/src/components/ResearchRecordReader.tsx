import { useEffect, useState, type ReactNode } from "react";

import { useTaskboardI18n } from "../i18n";
import { getResearchRecordContent, listResearchRecordContentVersions } from "../researchApi";
import {
  createResearchCompletenessPresentation,
} from "../researchCompletenessPresentation";
import type { ResearchRecord, ResearchRecordContent, ResearchRecordContentVersion } from "../researchTypes";
import { ResearchCompletenessPanel } from "./ResearchCompletenessPanel";
import { researchRecordKindLabel, researchRecordProviderLabel } from "./ResearchRecordEditor";
import { ResearchSummaryPanel } from "./ResearchSummaryPanel";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sourceLabel(record: ResearchRecord) {
  if (record.captureAdapter === "chatgpt-browser-v1") return "浏览器读取";
  if (record.captureAdapter === "chatgpt-export-v1") return "历史导入";
  if (record.captureAdapter === "manual-v1") return "手动记录";
  return record.captureAdapter;
}

function versionSourceLabel(version: ResearchRecordContentVersion) {
  if (version.completenessDetails?.coverageRelation === "safe_merge") return "渐进合并";
  if (version.captureAdapter === "chatgpt-export-v1") return "ChatGPT 导出";
  if (version.captureAdapter === "chatgpt-browser-v1") return "浏览器读取";
  return version.captureAdapter;
}

export function ResearchRecordReader({
  record,
  onClose,
  backLabel,
  actions,
  initialVersionNumber,
}: {
  record: ResearchRecord;
  onClose: () => void;
  backLabel?: string;
  actions?: ReactNode | ((context: { sourceContentVersionId: string | null; sourceTextComplete: boolean }) => ReactNode);
  initialVersionNumber?: number;
}) {
  const { text } = useTaskboardI18n();
  const [content, setContent] = useState<ResearchRecordContent | null>(null);
  const [versions, setVersions] = useState<ResearchRecordContentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getResearchRecordContent(record.id, initialVersionNumber),
      listResearchRecordContentVersions(record.id),
    ])
      .then(([nextContent, nextVersions]) => {
        if (!active) return;
        setContent(nextContent);
        setVersions(nextVersions);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [initialVersionNumber, record.captureAdapter, record.id]);

  async function selectVersion(version: number) {
    setLoading(true);
    setError(null);
    try {
      setContent(await getResearchRecordContent(record.id, version));
    } catch (versionError) {
      setError(errorMessage(versionError));
    } finally {
      setLoading(false);
    }
  }

  const resolvedCompleteness = content?.completeness ?? record.captureCompleteness;
  const completeness = createResearchCompletenessPresentation({
    completeness: resolvedCompleteness ?? null,
    details: content?.completenessDetails,
    messageCount: content?.messageCount ?? 0,
    context: "reader",
    captureAdapter: content?.captureAdapter ?? record.captureAdapter,
  });
  const selectedVersion = content
    ? versions.find((version) => version.versionNumber === content.versionNumber) ?? null
    : null;
  const selectedVersionIsCurrent = selectedVersion?.isCurrent ?? true;

  return (
    <div className="modal-backdrop research-content-backdrop" role="presentation">
      <section className="research-content-reader" role="dialog" aria-modal="true" aria-label={text("研究记录正文", "Research record content")}>
        <header className="research-reader-header">
          <div>
            <button className="research-reader-back" type="button" onClick={onClose}>← {backLabel ?? text("返回研究记录", "Back to research records")}</button>
            <span>{researchRecordProviderLabel(record.provider)} · {researchRecordKindLabel(record.kind)} · {sourceLabel(record)}</span>
            <h2>{record.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={text("关闭", "Close")}>×</button>
        </header>
        <div className="research-content-meta">
          <time dateTime={record.occurredAt}>{new Date(record.occurredAt).toLocaleString()}</time>
          {content && <div className="research-content-version"><span>{text("资料版本", "Source version")}</span>{versions.length > 1 ? <select aria-label={text("资料版本", "Source version")} value={content.versionNumber} disabled={loading} onChange={(event) => void selectVersion(Number(event.target.value))}>{versions.map((version) => {
            const versionCompleteness = createResearchCompletenessPresentation({
              completeness: version.completeness,
              details: version.completenessDetails,
              messageCount: version.messageCount,
              context: "reader",
              captureAdapter: version.captureAdapter,
            });
            return <option key={version.id} value={version.versionNumber}>资料版本 V{version.versionNumber} · {version.isCurrent ? "当前版本" : "旧版本"} · {versionSourceLabel(version)} · {version.messageCount} 条 · {versionCompleteness.compactLabel}</option>;
          })}</select> : <strong>资料版本 V{content.versionNumber} · 当前版本</strong>}</div>}
          {record.url && <a href={record.url} target="_blank" rel="noopener noreferrer">{text("打开原始内容 ↗", "Open original ↗")}</a>}
        </div>
        {content && !selectedVersionIsCurrent && <p className="research-version-notice" role="status">你正在查看旧版本</p>}
        {error && <div className="research-error" role="alert">{error}</div>}
        {loading ? <p className="research-empty-copy">{text("正在读取正文…", "Loading content…")}</p> : null}
        {!loading && !content ? <div className="research-reader-manual-copy">
          {record.summary && <section><span>{text("摘要", "Summary")}</span><p>{record.summary}</p></section>}
          {record.note && <section><span>{text("备注", "Note")}</span><p>{record.note}</p></section>}
          {!record.summary && !record.note && <p>{text("这条记录暂时没有可阅读的正文。", "This record does not have readable content yet.")}</p>}
        </div> : null}
        {resolvedCompleteness && record.captureAdapter !== "manual-v1" ? <div className="research-reader-completeness"><ResearchCompletenessPanel presentation={completeness} /></div> : null}
        {content?.versionId && <ResearchSummaryPanel
          recordId={record.id}
          sourceContentVersionId={content.versionId}
          sourceContentVersionNumber={content.versionNumber}
          sourceIsCurrent={selectedVersionIsCurrent}
        />}
        {actions && (record.captureAdapter === "manual-v1" || content) && <div className="research-reader-actions">{typeof actions === "function"
          ? actions({
            sourceContentVersionId: content?.versionId ?? null,
            sourceTextComplete: content?.completenessDetails?.textTranscriptComplete
              ?? content?.completeness === "complete",
          })
          : actions}</div>}
        {content && <section className="research-content-transcript">
          <h3>{record.captureAdapter === "manual-v1" ? "资料正文" : `对话内容 · ${content.messageCount} 条`}</h3>
          <div className="research-content-messages">
          {content.content.messages.map((message, index) => (
            <article key={message.id ?? message.sourceMessageId ?? index} className={`role-${message.role}`}>
              <strong>{record.captureAdapter === "manual-v1" ? "资料" : message.role === "user" ? text("我", "You") : message.role === "assistant" ? "ChatGPT" : message.role}</strong>
              {message.parts ? message.parts.map((part, partIndex) => part.type === "code"
                ? <pre key={partIndex}><code>{part.text}</code></pre>
                : part.type === "link"
                  ? <p key={partIndex}><a href={part.url} target="_blank" rel="noopener noreferrer">{part.text || part.url}</a></p>
                  : part.type === "media-placeholder"
                    ? <p key={partIndex} className="research-content-placeholder">[{part.label || "未完整保存的图片或文件"}]</p>
                    : <p key={partIndex}>{part.text}</p>) : <p>{message.text}</p>}
            </article>
          ))}
          </div>
        </section>}
      </section>
    </div>
  );
}
