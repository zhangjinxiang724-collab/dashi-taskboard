import { useMemo, useState } from "react";

import { ApiError } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  linkTopicTask,
  markTopicResearched,
  moveTopic,
  unlinkTopicTask,
} from "../researchApi";
import {
  RESEARCH_STATUSES,
  type ResearchStatus,
  type ResearchTaskSummary,
  type TopicDetail as TopicDetailType,
} from "../researchTypes";
import type { Task } from "../types";
import { confidenceLabel, researchStatusLabel } from "./TopicEditor";
import { TopicQuestionList } from "./TopicQuestionList";
import { ResearchRecordSection } from "./ResearchRecordSection";
import { CognitionUpdateHistory } from "./CognitionUpdateHistory";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formattedDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function daysSince(value: string | null) {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
}

export function TopicDetail({
  topic,
  recordCount,
  allTasks,
  onBack,
  onEdit,
  onChange,
  onOpenTask,
  onCapture,
  onRecordCountChange,
}: {
  topic: TopicDetailType;
  recordCount: number;
  allTasks: Task[];
  onBack: () => void;
  onEdit: () => void;
  onChange: (topic: TopicDetailType) => void;
  onOpenTask: (task: ResearchTaskSummary) => void;
  onCapture: () => void;
  onRecordCountChange: (count: number) => void;
}) {
  const { text } = useTaskboardI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cognitionRefreshKey, setCognitionRefreshKey] = useState(0);
  const [linkTaskId, setLinkTaskId] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const linkedTaskIds = useMemo(
    () => new Set(topic.tasks.map((task) => task.id)),
    [topic.tasks],
  );
  const availableTasks = allTasks.filter((task) => !linkedTaskIds.has(task.id));
  const elapsedDays = daysSince(topic.lastResearchedAt);

  function setOperationError(operationError: unknown) {
    if (operationError instanceof ApiError && operationError.code === "TOPIC_VERSION_CONFLICT") {
      setError(text(
        "这个主题已在别处更新，请返回 Research Board 后重新打开再操作。",
        "This topic changed elsewhere. Return to the Research Board and reopen it.",
      ));
    } else {
      setError(message(operationError));
    }
  }

  async function changeStatus(status: ResearchStatus) {
    if (topic.status === status) return;
    setPending(true);
    setError(null);
    try {
      onChange(await moveTopic(topic, status));
    } catch (operationError) {
      setOperationError(operationError);
    } finally {
      setPending(false);
    }
  }

  async function markResearched() {
    setPending(true);
    setError(null);
    try {
      onChange(await markTopicResearched(topic));
    } catch (operationError) {
      setOperationError(operationError);
    } finally {
      setPending(false);
    }
  }

  async function addTask() {
    if (!linkTaskId) return;
    setPending(true);
    setError(null);
    try {
      onChange(await linkTopicTask(topic.id, linkTaskId));
      setLinkTaskId("");
    } catch (operationError) {
      setOperationError(operationError);
    } finally {
      setPending(false);
    }
  }

  async function removeTask(taskId: string) {
    setPending(true);
    setError(null);
    try {
      await unlinkTopicTask(topic.id, taskId);
      onChange({
        ...topic,
        tasks: topic.tasks.filter((task) => task.id !== taskId),
      });
    } catch (operationError) {
      setOperationError(operationError);
    } finally {
      setPending(false);
    }
  }

  const ageLabel = topic.lastResearchedAt === null
    ? text("尚未标记研究", "Not marked as researched")
    : elapsedDays === 0
      ? text("今天已研究", "Researched today")
      : text(`${elapsedDays} 天前研究`, `Researched ${elapsedDays} days ago`);

  return (
    <section className="research-detail">
      <div className="research-detail-toolbar">
        <button className="research-back-link" type="button" onClick={onBack}>← {text("返回研究", "Back to Research")}</button>
        <button className="button" type="button" onClick={onEdit}>{text("编辑主题", "Edit topic")}</button>
      </div>
      {error && <div className="research-error" role="alert">{error}</div>}

      <div className="research-detail-heading">
        <div><h1>{topic.title}</h1></div>
        <div className="research-topic-meta">
          <label className="research-status-control">
            <span className="sr-only">{text("研究状态", "Research status")}</span>
            <select disabled={pending} value={topic.status} onChange={(event) => void changeStatus(event.target.value as ResearchStatus)}>
              {RESEARCH_STATUSES.map((status) => <option key={status} value={status}>{researchStatusLabel(status, text)}</option>)}
            </select>
          </label>
          <span className="research-meta-date">{text("创建于", "Created")} {new Intl.DateTimeFormat(undefined,{year:"numeric",month:"long",day:"numeric"}).format(new Date(topic.createdAt))}</span>
          <span className="research-meta-separator" aria-hidden="true">·</span>
          <span className="research-meta-date">{text(`共 ${recordCount} 份资料`, `${recordCount} sources`)}</span>
        </div>
        {topic.labels.length > 0 && <div className="research-labels">{topic.labels.map((label) => <span key={label}>{label}</span>)}</div>}
      </div>

      <nav className="research-journey" aria-label={text("研究主线", "Research journey")}>
        {[
          [text("研究主题", "Topic"), text("明确问题与方向", "Define the question")],
          [text("研究资料", "Sources"), text("阅读资料，提取信息", "Read and extract")],
          [text("内容总结", "Summary"), text("生成关键结论", "Form conclusions")],
          [text("更新认知", "Cognition"), text("形成新的观点", "Update your view")],
        ].map(([label, description],index) => <span key={label} className={index === 0 ? "active" : ""}><i>{index + 1}</i><b>{label}<small>{description}</small></b></span>)}
      </nav>

      <section className="research-reading-section research-current-state">
        <div className="research-reading-heading">
          <h2>{text("当前观点", "Current View")}</h2>
          <button className="research-inline-action" type="button" onClick={onEdit}>{text("编辑", "Edit")}</button>
        </div>
        {topic.currentView ? (
          <p>{topic.currentView}</p>
        ) : (
          <div className="research-friendly-empty">
            <p>{text("当前还没有形成明确观点。研究一段时间后，把现在最核心的判断留在这里。", "No clear view has formed yet. Leave your most important current judgment here after some research.")}</p>
            <button className="button" type="button" onClick={onEdit}>{text("添加当前观点", "Add current view")}</button>
          </div>
        )}
      </section>

      <ResearchRecordSection
        topicId={topic.id}
        onCapture={onCapture}
        onTopicChange={onChange}
        onCognitionChanged={() => setCognitionRefreshKey((value) => value + 1)}
        onCountChange={onRecordCountChange}
      />

      <button className="research-settings-toggle" type="button" aria-expanded={showSettings} onClick={() => setShowSettings((value) => !value)}>{text("研究设置", "Research settings")} <span>{showSettings ? "−" : "+"}</span></button>
      {showSettings && <div className="research-secondary-settings">
      <div className="research-focus-grid">
        <section className="research-reading-section research-core-question">
          <div className="research-reading-heading"><h2>{text("核心问题", "Core Question")}</h2></div>
          <p>{topic.coreQuestion || text("还没有写下这个主题最需要回答的问题。", "The central question for this topic has not been written yet.")}</p>
        </section>
        <section className="research-reading-section research-next-action">
          <div className="research-reading-heading"><h2>{text("下一步", "Next Action")}</h2></div>
          <p>{topic.nextAction || text("还没有安排下一步。可以从一个最小、可验证的问题开始。", "No next step yet. Start with one small, verifiable question.")}</p>
        </section>
      </div>

      <TopicQuestionList topic={topic} onChange={onChange} />

      <section className="research-reading-section research-tracking-section">
        <div className="research-reading-heading"><h2>{text("跟踪", "Tracking")}</h2></div>
        <div className="research-tracking-grid">
          <div>
            <span>{text("重新研究触发条件", "Review Trigger")}</span>
            <p>{topic.reviewTrigger || text("还没有设置需要重新研究的触发事件。", "No review trigger has been set yet.")}</p>
          </div>
          <div className="research-last-researched">
            <span>{text("最后研究", "Last Researched")}</span>
            <strong>{ageLabel}</strong>
            {topic.lastResearchedAt && <time dateTime={topic.lastResearchedAt}>{formattedDate(topic.lastResearchedAt)}</time>}
            <button className="button" type="button" disabled={pending} onClick={() => void markResearched()}>
              {text("标记今天已研究", "Mark researched today")}
            </button>
          </div>
        </div>
      </section>

      <section className="research-tasks-panel">
        <div className="research-section-heading">
          <div><span>{text("执行层", "Execution layer")}</span><h2>{text("关联任务", "Associated Tasks")}</h2></div>
          <div className="research-link-control">
            <select value={linkTaskId} onChange={(event) => setLinkTaskId(event.target.value)} aria-label={text("选择要关联的任务", "Choose a task to link")}>
              <option value="">{text("选择现有任务…", "Choose an existing task…")}</option>
              {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.identifier} · {task.title}</option>)}
            </select>
            <button className="button" type="button" disabled={!linkTaskId || pending} onClick={() => void addTask()}>{text("关联", "Link")}</button>
          </div>
        </div>
        {topic.tasks.length === 0 ? (
          <p className="research-empty-copy">{text("还没有关联任务。可以从上方选择原 Task Board 中的任务。", "No tasks linked yet. Choose an existing Task Board issue above.")}</p>
        ) : (
          <div className="research-task-list">
            {topic.tasks.map((task) => (
              <div key={task.id} className="research-task-row">
                <button type="button" onClick={() => onOpenTask(task)}><strong>{task.identifier}</strong><span>{task.title}</span></button>
                <span className="research-task-status">{task.status.replaceAll("_", " ")}</span>
                <button className="button subtle" type="button" disabled={pending} onClick={() => void removeTask(task.id)}>{text("解除关联", "Unlink")}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      </div>}
      <CognitionUpdateHistory topicId={topic.id} refreshKey={cognitionRefreshKey} />
    </section>
  );
}
