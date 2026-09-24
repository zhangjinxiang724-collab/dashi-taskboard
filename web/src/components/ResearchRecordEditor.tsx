import { useEffect, useState, type FormEvent } from "react";

import { useTaskboardI18n } from "../i18n";
import {
  RESEARCH_RECORD_KINDS,
  RESEARCH_RECORD_PROVIDERS,
  type ResearchRecord,
  type ResearchRecordDraft,
  type ResearchRecordKind,
  type ResearchRecordProvider,
} from "../researchTypes";

const providerLabels: Record<ResearchRecordProvider, string> = {
  chatgpt: "ChatGPT",
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  other: "其他",
};

const kindLabels: Record<ResearchRecordKind, string> = {
  chat: "对话",
  deep_research: "深度研究",
  workspace: "工作区研究",
  agent_run: "智能体执行",
  other: "其他",
};

function localDateTime(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function researchRecordProviderLabel(provider: ResearchRecordProvider) {
  return providerLabels[provider];
}

export function researchRecordKindLabel(kind: ResearchRecordKind) {
  return kindLabels[kind];
}

export function ResearchRecordEditor({
  record,
  initialContent,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  record: ResearchRecord | null;
  initialContent: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (draft: ResearchRecordDraft) => void;
}) {
  const { text } = useTaskboardI18n();
  const [title, setTitle] = useState(record?.title ?? "");
  const [provider, setProvider] = useState<ResearchRecordProvider>(record?.provider ?? "other");
  const [kind, setKind] = useState<ResearchRecordKind>(record?.kind ?? "other");
  const [url, setUrl] = useState(record?.url ?? "");
  const [externalId, setExternalId] = useState(record?.externalId ?? "");
  const [summary, setSummary] = useState(record?.summary ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [content, setContent] = useState(initialContent);
  const [occurredAt, setOccurredAt] = useState(localDateTime(record?.occurredAt ?? new Date().toISOString()));
  const contentEditable = !record || record.captureAdapter === "manual-v1";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, pending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      title,
      provider,
      kind,
      url: url.trim() || null,
      externalId: externalId.trim() || null,
      summary,
      note,
      content,
      occurredAt: new Date(occurredAt).toISOString(),
    });
  }

  return (
    <div className="research-dialog-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel();
    }}>
      <form className="research-topic-form research-record-form" role="dialog" aria-modal="true" aria-labelledby="research-record-editor-title" onSubmit={submit}>
        <header>
          <div>
            <span>{text("资料说明", "Source details")}</span>
            <h2 id="research-record-editor-title">{record ? text("编辑研究记录", "Edit research record") : text("添加研究记录", "Add research record")}</h2>
          </div>
          <button className="icon-button" type="button" disabled={pending} onClick={onCancel} aria-label={text("关闭", "Close")}>×</button>
        </header>

        <div className="research-form-fields">
          <label className="wide">
            <span>{text("标题", "Title")}</span>
            <input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </label>
          <label>
            <span>{text("来源工具（可选）", "Source tool (optional)")}</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value as ResearchRecordProvider)}>
              {RESEARCH_RECORD_PROVIDERS.map((value) => <option key={value} value={value}>{value === "other" ? text("未指定 / 其他", "Not specified / Other") : providerLabels[value]}</option>)}
            </select>
          </label>
          <label>
            <span>{text("资料类型", "Source type")}</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as ResearchRecordKind)}>
              {RESEARCH_RECORD_KINDS.map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>{text("研究时间", "Occurred at")}</span>
            <input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
          </label>
          <label className="wide">
            <span>{text("原始对话链接（可选）", "Original conversation URL (optional)")}</span>
            <input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
          {contentEditable && <label className="wide">
            <span>{text("资料正文", "Source content")}</span>
            <textarea required rows={8} value={content} onChange={(event) => setContent(event.target.value)} placeholder={text("粘贴文章、对话、会议记录或自己的研究笔记", "Paste the article, conversation, meeting notes, or your own research notes")} />
          </label>}
          <label className="wide">
            <span>{text("资料说明（可选）", "Source description (optional)")}</span>
            <textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <label className="wide">
            <span>{text("个人笔记（可选）", "Personal note (optional)")}</span>
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>

        <details className="research-record-advanced">
          <summary>{text("高级信息", "Advanced information")}</summary>
          <label>
            <span>{text("外部记录编号（可选）", "External ID (optional)")}</span>
            <input maxLength={1000} value={externalId} onChange={(event) => setExternalId(event.target.value)} />
          </label>
        </details>

        {error && <div className="form-error" role="alert">{error}</div>}
        <footer>
          <button className="button" type="button" disabled={pending} onClick={onCancel}>{text("取消", "Cancel")}</button>
          <button className="button primary" type="submit" disabled={pending || !title.trim() || (contentEditable && !content.trim()) || !occurredAt}>
            {pending ? text("保存中…", "Saving…") : text("保存记录", "Save record")}
          </button>
        </footer>
      </form>
    </div>
  );
}
