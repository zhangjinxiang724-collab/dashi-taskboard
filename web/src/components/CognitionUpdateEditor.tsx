import { useState } from "react";

import { ApiError } from "../api";
import { applyCognitionUpdate, generateCognitionAiDraft, reloadCognitionUpdate, rejectCognitionUpdate, updateCognitionUpdate } from "../researchApi";
import type { CognitionAiDraft, CognitionUpdate, CognitionUpdateType, TopicDetail } from "../researchTypes";

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
    if (error.code === "RESEARCH_AI_NOT_CONFIGURED") return "AI 起草尚未配置。";
    if (error.code === "RESEARCH_AI_SOURCE_TOO_LONG") return "这条资料太长，暂时无法完整起草认知更新。";
    if (error.code === "RESEARCH_AI_TIMEOUT") return "AI 起草超时，请稍后重试。";
    if (error.code === "RESEARCH_AI_DRAFT_FAILED") return "AI 起草失败，请稍后重试。";
    if (error.code === "SOURCE_CONTENT_VERSION_INVALID") return "这份认知更新锁定的资料版本已经不可用。";
    if (error.code === "RESEARCH_RECORD_TOPIC_MISMATCH") return "这条资料已经不属于当前主题。";
    if (error.code === "COGNITION_UPDATE_NOT_DRAFT") return "这份认知更新已经完成，不能再次起草。";
    if (error.code === "COGNITION_UPDATE_NOT_FOUND") return "这份认知更新已经不存在。";
    if (error.code === "TOPIC_NOT_FOUND") return "当前主题已经不存在。";
  }
  return error instanceof Error ? error.message : String(error);
}

export function CognitionUpdateEditor({
  initialUpdate,
  onClose,
  onApplied,
  onChanged,
  sourceTextComplete = true,
}: {
  initialUpdate: CognitionUpdate;
  onClose: () => void;
  onApplied: (topic: TopicDetail) => void;
  onChanged?: () => void;
  sourceTextComplete?: boolean;
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
  const [aiPending, setAiPending] = useState(false);
  const [aiDraft, setAiDraft] = useState<CognitionAiDraft | null>(null);
  const [editReinforcedView, setEditReinforcedView] = useState(initialUpdate.proposedCurrentView !== initialUpdate.baseCurrentView);
  const unchanged = updateType === "uncertain" || proposedCurrentView.trim() === update.baseCurrentView;
  const impactLabel = updateType === "uncertain" ? "为什么暂时不改变" : updateType === "reinforce" ? "为什么更确定" : "判断变化";
  const aiDraftEdited = aiDraft !== null && (
    updateType !== aiDraft.updateType
    || newInformation !== aiDraft.newInformation
    || impact !== aiDraft.impact
    || proposedCurrentView !== aiDraft.proposedCurrentView
  );

  async function draftWithAi() {
    if (aiDraft && aiDraftEdited && !window.confirm("重新起草会替换当前填写内容。")) return;
    setAiPending(true);
    setError(null);
    try {
      const candidate = await generateCognitionAiDraft(update);
      setAiDraft(candidate);
      setUpdateType(candidate.updateType);
      setNewInformation(candidate.newInformation);
      setImpact(candidate.impact);
      setProposedCurrentView(candidate.proposedCurrentView);
      setEditReinforcedView(candidate.updateType === "reinforce" && candidate.proposedCurrentView !== update.baseCurrentView);
      setNotice(null);
    } catch (draftError) {
      if (draftError instanceof ApiError && draftError.code === "COGNITION_TOPIC_VERSION_CONFLICT") setTopicConflict(true);
      setError(readableError(draftError));
    } finally {
      setAiPending(false);
    }
  }

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
      setAiDraft(null);
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

        <div className="cognition-ai-draft-row">
          <button type="button" disabled={aiPending || pending || topicConflict} onClick={() => void draftWithAi()}>
            {aiPending ? "正在起草…" : aiDraft ? "重新起草" : "AI 起草"}
          </button>
          {aiDraft && <span>AI 草稿</span>}
        </div>
        {(!sourceTextComplete || (aiDraft && !aiDraft.sourceTextComplete)) && <p className="cognition-ai-note">这条资料的文字可能不完整，AI 草稿可能遗漏信息。</p>}

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
