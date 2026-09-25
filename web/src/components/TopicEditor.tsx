import { useEffect, useState, type FormEvent } from "react";

import { useTaskboardI18n } from "../i18n";
import {
  type ConfidenceLevel,
  type ResearchStatus,
  type Topic,
  type TopicDraft,
} from "../researchTypes";

const STATUS_LABELS: Record<ResearchStatus, readonly [string, string]> = {
  inbox: ["进行中", "In progress"],
  active: ["进行中", "In progress"],
  waiting: ["暂停", "Paused"],
  thesis_formed: ["持续关注", "Following"],
  tracking: ["持续关注", "Following"],
  archived: ["已归档", "Archived"],
};

export const VISIBLE_RESEARCH_STATUSES = ["active", "waiting", "tracking", "archived"] as const;

export function visibleResearchStatus(status: ResearchStatus): (typeof VISIBLE_RESEARCH_STATUSES)[number] {
  if (status === "inbox") return "active";
  if (status === "thesis_formed") return "tracking";
  return status;
}

const CONFIDENCE_LABELS: Record<ConfidenceLevel, readonly [string, string]> = {
  low: ["低置信度", "Low confidence"],
  medium: ["中置信度", "Medium confidence"],
  high: ["高置信度", "High confidence"],
};

export function researchStatusLabel(
  status: ResearchStatus,
  text: (chinese: string, english: string) => string,
) {
  return text(...STATUS_LABELS[status]);
}

export function confidenceLabel(
  confidence: ConfidenceLevel | null,
  text: (chinese: string, english: string) => string,
) {
  return confidence ? text(...CONFIDENCE_LABELS[confidence]) : text("未设置", "Not set");
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
  const [status, setStatus] = useState<ResearchStatus>(visibleResearchStatus(topic?.status ?? "active"));
  const [coreQuestion, setCoreQuestion] = useState(topic?.coreQuestion ?? "");
  const [nextAction, setNextAction] = useState(topic?.nextAction ?? "");
  const [reviewTrigger, setReviewTrigger] = useState(topic?.reviewTrigger ?? "");
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
      status: topic && status === visibleResearchStatus(topic.status) ? topic.status : status,
      coreQuestion: coreQuestion.trim(),
      currentView: topic?.currentView ?? "",
      confidenceLevel: topic?.confidenceLevel ?? null,
      nextAction: nextAction.trim(),
      reviewTrigger: reviewTrigger.trim(),
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
            <h2 id="research-editor-title">{topic ? text("编辑主题", "Edit topic") : text("新建主题", "New topic")}</h2>
            <p>{topic
              ? text("调整这个研究主题的信息。", "Update this research topic.")
              : text("创建一个研究主题，开始你的分析与思考。", "Create a research topic and begin your analysis.")}</p>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label={text("关闭", "Close")}>×</button>
        </header>
        <div className="research-form-fields">
          <label>
            <span>{text("主题名称", "Topic title")}</span>
            <input autoFocus required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={text("例如：BSX 长期投资研究", "For example: Long-term BSX research")} />
          </label>
          <label className="wide">
            <span>{text("核心问题（可选）", "Core Question (optional)")}</span>
            <textarea rows={3} maxLength={500} value={coreQuestion} onChange={(event) => setCoreQuestion(event.target.value)} placeholder={text("例如：试点是否显著提升了公交运行效率？", "For example: Did the pilot improve transit efficiency?")} />
            <small className="research-topic-character-count">{coreQuestion.length}/500</small>
          </label>
          <label>
            <span>{text("研究状态", "Research status")}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as ResearchStatus)}>
              {VISIBLE_RESEARCH_STATUSES.map((candidate) => <option key={candidate} value={candidate}>{researchStatusLabel(candidate, text)}</option>)}
            </select>
          </label>
          <label>
            <span>{text("标签（可选）", "Labels (optional)")}</span>
            <input value={labels} onChange={(event) => setLabels(event.target.value)} />
          </label>
          <p className="research-topic-form-hint wide">{text("先写下主题名称就可以开始，其他内容以后再补。", "Start with a title. You can add the rest later.")}</p>
          <details className="research-topic-more wide">
            <summary><span><strong>{text("研究计划", "Research plan")}</strong><small>{text("下一步与重新研究的条件", "Next step and review trigger")}</small></span><i aria-hidden="true">⌄</i></summary>
            <div className="research-form-fields">
              <label className="wide">
                <span>{text("下一步行动", "Next Action")}</span>
                <textarea rows={3} value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
              </label>
              <label className="wide">
                <span>{text("重新研究触发条件", "Review Trigger")}</span>
                <textarea rows={2} value={reviewTrigger} onChange={(event) => setReviewTrigger(event.target.value)} placeholder={text("例如：下一季度财报发布", "For example: Next quarterly results")} />
              </label>
            </div>
          </details>
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
