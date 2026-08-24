import { useCallback, useEffect, useMemo, useState } from "react";

import "../research.css";
import { ApiError, listTasks } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createTopic,
  getTopic,
  linkTopicTask,
  listTopics,
  moveTopic,
  unlinkTopicTask,
  updateTopic,
} from "../researchApi";
import {
  RESEARCH_STATUSES,
  type ResearchStatus,
  type ResearchTaskSummary,
  type Topic,
  type TopicDetail,
  type TopicDraft,
} from "../researchTypes";
import type { Task } from "../types";
import { researchStatusLabel, TopicEditor } from "./TopicEditor";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ResearchBoard({
  onOpenTask,
}: {
  onOpenTask: (task: ResearchTaskSummary) => void;
}) {
  const { text } = useTaskboardI18n();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<TopicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorTopic, setEditorTopic] = useState<Topic | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);
  const [linkTaskId, setLinkTaskId] = useState("");
  const [relationPending, setRelationPending] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [nextTopics, nextTasks] = await Promise.all([
        listTopics(signal),
        listTasks(undefined, signal),
      ]);
      setTopics(nextTopics);
      setAllTasks(nextTasks);
    } catch (loadError) {
      if ((loadError as Error).name !== "AbortError") setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const linkedTaskIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedTopic) selectedTopic.tasks.forEach((task) => ids.add(task.id));
    return ids;
  }, [selectedTopic]);
  const availableTasks = allTasks.filter((task) => !linkedTaskIds.has(task.id));

  function replaceTopic(topic: Topic) {
    setTopics((current) => current.map((candidate) => candidate.id === topic.id ? topic : candidate));
    setSelectedTopic((current) => current?.id === topic.id
      ? { ...current, ...topic }
      : current);
  }

  async function openTopic(id: string) {
    setError(null);
    try {
      setSelectedTopic(await getTopic(id));
    } catch (openError) {
      setError(message(openError));
    }
  }

  async function saveTopic(draft: TopicDraft) {
    setSaving(true);
    setEditorError(null);
    try {
      if (editorTopic) {
        const updated = await updateTopic(editorTopic, draft);
        replaceTopic(updated);
        setSelectedTopic(updated);
      } else {
        const created = await createTopic(draft);
        setTopics((current) => [created, ...current]);
        setSelectedTopic(await getTopic(created.id));
      }
      setEditorTopic(undefined);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.code === "TOPIC_VERSION_CONFLICT") {
        setEditorError(text("这个主题已在别处更新，请关闭后重新打开再编辑。", "This topic changed elsewhere. Close and reopen it before editing."));
      } else {
        setEditorError(message(saveError));
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(topic: Topic, status: ResearchStatus) {
    if (topic.status === status) return;
    setError(null);
    try {
      replaceTopic(await moveTopic(topic, status));
    } catch (moveError) {
      setError(message(moveError));
      await reload();
    }
  }

  async function addTask() {
    if (!selectedTopic || !linkTaskId) return;
    setRelationPending(true);
    setError(null);
    try {
      const updated = await linkTopicTask(selectedTopic.id, linkTaskId);
      setSelectedTopic(updated);
      setLinkTaskId("");
    } catch (relationError) {
      setError(message(relationError));
    } finally {
      setRelationPending(false);
    }
  }

  async function removeTask(taskId: string) {
    if (!selectedTopic) return;
    setRelationPending(true);
    setError(null);
    try {
      await unlinkTopicTask(selectedTopic.id, taskId);
      setSelectedTopic({
        ...selectedTopic,
        tasks: selectedTopic.tasks.filter((task) => task.id !== taskId),
      });
    } catch (relationError) {
      setError(message(relationError));
    } finally {
      setRelationPending(false);
    }
  }

  if (selectedTopic) {
    return (
      <section className="research-detail">
        <div className="research-detail-toolbar">
          <button className="button" type="button" onClick={() => setSelectedTopic(null)}>← {text("返回研究看板", "Back to Research Board")}</button>
          <button className="button primary" type="button" onClick={() => setEditorTopic(selectedTopic)}>{text("编辑主题", "Edit topic")}</button>
        </div>
        {error && <div className="research-error" role="alert">{error}</div>}
        <div className="research-detail-heading">
          <div>
            <span className="research-eyebrow">{researchStatusLabel(selectedTopic.status, text)}</span>
            <h1>{selectedTopic.title}</h1>
            <div className="research-labels">{selectedTopic.labels.map((label) => <span key={label}>{label}</span>)}</div>
          </div>
          <label className="research-status-control">
            <span>{text("研究状态", "Research status")}</span>
            <select value={selectedTopic.status} onChange={(event) => void changeStatus(selectedTopic, event.target.value as ResearchStatus)}>
              {RESEARCH_STATUSES.map((status) => <option key={status} value={status}>{researchStatusLabel(status, text)}</option>)}
            </select>
          </label>
        </div>
        <div className="research-detail-grid">
          <article><h2>{text("核心问题", "Core Question")}</h2><p>{selectedTopic.coreQuestion || text("尚未填写", "Not added yet")}</p></article>
          <article><h2>{text("当前观点", "Current View")}</h2><p>{selectedTopic.currentView || text("尚未填写", "Not added yet")}</p></article>
          <article><h2>{text("下一步行动", "Next Action")}</h2><p>{selectedTopic.nextAction || text("尚未填写", "Not added yet")}</p></article>
        </div>
        <section className="research-tasks-panel">
          <div className="research-section-heading">
            <div><span>{text("执行层", "Execution layer")}</span><h2>{text("关联任务", "Associated Tasks")}</h2></div>
            <div className="research-link-control">
              <select value={linkTaskId} onChange={(event) => setLinkTaskId(event.target.value)} aria-label={text("选择要关联的任务", "Choose a task to link")}>
                <option value="">{text("选择现有任务…", "Choose an existing task…")}</option>
                {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.identifier} · {task.title}</option>)}
              </select>
              <button className="button" type="button" disabled={!linkTaskId || relationPending} onClick={() => void addTask()}>{text("关联", "Link")}</button>
            </div>
          </div>
          {selectedTopic.tasks.length === 0 ? (
            <p className="research-empty-copy">{text("还没有关联任务。可以从上方选择原 Task Board 中的任务。", "No tasks linked yet. Choose an existing Task Board issue above.")}</p>
          ) : (
            <div className="research-task-list">
              {selectedTopic.tasks.map((task) => (
                <div key={task.id} className="research-task-row">
                  <button type="button" onClick={() => onOpenTask(task)}><strong>{task.identifier}</strong><span>{task.title}</span></button>
                  <span className="research-task-status">{task.status.replaceAll("_", " ")}</span>
                  <button className="button subtle" type="button" disabled={relationPending} onClick={() => void removeTask(task.id)}>{text("解除关联", "Unlink")}</button>
                </div>
              ))}
            </div>
          )}
        </section>
        {editorTopic !== undefined && <TopicEditor topic={editorTopic} saving={saving} error={editorError} onCancel={() => setEditorTopic(undefined)} onSave={(draft) => void saveTopic(draft)} />}
      </section>
    );
  }

  return (
    <section className="research-board">
      <div className="research-board-heading">
        <div><span className="research-eyebrow">Research OS</span><h1>{text("研究看板", "Research Board")}</h1><p>{text("管理长期主题。具体执行仍由 Task Board 负责。", "Manage long-running topics while Task Board handles execution.")}</p></div>
        <button className="button primary" type="button" onClick={() => setEditorTopic(null)}>＋ {text("新建 Topic", "New Topic")}</button>
      </div>
      {error && <div className="research-error" role="alert">{error}</div>}
      {loading ? <div className="research-loading">{text("正在读取研究主题…", "Loading research topics…")}</div> : (
        <div className="research-columns">
          {RESEARCH_STATUSES.map((status) => {
            const columnTopics = topics.filter((topic) => topic.status === status);
            return (
              <section key={status} className={`research-column status-${status}`} onDragOver={(event) => event.preventDefault()} onDrop={() => {
                const topic = topics.find((candidate) => candidate.id === draggedTopicId);
                setDraggedTopicId(null);
                if (topic) void changeStatus(topic, status);
              }}>
                <header><span className="research-status-dot" /><h2>{researchStatusLabel(status, text)}</h2><span>{columnTopics.length}</span></header>
                <div className="research-column-body">
                  {columnTopics.map((topic) => (
                    <article key={topic.id} className="research-card" draggable onDragStart={() => setDraggedTopicId(topic.id)} onDragEnd={() => setDraggedTopicId(null)} onClick={() => void openTopic(topic.id)}>
                      <h3>{topic.title}</h3>
                      {topic.coreQuestion && <p>{topic.coreQuestion}</p>}
                      {topic.nextAction && <div className="research-card-next"><span>{text("下一步", "Next")}</span>{topic.nextAction}</div>}
                      <div className="research-labels">{topic.labels.map((label) => <span key={label}>{label}</span>)}</div>
                    </article>
                  ))}
                  {columnTopics.length === 0 && <div className="research-column-empty">{text("暂无主题", "No topics")}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {editorTopic !== undefined && <TopicEditor topic={editorTopic} saving={saving} error={editorError} onCancel={() => setEditorTopic(undefined)} onSave={(draft) => void saveTopic(draft)} />}
    </section>
  );
}
