import { useEffect, useState, type ReactNode } from "react";

import { useTaskboardI18n } from "../i18n";
import { getResearchRecordContent, listResearchRecordContentVersions } from "../researchApi";
import { captureReasonLabel } from "../researchCaptureLabels";
import type { ResearchRecord, ResearchRecordContent, ResearchRecordContentVersion } from "../researchTypes";
import { researchRecordKindLabel, researchRecordProviderLabel } from "./ResearchRecordEditor";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sourceLabel(record: ResearchRecord) {
  if (record.captureAdapter === "chatgpt-browser-v1") return "浏览器捕获";
  if (record.captureAdapter === "chatgpt-export-v1") return "历史导入";
  if (record.captureAdapter === "manual-v1") return "手动记录";
  return record.captureAdapter;
}

export function ResearchRecordReader({
  record,
  onClose,
  backLabel,
  actions,
}: {
  record: ResearchRecord;
  onClose: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  const { text } = useTaskboardI18n();
  const [content, setContent] = useState<ResearchRecordContent | null>(null);
  const [versions, setVersions] = useState<ResearchRecordContentVersion[]>([]);
  const [loading, setLoading] = useState(record.captureAdapter !== "manual-v1");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (record.captureAdapter === "manual-v1") return;
    let active = true;
    Promise.all([
      getResearchRecordContent(record.id),
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
  }, [record.captureAdapter, record.id]);

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
          {content && <span>{content.messageCount} {text("条可见消息", "visible messages")}{content.omittedMessageCount > 0 ? ` · ${content.omittedMessageCount} ${text("条已省略", "omitted")}` : ""}</span>}
          {(content?.completeness ?? record.captureCompleteness) && <strong className={`capture-${content?.completeness ?? record.captureCompleteness}`}>{(content?.completeness ?? record.captureCompleteness) === "complete" ? "✓ 已确认完整" : "⚠ 可能不完整"}</strong>}
          {versions.length > 1 && content && <label>{text("正文版本", "Content version")}<select value={content.versionNumber} disabled={loading} onChange={(event) => void selectVersion(Number(event.target.value))}>{versions.map((version) => <option key={version.id} value={version.versionNumber}>版本 {version.versionNumber} · {version.messageCount} 条 · {version.completeness === "complete" ? "完整" : "可能不完整"}{version.isCurrent ? " · 当前" : ""}</option>)}</select></label>}
          {record.url && <a href={record.url} target="_blank" rel="noopener noreferrer">{text("打开原始内容 ↗", "Open original ↗")}</a>}
        </div>
        {actions && <div className="research-reader-actions">{actions}</div>}
        {error && <div className="research-error" role="alert">{error}</div>}
        {loading ? <p className="research-empty-copy">{text("正在读取正文…", "Loading content…")}</p> : null}
        {!loading && !content ? <div className="research-reader-manual-copy">
          {record.summary && <section><span>{text("摘要", "Summary")}</span><p>{record.summary}</p></section>}
          {record.note && <section><span>{text("备注", "Note")}</span><p>{record.note}</p></section>}
          {!record.summary && !record.note && <p>{text("这条记录暂时没有可阅读的正文。", "This record does not have readable content yet.")}</p>}
        </div> : null}
        {content?.completeness === "partial" && content.completenessDetails?.reasons.length ? <div className="research-capture-warning"><strong>这份正文可能不完整</strong><ul>{content.completenessDetails.reasons.map((reason) => <li key={reason}>{captureReasonLabel(reason)}</li>)}</ul></div> : null}
        {content && <div className="research-content-messages">
          {content.content.messages.map((message, index) => (
            <article key={message.id ?? message.sourceMessageId ?? index} className={`role-${message.role}`}>
              <strong>{message.role === "user" ? text("我", "You") : message.role === "assistant" ? "ChatGPT" : message.role}</strong>
              {message.parts ? message.parts.map((part, partIndex) => part.type === "code"
                ? <pre key={partIndex}><code>{part.text}</code></pre>
                : part.type === "link"
                  ? <p key={partIndex}><a href={part.url} target="_blank" rel="noopener noreferrer">{part.text || part.url}</a></p>
                  : part.type === "media-placeholder"
                    ? <p key={partIndex} className="research-content-placeholder">[{part.label || "未捕获的媒体内容"}]</p>
                    : <p key={partIndex}>{part.text}</p>) : <p>{message.text}</p>}
            </article>
          ))}
        </div>}
      </section>
    </div>
  );
}
