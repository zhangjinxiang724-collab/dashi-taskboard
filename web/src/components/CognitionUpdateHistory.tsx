import { useEffect, useState } from "react";

import { listCognitionUpdates } from "../researchApi";
import type { CognitionUpdate } from "../researchTypes";

const TYPE_LABEL = { add: "新增", reinforce: "强化", revise: "修正", uncertain: "暂不调整" } as const;
const STATUS_LABEL = { draft: "草稿", applied: "已应用", rejected: "未采用" } as const;

export function CognitionUpdateHistory({ topicId, refreshKey = 0 }: { topicId: string; refreshKey?: number }) {
  const [updates, setUpdates] = useState<CognitionUpdate[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    listCognitionUpdates(topicId).then((items) => {
      if (active) setUpdates(items);
    }).catch(() => {
      if (active) setUpdates([]);
    });
    return () => { active = false; };
  }, [refreshKey, topicId]);

  if (updates.length === 0) return null;
  return (
    <section className="cognition-update-history">
      <button type="button" className="cognition-history-toggle" onClick={() => setOpen((value) => !value)}>
        <span>认知更新记录 <small>{updates.length}</small></span>
        <span>{open ? "收起" : "查看"}</span>
      </button>
      {open && <div className="cognition-history-list">
        {updates.map((update) => (
          <details key={update.id}>
            <summary>
              <span><strong>{TYPE_LABEL[update.updateType]}</strong><small>{update.sourceRecordTitle || "来源记录"}</small></span>
              <span><time>{new Date(update.appliedAt ?? update.rejectedAt ?? update.updatedAt).toLocaleDateString()}</time><em className={`status-${update.status}`}>{STATUS_LABEL[update.status]}</em></span>
            </summary>
            <div>
              <section><span>新信息</span><p>{update.newInformation || "尚未填写"}</p></section>
              <section><span>{update.status === "rejected" ? "不采用原因" : update.updateType === "uncertain" ? "为什么暂不调整" : update.updateType === "reinforce" ? "为什么更确定" : "判断变化"}</span><p>{update.impact || "尚未填写"}</p></section>
              {update.status !== "rejected" && (update.updateType === "uncertain" || (update.updateType === "reinforce" && update.baseCurrentView === update.proposedCurrentView)
                ? <section><span>当前观点</span><p>{update.updateType === "uncertain" ? "未修改" : "保持不变"}</p></section>
                : <div className="cognition-history-views">
                  <section><span>原观点</span><p>{update.baseCurrentView || "没有明确观点"}</p></section>
                  <span aria-hidden="true">↓</span>
                  <section><span>新观点</span><p>{update.proposedCurrentView || "没有明确观点"}</p></section>
                </div>)}
              {update.sourceDeleted && <small>来源记录后来已删除；本次认知更新历史仍保留。</small>}
            </div>
          </details>
        ))}
      </div>}
    </section>
  );
}
