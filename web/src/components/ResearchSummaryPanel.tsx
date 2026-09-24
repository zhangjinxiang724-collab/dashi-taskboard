import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createResearchRecordSummary,
  generateResearchSummaryAiDraft,
  getResearchRecordSummary,
  updateResearchRecordSummary,
} from "../researchApi";
import type { ResearchRecordSummary, ResearchRecordSummaryDraft } from "../researchTypes";

const EMPTY_DRAFT: ResearchRecordSummaryDraft = {
  oneLineSummary: "",
  coreContent: "",
  keyEvidence: "",
  unresolved: "",
};

function draftFromSummary(summary: ResearchRecordSummary | null): ResearchRecordSummaryDraft {
  return summary ? {
    oneLineSummary: summary.oneLineSummary,
    coreContent: summary.coreContent,
    keyEvidence: summary.keyEvidence,
    unresolved: summary.unresolved,
  } : { ...EMPTY_DRAFT };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ResearchSummaryPanel({
  recordId,
  sourceContentVersionId,
  sourceContentVersionNumber = 1,
  sourceIsCurrent = true,
}: {
  recordId: string;
  sourceContentVersionId: string;
  sourceContentVersionNumber?: number;
  sourceIsCurrent?: boolean;
}) {
  const { text } = useTaskboardI18n();
  const [summary, setSummary] = useState<ResearchRecordSummary | null>(null);
  const [draft, setDraft] = useState<ResearchRecordSummaryDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editStatus, setEditStatus] = useState<"dirty" | "ai-draft" | "saving" | "saved" | "save-error" | null>(null);
  const [aiSourceTextComplete, setAiSourceTextComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generationRequest = useRef(0);
  const currentSourceVersionId = useRef(sourceContentVersionId);
  const currentSummaryVersion = useRef<number | null>(null);
  currentSourceVersionId.current = sourceContentVersionId;
  currentSummaryVersion.current = summary?.version ?? null;

  useEffect(() => {
    let active = true;
    generationRequest.current += 1;
    setLoading(true);
    setEditing(false);
    setGenerating(false);
    setEditStatus(null);
    setAiSourceTextComplete(true);
    setError(null);
    getResearchRecordSummary(recordId, sourceContentVersionId)
      .then((next) => {
        if (!active) return;
        setSummary(next);
        setDraft(draftFromSummary(next));
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [recordId, sourceContentVersionId]);

  function beginEditing() {
    setDraft(draftFromSummary(summary));
    setError(null);
    setEditing(true);
    setEditStatus(null);
  }

  function changeDraft(key: keyof ResearchRecordSummaryDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setEditStatus("dirty");
  }

  function draftChanged() {
    const original = draftFromSummary(summary);
    return Object.keys(original).some((key) => (
      draft[key as keyof ResearchRecordSummaryDraft] !== original[key as keyof ResearchRecordSummaryDraft]
    ));
  }

  async function generateAiDraft() {
    if (summary && !window.confirm(text(
      "这会用新的 AI 草稿替换当前编辑内容，已保存的总结不会立即改变。",
      "This replaces the editor with a new AI draft. The saved summary will not change yet.",
    ))) return;
    if (editing && draftChanged() && !window.confirm(text(
      "当前有未保存的修改，继续会替换这些内容。",
      "You have unsaved edits. Continuing will replace them.",
    ))) return;

    const requestId = ++generationRequest.current;
    const requestedSourceVersionId = sourceContentVersionId;
    const requestedSummaryVersion = summary?.version ?? null;
    setGenerating(true);
    setError(null);
    try {
      const result = await generateResearchSummaryAiDraft(
        recordId,
        requestedSourceVersionId,
        requestedSummaryVersion,
      );
      if (requestId !== generationRequest.current) return;
      if (
        currentSourceVersionId.current !== requestedSourceVersionId
        || result.sourceContentVersionId !== requestedSourceVersionId
      ) {
        setError(text(
          "正文版本已经切换，这次 AI 草稿没有填入。请在当前版本重新起草。",
          "The content version changed, so this AI draft was not inserted. Draft again for the current version.",
        ));
        return;
      }
      if (currentSummaryVersion.current !== requestedSummaryVersion || result.summaryVersion !== requestedSummaryVersion) {
        setError(text(
          "内容总结已经发生变化，请重新载入后再起草。",
          "The summary changed. Reload it before drafting again.",
        ));
        return;
      }
      setDraft({
        oneLineSummary: result.oneLineSummary,
        coreContent: result.coreContent,
        keyEvidence: result.keyEvidence,
        unresolved: result.unresolved,
      });
      setAiSourceTextComplete(result.sourceTextComplete);
      setEditing(true);
      setEditStatus("ai-draft");
    } catch {
      if (requestId === generationRequest.current) {
        setError(text(
          "这次 AI 起草没有成功，可以重试或手动填写。",
          "AI drafting did not succeed. Try again or fill it in manually.",
        ));
      }
    } finally {
      if (requestId === generationRequest.current) setGenerating(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.oneLineSummary.trim()) {
      setError(text("请填写一句话总结。", "Add a one-line summary."));
      return;
    }
    setSaving(true);
    setEditStatus("saving");
    setError(null);
    try {
      const saved = summary
        ? await updateResearchRecordSummary(summary, draft)
        : await createResearchRecordSummary(recordId, sourceContentVersionId, draft);
      setSummary(saved);
      setDraft(draftFromSummary(saved));
      setEditing(false);
      setEditStatus("saved");
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.code === "RESEARCH_SUMMARY_VERSION_CONFLICT") {
        setError(text("内容已经发生变化，请重新载入后再编辑。", "This summary changed. Reload it before editing again."));
      } else if (saveError instanceof ApiError && saveError.code === "RESEARCH_SUMMARY_ALREADY_EXISTS") {
        setError(text("这个正文版本已经有总结，请重新载入。", "This content version already has a summary. Reload it."));
      } else {
        setError(errorMessage(saveError));
      }
      setEditStatus("save-error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="research-summary" aria-label={text("内容总结", "Content summary")}>
      <header>
        <div>
          <span>{text("重新理解这份资料", "Recall this source")}</span>
          <h3>{text("内容总结", "Content summary")}</h3>
        </div>
        {!loading && !editing && summary && <div className="research-summary-header-actions">
          <button type="button" disabled={generating} onClick={() => void generateAiDraft()}>{generating ? text("正在起草…", "Drafting…") : text("AI 起草", "AI draft")}</button>
          <button type="button" onClick={beginEditing}>{text("编辑", "Edit")}</button>
        </div>}
      </header>

      {loading && <p className="research-summary-muted">{text("正在读取总结…", "Loading summary…")}</p>}
      {error && <div className="research-error" role="alert">{error}</div>}
      {editStatus && <p className={`research-summary-status is-${editStatus}`} role="status">{{
        dirty: "有未保存修改",
        "ai-draft": "AI 草稿 · 未保存",
        saving: "正在保存…",
        saved: "已保存",
        "save-error": "保存失败，请重试",
      }[editStatus]}</p>}
      {!aiSourceTextComplete && <p className="research-summary-muted">{text("这条资料的文字可能不完整，AI 草稿可能遗漏信息。", "This source may be incomplete, so the AI draft may miss information.")}</p>}

      <p className="research-summary-version">这份总结对应资料 V{sourceContentVersionNumber}{sourceIsCurrent ? "" : " · 当前查看的是旧版本"}</p>

      {!loading && !editing && !summary && <div className="research-summary-empty">
        <p>{text("还没有内容总结", "No content summary yet")}</p>
        <span>{text("把这份资料压缩成以后容易重新理解的内容。", "Condense this source so it is easy to understand again later.")}</span>
        <div className="research-summary-empty-actions">
          <button type="button" onClick={beginEditing}>{text("添加总结", "Add summary")}</button>
          <button type="button" disabled={generating} onClick={() => void generateAiDraft()}>{generating ? text("正在起草…", "Drafting…") : text("AI 起草", "AI draft")}</button>
        </div>
        <small>{text("AI 只生成草稿，检查后由你决定是否保存。", "AI only creates a draft. You decide whether to save it after review.")}</small>
      </div>}

      {!loading && !editing && summary && <div className="research-summary-content">
        <section>
          <span>{text("一句话总结", "One-line summary")}</span>
          <p>{summary.oneLineSummary}</p>
        </section>
        {summary.coreContent && <section>
          <span>{text("核心内容", "Core content")}</span>
          <p>{summary.coreContent}</p>
        </section>}
        {summary.keyEvidence && <section>
          <span>{text("关键证据", "Key evidence")}</span>
          <p>{summary.keyEvidence}</p>
        </section>}
        {summary.unresolved && <section>
          <span>{text("尚未确认", "Unresolved")}</span>
          <p>{summary.unresolved}</p>
        </section>}
      </div>}

      {!loading && editing && <form className="research-summary-form" onSubmit={(event) => void save(event)}>
        <div className="research-summary-ai-row">
          <button type="button" disabled={saving || generating} onClick={() => void generateAiDraft()}>{generating ? text("正在起草…", "Drafting…") : text("AI 起草", "AI draft")}</button>
          <span>{text("AI 只生成草稿，检查后由你决定是否保存。", "AI only creates a draft. You decide whether to save it after review.")}</span>
        </div>
        <label>
          <span>{text("一句话总结", "One-line summary")}</span>
          <textarea
            required
            rows={3}
            maxLength={1000}
            value={draft.oneLineSummary}
            placeholder={text("用 1～3 句话写清这份资料最重要的内容", "Capture the most important point in 1–3 sentences")}
            onChange={(event) => changeDraft("oneLineSummary", event.target.value)}
          />
        </label>
        <label>
          <span>{text("核心内容", "Core content")}</span>
          <textarea
            rows={5}
            value={draft.coreContent}
            placeholder={text("记录 3～5 个重点，也可以自由分行", "Keep the main points, one per line if useful")}
            onChange={(event) => changeDraft("coreContent", event.target.value)}
          />
        </label>
        <label>
          <span>{text("关键证据", "Key evidence")}</span>
          <textarea
            rows={4}
            value={draft.keyEvidence}
            placeholder={text("重要数据、案例或原文依据（可留空）", "Important data, cases, or source evidence (optional)")}
            onChange={(event) => changeDraft("keyEvidence", event.target.value)}
          />
        </label>
        <label>
          <span>{text("尚未确认", "Unresolved")}</span>
          <textarea
            rows={4}
            value={draft.unresolved}
            placeholder={text("仍不确定或需要继续查证的内容（可留空）", "What remains uncertain or needs checking (optional)")}
            onChange={(event) => changeDraft("unresolved", event.target.value)}
          />
        </label>
        <footer>
          <button type="button" disabled={saving || generating} onClick={() => {
            setEditing(false);
            setDraft(draftFromSummary(summary));
            setError(null);
            setEditStatus(null);
          }}>{text("取消", "Cancel")}</button>
          <button className="button primary" type="submit" disabled={saving || generating}>{saving ? text("正在保存…", "Saving…") : text("保存", "Save")}</button>
        </footer>
      </form>}
    </section>
  );
}
