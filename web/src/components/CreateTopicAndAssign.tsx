import { useMemo, useState } from "react";

import type { ResearchStatus, Topic } from "../researchTypes";

export function CreateTopicAndAssign({
  count,
  topics,
  pending,
  onAssign,
  onCreate,
  onClose,
  initialMode = "existing",
}: {
  count: number;
  topics: Topic[];
  pending: boolean;
  onAssign: (topic: Topic) => void;
  onCreate: (title: string, status: ResearchStatus) => void;
  onClose: () => void;
  initialMode?: "existing" | "new";
}) {
  const [mode, setMode] = useState<"existing" | "new">(initialMode);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<ResearchStatus>("inbox");
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return topics.filter((topic) => !query || topic.title.toLocaleLowerCase().includes(query));
  }, [search, topics]);

  return (
    <div className="modal-backdrop research-inbox-organize-backdrop" role="presentation">
      <section className="research-inbox-organize" role="dialog" aria-modal="true" aria-label="归入研究主题">
        <header><div><span>整理 {count} 条研究记录</span><h2>{mode === "existing" ? "归入已有主题" : "创建新主题并归入"}</h2></div><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
        <nav aria-label="整理方式">
          <button className={mode === "existing" ? "active" : ""} type="button" onClick={() => setMode("existing")}>选择已有主题</button>
          <button className={mode === "new" ? "active" : ""} type="button" onClick={() => setMode("new")}>＋ 创建新主题</button>
        </nav>
        {mode === "existing" ? <div className="research-inbox-topic-picker">
          <input autoFocus type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索研究主题…" />
          <div>{matches.map((topic) => <button key={topic.id} type="button" disabled={pending} onClick={() => onAssign(topic)}><strong>{topic.title}</strong><span>{topic.status === "inbox" ? "待整理主题" : topic.status === "active" ? "研究中" : "已有主题"}</span></button>)}</div>
          {matches.length === 0 && <p>没有找到匹配的主题。你可以直接创建一个新主题。</p>}
        </div> : <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) onCreate(title.trim(), status); }}>
          <label><span>主题名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：伯克希尔长期投资研究" /></label>
          <label><span>初始状态</span><select value={status} onChange={(event) => setStatus(event.target.value as ResearchStatus)}><option value="inbox">待整理主题</option><option value="active">研究中</option><option value="waiting">等待</option><option value="tracking">持续跟踪</option></select></label>
          <p>创建成功后，所选记录会在同一个事务中归入新主题。</p>
          <footer><button type="button" onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={pending || !title.trim()}>{pending ? "正在创建…" : "创建并归入"}</button></footer>
        </form>}
      </section>
    </div>
  );
}
