import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";
import { ResearchDatabase } from "../server/research-database.mjs";

const fixtures = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    if (fixture.app) await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase391-test-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const fixture = { app, directory };
  fixtures.push(fixture);
  return { baseUrl: `http://127.0.0.1:${address.port}`, directory, app, fixture };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body === undefined ? options.headers : { "content-type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const responseText = await response.text();
  return { response, body: responseText ? JSON.parse(responseText) : undefined };
}

async function createTopicAndRecord(baseUrl, { title = "脱敏研究资料" } = {}) {
  const topic = (await request(baseUrl, "/api/research/topics", {
    method: "POST",
    body: { title: "脱敏主题", status: "active", currentView: "当前观点" },
  })).body.topic;
  const record = (await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: {
      title, provider: "chatgpt", kind: "chat", url: null, externalId: null,
      summary: "", note: "", occurredAt: "2026-09-21T01:00:00.000Z",
    },
  })).body.record;
  return { topic, record };
}

function insertContentVersion(database, recordId, versionNumber, { current = true } = {}) {
  const id = randomUUID();
  const content = Buffer.from(JSON.stringify({
    version: "research-record-content-v1",
    externalId: null,
    title: "脱敏研究资料",
    messages: [{ id: `message-${versionNumber}`, role: "user", text: `脱敏正文版本 ${versionNumber}` }],
  }), "utf8");
  const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (current) database.prepare("UPDATE research_record_content_versions SET is_current = 0 WHERE record_id = ?").run(recordId);
  database.prepare(`
    INSERT INTO research_record_content_versions (
      id, record_id, version_number, capture_adapter, completeness, completeness_details,
      relation_to_previous, content_encoding, content_blob, content_hash, source_fingerprint,
      message_count, omitted_message_count, source_created_at, source_updated_at,
      captured_at, is_current, created_at
    ) VALUES (?, ?, ?, 'chatgpt-browser-v1', 'complete',
      '{"textTranscriptComplete":true,"richContentComplete":true}', ?, 'gzip-json-v1',
      ?, ?, ?, 1, 0, NULL, NULL, ?, ?, ?)
  `).run(
    id, recordId, versionNumber, versionNumber === 1 ? "initial" : "append",
    gzipSync(content), hash, `fingerprint-${recordId}-${versionNumber}`,
    "2026-09-21T01:00:00.000Z", current ? 1 : 0, "2026-09-21T01:00:00.000Z",
  );
  database.prepare(`
    UPDATE research_records
    SET capture_adapter = 'chatgpt-browser-v1', capture_completeness = 'complete'
    WHERE id = ?
  `).run(recordId);
  return id;
}

const summaryDraft = {
  oneLineSummary: "这份资料说明了一个清楚的核心结论。",
  coreContent: "重点一\n重点二\n重点三",
  keyEvidence: "脱敏数据与案例",
  unresolved: "还需要继续确认长期变化。",
};

async function setupVersion() {
  const fixture = await startServer();
  const { topic, record } = await createTopicAndRecord(fixture.baseUrl);
  const database = new DatabaseSync(path.join(fixture.directory, "taskboard.sqlite"));
  const versionId = insertContentVersion(database, record.id, 1);
  return { ...fixture, topic, record, database, versionId };
}

async function createSummary(baseUrl, recordId, versionId, draft = summaryDraft) {
  return request(baseUrl, `/api/research/records/${recordId}/summary`, {
    method: "POST", body: { sourceContentVersionId: versionId, ...draft },
  });
}

test("007 creates the Research Summary table once", async () => {
  const { directory } = await startServer();
  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  assert.ok(database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'research_record_summaries'").get());
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_schema_migrations WHERE version = '007_research_record_summaries'").get().count, 1);
  database.close();
});

test("creates one manual Summary for V1", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const created = await createSummary(baseUrl, record.id, versionId);
  assert.equal(created.response.status, 201);
  assert.equal(created.body.summary.sourceContentVersionId, versionId);
  assert.equal(created.body.summary.version, 1);
  database.close();
});

test("reads the Summary bound to the requested content version", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  await createSummary(baseUrl, record.id, versionId);
  const loaded = await request(baseUrl, `/api/research/records/${record.id}/summary?contentVersionId=${versionId}`);
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.body.summary.oneLineSummary, summaryDraft.oneLineSummary);
  database.close();
});

test("returns a quiet null state when the selected version has no Summary", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const loaded = await request(baseUrl, `/api/research/records/${record.id}/summary?contentVersionId=${versionId}`);
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.body.summary, null);
  database.close();
});

test("edits all Summary fields and increases its version", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const summary = (await createSummary(baseUrl, record.id, versionId)).body.summary;
  const updated = await request(baseUrl, `/api/research/summaries/${summary.id}`, {
    method: "PATCH",
    body: { version: summary.version, ...summaryDraft, coreContent: "修改后的核心内容" },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.summary.coreContent, "修改后的核心内容");
  assert.equal(updated.body.summary.version, 2);
  database.close();
});

test("rejects a stale Summary edit instead of overwriting newer content", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const summary = (await createSummary(baseUrl, record.id, versionId)).body.summary;
  await request(baseUrl, `/api/research/summaries/${summary.id}`, {
    method: "PATCH", body: { version: 1, ...summaryDraft, coreContent: "先保存的内容" },
  });
  const stale = await request(baseUrl, `/api/research/summaries/${summary.id}`, {
    method: "PATCH", body: { version: 1, ...summaryDraft, coreContent: "过期覆盖" },
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "RESEARCH_SUMMARY_VERSION_CONFLICT");
  database.close();
});

test("requires a short one-line Summary", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const invalid = await createSummary(baseUrl, record.id, versionId, { ...summaryDraft, oneLineSummary: "   " });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_FIELD");
  database.close();
});

test("allows core content, evidence and unresolved fields to stay empty", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const created = await createSummary(baseUrl, record.id, versionId, {
    oneLineSummary: "只有一句话也可以保存。", coreContent: "", keyEvidence: "", unresolved: "",
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.summary.coreContent, "");
  assert.equal(created.body.summary.keyEvidence, "");
  assert.equal(created.body.summary.unresolved, "");
  database.close();
});

test("rejects binding another record's content version", async () => {
  const { baseUrl, record, database } = await setupVersion();
  const other = await createTopicAndRecord(baseUrl, { title: "另一条资料" });
  const otherVersionId = insertContentVersion(database, other.record.id, 1);
  const invalid = await createSummary(baseUrl, record.id, otherVersionId);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "SOURCE_CONTENT_VERSION_INVALID");
  database.close();
});

test("rejects a made-up content version", async () => {
  const { baseUrl, record, database } = await setupVersion();
  const invalid = await createSummary(baseUrl, record.id, randomUUID());
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "SOURCE_CONTENT_VERSION_INVALID");
  database.close();
});

test("does not create two Summaries for the same content version", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  await createSummary(baseUrl, record.id, versionId);
  const duplicate = await createSummary(baseUrl, record.id, versionId);
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, "RESEARCH_SUMMARY_ALREADY_EXISTS");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries").get().count, 1);
  database.close();
});

test("V1 Summary never appears while reading V2", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  await createSummary(baseUrl, record.id, versionId);
  const versionTwoId = insertContentVersion(database, record.id, 2);
  const loaded = await request(baseUrl, `/api/research/records/${record.id}/summary?contentVersionId=${versionTwoId}`);
  assert.equal(loaded.body.summary, null);
  database.close();
});

test("V2 can have an independent Summary", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const v1 = (await createSummary(baseUrl, record.id, versionId)).body.summary;
  const versionTwoId = insertContentVersion(database, record.id, 2);
  const v2 = (await createSummary(baseUrl, record.id, versionTwoId, {
    ...summaryDraft, oneLineSummary: "这是 V2 的独立总结。",
  })).body.summary;
  assert.notEqual(v1.id, v2.id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries WHERE record_id = ?").get(record.id).count, 2);
  database.close();
});

test("switching back to V1 restores only the V1 Summary", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  await createSummary(baseUrl, record.id, versionId);
  const versionTwoId = insertContentVersion(database, record.id, 2);
  await createSummary(baseUrl, record.id, versionTwoId, { ...summaryDraft, oneLineSummary: "V2 总结" });
  const loaded = await request(baseUrl, `/api/research/records/${record.id}/summary?contentVersionId=${versionId}`);
  assert.equal(loaded.body.summary.oneLineSummary, summaryDraft.oneLineSummary);
  database.close();
});

test("soft-deleting a Research Record retains its Summary for traceability", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  await createSummary(baseUrl, record.id, versionId);
  await request(baseUrl, `/api/research/records/${record.id}`, {
    method: "DELETE", body: { version: record.version },
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries WHERE record_id = ?").get(record.id).count, 1);
  database.close();
});

test("does not expose a Summary delete operation", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  const summary = (await createSummary(baseUrl, record.id, versionId)).body.summary;
  const deletion = await request(baseUrl, `/api/research/summaries/${summary.id}`, { method: "DELETE" });
  assert.equal(deletion.response.status, 405);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries WHERE id = ?").get(summary.id).count, 1);
  database.close();
});

test("a missing Summary cannot be patched", async () => {
  const { baseUrl, database } = await setupVersion();
  const missing = await request(baseUrl, `/api/research/summaries/${randomUUID()}`, {
    method: "PATCH", body: { version: 1, ...summaryDraft },
  });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "RESEARCH_SUMMARY_NOT_FOUND");
  database.close();
});

test("Summary writes do not change Topic Current View or Cognition Update counts", async () => {
  const { baseUrl, topic, record, database, versionId } = await setupVersion();
  const before = database.prepare("SELECT current_view, version FROM topics WHERE id = ?").get(topic.id);
  const cognitionCount = database.prepare("SELECT COUNT(*) AS count FROM cognition_updates").get().count;
  await createSummary(baseUrl, record.id, versionId);
  assert.deepEqual(database.prepare("SELECT current_view, version FROM topics WHERE id = ?").get(topic.id), before);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM cognition_updates").get().count, cognitionCount);
  database.close();
});

test("Cognition Update still locks the original content version independently of Summary", async () => {
  const { baseUrl, topic, record, database, versionId } = await setupVersion();
  await createSummary(baseUrl, record.id, versionId);
  const cognition = await request(baseUrl, `/api/research/topics/${topic.id}/cognition-updates`, {
    method: "POST", body: { recordId: record.id, sourceContentVersionId: versionId },
  });
  assert.equal(cognition.response.status, 201);
  assert.equal(cognition.body.update.sourceContentVersionId, versionId);
  database.close();
});

test("006 to 007 migration preserves existing records and cognition history", async () => {
  const { directory, app, fixture } = await startServer();
  await app.close();
  fixture.app = null;
  const databasePath = path.join(directory, "taskboard.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    DROP INDEX research_record_summaries_record_updated;
    DROP TABLE research_record_summaries;
    DELETE FROM research_schema_migrations WHERE version = '007_research_record_summaries';
  `);
  const countsBefore = {
    records: database.prepare("SELECT COUNT(*) AS count FROM research_records").get().count,
    cognition: database.prepare("SELECT COUNT(*) AS count FROM cognition_updates").get().count,
  };
  const research = new ResearchDatabase(database, { databasePath });
  assert.deepEqual(research.migrationResult.applied, ["007_research_record_summaries"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_records").get().count, countsBefore.records);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM cognition_updates").get().count, countsBefore.cognition);
  database.close();
});

test("007 migration is idempotent", async () => {
  const { directory } = await startServer();
  const databasePath = path.join(directory, "taskboard.sqlite");
  const database = new DatabaseSync(databasePath);
  const research = new ResearchDatabase(database, { databasePath });
  assert.deepEqual(research.migrationResult.applied, []);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_schema_migrations WHERE version = '007_research_record_summaries'").get().count, 1);
  database.close();
});

test("Summary schema passes foreign-key and integrity checks", async () => {
  const { baseUrl, record, database, versionId } = await setupVersion();
  await createSummary(baseUrl, record.id, versionId);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  database.close();
});
