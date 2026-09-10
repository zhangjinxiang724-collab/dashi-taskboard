import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

import { applyResearchMigrations } from "./research-migrations.mjs";
import {
  capturedConversationFingerprint,
  reconcileCapturedConversations,
} from "../shared/captured-conversation-domain.mjs";

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

function researchRecordFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    topicId: row.primary_topic_id,
    title: row.title,
    provider: row.provider,
    kind: row.kind,
    url: row.url,
    externalId: row.external_id,
    summary: row.summary,
    note: row.note,
    occurredAt: row.occurred_at,
    captureAdapter: row.capture_adapter,
    captureCompleteness: row.capture_completeness ?? null,
    lastCapturedAt: row.last_captured_at ?? null,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decodeContentRow(row) {
  if (!row) return null;
  const contentBuffer = gunzipSync(row.content_blob);
  const contentHash = `sha256:${createHash("sha256").update(contentBuffer).digest("hex")}`;
  if (contentHash !== row.content_hash) {
    throw new Error(`Research record content failed its integrity check: ${row.record_id}`);
  }
  return {
    recordId: row.record_id,
    content: JSON.parse(contentBuffer.toString("utf8")),
    contentHash: row.content_hash,
    messageCount: row.message_count,
    omittedMessageCount: row.omitted_message_count,
    sourceCreatedAt: row.source_created_at,
    sourceUpdatedAt: row.source_updated_at,
    versionId: row.version_id ?? null,
    versionNumber: row.version_number ?? 1,
    captureAdapter: row.capture_adapter ?? null,
    completeness: row.completeness ?? null,
    completenessDetails: row.completeness_details
      ? JSON.parse(row.completeness_details)
      : null,
    relationToPrevious: row.relation_to_previous ?? null,
    capturedAt: row.captured_at ?? row.created_at,
  };
}

function compactPreview(value, maxLength = 240) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}…`
    : normalized;
}

function contentPreview(content) {
  for (const message of content?.content?.messages ?? []) {
    if (typeof message.text === "string") {
      const preview = compactPreview(message.text);
      if (preview) return preview;
    }
    for (const part of message.parts ?? []) {
      if (part.type !== "text" || typeof part.text !== "string") continue;
      const preview = compactPreview(part.text);
      if (preview) return preview;
    }
  }
  return "";
}

export class ResearchDatabase {
  constructor(database, { databasePath } = {}) {
    this.database = database;
    this.databasePath = databasePath;
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

  listResearchRecords(topicId) {
    if (!this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) {
      return { kind: "topic_not_found" };
    }
    const records = this.database.prepare(`
      SELECT * FROM research_records
      WHERE primary_topic_id = ? AND deleted_at IS NULL
      ORDER BY occurred_at DESC, created_at DESC, id DESC
    `).all(topicId).map(researchRecordFromRow);
    return { kind: "found", records };
  }

  getResearchRecord(id, { includeDeleted = false } = {}) {
    return researchRecordFromRow(this.database.prepare(`
      SELECT * FROM research_records
      WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}
    `).get(id));
  }

  getResearchRecordContent(id, versionNumber = null) {
    const versionClause = versionNumber === null ? "AND versions.is_current = 1" : "AND versions.version_number = ?";
    const parameters = versionNumber === null ? [id] : [id, versionNumber];
    const versionRow = this.database.prepare(`
      SELECT versions.*, versions.id AS version_id
      FROM research_record_content_versions versions
      JOIN research_records records ON records.id = versions.record_id
      WHERE versions.record_id = ? AND records.deleted_at IS NULL ${versionClause}
    `).get(...parameters);
    if (versionRow) return decodeContentRow(versionRow);
    const legacyRow = this.database.prepare(`
      SELECT contents.* FROM research_record_contents contents
      JOIN research_records records ON records.id = contents.record_id
      WHERE contents.record_id = ? AND records.deleted_at IS NULL AND contents.deleted_at IS NULL
    `).get(id);
    return decodeContentRow(legacyRow);
  }

  listResearchRecordContentVersions(id) {
    if (!this.getResearchRecord(id)) return null;
    return this.database.prepare(`
      SELECT id, record_id, version_number, capture_adapter, completeness,
        completeness_details, relation_to_previous, content_hash, source_fingerprint,
        message_count, omitted_message_count, source_created_at, source_updated_at,
        captured_at, is_current, created_at
      FROM research_record_content_versions
      WHERE record_id = ?
      ORDER BY version_number DESC
    `).all(id).map((row) => ({
      id: row.id,
      recordId: row.record_id,
      versionNumber: row.version_number,
      captureAdapter: row.capture_adapter,
      completeness: row.completeness,
      completenessDetails: JSON.parse(row.completeness_details),
      relationToPrevious: row.relation_to_previous,
      contentHash: row.content_hash,
      sourceFingerprint: row.source_fingerprint,
      messageCount: row.message_count,
      omittedMessageCount: row.omitted_message_count,
      sourceCreatedAt: row.source_created_at,
      sourceUpdatedAt: row.source_updated_at,
      capturedAt: row.captured_at,
      isCurrent: Boolean(row.is_current),
      createdAt: row.created_at,
    }));
  }

  findImportedDuplicate(provider, externalId, sourceFingerprint) {
    return this.database.prepare(`
      SELECT id, external_id, source_fingerprint FROM research_records
      WHERE provider = ? AND deleted_at IS NULL
        AND capture_adapter IN ('chatgpt-export-v1', 'chatgpt-browser-v1')
        AND ((? IS NOT NULL AND external_id = ?) OR source_fingerprint = ?)
      LIMIT 1
    `).get(provider, externalId, externalId, sourceFingerprint) ?? null;
  }

  findCapturedConversation(provider, externalId, sourceFingerprint) {
    return researchRecordFromRow(this.database.prepare(`
      SELECT * FROM research_records
      WHERE provider = ? AND deleted_at IS NULL
        AND ((? IS NOT NULL AND external_id = ?) OR source_fingerprint = ?)
      ORDER BY CASE WHEN external_id = ? THEN 0 ELSE 1 END, created_at
      LIMIT 1
    `).get(provider, externalId, externalId, sourceFingerprint, externalId));
  }

  compareCapturedConversation(recordId, conversation) {
    const current = this.getResearchRecordContent(recordId);
    if (!current) return { relation: "conflict", reason: "missing-current-content" };
    const record = this.getResearchRecord(recordId);
    const storedConversation = {
      ...current.content,
      provider: record?.provider ?? "chatgpt",
      captureAdapter: current.captureAdapter ?? record?.captureAdapter ?? "unknown",
      externalConversationId: current.content.externalConversationId ?? current.content.externalId ?? record?.externalId ?? null,
      sourceUrl: current.content.sourceUrl ?? record?.url ?? null,
      capturedAt: current.capturedAt,
      branchScope: current.content.branchScope ?? "active-visible-branch",
      completeness: current.completeness ?? record?.captureCompleteness ?? "partial",
      completenessDetails: current.completenessDetails ?? {},
      captureStats: current.content.captureStats ?? {
        discoveredMessageCount: current.messageCount,
        messageOmissionCount: current.omittedMessageCount,
        unsupportedContentCount: 0,
      },
    };
    return reconcileCapturedConversations(storedConversation, conversation);
  }

  createCaptureClient({ extensionId, displayName, tokenHash }) {
    const timestamp = now();
    const client = {
      id: randomUUID(),
      extensionId,
      displayName,
      createdAt: timestamp,
    };
    this.database.prepare(`
      INSERT INTO research_capture_clients (
        id, extension_id, display_name, token_hash, scopes, created_at, last_used_at, revoked_at
      ) VALUES (?, ?, ?, ?, '["capture"]', ?, NULL, NULL)
    `).run(client.id, extensionId, displayName, tokenHash, timestamp);
    return client;
  }

  findCaptureClientByTokenHash(tokenHash) {
    const row = this.database.prepare(`
      SELECT * FROM research_capture_clients
      WHERE token_hash = ? AND revoked_at IS NULL
    `).get(tokenHash);
    if (!row) return null;
    return {
      id: row.id,
      extensionId: row.extension_id,
      displayName: row.display_name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    };
  }

  touchCaptureClient(id) {
    this.database.prepare(`
      UPDATE research_capture_clients SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL
    `).run(now(), id);
  }

  listCaptureClients() {
    return this.database.prepare(`
      SELECT id, extension_id, display_name, created_at, last_used_at, revoked_at
      FROM research_capture_clients ORDER BY created_at DESC
    `).all().map((row) => ({
      id: row.id,
      extensionId: row.extension_id,
      displayName: row.display_name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    }));
  }

  revokeCaptureClient(id) {
    return this.database.prepare(`
      UPDATE research_capture_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
    `).run(now(), id).changes > 0;
  }

  commitCapturedConversation({
    conversation,
    topicId,
    completeness,
    completenessDetails,
    relation,
    existingRecordId,
    expectedRecordVersion,
  }) {
    if (topicId && !this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) {
      return { kind: "topic_not_found" };
    }
    if (completeness !== "complete" && completeness !== "partial") {
      throw new Error("Only complete or explicitly accepted partial captures can be saved");
    }
    const timestamp = now();
    const captureAdapter = conversation.captureAdapter === "chatgpt-export-v1"
      ? "chatgpt-export-v1"
      : "chatgpt-browser-v1";
    const storedRelation = relation === "safe_merge" ? "append" : relation;
    const storedDetails = relation === "safe_merge"
      ? { ...completenessDetails, coverageRelation: "safe_merge" }
      : completenessDetails;
    const sourceFingerprint = capturedConversationFingerprint(conversation);
    const contentBuffer = Buffer.from(JSON.stringify(conversation), "utf8");
    const contentHash = `sha256:${createHash("sha256").update(contentBuffer).digest("hex")}`;
    const compressed = gzipSync(contentBuffer);
    const firstMessageTime = conversation.messages.find((message) => message.occurredAt)?.occurredAt;
    const recordId = existingRecordId ?? randomUUID();
    const currentRecord = existingRecordId ? this.getResearchRecord(existingRecordId) : null;
    if (existingRecordId && !currentRecord) return { kind: "not_found" };
    if (currentRecord && currentRecord.version !== expectedRecordVersion) {
      return { kind: "conflict", currentVersion: currentRecord.version };
    }
    const nextVersionNumber = currentRecord
      ? Number(this.database.prepare(`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
        FROM research_record_content_versions WHERE record_id = ?
      `).get(recordId).version_number)
      : 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (!currentRecord) {
        this.database.prepare(`
          INSERT INTO research_records (
            id, primary_topic_id, title, provider, kind, url, external_id, summary, note,
            occurred_at, capture_adapter, version, deleted_at, created_at, updated_at,
            source_fingerprint, capture_completeness, last_captured_at
          ) VALUES (?, ?, ?, 'chatgpt', 'chat', ?, ?, '', '', ?, ?,
            1, NULL, ?, ?, ?, ?, ?)
        `).run(
          recordId, topicId, conversation.title, conversation.sourceUrl,
          conversation.externalConversationId, firstMessageTime ?? conversation.capturedAt, captureAdapter,
          timestamp, timestamp, sourceFingerprint, completeness, conversation.capturedAt,
        );
      } else {
        const update = this.database.prepare(`
          UPDATE research_records
          SET primary_topic_id = ?, title = ?, url = ?, source_fingerprint = ?,
            capture_adapter = ?, capture_completeness = ?,
            last_captured_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
        `).run(
          topicId, conversation.title, conversation.sourceUrl, sourceFingerprint,
          captureAdapter, completeness, conversation.capturedAt, timestamp, recordId, expectedRecordVersion,
        );
        if (update.changes === 0) {
          this.database.exec("ROLLBACK");
          return { kind: "conflict", currentVersion: this.getResearchRecord(recordId)?.version ?? null };
        }
        this.database.prepare(`
          UPDATE research_record_content_versions SET is_current = 0 WHERE record_id = ? AND is_current = 1
        `).run(recordId);
      }
      this.database.prepare(`
        INSERT INTO research_record_content_versions (
          id, record_id, version_number, capture_adapter, completeness,
          completeness_details, relation_to_previous, content_encoding, content_blob,
          content_hash, source_fingerprint, message_count, omitted_message_count,
          source_created_at, source_updated_at, captured_at, is_current, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'gzip-json-v1', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        randomUUID(), recordId, nextVersionNumber, captureAdapter, completeness,
        JSON.stringify(storedDetails), storedRelation, compressed, contentHash,
        sourceFingerprint, conversation.messages.length,
        Number(conversation.captureStats?.messageOmissionCount ?? 0),
        firstMessageTime ?? null, conversation.capturedAt, conversation.capturedAt, timestamp,
      );
      this.database.prepare(`
        INSERT INTO research_record_contents (
          record_id, content_encoding, content_blob, content_hash, message_count,
          source_created_at, source_updated_at, omitted_message_count, deleted_at,
          created_at, updated_at
        ) VALUES (?, 'gzip-json-v1', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET
          content_blob = excluded.content_blob,
          content_hash = excluded.content_hash,
          message_count = excluded.message_count,
          source_created_at = excluded.source_created_at,
          source_updated_at = excluded.source_updated_at,
          omitted_message_count = excluded.omitted_message_count,
          deleted_at = NULL,
          updated_at = excluded.updated_at
      `).run(
        recordId, compressed, contentHash, conversation.messages.length,
        firstMessageTime ?? null, conversation.capturedAt,
        Number(conversation.captureStats?.messageOmissionCount ?? 0), timestamp, timestamp,
      );
      this.database.exec("COMMIT");
      return {
        kind: currentRecord ? "updated" : "created",
        record: this.getResearchRecord(recordId),
        contentVersion: nextVersionNumber,
      };
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  listUnclassifiedResearchRecords() {
    return this.database.prepare(`
      SELECT * FROM research_records
      WHERE primary_topic_id IS NULL AND deleted_at IS NULL
      ORDER BY occurred_at DESC, created_at DESC, id DESC
    `).all().map(researchRecordFromRow);
  }

  getResearchInboxSummary() {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM research_records
      WHERE primary_topic_id IS NULL AND deleted_at IS NULL
    `).get();
    return { count: Number(row.count) };
  }

  listResearchInbox({ page = 1, pageSize = 50, provider = null, dateFrom = null, dateTo = null } = {}) {
    const conditions = ["primary_topic_id IS NULL", "deleted_at IS NULL"];
    const parameters = [];
    if (provider) {
      conditions.push("provider = ?");
      parameters.push(provider);
    }
    if (dateFrom) {
      conditions.push("occurred_at >= ?");
      parameters.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("occurred_at <= ?");
      parameters.push(dateTo);
    }
    const where = conditions.join(" AND ");
    const total = Number(this.database.prepare(`
      SELECT COUNT(*) AS count FROM research_records WHERE ${where}
    `).get(...parameters).count);
    const rows = this.database.prepare(`
      SELECT * FROM research_records
      WHERE ${where}
      ORDER BY occurred_at DESC, created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, pageSize, (page - 1) * pageSize);
    const records = rows.map((row) => {
      const record = researchRecordFromRow(row);
      const content = this.getResearchRecordContent(record.id);
      return {
        ...record,
        preview: compactPreview(record.summary) || contentPreview(content) || compactPreview(record.note),
        contentAvailable: content !== null,
        messageCount: content?.messageCount ?? 0,
      };
    });
    return { total, page, pageSize, records };
  }

  assignResearchRecords(recordIds, topicId) {
    if (!this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) {
      return { kind: "topic_not_found" };
    }
    const uniqueIds = [...new Set(recordIds)];
    const timestamp = now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const inboxRecord = this.database.prepare(`
        SELECT 1 FROM research_records
        WHERE id = ? AND primary_topic_id IS NULL AND deleted_at IS NULL
      `);
      const invalidRecordIds = uniqueIds.filter((id) => !inboxRecord.get(id));
      if (invalidRecordIds.length > 0) {
        this.database.exec("ROLLBACK");
        return { kind: "records_not_in_inbox", recordIds: invalidRecordIds };
      }
      const update = this.database.prepare(`
        UPDATE research_records
        SET primary_topic_id = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND primary_topic_id IS NULL AND deleted_at IS NULL
      `);
      for (const id of uniqueIds) {
        if (update.run(topicId, timestamp, id).changes !== 1) {
          throw new Error(`Research inbox record changed while assigning: ${id}`);
        }
      }
      this.database.exec("COMMIT");
      return { kind: "updated", updated: uniqueIds.length };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createTopicAndAssignResearchRecords(recordIds, topicInput) {
    const uniqueIds = [...new Set(recordIds)];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const topic = this.createTopic(topicInput);
      const inboxRecord = this.database.prepare(`
        SELECT 1 FROM research_records
        WHERE id = ? AND primary_topic_id IS NULL AND deleted_at IS NULL
      `);
      const invalidRecordIds = uniqueIds.filter((id) => !inboxRecord.get(id));
      if (invalidRecordIds.length > 0) {
        this.database.exec("ROLLBACK");
        return { kind: "records_not_in_inbox", recordIds: invalidRecordIds };
      }
      const timestamp = now();
      const update = this.database.prepare(`
        UPDATE research_records
        SET primary_topic_id = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND primary_topic_id IS NULL AND deleted_at IS NULL
      `);
      for (const id of uniqueIds) {
        if (update.run(topic.id, timestamp, id).changes !== 1) {
          throw new Error(`Research inbox record changed while creating its topic: ${id}`);
        }
      }
      this.database.exec("COMMIT");
      return { kind: "created", topic, updated: uniqueIds.length };
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  listImportSessions() {
    return this.database.prepare(`
      SELECT * FROM research_import_sessions ORDER BY created_at DESC, id DESC
    `).all().map((row) => ({
      id: row.id,
      provider: row.provider,
      captureAdapter: row.capture_adapter,
      sourceFilename: row.source_filename,
      status: row.status,
      selectedCount: row.selected_count,
      importedCount: row.imported_count,
      skippedCount: row.skipped_count,
      failedCount: row.failed_count,
      unclassifiedCount: row.unclassified_count,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      undoneAt: row.undone_at,
    }));
  }

  undoImportSession(sessionId, version) {
    const session = this.database.prepare(`SELECT * FROM research_import_sessions WHERE id = ?`).get(sessionId);
    if (!session) return { kind: "not_found" };
    if (session.status === "undone") return { kind: "already_undone" };
    if (session.version !== version) return { kind: "conflict", currentVersion: session.version };
    const records = this.database.prepare(`
      SELECT link.record_id, link.imported_record_version, record.version, record.deleted_at,
        EXISTS(SELECT 1 FROM research_record_tasks t WHERE t.record_id = record.id) AS has_tasks
      FROM research_import_session_records link
      JOIN research_records record ON record.id = link.record_id
      WHERE link.session_id = ? AND link.outcome = 'imported'
    `).all(sessionId);
    const unsafe = records.find((record) => (
      record.deleted_at !== null
      || record.version !== record.imported_record_version
      || record.has_tasks
    ));
    if (unsafe) return { kind: "unsafe", recordId: unsafe.record_id };
    const timestamp = now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const softDeleteRecord = this.database.prepare(`
        UPDATE research_records SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND deleted_at IS NULL
      `);
      const softDeleteContent = this.database.prepare(`
        UPDATE research_record_contents SET deleted_at = ?, updated_at = ?
        WHERE record_id = ? AND deleted_at IS NULL
      `);
      for (const record of records) {
        softDeleteRecord.run(timestamp, timestamp, record.record_id);
        softDeleteContent.run(timestamp, timestamp, record.record_id);
      }
      this.database.prepare(`
        UPDATE research_import_sessions
        SET status = 'undone', version = version + 1, updated_at = ?, undone_at = ?
        WHERE id = ? AND version = ?
      `).run(timestamp, timestamp, sessionId, version);
      this.database.exec("COMMIT");
      return { kind: "undone", count: records.length };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createResearchRecord(topicId, input) {
    if (!this.database.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) {
      return { kind: "topic_not_found" };
    }
    const timestamp = now();
    const record = {
      id: randomUUID(),
      topicId,
      title: input.title,
      provider: input.provider,
      kind: input.kind,
      url: input.url,
      externalId: input.externalId,
      summary: input.summary,
      note: input.note,
      occurredAt: input.occurredAt,
      captureAdapter: "manual-v1",
      version: 1,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.database.prepare(`
      INSERT INTO research_records (
        id, primary_topic_id, title, provider, kind, url, external_id,
        summary, note, occurred_at, capture_adapter, version, deleted_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.topicId,
      record.title,
      record.provider,
      record.kind,
      record.url,
      record.externalId,
      record.summary,
      record.note,
      record.occurredAt,
      record.captureAdapter,
      record.version,
      record.deletedAt,
      record.createdAt,
      record.updatedAt,
    );
    return { kind: "created", record };
  }

  updateResearchRecord(id, input) {
    const current = this.getResearchRecord(id);
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
      UPDATE research_records
      SET title = ?, provider = ?, kind = ?, url = ?, external_id = ?,
          summary = ?, note = ?, occurred_at = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ? AND deleted_at IS NULL
    `).run(
      next.title,
      next.provider,
      next.kind,
      next.url,
      next.externalId,
      next.summary,
      next.note,
      next.occurredAt,
      next.version,
      next.updatedAt,
      id,
      input.version,
    );
    if (result.changes === 0) {
      const latest = this.getResearchRecord(id);
      return latest
        ? { kind: "conflict", currentVersion: latest.version }
        : { kind: "not_found" };
    }
    return { kind: "updated", record: this.getResearchRecord(id) };
  }

  deleteResearchRecord(id, version) {
    const current = this.getResearchRecord(id);
    if (!current) return { kind: "not_found" };
    if (current.version !== version) {
      return { kind: "conflict", currentVersion: current.version };
    }
    const timestamp = now();
    const result = this.database.prepare(`
      UPDATE research_records
      SET deleted_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, id, version);
    if (result.changes === 0) {
      const latest = this.getResearchRecord(id);
      return latest
        ? { kind: "conflict", currentVersion: latest.version }
        : { kind: "not_found" };
    }
    return { kind: "deleted" };
  }

  linkResearchRecordTask(recordId, taskId) {
    if (!this.getResearchRecord(recordId)) return { kind: "record_not_found" };
    if (!this.database.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) {
      return { kind: "task_not_found" };
    }
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO research_record_tasks (record_id, task_id, created_at)
      VALUES (?, ?, ?)
    `).run(recordId, taskId, now());
    return result.changes > 0 ? { kind: "linked" } : { kind: "already_linked" };
  }

  unlinkResearchRecordTask(recordId, taskId) {
    return this.database.prepare(`
      DELETE FROM research_record_tasks WHERE record_id = ? AND task_id = ?
    `).run(recordId, taskId).changes > 0;
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
