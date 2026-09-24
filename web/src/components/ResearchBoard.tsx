import { useCallback, useState, useEffect, useMemo } from "react";

import "../research.css";
import { ApiError, listTasks } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createTopic,
  getResearchInboxSummary,
  getTopic,
  listResearchRecords,
  listTopics,
  updateTopic,
} from "../researchApi";
import {
  type ResearchTaskSummary,
  type Topic,
  type TopicDetail as TopicDetailType,
  type TopicDraft,
} from "../researchTypes";
import type { Task } from "../types";
import { TopicDetail } from "./TopicDetail";
import { ResearchImporter } from "./ResearchImporter";
import { BrowserCapturePairing } from "./BrowserCapturePairing";
import { ResearchInbox } from "./ResearchInbox";
import { TopicEditor } from "./TopicEditor";

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
  const [selectedTopic, setSelectedTopic] = useState<TopicDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorTopic, setEditorTopic] = useState<Topic | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [showImporter, setShowImporter] = useState(false);
  const [showCapturePairing, setShowCapturePairing] = useState(false);
  const [view, setView] = useState<"topics" | "inbox">(() => (
    new URL(document.baseURI).searchParams.get("researchView") === "inbox" ? "inbox" : "topics"
  ));
  const [inboxCount, setInboxCount] = useState(0);
  const [search, setSearch] = useState("");
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [nextTopics, nextTasks, nextInboxCount] = await Promise.all([
        listTopics(signal),
        listTasks(undefined, signal),
        getResearchInboxSummary(signal),
      ]);
      setTopics(nextTopics);
      setAllTasks(nextTasks);
      setInboxCount(nextInboxCount);
      const counts = await Promise.all(nextTopics.map(async (topic) => {
        try { return [topic.id, (await listResearchRecords(topic.id, signal)).length] as const; }
        catch { return [topic.id, 0] as const; }
      }));
      setRecordCounts(Object.fromEntries(counts));
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

  useEffect(() => {
    const onViewChange = (event: Event) => setView((event as CustomEvent<"topics" | "inbox">).detail);
    window.addEventListener("research-view-change", onViewChange);
    return () => window.removeEventListener("research-view-change", onViewChange);
  }, []);

  const visibleTopics = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? topics.filter((topic) => `${topic.title}\n${topic.currentView}`.toLocaleLowerCase().includes(query)) : topics;
  }, [search, topics]);

  const updateSelectedTopicRecordCount = useCallback((count: number) => {
    if (!selectedTopic) return;
    setRecordCounts((current) => ({ ...current, [selectedTopic.id]: count }));
  }, [selectedTopic?.id]);

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

  function upsertTopic(topic: Topic) {
    setTopics((current) => current.some((candidate) => candidate.id === topic.id)
      ? current.map((candidate) => candidate.id === topic.id ? topic : candidate)
      : [topic, ...current]);
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
          recordCount={recordCounts[selectedTopic.id] ?? 0}
          allTasks={allTasks}
          onBack={() => setSelectedTopic(null)}
          onEdit={() => setEditorTopic(selectedTopic)}
          onChange={replaceTopicDetail}
          onOpenTask={onOpenTask}
          onCapture={() => setShowCapturePairing(true)}
          onRecordCountChange={updateSelectedTopicRecordCount}
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
        {showCapturePairing && <BrowserCapturePairing onClose={() => setShowCapturePairing(false)} />}
      </>
    );
  }

  return (
    <section className="research-board">
      <div className="research-board-heading">
        <div>
          <h1>{view === "inbox" ? text("资料库", "Library") : text("我的研究", "My Research")}</h1>
          <p>{view === "inbox" ? text("收好资料，再把它放进长期研究主题。", "Collect sources and organize them into long-term topics.") : text("持续跟踪和分析你关心的问题。", "Keep tracking and analysing the questions you care about.")}</p>
        </div>
        <div className="research-board-actions">
          <button className="button subtle" type="button" onClick={() => setShowCapturePairing(true)}>{text("连接扩展", "Connect extension")}</button>
          <button className="button subtle" type="button" onClick={() => setShowImporter(true)}>{text("导入", "Import")}</button>
          <button className="button primary" type="button" onClick={() => setEditorTopic(null)}>＋ {text("新建主题", "New topic")}</button>
        </div>
      </div>
      {view === "topics" && topics.length > 0 && <div className="research-home-tools">
        <label><span className="sr-only">{text("搜索研究主题", "Search research topics")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text("搜索研究主题", "Search research topics")} /></label>
        <button type="button" onClick={() => setView("inbox")}>{text("待整理资料", "Inbox")} <span>{inboxCount}</span></button>
      </div>}
      {error && <div className="research-error" role="alert">{error}</div>}
      {view === "inbox" ? <ResearchInbox topics={topics} onCountChange={setInboxCount} onTopicCreated={upsertTopic} /> : loading ? <div className="research-loading">{text("正在读取研究主题…", "Loading research topics…")}</div> : (
        <>
        {topics.length === 0 && <section className="research-first-start" aria-label={text("开始使用 Research OS", "Get started with Research OS")}>
          <div>
            <h2>{text("开始你的第一个研究主题", "Start your first research topic")}</h2>
            <p>{text("创建一个长期研究主题，或先收进一条资料。", "Create a long-term research topic, or capture a source first.")}</p>
          </div>
          <div className="research-first-start-actions">
            <button className="button primary" type="button" onClick={() => setEditorTopic(null)}>{text("创建研究主题", "Create research topic")}</button>
            <button className="button" type="button" onClick={() => setShowCapturePairing(true)}>{text("收一条资料", "Capture a source")}</button>
          </div>
          <small>{text("收资料前需要先安装并连接 Research OS 浏览器扩展。", "Install and connect the Research OS browser extension before capturing a source.")}</small>
        </section>}
        <section className="research-library-list" aria-label={text("研究主题列表", "Research topics")}>
          {visibleTopics.map((topic) => <button key={topic.id} className="research-library-row" type="button" onClick={() => void openTopic(topic.id)}>
            <span className="research-library-copy"><strong>{topic.title}</strong><span>{topic.currentView || text("还没有形成当前观点。", "No current view yet.")}</span></span>
            <span className="research-library-meta"><time dateTime={topic.updatedAt}>{text("更新于", "Updated")} {new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(new Date(topic.updatedAt))}</time><span>{recordCounts[topic.id] ?? 0} {text("份资料", "sources")}</span></span>
            <span className="research-library-more" aria-label={text("更多操作", "More actions")}>•••</span>
          </button>)}
          {visibleTopics.length === 0 && <div className="research-group-empty">{text("没有找到相关研究主题。", "No matching topics.")}</div>}
        </section>
        </>
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
      {showImporter && <ResearchImporter topics={topics} onClose={() => setShowImporter(false)} onOpenInbox={() => { setShowImporter(false); setView("inbox"); }} />}
      {showCapturePairing && <BrowserCapturePairing onClose={() => setShowCapturePairing(false)} />}
    </section>
  );
}
