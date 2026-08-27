import { useCallback, useState, useEffect } from "react";

import "../research.css";
import { ApiError, listTasks } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createTopic,
  getTopic,
  listTopics,
  moveTopic,
  updateTopic,
} from "../researchApi";
import {
  RESEARCH_STATUSES,
  type ResearchStatus,
  type ResearchTaskSummary,
  type Topic,
  type TopicDetail as TopicDetailType,
  type TopicDraft,
} from "../researchTypes";
import type { Task } from "../types";
import { TopicDetail } from "./TopicDetail";
import { confidenceLabel, researchStatusLabel, TopicEditor } from "./TopicEditor";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function researchAge(value: string | null, text: (chinese: string, english: string) => string) {
  if (!value) return text("尚未研究", "Not researched");
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return text("今天研究", "Today");
  return text(`${days} 天未研究`, `${days} days ago`);
}

export function ResearchBoard({
  onOpenTask,
}: {
  onOpenTask: (task: ResearchTaskSummary) => void;
}) {
  const { text } = useTaskboardI18n();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<TopicDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorTopic, setEditorTopic] = useState<Topic | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);

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

  function replaceTopic(topic: Topic) {
    setTopics((current) => current.map((candidate) => candidate.id === topic.id ? topic : candidate));
    setSelectedTopic((current) => current?.id === topic.id
      ? { ...current, ...topic }
      : current);
  }

  function replaceTopicDetail(topic: TopicDetailType) {
    replaceTopic(topic);
    setSelectedTopic(topic);
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
        replaceTopicDetail(await updateTopic(editorTopic, draft));
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

  if (selectedTopic) {
    return (
      <>
        <TopicDetail
          topic={selectedTopic}
          allTasks={allTasks}
          onBack={() => setSelectedTopic(null)}
          onEdit={() => setEditorTopic(selectedTopic)}
          onChange={replaceTopicDetail}
          onOpenTask={onOpenTask}
        />
        {editorTopic !== undefined && (
          <TopicEditor
            topic={editorTopic}
            saving={saving}
            error={editorError}
            onCancel={() => setEditorTopic(undefined)}
            onSave={(draft) => void saveTopic(draft)}
          />
        )}
      </>
    );
  }

  return (
    <section className="research-board">
      <div className="research-board-heading">
        <div><span className="research-eyebrow">Research OS</span><h1>{text("研究看板", "Research Board")}</h1><p>{text("管理长期认知状态。具体执行仍由 Task Board 负责。", "Manage long-running research state while Task Board handles execution.")}</p></div>
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
                      <div className="research-card-heading">
                        <h3>{topic.title}</h3>
                        <span className={topic.confidenceLevel ? `confidence-${topic.confidenceLevel}` : ""}>
                          {confidenceLabel(topic.confidenceLevel, text)}
                        </span>
                      </div>
                      {topic.currentView && <p>{topic.currentView}</p>}
                      {topic.nextAction && <div className="research-card-next"><span>{text("下一步", "Next")}</span>{topic.nextAction}</div>}
                      <div className="research-card-metrics">
                        <span>{topic.openQuestionCount} {text("个未解决", "open")}</span>
                        <span>{researchAge(topic.lastResearchedAt, text)}</span>
                      </div>
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
      {editorTopic !== undefined && (
        <TopicEditor
          topic={editorTopic}
          saving={saving}
          error={editorError}
          onCancel={() => setEditorTopic(undefined)}
          onSave={(draft) => void saveTopic(draft)}
        />
      )}
    </section>
  );
}
