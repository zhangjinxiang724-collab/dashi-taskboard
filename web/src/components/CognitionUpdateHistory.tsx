import { useEffect, useState } from "react";

import { deleteCognitionDraft, listCognitionUpdates } from "../researchApi";
import type { CognitionUpdate } from "../researchTypes";

const TYPE_LABEL = { add: "新增", reinforce: "强化", revise: "修正", uncertain: "暂不调整" } as const;

function excerpt(value: string, length = 150) {
  return value.length > length ? `${value.slice(0, length)}…` : value || "尚未填写";
}

function date(value: string | null) {
  return new Date(value ?? "").toLocaleDateString();
}

export function CognitionUpdateHistory({ topicId, currentView, refreshKey = 0, onEditDraft }: {
  topicId: string;
  currentView: string;
  refreshKey?: number;
  onEditDraft: (update: CognitionUpdate) => void;
}) {
  const [updates, setUpdates] = useState<CognitionUpdate[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDraft, setConfirmDraft] = useState<CognitionUpdate | null>(null);

  useEffect(() => {
    let active = true;
    listCognitionUpdates(topicId).then((items) => {
      if (active) { setUpdates(items); setError(null); }
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => { active = false; };
  }, [refreshKey, topicId]);

  async function removeDraft(update: CognitionUpdate) {
    setDeletingId(update.id);
    setError(null);
    try {
      await deleteCognitionDraft(update);
      setUpdates((current) => current.filter((item) => item.id !== update.id));
      setConfirmDraft(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingId(null);
    }
  }

  const drafts = updates.filter((update) => update.status === "draft");
  const applied = updates.filter((update) => update.status === "applied")
    .sort((left, right) => (right.appliedAt ?? "").localeCompare(left.appliedAt ?? ""));
  const rejected = updates.filter((update) => update.status === "rejected");

  return <section id="topic-cognition" className="cognition-update-history cognition-timeline" aria-label="认知变化">
    <header><span>现在的我怎么看</span><h2>当前观点</h2><p>{currentView || "还没有形成明确观点。"}</p></header>
    {error && <p className="research-error" role="alert">{error}</p>}

    {drafts.length > 0 && <section className="cognition-drafts" aria-label="待处理认知草稿">
      <h3>待处理认知草稿 <small>{drafts.length}</small></h3>
      {drafts.map((update) => <article key={update.id}>
        <div><strong>{TYPE_LABEL[update.updateType]} · {update.sourceRecordTitle || "来源资料"}</strong><small>{date(update.createdAt)}</small></div>
        <p>新知道：{excerpt(update.newInformation)}</p>
        <p>拟议观点：{excerpt(update.proposedCurrentView)}</p>
        <div className="cognition-draft-actions"><button className="button" type="button" onClick={() => onEditDraft(update)}>继续编辑</button><button className="button subtle" type="button" disabled={deletingId === update.id} onClick={() => setConfirmDraft(update)}>删除草稿</button></div>
      </article>)}
    </section>}

    <section className="cognition-applied" aria-label="已应用的认知变化">
      <h3>认知变化 <small>{applied.length}</small></h3>
      {applied.length === 0 && <p>还没有已应用的认知变化。</p>}
      {(showAll ? applied : applied.slice(0, 3)).map((update) => <article key={update.id}>
        <div className="cognition-timeline-meta"><time dateTime={update.appliedAt ?? undefined}>{date(update.appliedAt)}</time><strong>{TYPE_LABEL[update.updateType]}</strong><span>{update.sourceRecordTitle || "来源资料"}</span></div>
        <p><b>新知道了什么：</b>{excerpt(update.newInformation)}</p>
        <p><b>判断怎样变化：</b>{excerpt(update.impact)}</p>
        <div className="cognition-before-after"><p><b>之前</b>{excerpt(update.baseCurrentView)}</p><span aria-hidden="true">↓</span><p><b>之后</b>{excerpt(update.proposedCurrentView)}</p></div>
        <details><summary>查看变化详情</summary><div><p><b>新信息</b>{update.newInformation || "尚未填写"}</p><p><b>判断变化</b>{update.impact || "尚未填写"}</p><p><b>之前</b>{update.baseCurrentView || "没有明确观点"}</p><p><b>之后</b>{update.proposedCurrentView || "没有明确观点"}</p>{update.sourceContentVersionNumber && <small>来源资料 V{update.sourceContentVersionNumber}</small>}</div></details>
      </article>)}
      {applied.length > 3 && <button className="button" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "收起历史" : `查看全部认知历史（${applied.length}）`}</button>}
    </section>

    {rejected.length > 0 && <details className="cognition-rejected"><summary>未采用的认知 · {rejected.length}</summary>{rejected.map((update) => <article key={update.id}><strong>{TYPE_LABEL[update.updateType]} · {update.sourceRecordTitle || "来源资料"}</strong><small>{date(update.rejectedAt)}</small><p>{excerpt(update.impact)}</p><details><summary>查看详情</summary><p>{update.newInformation || "尚未填写"}</p><p>{update.impact || "尚未填写"}</p></details></article>)}</details>}
    {confirmDraft && <div className="research-dialog-layer" role="presentation"><section className="cognition-delete-dialog" role="dialog" aria-modal="true" aria-label="确认删除认知草稿"><h3>删除这份认知草稿？</h3><p>删除后无法恢复。当前观点和已应用的认知不会改变。</p><div><button className="button" type="button" onClick={() => setConfirmDraft(null)}>取消</button><button className="button primary" type="button" disabled={deletingId === confirmDraft.id} onClick={() => void removeDraft(confirmDraft)}>确认删除草稿</button></div></section></div>}
  </section>;
}
