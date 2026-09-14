import { useState } from "react";

import { ApiError } from "../api";
import { applyCognitionUpdate, reloadCognitionUpdate, rejectCognitionUpdate, updateCognitionUpdate } from "../researchApi";
import type { CognitionUpdate, CognitionUpdateType, TopicDetail } from "../researchTypes";

const TYPE_OPTIONS: Array<{ value: CognitionUpdateType; label: string }> = [
  { value: "add", label: "新增" },
  { value: "reinforce", label: "强化" },
  { value: "revise", label: "修正" },
  { value: "uncertain", label: "暂不调整" },
];

function readableError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "COGNITION_TOPIC_VERSION_CONFLICT") {
      return "当前观点已经发生变化";
    }
    if (error.code === "COGNITION_UPDATE_VERSION_CONFLICT") {
      return "这份认知更新已在别处修改，请关闭后重新打开。";
    }
    if (error.code === "COGNITION_SOURCE_UNAVAILABLE") {
      return "来源记录已被删除，这份草稿不能继续应用。";
    }
    if (error.code === "COGNITION_UPDATE_INCOMPLETE") {
      return "请填写这条资料带来的新信息，以及它对原判断的影响。";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function CognitionUpdateEditor({
  initialUpdate,
  onClose,
  onApplied,
  onChanged,
}: {
  initialUpdate: CognitionUpdate;
  onClose: () => void;
  onApplied: (topic: TopicDetail) => void;
  onChanged?: () => void;
}) {
  const [update, setUpdate] = useState(initialUpdate);
  const [updateType, setUpdateType] = useState(initialUpdate.updateType);
  const [newInformation, setNewInformation] = useState(initialUpdate.newInformation);
  const [impact, setImpact] = useState(initialUpdate.impact);
  const [proposedCurrentView, setProposedCurrentView] = useState(initialUpdate.proposedCurrentView);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topicConflict, setTopicConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editReinforcedView, setEditReinforcedView] = useState(initialUpdate.proposedCurrentView !== initialUpdate.baseCurrentView);
  const unchanged = updateType === "uncertain" || proposedCurrentView.trim() === update.baseCurrentView;
  const impactLabel = updateType === "uncertain" ? "为什么暂时不改变" : updateType === "reinforce" ? "为什么更确定" : "判断变化";

  function changes() {
    return {
      updateType,
      newInformation: newInformation.trim(),
      impact: impact.trim(),
      proposedCurrentView: updateType === "uncertain"
        ? update.baseCurrentView
        : proposedCurrentView.trim(),
    };
  }

  async function saveDraft() {
    setPending(true);
    setError(null);
    try {
      const saved = await updateCognitionUpdate(update, changes());
      setUpdate(saved);
      onChanged?.();
      onClose();
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setPending(false);
    }
  }

  async function apply() {
    if (topicConflict) return;
    setPending(true);
    setError(null);
    try {
      const saved = await updateCognitionUpdate(update, changes());
      setUpdate(saved);
      const result = await applyCognitionUpdate(saved);
      onChanged?.();
      onApplied(result.topic);
      onClose();
    } catch (applyError) {
      if (applyError instanceof ApiError && applyError.code === "COGNITION_TOPIC_VERSION_CONFLICT") setTopicConflict(true);
      setError(readableError(applyError));
    } finally {
      setPending(false);
    }
  }

  async function viewLatest() {
    setPending(true);
    try {
      const saved = await updateCognitionUpdate(update, changes());
      setUpdate(saved);
      const refreshed = await reloadCognitionUpdate(saved);
      setUpdate(refreshed);
      setProposedCurrentView(refreshed.proposedCurrentView);
      setEditReinforcedView(false);
      setTopicConflict(false);
      setError(null);
      setNotice("已载入最新观点，请重新确认“新的观点”。");
      onChanged?.();
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setPending(false);
    }
  }

  async function reject() {
    setPending(true);
    setError(null);
    try {
      const saved = await updateCognitionUpdate(update, changes());
      const rejected = await rejectCognitionUpdate(saved);
      setUpdate(rejected);
      onChanged?.();
      onClose();
    } catch (rejectError) {
      setError(readableError(rejectError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop cognition-update-backdrop" role="presentation">
      <section className="cognition-update-editor" role="dialog" aria-modal="true" aria-label="更新认知">
        <header>
          <div>
            <h2>更新认知</h2>
            <p>{update.sourceRecordTitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="cognition-update-body">
        <div className="cognition-update-base">
          <span>当前观点</span>
          <p>{update.baseCurrentView || "目前还没有写下明确观点。"}</p>
        </div>

        <fieldset className="cognition-update-types">
          <legend>影响</legend>
          {TYPE_OPTIONS.map((option) => (
            <label key={option.value} className={updateType === option.value ? "is-selected" : ""}>
              <input type="radio" name="update-type" value={option.value} checked={updateType === option.value} disabled={pending} onChange={() => {
                setUpdateType(option.value);
              }} />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        <label className="cognition-update-field">
          <span>新信息</span>
          <textarea rows={3} value={newInformation} disabled={pending} onChange={(event) => setNewInformation(event.target.value)} />
        </label>
        <label className="cognition-update-field">
          <span>{impactLabel}</span>
          <textarea rows={3} value={impact} disabled={pending} onChange={(event) => setImpact(event.target.value)} />
        </label>
        {updateType === "uncertain" ? <p className="cognition-unchanged">当前观点保持不变</p> : <>
          {updateType === "reinforce" && <button className="cognition-optional-view" type="button" disabled={pending} onClick={() => setEditReinforcedView((value) => !value)} aria-expanded={editReinforcedView}>
            {editReinforcedView ? "收起新的观点" : "编辑新的观点（可选）"}
          </button>}
          {(updateType !== "reinforce" || editReinforcedView) && <label className="cognition-update-field">
            <span>新的观点</span>
            <textarea rows={4} value={proposedCurrentView} disabled={pending} onChange={(event) => setProposedCurrentView(event.target.value)} />
          </label>}
        </>}

        {error && !topicConflict && <div className="research-error" role="alert">{error}</div>}
        </div>
        {topicConflict && <div className="cognition-conflict" role="alert">
          <span>{error ?? "当前观点已经发生变化"}</span>
          <button type="button" disabled={pending} onClick={() => void viewLatest()}>{pending ? "读取中…" : "重新载入最新观点"}</button>
        </div>}
        {notice && <div className="cognition-conflict" role="status">{notice}</div>}
        <footer>
          <button type="button" disabled={pending} onClick={() => void reject()}>不采用这次更新</button>
          <div>
            <button type="button" disabled={pending} onClick={() => void saveDraft()}>保存草稿</button>
            <button className="button primary" type="button" disabled={pending || topicConflict} onClick={() => void apply()}>
              {(updateType === "uncertain" || updateType === "reinforce") && unchanged ? "记录影响" : "更新观点"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
