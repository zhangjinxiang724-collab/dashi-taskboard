import { useState } from "react";

import { useTaskboardI18n } from "../i18n";

type WorkspaceMode = "research" | "tasks";

function ResearchGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m3 9 7-5.75L17 9v7.25H3z" />
      <path d="M7.5 16.25V11h5v5.25" />
    </svg>
  );
}

function TaskGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2.25" />
      <path d="m6.5 9.7 1.65 1.65 4-4" />
    </svg>
  );
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.9v1.3M10 15.8v1.3M17.1 10h-1.3M4.2 10H2.9M15 5l-.9.9M5.9 14.1l-.9.9M15 15l-.9-.9M5.9 5.9 5 5" />
    </svg>
  );
}

function LibraryGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.25 4.5h4.4c1.3 0 2.35.8 2.35 1.8v9.2c0-1-1.05-1.8-2.35-1.8h-4.4zM16.75 4.5h-4.4c-1.3 0-2.35.8-2.35 1.8v9.2c0-1 1.05-1.8 2.35-1.8h4.4z" />
    </svg>
  );
}

export function QuietWorkspaceSidebar({
  mode,
  onShowResearch,
  onShowTasks,
}: {
  mode: WorkspaceMode;
  onShowResearch: () => void;
  onShowTasks: () => void;
}) {
  const { text } = useTaskboardI18n();
  const [showAppearance, setShowAppearance] = useState(false);

  function openResearchView(view: "topics" | "inbox") {
    const url = new URL(window.location.href);
    if (view === "inbox") url.searchParams.set("researchView", "inbox");
    else url.searchParams.delete("researchView");
    window.history.replaceState({}, "", url);
    onShowResearch();
    window.dispatchEvent(new CustomEvent("research-view-change", { detail: view }));
  }

  return (
    <aside className="quiet-sidebar" aria-label={text("主导航", "Primary navigation")}>
      <div className="quiet-sidebar-brand">
        <span className="quiet-sidebar-mark" aria-hidden="true"><i /></span>
        <strong>{text("研究", "Research")}</strong>
      </div>

      <nav className="quiet-sidebar-nav">
        <button
          className={mode === "research" && new URL(document.baseURI).searchParams.get("researchView") !== "inbox" ? "active" : ""}
          type="button"
          aria-current={mode === "research" ? "page" : undefined}
          onClick={() => openResearchView("topics")}
        >
          <ResearchGlyph />
          <span>{text("我的研究", "My Research")}</span>
        </button>
        <button
          className={mode === "research" && new URL(document.baseURI).searchParams.get("researchView") === "inbox" ? "active" : ""}
          type="button"
          onClick={() => openResearchView("inbox")}
        >
          <LibraryGlyph />
          <span>{text("资料库", "Library")}</span>
        </button>
        <button
          className={`quiet-sidebar-auxiliary ${mode === "tasks" ? "active" : ""}`}
          type="button"
          aria-current={mode === "tasks" ? "page" : undefined}
          onClick={onShowTasks}
        >
          <TaskGlyph />
          <span>{text("任务（辅助）", "Tasks")}</span>
        </button>
      </nav>

      <div className="quiet-sidebar-spacer" />
      <button className="quiet-sidebar-settings" type="button" onClick={() => setShowAppearance(true)}>
        <SettingsGlyph />
        <span>{text("设置", "Settings")}</span>
      </button>
      {showAppearance && <div className="research-settings-backdrop" role="presentation">
        <section className="research-settings-panel" role="dialog" aria-modal="true" aria-label={text("设置", "Settings")}>
          <header>
            <div><span>{text("设置", "Settings")}</span><h2>{text("外观", "Appearance")}</h2></div>
            <button type="button" aria-label={text("关闭", "Close")} onClick={() => setShowAppearance(false)}>×</button>
          </header>
          <div className="research-appearance-choice">
            <span className="research-appearance-swatch" aria-hidden="true" />
            <div><strong>{text("黑白灰 / 粉", "Black, white, gray / pink")}</strong><p>{text("当前界面主题", "Current interface theme")}</p></div>
            <span className="research-appearance-current">{text("当前", "Current")}</span>
          </div>
          <p className="research-settings-note">{text("界面保持安静、清晰，适合长时间阅读。更多颜色主题将在后续版本开放。", "A calm interface designed for long reading. More themes will come later.")}</p>
        </section>
      </div>}
    </aside>
  );
}
