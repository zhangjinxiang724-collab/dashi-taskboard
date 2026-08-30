import { useEffect, useState } from "react";

import {
  confirmResearchImport,
  createChatGptImportPreview,
  getImportPreview,
  getSelectableImportPreviewKeys,
  listResearchImportSessions,
  undoResearchImportSession,
} from "../researchApi";
import type {
  ImportPreviewRecord,
  ResearchImportSession,
  Topic,
} from "../researchTypes";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ResearchImporter({ topics, onClose, onOpenInbox }: { topics: Topic[]; onClose: () => void; onOpenInbox: () => void }) {
  const [tab, setTab] = useState<"import" | "history">("import");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [records, setRecords] = useState<ImportPreviewRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [topicId, setTopicId] = useState("");
  const [search, setSearch] = useState("");
  const [duplicates, setDuplicates] = useState<"all" | "only" | "exclude">("exclude");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sessions, setSessions] = useState<ResearchImportSession[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [latestSessionId, setLatestSessionId] = useState<string | null>(null);
  const [finalPreview, setFinalPreview] = useState(false);
  const [inboxAdded, setInboxAdded] = useState(0);

  async function loadPreview(id = previewId, nextPage = page) {
    if (!id) return;
    const data = await getImportPreview(id, { page: nextPage, pageSize: 50, search, duplicates });
    setRecords(data.records);
    setTotal(data.total);
    setPage(data.page);
  }

  useEffect(() => {
    if (tab === "history") void listResearchImportSessions().then(setSessions).catch((loadError) => setError(message(loadError)));
  }, [tab]);

  async function upload(file: File) {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const preview = await createChatGptImportPreview(file);
      setPreviewId(preview.id);
      setPage(1);
      const data = await getImportPreview(preview.id, { pageSize: 50, duplicates });
      setRecords(data.records);
      setTotal(data.total);
      setSelected(new Set());
      setAssignments({});
      setFinalPreview(false);
      setResult(`已安全解析 ${preview.validCount} 条记录；${preview.invalidCount} 条无法识别。此时尚未写入研究记录。`);
    } catch (uploadError) {
      setError(message(uploadError));
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!previewId || selected.size === 0) return;
    setPending(true);
    setError(null);
    try {
      const imported = await confirmResearchImport(previewId, [...selected].map((sourceKey) => ({
        sourceKey,
        topicId: assignments[sourceKey] || null,
      })));
      setResult(`导入完成：新增 ${imported.imported}，跳过重复 ${imported.skipped}，失败 ${imported.failed}，待归类 ${imported.unclassified}。`);
      setLatestSessionId(imported.sessionId);
      setInboxAdded(imported.unclassified);
      setSelected(new Set());
      setFinalPreview(false);
      await loadPreview(previewId, page);
    } catch (confirmError) {
      setError(message(confirmError));
    } finally {
      setPending(false);
    }
  }

  async function selectAllFiltered() {
    if (!previewId) return;
    setPending(true);
    try {
      const keys = await getSelectableImportPreviewKeys(previewId, search);
      setSelected(new Set(keys));
      setAssignments((current) => Object.fromEntries(keys.map((key) => [key, current[key] ?? topicId])));
    } catch (selectionError) {
      setError(message(selectionError));
    } finally {
      setPending(false);
    }
  }

  function applyTopicToSelection(value: string) {
    setTopicId(value);
    setAssignments((current) => {
      const next = { ...current };
      for (const key of selected) next[key] = value;
      return next;
    });
  }

  async function undo(session: ResearchImportSession) {
    if (!window.confirm("撤销只会移除这个批次创建、且之后没有被编辑或关联任务的记录。继续吗？")) return;
    setPending(true);
    try {
      await undoResearchImportSession(session);
      setSessions(await listResearchImportSessions());
      setResult("导入批次已安全撤销。");
    } catch (undoError) {
      setError(message(undoError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop research-import-backdrop" role="presentation">
      <section className="research-importer" role="dialog" aria-modal="true" aria-label="ChatGPT 历史导入器">
        <header>
          <div><span>Phase 3.5</span><h2>ChatGPT 历史导入</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <nav aria-label="导入管理">
          <button className={tab === "import" ? "active" : ""} type="button" onClick={() => setTab("import")}>选择性导入</button>
          <button type="button" onClick={onOpenInbox}>待整理记录</button>
          <button className={tab === "history" ? "active" : ""} type="button" onClick={() => setTab("history")}>导入历史</button>
        </nav>
        {error && <div className="research-error" role="alert">{error}</div>}
        {result && <div className="research-import-result"><span>{result}</span>{inboxAdded > 0 && <button type="button" onClick={onOpenInbox}>前往待整理记录</button>}{latestSessionId && <button type="button" onClick={() => setTab("history")}>查看 Import Session 与撤销</button>}</div>}

        {tab === "import" && <div className="research-import-body">
          <div className="research-import-safety">
            <strong>先预览，后写入</strong>
            <span>支持 ChatGPT 导出的 ZIP 或 conversations.json。预览阶段不会写入 Research OS 数据库。</span>
          </div>
          <label className="research-import-file">
            <span>{pending ? "正在解析…" : "选择 ChatGPT 导出文件"}</span>
            <input type="file" disabled={pending} accept=".zip,.json,application/zip,application/json" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }} />
          </label>
          {previewId && !finalPreview && <>
            <div className="research-import-toolbar">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题或内容预览" />
              <select value={duplicates} onChange={(event) => setDuplicates(event.target.value as typeof duplicates)}>
                <option value="exclude">隐藏重复项</option><option value="all">显示全部</option><option value="only">只看重复项</option>
              </select>
              <button type="button" onClick={() => void loadPreview(previewId, 1)}>筛选</button>
            </div>
            <div className="research-import-list">
              {records.map((record) => <label key={record.sourceKey} className={record.duplicate || record.parseError ? "duplicate" : ""}>
                <input type="checkbox" disabled={record.duplicate || Boolean(record.parseError)} checked={selected.has(record.sourceKey)} onChange={(event) => setSelected((current) => {
                  const next = new Set(current); if (event.target.checked) { next.add(record.sourceKey); setAssignments((values) => ({ ...values, [record.sourceKey]: values[record.sourceKey] ?? topicId })); } else next.delete(record.sourceKey); return next;
                })} />
                <span><strong>{record.title}</strong><small>{record.parseError ? "解析异常" : `${new Date(record.occurredAt).toLocaleDateString()} · ${record.messageCount} 条消息${record.duplicate ? " · 已导入" : " · 未导入"}`}</small><p>{record.parseError ?? record.preview}</p></span>
                {!record.duplicate && !record.parseError && selected.has(record.sourceKey) && <select aria-label={`为 ${record.title} 选择 Topic`} value={assignments[record.sourceKey] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [record.sourceKey]: event.target.value }))}><option value="">暂不分类</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select>}
              </label>)}
            </div>
            <footer className="research-import-footer">
              <span>共 {total} 条 · 已选 {selected.size} 条</span>
              <button type="button" disabled={pending || total === 0} onClick={() => void selectAllFiltered()}>全选当前筛选结果</button>
              <button type="button" disabled={selected.size === 0} onClick={() => { setSelected(new Set()); setAssignments({}); }}>取消全选</button>
              <div className="research-import-pagination"><button disabled={page <= 1} onClick={() => void loadPreview(previewId, page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 50 >= total} onClick={() => void loadPreview(previewId, page + 1)}>下一页</button></div>
              <select value={topicId} onChange={(event) => applyTopicToSelection(event.target.value)}><option value="">批量设为暂不分类</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>批量设为：{topic.title}</option>)}</select>
              <button className="button primary" disabled={pending || selected.size === 0} onClick={() => setFinalPreview(true)}>检查导入计划</button>
            </footer>
          </>}
          {previewId && finalPreview && <div className="research-import-final-preview">
            <div><span>最终预览</span><h3>准备导入 {selected.size} 条 ChatGPT 对话</h3><p>其中 {([...selected].filter((key) => assignments[key]).length)} 条已指定 Topic，{([...selected].filter((key) => !assignments[key]).length)} 条将暂不分类。确认后才会正式写入隔离数据库。</p></div>
            <dl><div><dt>来源</dt><dd>ChatGPT 官方导出</dd></div><div><dt>正文</dt><dd>独立压缩保存</dd></div><div><dt>重复项</dt><dd>确认时再次校验并跳过</dd></div></dl>
            <footer><button type="button" onClick={() => setFinalPreview(false)}>返回调整</button><button className="button primary" disabled={pending} onClick={() => void confirm()}>最终确认导入</button></footer>
          </div>}
        </div>}

        {tab === "history" && <div className="research-import-body"><div className="research-import-history">{sessions.map((session) => <article key={session.id}><div><strong>{session.sourceFilename}</strong><span>{new Date(session.createdAt).toLocaleString()} · 导入 {session.importedCount} · 跳过 {session.skippedCount}</span></div><span>{session.status === "undone" ? "已撤销" : "已完成"}</span>{session.status === "committed" && <button disabled={pending} onClick={() => void undo(session)}>安全撤销</button>}</article>)}</div></div>}
      </section>
    </div>
  );
}
