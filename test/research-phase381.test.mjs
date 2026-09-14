import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";

const fixtures = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    if (fixture.app) await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase381-test-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  fixtures.push({ app, directory });
  return { baseUrl: `http://127.0.0.1:${address.port}`, directory };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body === undefined ? options.headers : { "content-type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

async function createTopicAndRecord(baseUrl, { currentView = "观点 A", title = "研究资料" } = {}) {
  const topic = (await request(baseUrl, "/api/research/topics", {
    method: "POST", body: { title: "长期研究", status: "active", currentView },
  })).body.topic;
  const record = (await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: {
      title, provider: "chatgpt", kind: "chat", url: null, externalId: null,
      summary: "必要摘要", note: "必要笔记", occurredAt: "2026-09-13T01:00:00.000Z",
    },
  })).body.record;
  return { topic, record };
}

function insertContentVersion(database, recordId, versionNumber) {
  const id = randomUUID();
  const payload = Buffer.from(JSON.stringify({ messages: [{ role: "user", text: `版本 ${versionNumber}` }] }), "utf8");
  const hash = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  database.prepare(`UPDATE research_record_content_versions SET is_current = 0 WHERE record_id = ?`).run(recordId);
  database.prepare(`
    INSERT INTO research_record_content_versions (
      id, record_id, version_number, capture_adapter, completeness, completeness_details,
      relation_to_previous, content_encoding, content_blob, content_hash, source_fingerprint,
      message_count, omitted_message_count, source_created_at, source_updated_at,
      captured_at, is_current, created_at
    ) VALUES (?, ?, ?, 'chatgpt-browser-v1', 'complete', '{}', ?, 'gzip-json-v1', ?, ?, ?, 1, 0, NULL, NULL, ?, 1, ?)
  `).run(id, recordId, versionNumber, versionNumber === 1 ? "initial" : "append", gzipSync(payload), hash, `source-${recordId}-${versionNumber}`, new Date().toISOString(), new Date().toISOString());
  return id;
}

async function createUpdate(baseUrl, topicId, recordId, sourceContentVersionId = null) {
  return request(baseUrl, `/api/research/topics/${topicId}/cognition-updates`, {
    method: "POST", body: { recordId, sourceContentVersionId },
  });
}

async function fillUpdate(baseUrl, update, changes = {}) {
  return request(baseUrl, `/api/research/cognition-updates/${update.id}`, {
    method: "PATCH",
    body: {
      version: update.version,
      updateType: "revise",
      newInformation: "出现了新的重要信息",
      impact: "原来的判断需要调整",
      proposedCurrentView: "观点 B",
      ...changes,
    },
  });
}

test("explicit reload preserves thinking, resets proposal and rejects stale draft versions", async () => {
  const { baseUrl } = await startServer();
  const { topic, record } = await createTopicAndRecord(baseUrl);
  const draft = (await createUpdate(baseUrl, topic.id, record.id)).body.update;
  const saved = (await fillUpdate(baseUrl, draft)).body.update;
  const latest = (await request(baseUrl, `/api/research/topics/${topic.id}`, {
    method: "PATCH", body: { version: topic.version, currentView: "最新观点 C" },
  })).body.topic;
  const url = `/api/research/cognition-updates/${saved.id}/reload`;
  const stale = await request(baseUrl, url, { method: "POST", body: { version: draft.version } });
  assert.equal(stale.body.error.code, "COGNITION_UPDATE_VERSION_CONFLICT");
  const result = await request(baseUrl, url, { method: "POST", body: { version: saved.version } });
  assert.equal(result.response.status, 200);
  const refreshed = result.body.update;
  assert.equal(refreshed.baseCurrentView, latest.currentView);
  assert.equal(refreshed.baseTopicVersion, latest.version);
  assert.equal(refreshed.proposedCurrentView, latest.currentView);
  assert.equal(refreshed.newInformation, saved.newInformation);
  assert.equal(refreshed.impact, saved.impact);
  assert.equal(refreshed.version, saved.version + 1);
  assert.equal(refreshed.status, "draft");
  const repeated = await request(baseUrl, url, { method: "POST", body: { version: saved.version } });
  assert.equal(repeated.response.status, 409);
  const edited = (await fillUpdate(baseUrl, refreshed, { proposedCurrentView: "重新确认后的观点" })).body.update;
  const applied = await request(baseUrl, `/api/research/cognition-updates/${saved.id}/apply`, { method: "POST", body: { version: edited.version } });
  assert.equal(applied.body.topic.currentView, "重新确认后的观点");
  const immutable = await request(baseUrl, url, { method: "POST", body: { version: applied.body.update.version } });
  assert.equal(immutable.body.error.code, "COGNITION_UPDATE_NOT_DRAFT");
});

test("006 schema creates durable cognition updates without changing existing data", async () => {
  const { baseUrl, directory } = await startServer();
  const { topic, record } = await createTopicAndRecord(baseUrl);
  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_schema_migrations WHERE version = '006_cognition_updates'").get().count, 1);
  assert.ok(database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'cognition_updates'").get());

  database.prepare("UPDATE research_records SET primary_topic_id = NULL WHERE id = ?").run(record.id);
  const unclassified = await createUpdate(baseUrl, topic.id, record.id);
  assert.equal(unclassified.response.status, 409);
  assert.equal(unclassified.body.error.code, "RESEARCH_RECORD_UNCLASSIFIED");
  database.prepare("UPDATE research_records SET primary_topic_id = ? WHERE id = ?").run(topic.id, record.id);

  database.prepare("UPDATE research_records SET capture_adapter = 'chatgpt-browser-v1' WHERE id = ?").run(record.id);
  const capturedWithoutVersion = await createUpdate(baseUrl, topic.id, record.id);
  assert.equal(capturedWithoutVersion.body.error.code, "SOURCE_CONTENT_VERSION_REQUIRED");
  database.prepare("UPDATE research_records SET capture_adapter = 'manual-v1' WHERE id = ?").run(record.id);

  const versionOne = insertContentVersion(database, record.id, 1);
  const missingVersion = await createUpdate(baseUrl, topic.id, record.id);
  assert.equal(missingVersion.body.error.code, "SOURCE_CONTENT_VERSION_REQUIRED");
  const wrongVersion = await createUpdate(baseUrl, topic.id, record.id, randomUUID());
  assert.equal(wrongVersion.body.error.code, "SOURCE_CONTENT_VERSION_INVALID");
  const created = await createUpdate(baseUrl, topic.id, record.id, versionOne);
  assert.equal(created.response.status, 201);
  assert.equal(created.body.update.sourceContentVersionId, versionOne);
  assert.equal(created.body.update.baseCurrentView, "观点 A");
  assert.equal(created.body.update.sourceContext.summary, "必要摘要");
  assert.equal(JSON.stringify(created.body.update.sourceContext).includes("版本 1"), false);
  const existing = await createUpdate(baseUrl, topic.id, record.id, versionOne);
  assert.equal(existing.response.status, 200);
  assert.equal(existing.body.existing, true);
  assert.equal(existing.body.update.id, created.body.update.id);

  const patched = await fillUpdate(baseUrl, created.body.update);
  assert.equal(patched.response.status, 200);
  const stale = await fillUpdate(baseUrl, created.body.update, { impact: "过期写入" });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "COGNITION_UPDATE_VERSION_CONFLICT");

  insertContentVersion(database, record.id, 2);
  assert.equal((await request(baseUrl, `/api/research/cognition-updates/${created.body.update.id}`)).body.update.sourceContentVersionId, versionOne);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  database.close();
});

test("apply changes Current View atomically, is immutable and is idempotent", async () => {
  const { baseUrl, directory } = await startServer();
  const { topic, record } = await createTopicAndRecord(baseUrl);
  const draft = (await createUpdate(baseUrl, topic.id, record.id)).body.update;
  const saved = (await fillUpdate(baseUrl, draft)).body.update;
  const applied = await request(baseUrl, `/api/research/cognition-updates/${saved.id}/apply`, {
    method: "POST", body: { version: saved.version },
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.update.status, "applied");
  assert.equal(applied.body.topic.currentView, "观点 B");
  assert.equal(applied.body.topic.version, topic.version + 1);
  assert.equal(applied.body.update.appliedTopicVersion, topic.version + 1);

  const immutable = await fillUpdate(baseUrl, applied.body.update, { impact: "不应修改" });
  assert.equal(immutable.body.error.code, "COGNITION_UPDATE_NOT_DRAFT");
  const repeated = await request(baseUrl, `/api/research/cognition-updates/${saved.id}/apply`, {
    method: "POST", body: { version: saved.version },
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.alreadyApplied, true);
  assert.equal(repeated.body.topic.version, topic.version + 1);

  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM cognition_updates WHERE status = 'applied'").get().count, 1);
  database.prepare("UPDATE research_records SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), record.id);
  const history = await request(baseUrl, `/api/research/cognition-updates/${saved.id}`);
  assert.equal(history.response.status, 200);
  assert.equal(history.body.update.sourceDeleted, true);
  assert.equal(history.body.update.sourceRecordTitle, record.title);
  database.close();
});

test("UNCERTAIN and unchanged REINFORCE apply without increasing Topic version; rejected history remains", async () => {
  const { baseUrl } = await startServer();
  const { topic, record } = await createTopicAndRecord(baseUrl);

  const uncertainDraft = (await createUpdate(baseUrl, topic.id, record.id)).body.update;
  const uncertainSaved = (await fillUpdate(baseUrl, uncertainDraft, {
    updateType: "uncertain", impact: "还需要更多证据", proposedCurrentView: "观点 A",
  })).body.update;
  const uncertain = await request(baseUrl, `/api/research/cognition-updates/${uncertainSaved.id}/apply`, {
    method: "POST", body: { version: uncertainSaved.version },
  });
  assert.equal(uncertain.body.update.status, "applied");
  assert.equal(uncertain.body.topic.currentView, "观点 A");
  assert.equal(uncertain.body.topic.version, topic.version);

  const reinforceDraft = (await createUpdate(baseUrl, topic.id, record.id)).body.update;
  const reinforceSaved = (await fillUpdate(baseUrl, reinforceDraft, {
    updateType: "reinforce", impact: "让原判断更有依据", proposedCurrentView: "观点 A",
  })).body.update;
  const reinforce = await request(baseUrl, `/api/research/cognition-updates/${reinforceSaved.id}/apply`, {
    method: "POST", body: { version: reinforceSaved.version },
  });
  assert.equal(reinforce.body.topic.version, topic.version);

  const rejectDraft = (await createUpdate(baseUrl, topic.id, record.id)).body.update;
  const rejectSaved = (await fillUpdate(baseUrl, rejectDraft)).body.update;
  const rejected = await request(baseUrl, `/api/research/cognition-updates/${rejectSaved.id}/reject`, {
    method: "POST", body: { version: rejectSaved.version },
  });
  assert.equal(rejected.body.update.status, "rejected");
  assert.ok(rejected.body.update.rejectedAt);
  const cannotApply = await request(baseUrl, `/api/research/cognition-updates/${rejectSaved.id}/apply`, {
    method: "POST", body: { version: rejected.body.update.version },
  });
  assert.equal(cannotApply.body.error.code, "COGNITION_UPDATE_NOT_DRAFT");
  const all = await request(baseUrl, `/api/research/topics/${topic.id}/cognition-updates`);
  assert.equal(all.body.updates.length, 3);
});

test("stale Topic, deleted source and transaction failure cannot partially apply", async () => {
  const { baseUrl, directory } = await startServer();
  const first = await createTopicAndRecord(baseUrl, { title: "并发资料" });
  const staleDraft = (await createUpdate(baseUrl, first.topic.id, first.record.id)).body.update;
  const staleSaved = (await fillUpdate(baseUrl, staleDraft)).body.update;
  await request(baseUrl, `/api/research/topics/${first.topic.id}`, {
    method: "PATCH", body: { version: first.topic.version, currentView: "其他地方的新观点" },
  });
  const conflict = await request(baseUrl, `/api/research/cognition-updates/${staleSaved.id}/apply`, {
    method: "POST", body: { version: staleSaved.version },
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "COGNITION_TOPIC_VERSION_CONFLICT");
  assert.equal((await request(baseUrl, `/api/research/cognition-updates/${staleSaved.id}`)).body.update.status, "draft");

  const second = await createTopicAndRecord(baseUrl, { title: "删除资料" });
  const deletedDraft = (await createUpdate(baseUrl, second.topic.id, second.record.id)).body.update;
  const deletedSaved = (await fillUpdate(baseUrl, deletedDraft)).body.update;
  await request(baseUrl, `/api/research/records/${second.record.id}`, {
    method: "DELETE", body: { version: second.record.version },
  });
  const deletedApply = await request(baseUrl, `/api/research/cognition-updates/${deletedSaved.id}/apply`, {
    method: "POST", body: { version: deletedSaved.version },
  });
  assert.equal(deletedApply.body.error.code, "COGNITION_SOURCE_UNAVAILABLE");

  const third = await createTopicAndRecord(baseUrl, { title: "事务资料" });
  const transactionDraft = (await createUpdate(baseUrl, third.topic.id, third.record.id)).body.update;
  const transactionSaved = (await fillUpdate(baseUrl, transactionDraft)).body.update;
  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  database.exec(`
    CREATE TRIGGER fail_cognition_apply BEFORE UPDATE OF status ON cognition_updates
    WHEN NEW.id = '${transactionSaved.id}' AND NEW.status = 'applied'
    BEGIN SELECT RAISE(ABORT, 'forced apply failure'); END;
  `);
  const failed = await request(baseUrl, `/api/research/cognition-updates/${transactionSaved.id}/apply`, {
    method: "POST", body: { version: transactionSaved.version },
  });
  assert.equal(failed.response.status, 500);
  assert.equal(database.prepare("SELECT current_view FROM topics WHERE id = ?").get(third.topic.id).current_view, "观点 A");
  assert.equal(database.prepare("SELECT status FROM cognition_updates WHERE id = ?").get(transactionSaved.id).status, "draft");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});
