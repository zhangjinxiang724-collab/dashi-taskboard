import { useEffect, useState } from "react";

import { ApiError } from "../api";
import {
  confirmBrowserCapturePreview,
  getBrowserCapturePreview,
  listTopics,
} from "../researchApi";
import type { BrowserCapturePreview, Topic } from "../researchTypes";
import {
  captureCompletenessPresentation,
  captureReasonLabel,
  unsupportedContentLabels,
} from "../researchCaptureLabels";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const relationLabel = {
  new: "新对话",
  identical: "已经是最新",
  append: "发现后续新消息",
  safe_merge: "发现同一对话的新覆盖内容",
  conflict: "历史内容发生变化",
} as const;

export function ResearchCapturePreview({ previewId }: { previewId: string }) {
  const [preview, setPreview] = useState<BrowserCapturePreview | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [allowPartial, setAllowPartial] = useState(false);
  const [acceptConflict, setAcceptConflict] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [savedToInbox, setSavedToInbox] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getBrowserCapturePreview(previewId), listTopics(controller.signal)])
      .then(([nextPreview, nextTopics]) => {
        setPreview(nextPreview);
        setTopics(nextTopics);
        setTopicId(nextPreview.existingRecord?.topicId ?? "");
      })
      .catch((loadError) => setError(message(loadError)))
      .finally(() => setPending(false));
    return () => controller.abort();
  }, [previewId]);

  async function confirm() {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      const saved = await confirmBrowserCapturePreview(preview.id, {
        topicId: topicId || null,
        allowPartial,
        conflictAction: acceptConflict ? "replace-current" : null,
        expectedRecordVersion: preview.existingRecord?.version ?? null,
      });
      setSavedToInbox(!topicId && saved.kind !== "already_latest");
      setResult(saved.kind === "already_latest"
        ? "这条对话已经是最新版本，没有重复写入。"
        : saved.kind === "created"
          ? !topicId
            ? `已保存到待整理记录，正文版本 ${saved.contentVersion ?? 1}。`
            : `已保存 Research Record，正文版本 ${saved.contentVersion ?? 1}。`
          : `已安全更新 Research Record，正文版本 ${saved.contentVersion ?? ""}；旧版本仍然保留。`);
      setPreview((current) => current ? { ...current, status: "committed" } : current);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.code === "RESEARCH_RECORD_VERSION_CONFLICT") {
        setError("这条研究记录已在别处更新。请刷新 Preview 后重新确认。");
      } else {
        setError(message(saveError));
      }
    } finally {
      setPending(false);
    }
  }

  if (pending && !preview) return <section className="research-capture-preview"><p>正在读取捕获预览…</p></section>;
  if (!preview) return <section className="research-capture-preview"><div className="research-error">{error ?? "捕获预览不存在或已经过期。"}</div></section>;

  const partial = preview.completeness === "partial";
  const conflict = preview.relation === "conflict";
  const failed = preview.completeness === "failed";
  const completeness = captureCompletenessPresentation(preview.completeness, preview.completenessDetails);
  const unsupportedContent = Object.entries(preview.completenessDetails?.unsupportedContentCounts ?? {})
    .filter(([, count]) => Number(count) > 0);
  const canSave = !failed
    && (!partial || allowPartial)
    && (!conflict || acceptConflict)
    && preview.status !== "committed";

  return (
    <section className="research-capture-preview">
      <header>
        <span>ChatGPT Browser Capture</span>
        <h1>保存当前研究对话</h1>
        <p>捕获不等于保存。请确认内容完整性和 Topic 后再写入 Research OS。</p>
      </header>
      <article className="research-capture-summary">
        <div className="research-capture-title">
          <div><span>当前对话</span><h2>{preview.title}</h2></div>
          <a href={preview.sourceUrl} target="_blank" rel="noopener noreferrer">打开原对话 ↗</a>
        </div>
        <div className="research-capture-facts">
          <span><small>消息</small><strong>{preview.messageCount} 条</strong></span>
          <span><small>总体</small><strong className={`capture-${preview.completeness}`}>{completeness.overallLabel}</strong></span>
          <span><small>文字问答</small><strong className={preview.completenessDetails?.textTranscriptComplete ? "capture-complete" : "capture-partial"}>{completeness.textLabel}</strong></span>
          <span><small>富媒体</small><strong className={preview.completenessDetails?.richContentComplete ? "capture-complete" : "capture-partial"}>{completeness.richLabel}</strong></span>
          <span><small>判断</small><strong>{preview.relation ? relationLabel[preview.relation] : "正在判断"}</strong></span>
        </div>
        {unsupportedContent.length ? <div className="research-capture-media-facts">
          {unsupportedContent.map(([type, count]) => <span key={type}>{unsupportedContentLabels[type] ?? "其他内容"}未完整保存：{Number(count)}</span>)}
        </div> : null}
        {preview.relation === "safe_merge" && preview.coverage ? (
          <div className="research-capture-warning research-capture-coverage">
            <strong>将安全合并为同一条研究记录</strong>
            <p>现有 {preview.coverage.existingMessageCount} 条 · 本次 {preview.coverage.incomingMessageCount} 条 · 合并后 {preview.coverage.mergedMessageCount} 条 · 新增覆盖 {preview.coverage.newCoverageMessageCount} 条</p>
            <p>最早边界{preview.coverage.earliestBoundaryConfirmed ? "已确认" : "未确认"} · 最新边界{preview.coverage.latestBoundaryConfirmed ? "已确认" : "未确认"}</p>
          </div>
        ) : null}
        {preview.completenessDetails?.reasons.length ? (
          <div className="research-capture-warning"><strong>{completeness.partialHeading}</strong><ul>{preview.completenessDetails.reasons.map((reason) => <li key={reason}>{captureReasonLabel(reason)}</li>)}</ul></div>
        ) : null}
        {(preview.messages?.length ?? 0) > 0 ? (
          <details className="research-capture-transcript" open>
            <summary>捕获正文 · {preview.messages?.length ?? 0} 条</summary>
            <div className="research-capture-transcript-list">
              {(preview.messages ?? []).map((capturedMessage) => (
                <article key={capturedMessage.sourceMessageId ?? capturedMessage.fingerprint}>
                  <strong>{capturedMessage.role === "user" ? "我" : capturedMessage.role === "assistant" ? "ChatGPT" : "可见结果"}</strong>
                  {capturedMessage.parts.map((part, index) => part.type === "code"
                    ? <pre key={index}><code>{part.text}</code></pre>
                    : part.type === "link"
                      ? <a key={index} href={part.url} target="_blank" rel="noopener noreferrer">{part.text ?? part.url}</a>
                      : <p key={index}>{part.text ?? part.label}</p>)}
                </article>
              ))}
            </div>
          </details>
        ) : null}
        {conflict && <div className="research-capture-warning"><strong>不会静默覆盖</strong><p>同一 Conversation 的历史内容发生了非追加变化。保存后会创建新的正文版本，旧版本继续保留。</p></div>}
        <label className="research-capture-topic">
          <span>归入 Topic</span>
          <select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
            <option value="">暂不分类</option>
            {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
          </select>
        </label>
        {partial && <label className="research-capture-confirmation"><input type="checkbox" checked={allowPartial} onChange={(event) => setAllowPartial(event.target.checked)} /><span>{preview.completenessDetails?.textTranscriptComplete && !preview.completenessDetails?.richContentComplete ? "我知道文字问答完整，但富媒体未完全归档；仍然保存，并保留部分完整标记。" : "我知道文字问答尚未确认完整，仍然保存，并保留部分完整标记。"}</span></label>}
        {conflict && <label className="research-capture-confirmation"><input type="checkbox" checked={acceptConflict} onChange={(event) => setAcceptConflict(event.target.checked)} /><span>保存为新的当前版本；旧正文版本不得删除。</span></label>}
        {error && <div className="research-error" role="alert">{error}</div>}
        {result && <div className="research-import-result"><span>{result}</span>{savedToInbox && <a href="/?researchView=inbox">前往研究收件箱</a>}</div>}
        <footer>
          <button className="button primary" type="button" disabled={!canSave || pending} onClick={() => void confirm()}>{preview.relation === "identical" ? "确认已经是最新" : "确认保存"}</button>
          <a className="button" href="/">返回 Research OS</a>
        </footer>
      </article>
    </section>
  );
}
