import { useState, type FormEvent } from "react";

import { ApiError } from "../api";
import { useTaskboardI18n } from "../i18n";
import {
  createTopicQuestion,
  moveTopicQuestion,
  setTopicQuestionStatus,
  updateTopicQuestion,
} from "../researchApi";
import type { TopicDetail, TopicQuestion, TopicQuestionStatus } from "../researchTypes";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function TopicQuestionList({
  topic,
  onChange,
}: {
  topic: TopicDetail;
  onChange: (topic: TopicDetail) => void;
}) {
  const { text } = useTaskboardI18n();
  const [newQuestion, setNewQuestion] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editNote, setEditNote] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(operation: () => Promise<TopicDetail>) {
    setPending(true);
    setError(null);
    try {
      onChange(await operation());
    } catch (operationError) {
      if (operationError instanceof ApiError && operationError.code === "QUESTION_VERSION_CONFLICT") {
        setError(text(
          "这个问题已在别处更新，请重新打开 Topic 后再操作。",
          "This question changed elsewhere. Reopen the topic before editing it.",
        ));
      } else {
        setError(errorMessage(operationError));
      }
      throw operationError;
    } finally {
      setPending(false);
    }
  }

  async function addQuestion(event: FormEvent) {
    event.preventDefault();
    const value = newQuestion.trim();
    if (!value) return;
    try {
      await run(() => createTopicQuestion(topic.id, value));
      setNewQuestion("");
    } catch {
      // The inline error already explains the failure.
    }
  }

  function beginEdit(question: TopicQuestion) {
    setEditingId(question.id);
    setEditQuestion(question.question);
    setEditNote(question.answerOrNote);
    setResolvingId(null);
    setError(null);
  }

  async function saveEdit(question: TopicQuestion) {
    const value = editQuestion.trim();
    if (!value) return;
    try {
      await run(() => updateTopicQuestion(question, {
        question: value,
        ...(question.status === "resolved" ? { answerOrNote: editNote.trim() } : {}),
      }));
      setEditingId(null);
    } catch {
      // The inline error already explains the failure.
    }
  }

  function beginResolve(question: TopicQuestion) {
    setResolvingId(question.id);
    setResolutionNote(question.answerOrNote);
    setEditingId(null);
    setError(null);
  }

  async function changeStatus(
    question: TopicQuestion,
    status: TopicQuestionStatus,
    note?: string,
  ) {
    try {
      await run(() => setTopicQuestionStatus(question, status, note));
      setResolvingId(null);
      setResolutionNote("");
    } catch {
      // The inline error already explains the failure.
    }
  }

  async function move(question: TopicQuestion, direction: "up" | "down") {
    try {
      await run(() => moveTopicQuestion(question, direction));
    } catch {
      // The inline error already explains the failure.
    }
  }

  const statusLabel = (status: TopicQuestionStatus) => ({
    open: text("未解决", "Open"),
    resolved: text("已解决", "Resolved"),
    dropped: text("不再研究", "Dropped"),
  })[status];

  return (
    <section className="research-questions-panel">
      <div className="research-section-heading">
        <div>
          <span>{text("认知缺口", "Knowledge gaps")}</span>
          <h2>{text("未解决问题", "Open Questions")}</h2>
        </div>
        <span className="research-open-count">{topic.openQuestionCount} {text("个未解决", "open")}</span>
      </div>

      <form className="research-question-create" onSubmit={(event) => void addQuestion(event)}>
        <input
          value={newQuestion}
          maxLength={2_000}
          onChange={(event) => setNewQuestion(event.target.value)}
          placeholder={text("新增一个需要研究的问题…", "Add a question to investigate…")}
          aria-label={text("新问题", "New question")}
        />
        <button className="button" type="submit" disabled={pending || !newQuestion.trim()}>
          {text("添加问题", "Add question")}
        </button>
      </form>

      {error && <div className="research-error" role="alert">{error}</div>}

      {topic.questions.length === 0 ? (
        <p className="research-empty-copy">{text(
          "还没有问题。把需要继续验证的判断拆成可以逐个解决的问题。",
          "No questions yet. Break the remaining uncertainty into questions you can resolve one by one.",
        )}</p>
      ) : (
        <div className="research-question-list">
          {topic.questions.map((question, index) => (
            <article key={question.id} className={`research-question status-${question.status}`}>
              <div className="research-question-order" aria-label={text("调整顺序", "Reorder")}>
                <button type="button" disabled={pending || index === 0} onClick={() => void move(question, "up")} aria-label={text("上移问题", "Move question up")}>↑</button>
                <button type="button" disabled={pending || index === topic.questions.length - 1} onClick={() => void move(question, "down")} aria-label={text("下移问题", "Move question down")}>↓</button>
              </div>
              <div className="research-question-content">
                <div className="research-question-title">
                  <span className={`research-question-status status-${question.status}`}>{statusLabel(question.status)}</span>
                  <strong>{question.question}</strong>
                </div>
                {question.status === "resolved" && (
                  <p className="research-resolution-note">
                    <span>{text("解决说明", "Resolution note")}</span>
                    {question.answerOrNote || text("未填写说明", "No note added")}
                  </p>
                )}

                {editingId === question.id && (
                  <div className="research-question-editor">
                    <label>
                      <span>{text("问题", "Question")}</span>
                      <textarea value={editQuestion} onChange={(event) => setEditQuestion(event.target.value)} rows={2} />
                    </label>
                    {question.status === "resolved" && (
                      <label>
                        <span>{text("解决说明", "Resolution note")}</span>
                        <textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} rows={3} />
                      </label>
                    )}
                    <div>
                      <button className="button" type="button" disabled={pending} onClick={() => setEditingId(null)}>{text("取消", "Cancel")}</button>
                      <button className="button primary" type="button" disabled={pending || !editQuestion.trim()} onClick={() => void saveEdit(question)}>{text("保存", "Save")}</button>
                    </div>
                  </div>
                )}

                {resolvingId === question.id && (
                  <div className="research-question-editor">
                    <label>
                      <span>{text("为什么认为它已经解决？", "Why is this resolved?")}</span>
                      <textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} rows={3} placeholder={text("填写目前的答案或判断依据…", "Add the current answer or reasoning…")} />
                    </label>
                    <div>
                      <button className="button" type="button" disabled={pending} onClick={() => setResolvingId(null)}>{text("取消", "Cancel")}</button>
                      <button className="button primary" type="button" disabled={pending} onClick={() => void changeStatus(question, "resolved", resolutionNote.trim())}>{text("标记已解决", "Mark resolved")}</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="research-question-actions">
                <button className="button subtle" type="button" disabled={pending} onClick={() => beginEdit(question)}>{text("编辑", "Edit")}</button>
                {question.status === "open" ? (
                  <>
                    <button className="button subtle" type="button" disabled={pending} onClick={() => beginResolve(question)}>{text("解决", "Resolve")}</button>
                    <button className="button subtle" type="button" disabled={pending} onClick={() => void changeStatus(question, "dropped")}>{text("不再研究", "Drop")}</button>
                  </>
                ) : (
                  <button className="button subtle" type="button" disabled={pending} onClick={() => void changeStatus(question, "open")}>{text("恢复为未解决", "Restore as open")}</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="research-question-policy">{text(
        "本阶段不永久删除问题；不再继续的问题标记为“不再研究”，以后仍可恢复。",
        "Questions are not permanently deleted in this phase. Drop them now and restore them later if needed.",
      )}</p>
    </section>
  );
}
