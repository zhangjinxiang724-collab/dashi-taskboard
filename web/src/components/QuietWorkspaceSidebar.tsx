import { useTaskboardI18n } from "../i18n";

type WorkspaceMode = "research" | "tasks";

function ResearchGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="4.75" />
      <path d="m12 12 3.6 3.6" />
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

  return (
    <aside className="quiet-sidebar" aria-label={text("主导航", "Primary navigation")}>
      <div className="quiet-sidebar-brand">
        <span className="quiet-sidebar-mark" aria-hidden="true"><i /></span>
        <strong>Research OS</strong>
      </div>

      <nav className="quiet-sidebar-nav">
        <button
          className={mode === "research" ? "active" : ""}
          type="button"
          aria-current={mode === "research" ? "page" : undefined}
          onClick={onShowResearch}
        >
          <ResearchGlyph />
          <span>{text("研究", "Research")}</span>
        </button>
        <button
          className={mode === "tasks" ? "active" : ""}
          type="button"
          aria-current={mode === "tasks" ? "page" : undefined}
          onClick={onShowTasks}
        >
          <TaskGlyph />
          <span>{text("任务", "Tasks")}</span>
        </button>
      </nav>

      <div className="quiet-sidebar-spacer" />
      <button className="quiet-sidebar-settings" type="button" aria-disabled="true">
        <SettingsGlyph />
        <span>{text("设置", "Settings")}</span>
      </button>
    </aside>
  );
}
