import { randomUUID } from "node:crypto";

import { applyResearchMigrations } from "./research-migrations.mjs";

function now() {
  return new Date().toISOString();
}

function topicFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    coreQuestion: row.core_question,
    currentView: row.current_view,
    confidenceLevel: row.confidence_level,
    nextAction: row.next_action,
    reviewTrigger: row.review_trigger,
    labels: JSON.parse(row.labels),
    lastResearchedAt: row.last_researched_at,
    openQuestionCount: Number(row.open_question_count ?? 0),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function questionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    topicId: row.topic_id,
    question: row.question,
    status: row.status,
    answerOrNote: row.answer_or_note,
    sortOrder: row.sort_order,
    version: row.version,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskFromRow(row) {
  return {
    id: row.id,
    identifier: row.identifier,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
  };
}

export class ResearchDatabase {
  constructor(database, { databasePath } = {}) {
    this.database = database;
    this.migrationResult = applyResearchMigrations(database, { databasePath });
  }

  listTopics() {
    return this.database.prepare(`
      SELECT topics.*,
        (SELECT COUNT(*)
          FROM topic_questions
          WHERE topic_questions.topic_id = topics.id
            AND topic_questions.status = 'open') AS open_question_count
      FROM topics
      ORDER BY topics.updated_at DESC, topics.id
    `).all().map(topicFromRow);
  }

  getTopic(id) {
    const topic = topicFromRow(this.database.prepare(`
      SELECT topics.*,
        (SELECT COUNT(*)
          FROM topic_questions
          WHERE topic_questions.topic_id = topics.id
            AND topic_questions.status = 'open') AS open_question_count
      FROM topics
      WHERE topics.id = ?
    `).get(id));
    if (!topic) return null;
    const tasks = this.database.prepare(`
      SELECT tasks.id, tasks.identifier, tasks.project_id, tasks.title, tasks.status
      FROM topic_tasks
      JOIN tasks ON tasks.id = topic_tasks.task_id
      WHERE topic_tasks.topic_id = ?
      ORDER BY topic_tasks.created_at, tasks.identifier
    `).all(id).map(taskFromRow);
    const questions = this.database.prepare(`
      SELECT * FROM topic_questions
      WHERE topic_id = ?
      ORDER BY sort_order, created_at, id
    `).all(id).map(questionFromRow);
    return { ...topic, tasks, questions };
  }

  createTopic(input) {
    const timestamp = now();
    const topic = {
      id: randomUUID(),
      title: input.title,
      status: input.status,
      coreQuestion: input.coreQuestion,
      currentView: input.currentView,
      confidenceLevel: input.confidenceLevel,
      nextAction: input.nextAction,
      reviewTrigger: input.reviewTrigger,
      labels: input.labels,
      lastResearchedAt: null,
      openQuestionCount: 0,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.database.prepare(`
      INSERT INTO topics (
        id, title, status, core_question, current_view, confidence_level,
        next_action, review_trigger, labels, last_researched_at,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      topic.id,
      topic.title,
      topic.status,
      topic.coreQuestion,
      topic.currentView,
      topic.confidenceLevel,
      topic.nextAction,
      topic.reviewTrigger,
      JSON.stringify(topic.labels),
      topic.lastResearchedAt,
      topic.version,
      topic.createdAt,
      topic.updatedAt,
    );
    return topic;
  }

  updateTopic(id, input) {
    const current = this.getTopic(id);
    if (!current) return { kind: "not_found" };
    if (current.version !== input.version) {
      return { kind: "conflict", currentVersion: current.version };
    }
    const next = {
      ...current,
      ...input.changes,
      version: current.version + 1,
      updatedAt: now(),
    };
    const result = this.database.prepare(`
      UPDATE topics
      SET title = ?, status = ?, core_question = ?, current_view = ?,
          confidence_level = ?, next_action = ?, review_trigger = ?,
          labels = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `).run(
      next.title,
      next.status,
      next.coreQuestion,
      next.currentView,
      next.confidenceLevel,
      next.nextAction,
      next.reviewTrigger,
      JSON.stringify(next.labels),
      next.version,
      next.updatedAt,
      id,
      input.version,
    );
    if (result.changes === 0) {
      const latest = this.getTopic(id);
      return latest
        ? { kind: "conflict", currentVersion: latest.version }
        : { kind: "not_found" };
    }
    return { kind: "updated", topic: this.getTopic(id) };
  }

  markTopicResearched(id, version) {
    if (!this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(id)) {
      return { kind: "not_found" };
    }
    const timestamp = now();
    const result = this.database.prepare(`
      UPDATE topics
      SET last_researched_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ?
    `).run(timestamp, timestamp, id, version);
    if (result.changes === 0) {
      const latest = this.getTopic(id);
      return latest
        ? { kind: "conflict", currentVersion: latest.version }
        : { kind: "not_found" };
    }
    return { kind: "updated", topic: this.getTopic(id) };
  }

  createQuestion(topicId, input) {
    if (!this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) {
      return { kind: "topic_not_found" };
    }
    const timestamp = now();
    const sortOrder = this.database.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
      FROM topic_questions WHERE topic_id = ?
    `).get(topicId).next_order;
    this.database.prepare(`
      INSERT INTO topic_questions (
        id, topic_id, question, status, answer_or_note, sort_order,
        version, resolved_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'open', '', ?, 1, NULL, ?, ?)
    `).run(randomUUID(), topicId, input.question, sortOrder, timestamp, timestamp);
    return { kind: "created", topic: this.getTopic(topicId) };
  }

  updateQuestion(topicId, questionId, input) {
    const current = questionFromRow(this.database.prepare(`
      SELECT * FROM topic_questions WHERE id = ? AND topic_id = ?
    `).get(questionId, topicId));
    if (!current) return { kind: "not_found" };
    if (current.version !== input.version) {
      return { kind: "conflict", currentVersion: current.version };
    }
    const timestamp = now();
    const nextStatus = input.changes.status ?? current.status;
    const resolvedAt = nextStatus === "resolved"
      ? current.resolvedAt ?? timestamp
      : null;
    const next = {
      ...current,
      ...input.changes,
      status: nextStatus,
      resolvedAt,
      version: current.version + 1,
      updatedAt: timestamp,
    };
    const result = this.database.prepare(`
      UPDATE topic_questions
      SET question = ?, status = ?, answer_or_note = ?, resolved_at = ?,
          version = ?, updated_at = ?
      WHERE id = ? AND topic_id = ? AND version = ?
    `).run(
      next.question,
      next.status,
      next.answerOrNote,
      next.resolvedAt,
      next.version,
      next.updatedAt,
      questionId,
      topicId,
      input.version,
    );
    if (result.changes === 0) {
      const latest = questionFromRow(this.database.prepare(`
        SELECT * FROM topic_questions WHERE id = ? AND topic_id = ?
      `).get(questionId, topicId));
      return latest
        ? { kind: "conflict", currentVersion: latest.version }
        : { kind: "not_found" };
    }
    return { kind: "updated", topic: this.getTopic(topicId) };
  }

  moveQuestion(topicId, questionId, { version, direction }) {
    if (!this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) {
      return { kind: "topic_not_found" };
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const questions = this.database.prepare(`
        SELECT * FROM topic_questions
        WHERE topic_id = ?
        ORDER BY sort_order, created_at, id
      `).all(topicId).map(questionFromRow);
      const index = questions.findIndex((question) => question.id === questionId);
      if (index < 0) {
        this.database.exec("ROLLBACK");
        return { kind: "not_found" };
      }
      const current = questions[index];
      if (current.version !== version) {
        this.database.exec("ROLLBACK");
        return { kind: "conflict", currentVersion: current.version };
      }
      const targetIndex = index + (direction === "up" ? -1 : 1);
      if (targetIndex < 0 || targetIndex >= questions.length) {
        this.database.exec("COMMIT");
        return { kind: "updated", topic: this.getTopic(topicId) };
      }
      const target = questions[targetIndex];
      const timestamp = now();
      const update = this.database.prepare(`
        UPDATE topic_questions
        SET sort_order = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND topic_id = ?
      `);
      update.run(target.sortOrder, timestamp, current.id, topicId);
      update.run(current.sortOrder, timestamp, target.id, topicId);
      this.database.exec("COMMIT");
      return { kind: "updated", topic: this.getTopic(topicId) };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  linkTask(topicId, taskId) {
    if (!this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) {
      return { kind: "topic_not_found" };
    }
    if (!this.database.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) {
      return { kind: "task_not_found" };
    }
    const existing = this.database.prepare(`
      SELECT topic_id FROM topic_tasks WHERE task_id = ?
    `).get(taskId);
    if (existing) {
      return existing.topic_id === topicId
        ? { kind: "already_linked" }
        : { kind: "task_linked_elsewhere", topicId: existing.topic_id };
    }
    this.database.prepare(`
      INSERT INTO topic_tasks (topic_id, task_id, created_at) VALUES (?, ?, ?)
    `).run(topicId, taskId, now());
    return { kind: "linked", topic: this.getTopic(topicId) };
  }

  unlinkTask(topicId, taskId) {
    return this.database.prepare(`
      DELETE FROM topic_tasks WHERE topic_id = ? AND task_id = ?
    `).run(topicId, taskId).changes > 0;
  }
}
