import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createResearchRecordSummary,
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
}: {
  recordId: string;
  sourceContentVersionId: string;
}) {
  const { text } = useTaskboardI18n();
  const [summary, setSummary] = useState<ResearchRecordSummary | null>(null);
  const [draft, setDraft] = useState<ResearchRecordSummaryDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEditing(false);
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
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.oneLineSummary.trim()) {
      setError(text("请填写一句话总结。", "Add a one-line summary."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = summary
        ? await updateResearchRecordSummary(summary, draft)
        : await createResearchRecordSummary(recordId, sourceContentVersionId, draft);
      setSummary(saved);
      setDraft(draftFromSummary(saved));
      setEditing(false);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.code === "RESEARCH_SUMMARY_VERSION_CONFLICT") {
        setError(text("内容已经发生变化，请重新载入后再编辑。", "This summary changed. Reload it before editing again."));
      } else if (saveError instanceof ApiError && saveError.code === "RESEARCH_SUMMARY_ALREADY_EXISTS") {
        setError(text("这个正文版本已经有总结，请重新载入。", "This content version already has a summary. Reload it."));
      } else {
        setError(errorMessage(saveError));
      }
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
        {!loading && !editing && summary && <button type="button" onClick={beginEditing}>{text("编辑", "Edit")}</button>}
      </header>

      {loading && <p className="research-summary-muted">{text("正在读取总结…", "Loading summary…")}</p>}
      {error && <div className="research-error" role="alert">{error}</div>}

      {!loading && !editing && !summary && <div className="research-summary-empty">
        <p>{text("还没有内容总结", "No content summary yet")}</p>
        <button type="button" onClick={beginEditing}>{text("添加总结", "Add summary")}</button>
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
        <label>
          <span>{text("一句话总结", "One-line summary")}</span>
          <textarea
            required
            rows={3}
            maxLength={1000}
            value={draft.oneLineSummary}
            placeholder={text("用 1～3 句话写清这份资料最重要的内容", "Capture the most important point in 1–3 sentences")}
            onChange={(event) => setDraft((current) => ({ ...current, oneLineSummary: event.target.value }))}
          />
        </label>
        <label>
          <span>{text("核心内容", "Core content")}</span>
          <textarea
            rows={5}
            value={draft.coreContent}
            placeholder={text("记录 3～5 个重点，也可以自由分行", "Keep the main points, one per line if useful")}
            onChange={(event) => setDraft((current) => ({ ...current, coreContent: event.target.value }))}
          />
        </label>
        <label>
          <span>{text("关键证据", "Key evidence")}</span>
          <textarea
            rows={4}
            value={draft.keyEvidence}
            placeholder={text("重要数据、案例或原文依据（可留空）", "Important data, cases, or source evidence (optional)")}
            onChange={(event) => setDraft((current) => ({ ...current, keyEvidence: event.target.value }))}
          />
        </label>
        <label>
          <span>{text("尚未确认", "Unresolved")}</span>
          <textarea
            rows={4}
            value={draft.unresolved}
            placeholder={text("仍不确定或需要继续查证的内容（可留空）", "What remains uncertain or needs checking (optional)")}
            onChange={(event) => setDraft((current) => ({ ...current, unresolved: event.target.value }))}
          />
        </label>
        <footer>
          <button type="button" disabled={saving} onClick={() => {
            setEditing(false);
            setDraft(draftFromSummary(summary));
            setError(null);
          }}>{text("取消", "Cancel")}</button>
          <button className="button primary" type="submit" disabled={saving}>{saving ? text("正在保存…", "Saving…") : text("保存", "Save")}</button>
        </footer>
      </form>}
    </section>
  );
}
