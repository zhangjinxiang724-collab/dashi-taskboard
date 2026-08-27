import { useCallback, useState, useEffect } from "react";

import "../research.css";
import { ApiError, listTasks } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createTopic,
  getTopic,
  listTopics,
  updateTopic,
} from "../researchApi";
import {
  RESEARCH_STATUSES,
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
        <div>
          <h1>{text("研究", "Research")}</h1>
          <p>{text("管理那些需要长期思考和持续跟踪的主题。", "Manage topics that need long-term thinking and continued attention.")}</p>
        </div>
        <button className="button primary" type="button" onClick={() => setEditorTopic(null)}>＋ {text("新建主题", "New topic")}</button>
      </div>
      {error && <div className="research-error" role="alert">{error}</div>}
      {loading ? <div className="research-loading">{text("正在读取研究主题…", "Loading research topics…")}</div> : (
        <div className="research-topic-groups">
          {RESEARCH_STATUSES.map((status) => {
            const statusTopics = topics.filter((topic) => topic.status === status);
            return (
              <section key={status} className={`research-topic-group status-${status}`}>
                <header>
                  <h2>{researchStatusLabel(status, text)}</h2>
                  <span>{statusTopics.length}</span>
                </header>
                <div className="research-topic-list">
                  {statusTopics.map((topic) => (
                    <button key={topic.id} className="research-topic-row" type="button" onClick={() => void openTopic(topic.id)}>
                      <span className="research-topic-primary">
                        <span className="research-topic-title-line">
                          <strong>{topic.title}</strong>
                          <span className={`research-status-badge status-${topic.status}`}>{researchStatusLabel(topic.status, text)}</span>
                        </span>
                        <span className="research-topic-summary">
                          {topic.currentView || text("当前还没有形成明确观点。", "No clear current view yet.")}
                        </span>
                      </span>
                      <span className="research-topic-confidence">
                        {confidenceLabel(topic.confidenceLevel, text)}
                      </span>
                      <span className="research-topic-open-count">
                        {topic.openQuestionCount} {text("个未解决问题", "open questions")}
                      </span>
                      <span className="research-topic-age">{researchAge(topic.lastResearchedAt, text)}</span>
                      <span className="research-topic-next">
                        <small>{text("下一步", "Next")}</small>
                        {topic.nextAction || text("还没有安排下一步", "No next action yet")}
                      </span>
                      <span className="research-topic-chevron" aria-hidden="true">›</span>
                    </button>
                  ))}
                  {statusTopics.length === 0 && (
                    <div className="research-group-empty">{text("这个阶段暂时没有主题。", "No topics in this stage yet.")}</div>
                  )}
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
