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
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase37-test-"));
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

function insertRecord(database, {
  id = randomUUID(),
  topicId = null,
  title,
  provider = "chatgpt",
  kind = "chat",
  captureAdapter = "manual-v1",
  completeness = null,
  summary = "",
  note = "",
  contentText = null,
  occurredAt = "2026-08-29T08:00:00.000Z",
} = {}) {
  const timestamp = "2026-08-29T09:00:00.000Z";
  database.prepare(`
    INSERT INTO research_records (
      id, primary_topic_id, title, provider, kind, url, external_id, summary, note,
      occurred_at, capture_adapter, version, deleted_at, created_at, updated_at,
      source_fingerprint, capture_completeness, last_captured_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, ?)
  `).run(id, topicId, title, provider, kind, summary, note, occurredAt, captureAdapter, timestamp, timestamp, completeness, completeness ? timestamp : null);
  if (contentText !== null) {
    const content = Buffer.from(JSON.stringify({
      version: "research-record-content-v1",
      externalId: null,
      title,
      messages: [{ id: `${id}-message`, role: "user", text: contentText }],
    }), "utf8");
    const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    database.prepare(`
      INSERT INTO research_record_contents (
        record_id, content_encoding, content_blob, content_hash, message_count,
        source_created_at, source_updated_at, omitted_message_count, deleted_at,
        created_at, updated_at
      ) VALUES (?, 'gzip-json-v1', ?, ?, 1, ?, ?, 0, NULL, ?, ?)
    `).run(id, gzipSync(content), hash, occurredAt, occurredAt, timestamp, timestamp);
  }
  return id;
}

test("Research Inbox is a paginated source-agnostic view with deterministic previews", async () => {
  const { baseUrl, directory } = await startServer();
  const topicResponse = await request(baseUrl, "/api/research/topics", {
    method: "POST", body: { title: "BSX 长期投资研究", status: "active" },
  });
  const topic = topicResponse.body.topic;
  const databasePath = path.join(directory, "taskboard.sqlite");
  const database = new DatabaseSync(databasePath);
  const zipId = insertRecord(database, {
    title: "ZIP 未分类记录",
    captureAdapter: "chatgpt-export-v1",
    summary: "已有摘要优先作为预览。",
    contentText: "这段正文不应覆盖已有摘要。",
  });
  const browserId = insertRecord(database, {
    title: "Browser Capture 未分类记录",
    captureAdapter: "chatgpt-browser-v1",
    contentText: "浏览器捕获正文的第一段可见文字。",
    occurredAt: "2026-08-28T08:00:00.000Z",
  });
  insertRecord(database, {
    title: "PARTIAL Deep Research",
    kind: "deep_research",
    captureAdapter: "chatgpt-browser-v1",
    completeness: "partial",
    contentText: "这份深度研究可能不完整，但仍可整理。",
    occurredAt: "2026-08-27T08:00:00.000Z",
  });
  const assignedId = insertRecord(database, { title: "已经归类", topicId: topic.id });
  const deletedId = insertRecord(database, { title: "已经软删除" });
  database.prepare("UPDATE research_records SET deleted_at = ? WHERE id = ?").run("2026-08-29T10:00:00.000Z", deletedId);

  const summary = await request(baseUrl, "/api/research/inbox/summary");
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.count, 3);

  const firstPage = await request(baseUrl, "/api/research/inbox?page=1&pageSize=2");
  assert.equal(firstPage.response.status, 200, JSON.stringify(firstPage.body));
  assert.equal(firstPage.body.total, 3);
  assert.equal(firstPage.body.records.length, 2);
  assert.equal(firstPage.body.records.find((record) => record.id === zipId).preview, "已有摘要优先作为预览。");
  assert.equal(firstPage.body.records.find((record) => record.id === browserId).preview, "浏览器捕获正文的第一段可见文字。");
  assert.equal(firstPage.body.records.every((record) => record.id !== assignedId && record.id !== deletedId), true);
  const secondPage = await request(baseUrl, "/api/research/inbox?page=2&pageSize=2");
  assert.equal(secondPage.body.records.length, 1);
  assert.equal(secondPage.body.records[0].captureCompleteness, "partial");

  const filtered = await request(baseUrl, "/api/research/inbox?provider=chatgpt&dateFrom=2026-08-28&dateTo=2026-08-29");
  assert.equal(filtered.body.total, 2);

  database.prepare("DELETE FROM topics WHERE id = ?").run(topic.id);
  assert.equal((await request(baseUrl, "/api/research/inbox/summary")).body.count, 4);
  assert.equal(database.prepare("SELECT primary_topic_id FROM research_records WHERE id = ?").get(assignedId).primary_topic_id, null);

  const zipRecord = (await request(baseUrl, `/api/research/records/${zipId}`)).body.record;
  const softDelete = await request(baseUrl, `/api/research/records/${zipId}`, {
    method: "DELETE", body: { version: zipRecord.version },
  });
  assert.equal(softDelete.response.status, 204);
  assert.equal((await request(baseUrl, "/api/research/inbox/summary")).body.count, 3);
  assert.notEqual(database.prepare("SELECT deleted_at FROM research_records WHERE id = ?").get(zipId).deleted_at, null);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("Inbox assignments are all-or-nothing and create Topic plus assignment atomically", async () => {
  const { baseUrl, directory } = await startServer();
  const existingTopic = (await request(baseUrl, "/api/research/topics", {
    method: "POST", body: { title: "已有主题", status: "active" },
  })).body.topic;
  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  const firstId = insertRecord(database, { title: "待整理一" });
  const secondId = insertRecord(database, { title: "待整理二" });
  const alreadyAssignedId = insertRecord(database, { title: "已归类", topicId: existingTopic.id });

  const unsafeBatch = await request(baseUrl, "/api/research/records/assign-topic", {
    method: "POST", body: { recordIds: [firstId, alreadyAssignedId], topicId: existingTopic.id },
  });
  assert.equal(unsafeBatch.response.status, 409);
  assert.equal(unsafeBatch.body.error.code, "RESEARCH_RECORDS_NOT_IN_INBOX");
  assert.equal(database.prepare("SELECT primary_topic_id FROM research_records WHERE id = ?").get(firstId).primary_topic_id, null);

  const topicCountBefore = database.prepare("SELECT COUNT(*) AS count FROM topics").get().count;
  const rolledBack = await request(baseUrl, "/api/research/inbox/create-topic-and-assign", {
    method: "POST",
    body: { recordIds: [firstId, alreadyAssignedId], topic: { title: "不应留下的空主题", status: "inbox" } },
  });
  assert.equal(rolledBack.response.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM topics").get().count, topicCountBefore);
  assert.equal(database.prepare("SELECT primary_topic_id FROM research_records WHERE id = ?").get(firstId).primary_topic_id, null);

  const created = await request(baseUrl, "/api/research/inbox/create-topic-and-assign", {
    method: "POST",
    body: { recordIds: [firstId, secondId], topic: { title: "伯克希尔长期投资研究", status: "inbox" } },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.updated, 2);
  assert.equal(created.body.topic.title, "伯克希尔长期投资研究");
  assert.deepEqual(
    database.prepare("SELECT primary_topic_id FROM research_records WHERE id IN (?, ?) ORDER BY id").all(firstId, secondId).map((row) => row.primary_topic_id),
    [created.body.topic.id, created.body.topic.id],
  );
  assert.equal((await request(baseUrl, "/api/research/inbox/summary")).body.count, 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_schema_migrations WHERE version LIKE '006_%'").get().count, 0);
  database.close();
});
