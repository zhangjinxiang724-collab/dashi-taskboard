import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

import { createConsistentDatabaseBackup } from "./database-backup.mjs";
import {
  CHATGPT_CAPTURE_ADAPTER,
  CHATGPT_CONTENT_ENCODING,
  createChatGptConversationStream,
  normalizeChatGptConversation,
} from "./import-adapters/chatgpt-export-v1.mjs";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const PREVIEW_TTL_MS = 2 * 60 * 60 * 1_000;

function previewRow(row) {
  return {
    sourceKey: row.source_key,
    externalId: row.external_id,
    title: row.title,
    occurredAt: row.occurred_at,
    updatedAt: row.source_updated_at,
    messageCount: row.message_count,
    omittedMessageCount: row.omitted_message_count,
    sourceFingerprint: row.source_fingerprint,
    preview: row.preview,
    duplicate: Boolean(row.duplicate_record_id),
    duplicateRecordId: row.duplicate_record_id,
    parseError: row.parse_error,
  };
}

async function streamUpload(request, destination) {
  const hash = createHash("sha256");
  const output = createWriteStream(destination, { mode: 0o600 });
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw new Error("Import file exceeds the 5 GiB safety limit");
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
    }
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
  } catch (error) {
    output.destroy();
    throw error;
  }
  return { size, hash: `sha256:${hash.digest("hex")}` };
}

export class ResearchImportService {
  constructor(research) {
    this.research = research;
    this.previews = new Map();
  }

  async createPreview(request, sourceFilename) {
    const id = randomUUID();
    const directory = await mkdtemp(path.join(os.tmpdir(), "research-import-preview-"));
    const uploadPath = path.join(directory, "upload");
    const previewPath = path.join(directory, "preview.sqlite");
    try {
      const source = await streamUpload(request, uploadPath);
      const previewDatabase = new DatabaseSync(previewPath);
      previewDatabase.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE preview_records (
          source_key TEXT PRIMARY KEY, external_id TEXT, title TEXT NOT NULL,
          occurred_at TEXT NOT NULL, source_updated_at TEXT, message_count INTEGER NOT NULL,
          omitted_message_count INTEGER NOT NULL, source_fingerprint TEXT NOT NULL,
          preview TEXT NOT NULL, content_json TEXT NOT NULL, duplicate_record_id TEXT,
          parse_error TEXT
        );
        CREATE INDEX preview_records_occurred ON preview_records(occurred_at DESC, source_key);
      `);
      const insert = previewDatabase.prepare(`
        INSERT OR REPLACE INTO preview_records (
          source_key, external_id, title, occurred_at, source_updated_at, message_count,
          omitted_message_count, source_fingerprint, preview, content_json,
          duplicate_record_id, parse_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let validCount = 0;
      let invalidCount = 0;
      const pipeline = await createChatGptConversationStream(uploadPath, sourceFilename);
      for await (const item of pipeline) {
        const normalized = normalizeChatGptConversation(item.value);
        if (!normalized) {
          invalidCount += 1;
          insert.run(
            `invalid:${invalidCount}`, null, "无法解析的对话",
            new Date(0).toISOString(), null, 0, 0, `invalid:${invalidCount}`,
            "源文件中的这条数据不包含可安全还原的用户与 Assistant 对话。",
            "{}", null, "无法安全重建用户可见消息",
          );
          continue;
        }
        const duplicate = this.research.findImportedDuplicate(
          "chatgpt",
          normalized.externalId,
          normalized.sourceFingerprint,
        );
        insert.run(
          normalized.sourceKey,
          normalized.externalId,
          normalized.title,
          normalized.occurredAt,
          normalized.updatedAt,
          normalized.messageCount,
          normalized.omittedMessageCount,
          normalized.sourceFingerprint,
          normalized.preview,
          JSON.stringify(normalized.content),
          duplicate?.id ?? null,
          null,
        );
        validCount += 1;
      }
      const createdAt = Date.now();
      this.previews.set(id, {
        id, directory, previewDatabase, sourceFilename, sourceHash: source.hash,
        validCount, invalidCount, createdAt,
      });
      return { id, sourceFilename, sourceHash: source.hash, validCount, invalidCount };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  getPreview(id) {
    const preview = this.previews.get(id);
    if (!preview || Date.now() - preview.createdAt > PREVIEW_TTL_MS) return null;
    return preview;
  }

  listPreview(id, { page = 1, pageSize = 50, search = "", duplicates = "all" } = {}) {
    const preview = this.getPreview(id);
    if (!preview) return null;
    const filters = [];
    const parameters = [];
    if (search) {
      filters.push("(title LIKE ? ESCAPE '\\' OR preview LIKE ? ESCAPE '\\')");
      const escaped = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      parameters.push(escaped, escaped);
    }
    if (duplicates === "only") filters.push("duplicate_record_id IS NOT NULL");
    if (duplicates === "exclude") filters.push("duplicate_record_id IS NULL");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = preview.previewDatabase.prepare(`SELECT COUNT(*) AS count FROM preview_records ${where}`).get(...parameters).count;
    const rows = preview.previewDatabase.prepare(`
      SELECT * FROM preview_records ${where}
      ORDER BY occurred_at DESC, source_key LIMIT ? OFFSET ?
    `).all(...parameters, pageSize, (page - 1) * pageSize).map(previewRow);
    return { id, page, pageSize, total, records: rows };
  }

  listSelectablePreviewKeys(id, { search = "" } = {}) {
    const preview = this.getPreview(id);
    if (!preview) return null;
    const parameters = [];
    let searchClause = "";
    if (search) {
      searchClause = "AND (title LIKE ? ESCAPE '\\' OR preview LIKE ? ESCAPE '\\')";
      const escaped = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      parameters.push(escaped, escaped);
    }
    return preview.previewDatabase.prepare(`
      SELECT source_key FROM preview_records
      WHERE duplicate_record_id IS NULL AND parse_error IS NULL ${searchClause}
      ORDER BY occurred_at DESC, source_key
    `).all(...parameters).map((row) => row.source_key);
  }

  confirmImport(id, selections) {
    const preview = this.getPreview(id);
    if (!preview) return { kind: "preview_not_found" };
    const unique = new Map(selections.map((selection) => [selection.sourceKey, selection]));
    const sessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const database = this.research.database;
    if (this.research.databasePath && this.research.databasePath !== ":memory:") {
      createConsistentDatabaseBackup(database, {
        databasePath: this.research.databasePath,
        label: "before-chatgpt-import",
      });
    }
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let unclassified = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT INTO research_import_sessions (
          id, provider, capture_adapter, source_filename, source_hash, status,
          selected_count, imported_count, skipped_count, failed_count, unclassified_count,
          version, created_at, updated_at, undone_at
        ) VALUES (?, 'chatgpt', ?, ?, ?, 'committed', ?, 0, 0, 0, 0, 1, ?, ?, NULL)
      `).run(sessionId, CHATGPT_CAPTURE_ADAPTER, preview.sourceFilename, preview.sourceHash, unique.size, timestamp, timestamp);
      const getPreviewRecord = preview.previewDatabase.prepare("SELECT * FROM preview_records WHERE source_key = ?");
      const markPreviewDuplicate = preview.previewDatabase.prepare("UPDATE preview_records SET duplicate_record_id = ? WHERE source_key = ?");
      const topicExists = database.prepare("SELECT 1 FROM topics WHERE id = ?");
      const insertRecord = database.prepare(`
        INSERT INTO research_records (
          id, primary_topic_id, title, provider, kind, url, external_id, summary, note,
          occurred_at, capture_adapter, version, deleted_at, created_at, updated_at, source_fingerprint
        ) VALUES (?, ?, ?, 'chatgpt', 'chat', NULL, ?, '', '', ?, ?, 1, NULL, ?, ?, ?)
      `);
      const insertContent = database.prepare(`
        INSERT INTO research_record_contents (
          record_id, content_encoding, content_blob, content_hash, message_count,
          source_created_at, source_updated_at, omitted_message_count, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `);
      const insertLink = database.prepare(`
        INSERT INTO research_import_session_records (
          session_id, source_key, source_fingerprint, record_id, outcome,
          imported_record_version, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const selection of unique.values()) {
        const row = getPreviewRecord.get(selection.sourceKey);
        if (!row) {
          failed += 1;
          insertLink.run(sessionId, selection.sourceKey, "missing", null, "failed", null, "Preview item not found", timestamp);
          continue;
        }
        const duplicate = this.research.findImportedDuplicate("chatgpt", row.external_id, row.source_fingerprint);
        if (duplicate) {
          skipped += 1;
          insertLink.run(sessionId, row.source_key, row.source_fingerprint, duplicate.id, "duplicate", null, null, timestamp);
          markPreviewDuplicate.run(duplicate.id, row.source_key);
          continue;
        }
        const topicId = selection.topicId || null;
        if (topicId && !topicExists.get(topicId)) {
          failed += 1;
          insertLink.run(sessionId, row.source_key, row.source_fingerprint, null, "failed", null, "Topic not found", timestamp);
          continue;
        }
        const recordId = randomUUID();
        const contentBuffer = Buffer.from(row.content_json, "utf8");
        const contentHash = `sha256:${createHash("sha256").update(contentBuffer).digest("hex")}`;
        insertRecord.run(
          recordId, topicId, row.title, row.external_id, row.occurred_at,
          CHATGPT_CAPTURE_ADAPTER, timestamp, timestamp, row.source_fingerprint,
        );
        insertContent.run(
          recordId, CHATGPT_CONTENT_ENCODING, gzipSync(contentBuffer), contentHash,
          row.message_count, row.occurred_at, row.source_updated_at,
          row.omitted_message_count, timestamp, timestamp,
        );
        insertLink.run(sessionId, row.source_key, row.source_fingerprint, recordId, "imported", 1, null, timestamp);
        markPreviewDuplicate.run(recordId, row.source_key);
        imported += 1;
        if (!topicId) unclassified += 1;
      }
      database.prepare(`
        UPDATE research_import_sessions
        SET imported_count = ?, skipped_count = ?, failed_count = ?, unclassified_count = ?
        WHERE id = ?
      `).run(imported, skipped, failed, unclassified, sessionId);
      database.exec("COMMIT");
      return { kind: "committed", sessionId, selected: unique.size, imported, skipped, failed, unclassified };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  async disposePreview(id) {
    const preview = this.previews.get(id);
    if (!preview) return;
    preview.previewDatabase.close();
    this.previews.delete(id);
    await rm(preview.directory, { recursive: true, force: true });
  }

  async close() {
    await mkdir(os.tmpdir(), { recursive: true });
    for (const id of [...this.previews.keys()]) await this.disposePreview(id);
  }
}
