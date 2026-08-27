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
  allTasks,
  onBack,
  onEdit,
  onChange,
  onOpenTask,
}: {
  topic: TopicDetailType;
  allTasks: Task[];
  onBack: () => void;
  onEdit: () => void;
  onChange: (topic: TopicDetailType) => void;
  onOpenTask: (task: ResearchTaskSummary) => void;
}) {
  const { text } = useTaskboardI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [linkTaskId, setLinkTaskId] = useState("");

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
        <button className="button" type="button" onClick={onBack}>← {text("返回研究看板", "Back to Research Board")}</button>
        <button className="button primary" type="button" onClick={onEdit}>{text("编辑当前认知", "Edit current state")}</button>
      </div>
      {error && <div className="research-error" role="alert">{error}</div>}

      <div className="research-detail-heading">
        <div>
          <span className="research-eyebrow">{researchStatusLabel(topic.status, text)}</span>
          <h1>{topic.title}</h1>
          <div className="research-labels">{topic.labels.map((label) => <span key={label}>{label}</span>)}</div>
        </div>
        <label className="research-status-control">
          <span>{text("研究状态", "Research status")}</span>
          <select disabled={pending} value={topic.status} onChange={(event) => void changeStatus(event.target.value as ResearchStatus)}>
            {RESEARCH_STATUSES.map((status) => <option key={status} value={status}>{researchStatusLabel(status, text)}</option>)}
          </select>
        </label>
      </div>

      <section className="research-current-state">
        <div>
          <span className="research-panel-label">{text("当前观点", "Current View")}</span>
          <p>{topic.currentView || text("尚未形成当前观点", "No current view yet")}</p>
        </div>
        <aside>
          <span>{text("置信度", "Confidence")}</span>
          <strong className={topic.confidenceLevel ? `confidence-${topic.confidenceLevel}` : ""}>
            {confidenceLabel(topic.confidenceLevel, text)}
          </strong>
        </aside>
      </section>

      <div className="research-detail-grid research-context-grid">
        <article>
          <h2>{text("核心问题", "Core Question")}</h2>
          <p>{topic.coreQuestion || text("尚未填写", "Not added yet")}</p>
        </article>
        <article>
          <h2>{text("下一步行动", "Next Action")}</h2>
          <p>{topic.nextAction || text("尚未填写", "Not added yet")}</p>
        </article>
        <article>
          <h2>{text("重新研究触发条件", "Review Trigger")}</h2>
          <p>{topic.reviewTrigger || text("尚未填写", "Not added yet")}</p>
        </article>
        <article className="research-last-researched">
          <h2>{text("最后研究时间", "Last Researched")}</h2>
          <strong>{ageLabel}</strong>
          {topic.lastResearchedAt && <time dateTime={topic.lastResearchedAt}>{formattedDate(topic.lastResearchedAt)}</time>}
          <button className="button" type="button" disabled={pending} onClick={() => void markResearched()}>
            {text("标记今天已研究", "Mark researched today")}
          </button>
        </article>
      </div>

      <TopicQuestionList topic={topic} onChange={onChange} />

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
    </section>
  );
}
