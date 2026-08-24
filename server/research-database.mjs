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
    nextAction: row.next_action,
    labels: JSON.parse(row.labels),
    version: row.version,
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
  constructor(database) {
    this.database = database;
    applyResearchMigrations(database);
  }

  listTopics() {
    return this.database.prepare(`
      SELECT * FROM topics ORDER BY updated_at DESC, id
    `).all().map(topicFromRow);
  }

  getTopic(id) {
    const topic = topicFromRow(this.database.prepare(`
      SELECT * FROM topics WHERE id = ?
    `).get(id));
    if (!topic) return null;
    const tasks = this.database.prepare(`
      SELECT tasks.id, tasks.identifier, tasks.project_id, tasks.title, tasks.status
      FROM topic_tasks
      JOIN tasks ON tasks.id = topic_tasks.task_id
      WHERE topic_tasks.topic_id = ?
      ORDER BY topic_tasks.created_at, tasks.identifier
    `).all(id).map(taskFromRow);
    return { ...topic, tasks };
  }

  createTopic(input) {
    const timestamp = now();
    const topic = {
      id: randomUUID(),
      title: input.title,
      status: input.status,
      coreQuestion: input.coreQuestion,
      currentView: input.currentView,
      nextAction: input.nextAction,
      labels: input.labels,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.database.prepare(`
      INSERT INTO topics (
        id, title, status, core_question, current_view, next_action,
        labels, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      topic.id,
      topic.title,
      topic.status,
      topic.coreQuestion,
      topic.currentView,
      topic.nextAction,
      JSON.stringify(topic.labels),
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
          next_action = ?, labels = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `).run(
      next.title,
      next.status,
      next.coreQuestion,
      next.currentView,
      next.nextAction,
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
