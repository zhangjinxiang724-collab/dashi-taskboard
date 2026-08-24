import { useEffect, useState, type FormEvent } from "react";

import { useTaskboardI18n } from "../i18n";
import {
  RESEARCH_STATUSES,
  type ResearchStatus,
  type Topic,
  type TopicDraft,
} from "../researchTypes";

const STATUS_LABELS: Record<ResearchStatus, readonly [string, string]> = {
  inbox: ["收件箱", "Inbox"],
  active: ["主动研究", "Active Research"],
  waiting: ["等待", "Waiting"],
  thesis_formed: ["观点已形成", "Thesis Formed"],
  tracking: ["持续跟踪", "Tracking"],
  archived: ["已归档", "Archived"],
};

export function researchStatusLabel(
  status: ResearchStatus,
  text: (chinese: string, english: string) => string,
) {
  return text(...STATUS_LABELS[status]);
}

export function TopicEditor({
  topic,
  saving,
  error,
  onCancel,
  onSave,
}: {
  topic: Topic | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (draft: TopicDraft) => void;
}) {
  const { text } = useTaskboardI18n();
  const [title, setTitle] = useState(topic?.title ?? "");
  const [status, setStatus] = useState<ResearchStatus>(topic?.status ?? "inbox");
  const [coreQuestion, setCoreQuestion] = useState(topic?.coreQuestion ?? "");
  const [currentView, setCurrentView] = useState(topic?.currentView ?? "");
  const [nextAction, setNextAction] = useState(topic?.nextAction ?? "");
  const [labels, setLabels] = useState(topic?.labels.join(", ") ?? "");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, saving]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      title: title.trim(),
      status,
      coreQuestion: coreQuestion.trim(),
      currentView: currentView.trim(),
      nextAction: nextAction.trim(),
      labels: [...new Set(labels.split(",").map((label) => label.trim()).filter(Boolean))],
    });
  }

  return (
    <div className="research-dialog-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onCancel();
    }}>
      <form className="research-topic-form" role="dialog" aria-modal="true" aria-labelledby="research-editor-title" onSubmit={submit}>
        <header>
          <div>
            <span>{text("Research Topic", "Research Topic")}</span>
            <h2 id="research-editor-title">{topic ? text("编辑主题", "Edit topic") : text("新建主题", "New topic")}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label={text("关闭", "Close")}>×</button>
        </header>
        <div className="research-form-fields">
          <label>
            <span>{text("主题名称", "Topic title")}</span>
            <input autoFocus required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={text("例如：BSX 长期投资研究", "For example: Long-term BSX research")} />
          </label>
          <label>
            <span>{text("研究状态", "Research status")}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as ResearchStatus)}>
              {RESEARCH_STATUSES.map((candidate) => <option key={candidate} value={candidate}>{researchStatusLabel(candidate, text)}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>{text("核心问题", "Core Question")}</span>
            <textarea rows={3} value={coreQuestion} onChange={(event) => setCoreQuestion(event.target.value)} />
          </label>
          <label className="wide">
            <span>{text("当前观点", "Current View")}</span>
            <textarea rows={4} value={currentView} onChange={(event) => setCurrentView(event.target.value)} />
          </label>
          <label className="wide">
            <span>{text("下一步行动", "Next Action")}</span>
            <textarea rows={3} value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
          </label>
          <label className="wide">
            <span>{text("标签（用英文逗号分隔）", "Labels (comma separated)")}</span>
            <input value={labels} onChange={(event) => setLabels(event.target.value)} />
          </label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <footer>
          <button className="button" type="button" disabled={saving} onClick={onCancel}>{text("取消", "Cancel")}</button>
          <button className="button primary" type="submit" disabled={saving || !title.trim()}>{saving ? text("保存中…", "Saving…") : text("保存", "Save")}</button>
        </footer>
      </form>
    </div>
  );
}
