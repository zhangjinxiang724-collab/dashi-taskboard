import { useCallback, useEffect, useRef, useState } from "react";

import {
  assignResearchRecordsToTopic,
  createTopicAndAssignResearchRecords,
  deleteResearchRecord,
  getResearchInboxSummary,
  listResearchInbox,
} from "../researchApi";
import type { ResearchInboxItem, ResearchRecordProvider, ResearchStatus, Topic } from "../researchTypes";
import { CreateTopicAndAssign } from "./CreateTopicAndAssign";
import { researchRecordKindLabel, researchRecordProviderLabel } from "./ResearchRecordEditor";
import { ResearchRecordReader } from "./ResearchRecordReader";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sourceLabel(record: ResearchInboxItem) {
  if (record.captureAdapter === "chatgpt-browser-v1") return "浏览器捕获";
  if (record.captureAdapter === "chatgpt-export-v1") return "历史导入";
  if (record.captureAdapter === "manual-v1") return "手动记录";
  return record.captureAdapter;
}

export function ResearchInbox({
  topics,
  onCountChange,
  onTopicCreated,
}: {
  topics: Topic[];
  onCountChange: (count: number) => void;
  onTopicCreated: (topic: Topic) => void;
}) {
  const [records, setRecords] = useState<ResearchInboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState<ResearchRecordProvider | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState<{ ids: string[]; mode: "existing" | "new" } | null>(null);
  const [readerRecord, setReaderRecord] = useState<ResearchInboxItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const scrollPosition = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, nextPage = page) => {
    setLoading(true);
    try {
      const [next, inboxCount] = await Promise.all([
        listResearchInbox({ page: nextPage, pageSize: 50, provider, dateFrom, dateTo }, signal),
        getResearchInboxSummary(signal),
      ]);
      setRecords(next.records);
      setTotal(next.total);
      setPage(next.page);
      onCountChange(inboxCount);
      setError(null);
    } catch (loadError) {
      if ((loadError as Error).name !== "AbortError") setError(message(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [dateFrom, dateTo, onCountChange, page, provider]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, 1);
    return () => controller.abort();
  }, [provider, dateFrom, dateTo]);

  async function organized(ids: string[], action: () => Promise<{ topic: Topic; updated: number }>) {
    setPending(true);
    setError(null);
    try {
      const outcome = await action();
      setResult(`已将 ${outcome.updated} 条记录归入“${outcome.topic.title}”。`);
      setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))));
      setOrganizing(null);
      setReaderRecord(null);
      onTopicCreated(outcome.topic);
      await load(undefined, records.length === ids.length && page > 1 ? page - 1 : page);
    } catch (organizeError) {
      setError(message(organizeError));
    } finally {
      setPending(false);
    }
  }

  function assign(topic: Topic) {
    const ids = organizing?.ids ?? [];
    void organized(ids, async () => ({ topic, updated: await assignResearchRecordsToTopic(ids, topic.id) }));
  }

  function createAndAssign(title: string, status: ResearchStatus) {
    const ids = organizing?.ids ?? [];
    void organized(ids, () => createTopicAndAssignResearchRecords(ids, { title, status }));
  }

  async function remove(record: ResearchInboxItem) {
    if (!window.confirm(`确定删除“${record.title}”吗？这会把它软删除，不会物理清除数据库内容。`)) return;
    setPending(true);
    setError(null);
    try {
      await deleteResearchRecord(record);
      setReaderRecord(null);
      setResult(`已删除“${record.title}”。`);
      await load(undefined, records.length === 1 && page > 1 ? page - 1 : page);
    } catch (deleteError) {
      setError(message(deleteError));
    } finally {
      setPending(false);
    }
  }

  function openReader(record: ResearchInboxItem) {
    scrollPosition.current = window.scrollY;
    setReaderRecord(record);
  }

  function closeReader() {
    setReaderRecord(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollPosition.current }));
  }

  return (
    <section className="research-inbox">
      <header className="research-inbox-heading">
        <div><h1>研究收件箱</h1><p>先保存，后整理。这里收集尚未归入研究主题的记录。</p></div>
        <button type="button" className={selectionMode ? "active" : ""} onClick={() => { setSelectionMode((value) => !value); setSelected(new Set()); }}>{selectionMode ? "退出选择" : "选择多条"}</button>
      </header>
      <div className="research-inbox-filters">
        <label><span>来源</span><select value={provider} onChange={(event) => setProvider(event.target.value as ResearchRecordProvider | "")}><option value="">全部来源</option><option value="chatgpt">ChatGPT</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="other">其他</option></select></label>
        <label><span>从</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>到</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        {(provider || dateFrom || dateTo) && <button type="button" onClick={() => { setProvider(""); setDateFrom(""); setDateTo(""); }}>清除筛选</button>}
        <span>{total} 条待整理</span>
      </div>
      {error && <div className="research-error" role="alert">{error}</div>}
      {result && <div className="research-import-result"><span>{result}</span></div>}
      {loading ? <p className="research-empty-copy">正在读取待整理记录…</p> : records.length === 0 ? <div className="research-inbox-empty"><h2>待整理记录已经清空</h2><p>以后保存但暂未归类的研究记录，会自动出现在这里。</p></div> : <div className="research-inbox-list">
        {records.map((record) => <article key={record.id} className="research-inbox-row">
          {selectionMode && <label className="research-inbox-select"><input type="checkbox" aria-label={`选择 ${record.title}`} checked={selected.has(record.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(record.id); else next.delete(record.id); return next; })} /></label>}
          <button className="research-inbox-main" type="button" onClick={() => openReader(record)}>
            <span className="research-inbox-title-line"><strong>{record.title}</strong>{record.captureCompleteness && <em className={`capture-${record.captureCompleteness}`}>{record.captureCompleteness === "complete" ? "已确认完整" : "可能不完整"}</em>}</span>
            <p>{record.preview || "这条记录暂时没有可显示的正文预览。"}</p>
            <span className="research-inbox-meta">{researchRecordProviderLabel(record.provider)} · {researchRecordKindLabel(record.kind)} · {sourceLabel(record)} · {new Date(record.occurredAt).toLocaleDateString()}</span>
          </button>
          <div className="research-inbox-actions">
            <button type="button" onClick={() => openReader(record)}>{record.contentAvailable ? "查看正文" : "查看记录"}</button>
            <button type="button" onClick={() => setOrganizing({ ids: [record.id], mode: "existing" })}>归入主题</button>
            <details><summary aria-label="更多操作">···</summary><button type="button" disabled={pending} onClick={() => void remove(record)}>删除记录</button></details>
          </div>
        </article>)}
      </div>}
      {total > 50 && <nav className="research-inbox-pagination" aria-label="待整理记录分页"><button disabled={page <= 1 || loading} onClick={() => void load(undefined, page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 50 >= total || loading} onClick={() => void load(undefined, page + 1)}>下一页</button></nav>}
      {selectionMode && selected.size > 0 && <div className="research-inbox-batch"><span>已选 {selected.size} 条</span><button className="button primary" type="button" onClick={() => setOrganizing({ ids: [...selected], mode: "existing" })}>归入主题</button><button type="button" onClick={() => setOrganizing({ ids: [...selected], mode: "new" })}>＋ 创建新主题</button><button type="button" onClick={() => setSelected(new Set())}>取消选择</button></div>}
      {organizing && <CreateTopicAndAssign count={organizing.ids.length} topics={topics} pending={pending} initialMode={organizing.mode} onAssign={assign} onCreate={createAndAssign} onClose={() => setOrganizing(null)} />}
      {readerRecord && <ResearchRecordReader record={readerRecord} onClose={closeReader} backLabel="返回待整理记录" actions={<><button className="button primary" type="button" onClick={() => setOrganizing({ ids: [readerRecord.id], mode: "existing" })}>归入主题</button><button type="button" onClick={() => setOrganizing({ ids: [readerRecord.id], mode: "new" })}>＋ 创建新主题</button><button type="button" disabled={pending} onClick={() => void remove(readerRecord)}>删除记录</button></>} />}
    </section>
  );
}
