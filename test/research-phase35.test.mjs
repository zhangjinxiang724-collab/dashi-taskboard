import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";

import { normalizeChatGptConversation } from "../server/import-adapters/chatgpt-export-v1.mjs";
import { ResearchDatabase } from "../server/research-database.mjs";
import { createTaskboardServer } from "../server/index.mjs";

const execFileAsync = promisify(execFile);
const fixtures = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    if (fixture.app) await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

function exportedConversation({ id = "chat-1", title = "BSX Penumbra 研究", createTime = 1_788_000_000 } = {}) {
  return {
    id,
    title,
    create_time: createTime,
    update_time: createTime + 60,
    current_node: "assistant-1",
    mapping: {
      root: { id: "root", parent: null, children: ["user-1"], message: null },
      "user-1": {
        id: "user-1", parent: "root", children: ["assistant-1"],
        message: { id: `${id}-user`, author: { role: "user" }, create_time: createTime, content: { content_type: "text", parts: ["研究收购后的资本回报。"] }, metadata: {} },
      },
      "assistant-1": {
        id: "assistant-1", parent: "user-1", children: [],
        message: { id: `${id}-assistant`, author: { role: "assistant" }, create_time: createTime + 30, content: { content_type: "text", parts: ["需要比较 ROIC 与资本成本。"] }, metadata: {} },
      },
      hidden: {
        id: "hidden", parent: "root", children: [],
        message: { id: `${id}-system`, author: { role: "system" }, create_time: createTime, content: { content_type: "text", parts: ["private system metadata"] }, metadata: {} },
      },
    },
  };
}

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase35-test-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  fixtures.push({ app, directory });
  return { app, directory, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body === undefined ? options.headers : { "content-type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

async function uploadPreview(baseUrl, filename, data, contentType = "application/json") {
  const response = await fetch(`${baseUrl}/api/research/imports/chatgpt/preview`, {
    method: "POST",
    headers: { "content-type": contentType, "x-research-import-filename": filename },
    body: data,
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

test("ChatGPT adapter keeps only the active visible user/assistant branch and fingerprints deterministically", () => {
  const first = normalizeChatGptConversation(exportedConversation());
  const second = normalizeChatGptConversation(exportedConversation());
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.notEqual(
    first.sourceFingerprint,
    normalizeChatGptConversation(exportedConversation({ title: "内容已经变化" })).sourceFingerprint,
  );
  assert.deepEqual(first.content.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(first.messageCount, 2);
  assert.equal(first.omittedMessageCount, 1);
  assert.equal(JSON.stringify(first.content).includes("private system metadata"), false);
});

test("preview writes zero formal records, selective confirm stores compressed content, dedupes, assigns, and safely undoes", async () => {
  const { baseUrl, directory } = await startServer();
  const topicResponse = await jsonRequest(baseUrl, "/api/research/topics", {
    method: "POST", body: { title: "BSX 长期投资研究", status: "active" },
  });
  const topic = topicResponse.body.topic;
  const manualRecordResponse = await jsonRequest(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: {
      title: "导入前已有的手工研究记录",
      provider: "chatgpt",
      kind: "chat",
      url: null,
      externalId: null,
      summary: "用于验证整批撤销不会影响旧记录。",
      note: "",
      occurredAt: "2026-08-20T00:00:00.000Z",
    },
  });
  assert.equal(manualRecordResponse.response.status, 201);
  const manualRecord = manualRecordResponse.body.record;
  const payload = Buffer.from(JSON.stringify([
    exportedConversation(),
    exportedConversation({ id: "chat-2", title: "BSX 竞争格局", createTime: 1_788_100_000 }),
  ]));
  const upload = await uploadPreview(baseUrl, "conversations.json", payload);
  assert.equal(upload.response.status, 201, JSON.stringify(upload.body));
  assert.equal(upload.body.preview.validCount, 2);

  const databasePath = path.join(directory, "taskboard.sqlite");
  let database = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_records").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_import_sessions").get().count, 0);
  database.close();

  const list = await jsonRequest(baseUrl, `/api/research/imports/previews/${upload.body.preview.id}?page=1&pageSize=1&duplicates=exclude`);
  assert.equal(list.response.status, 200);
  assert.equal(list.body.preview.total, 2);
  assert.equal(list.body.preview.records.length, 1);
  const first = list.body.preview.records[0];

  const confirmed = await jsonRequest(baseUrl, `/api/research/imports/previews/${upload.body.preview.id}/confirm`, {
    method: "POST", body: { selections: [{ sourceKey: first.sourceKey, topicId: null }] },
  });
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.body.session.imported, 1);
  assert.equal(confirmed.body.session.unclassified, 1);

  const unclassified = await jsonRequest(baseUrl, "/api/research/records/unclassified");
  assert.equal(unclassified.body.records.length, 1);
  const record = unclassified.body.records[0];
  assert.equal(record.captureAdapter, "chatgpt-export-v1");

  const content = await jsonRequest(baseUrl, `/api/research/records/${record.id}/content`);
  assert.equal(content.response.status, 200);
  assert.equal(content.body.content.content.messages.length, 2);
  assert.equal(content.body.content.content.messages.some((item) => item.role === "system"), false);

  const assigned = await jsonRequest(baseUrl, "/api/research/records/assign-topic", {
    method: "POST", body: { recordIds: [record.id], topicId: topic.id },
  });
  assert.equal(assigned.body.updated, 1);
  assert.equal((await jsonRequest(baseUrl, "/api/research/records/unclassified")).body.records.length, 0);

  const secondUpload = await uploadPreview(baseUrl, "conversations.json", payload);
  const duplicateList = await jsonRequest(baseUrl, `/api/research/imports/previews/${secondUpload.body.preview.id}?duplicates=only`);
  assert.equal(duplicateList.body.preview.total, 1);
  assert.equal(duplicateList.body.preview.records[0].duplicate, true);

  const sessions = await jsonRequest(baseUrl, "/api/research/imports/sessions");
  const session = sessions.body.sessions[0];
  const unsafeUndo = await jsonRequest(baseUrl, `/api/research/imports/sessions/${session.id}/undo`, {
    method: "POST", body: { version: session.version },
  });
  assert.equal(unsafeUndo.response.status, 409, "topic assignment increments the record version and protects later work");

  const thirdUpload = await uploadPreview(baseUrl, "conversations.json", Buffer.from(JSON.stringify([
    exportedConversation({ id: "chat-3", title: "可安全撤销的研究", createTime: 1_788_200_000 }),
  ])));
  const thirdList = await jsonRequest(baseUrl, `/api/research/imports/previews/${thirdUpload.body.preview.id}`);
  const thirdConfirm = await jsonRequest(baseUrl, `/api/research/imports/previews/${thirdUpload.body.preview.id}/confirm`, {
    method: "POST", body: { selections: [{ sourceKey: thirdList.body.preview.records[0].sourceKey, topicId: null }] },
  });
  const allSessions = await jsonRequest(baseUrl, "/api/research/imports/sessions");
  const thirdSession = allSessions.body.sessions.find((item) => item.id === thirdConfirm.body.session.sessionId);
  const undone = await jsonRequest(baseUrl, `/api/research/imports/sessions/${thirdSession.id}/undo`, {
    method: "POST", body: { version: thirdSession.version },
  });
  assert.equal(undone.response.status, 200);
  assert.equal(undone.body.result.kind, "undone");
  assert.equal((await jsonRequest(baseUrl, `/api/research/records/${manualRecord.id}`)).response.status, 200);

  database = new DatabaseSync(databasePath, { readOnly: true });
  assert.ok(database.prepare("SELECT length(content_blob) AS size FROM research_record_contents WHERE record_id = ?").get(record.id).size > 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
  const backups = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(directory, "backups")));
  assert.ok(backups.some((name) => name.includes("before-chatgpt-import")));
});

test("ZIP export is accepted and malformed exports are rejected without database writes", async () => {
  const { baseUrl, directory } = await startServer();
  const exportDirectory = await mkdtemp(path.join(os.tmpdir(), "research-phase35-zip-"));
  fixtures.push({ directory: exportDirectory });
  await writeFile(path.join(exportDirectory, "conversations.json"), JSON.stringify([exportedConversation()]));
  await writeFile(path.join(exportDirectory, "conversations-2.json"), JSON.stringify([
    exportedConversation({ id: "chat-second-file", title: "第二个导出文件" }),
  ]));
  await execFileAsync("zip", ["-q", "chatgpt-export.zip", "conversations.json", "conversations-2.json"], { cwd: exportDirectory });
  const zip = await readFile(path.join(exportDirectory, "chatgpt-export.zip"));
  const accepted = await uploadPreview(baseUrl, "chatgpt-export.zip", zip, "application/zip");
  assert.equal(accepted.response.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.preview.validCount, 2);

  await writeFile(path.join(exportDirectory, "readme.txt"), "no conversations here");
  await execFileAsync("zip", ["-q", "missing-conversations.zip", "readme.txt"], { cwd: exportDirectory });
  const missingZip = await uploadPreview(
    baseUrl,
    "missing-conversations.zip",
    await readFile(path.join(exportDirectory, "missing-conversations.zip")),
    "application/zip",
  );
  assert.equal(missingZip.response.status, 400);

  const corruptZip = await uploadPreview(baseUrl, "corrupt.zip", Buffer.from("PK-not-a-zip"), "application/zip");
  assert.equal(corruptZip.response.status, 400);

  const unknown = await uploadPreview(baseUrl, "history.txt", Buffer.from("[]"), "application/octet-stream");
  assert.equal(unknown.response.status, 400);

  const malformed = await uploadPreview(baseUrl, "conversations.json", Buffer.from("not json"));
  assert.equal(malformed.response.status, 400);
  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"), { readOnly: true });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_records").get().count, 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("preview paginates large lists, exposes parse errors, and selects only current-filter valid unimported rows", async () => {
  const { baseUrl } = await startServer();
  const conversations = Array.from({ length: 125 }, (_, index) => exportedConversation({
    id: `large-${index}`,
    title: index % 2 === 0 ? `BSX 研究 ${index}` : `其他研究 ${index}`,
    createTime: 1_788_000_000 + index,
  }));
  conversations.push({ broken: true });
  const upload = await uploadPreview(baseUrl, "conversations.json", Buffer.from(JSON.stringify(conversations)));
  assert.equal(upload.response.status, 201);
  assert.equal(upload.body.preview.validCount, 125);
  assert.equal(upload.body.preview.invalidCount, 1);

  const thirdPage = await jsonRequest(baseUrl, `/api/research/imports/previews/${upload.body.preview.id}?page=3&pageSize=50&duplicates=all`);
  assert.equal(thirdPage.body.preview.total, 126);
  assert.equal(thirdPage.body.preview.records.length, 26);

  const invalid = await jsonRequest(baseUrl, `/api/research/imports/previews/${upload.body.preview.id}?search=${encodeURIComponent("无法解析")}&duplicates=all`);
  assert.equal(invalid.body.preview.records.length, 1);
  assert.equal(invalid.body.preview.records[0].parseError, "无法安全重建用户可见消息");

  const selection = await jsonRequest(baseUrl, `/api/research/imports/previews/${upload.body.preview.id}/selection?search=BSX`);
  assert.equal(selection.body.sourceKeys.length, 63);
  assert.equal(selection.body.sourceKeys.some((key) => key.startsWith("invalid:")), false);
});

test("004 migration backs up a 003 database and preserves Phase 3 records", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase35-migration-"));
  fixtures.push({ directory });
  const app = createTaskboardServer({ dataDirectory: directory });
  await app.close();
  const databasePath = path.join(directory, "taskboard.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      DROP INDEX research_records_active_provider_external;
      DROP INDEX research_records_active_provider_fingerprint;
      DROP INDEX research_records_unclassified_occurred;
      DROP INDEX research_import_sessions_created;
      DROP INDEX research_import_session_records_record;
      DROP TABLE research_import_session_records;
      DROP TABLE research_import_sessions;
      DROP TABLE research_record_contents;
      ALTER TABLE research_records DROP COLUMN source_fingerprint;
      DELETE FROM research_schema_migrations WHERE version = '004_chatgpt_historical_import';
      INSERT INTO research_records (
        id, primary_topic_id, title, provider, kind, url, external_id, summary, note,
        occurred_at, capture_adapter, version, deleted_at, created_at, updated_at
      ) VALUES (
        'phase3-record', NULL, '已有研究记录', 'chatgpt', 'chat', NULL, NULL, '', '',
        '2026-08-01T00:00:00.000Z', 'manual-v1', 1, NULL,
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
      );
    `);
    const research = new ResearchDatabase(database, { databasePath });
    assert.deepEqual(research.migrationResult.applied, ["004_chatgpt_historical_import"]);
    assert.equal(research.getResearchRecord("phase3-record").title, "已有研究记录");
    assert.ok(database.prepare("SELECT 1 FROM research_schema_migrations WHERE version = '004_chatgpt_historical_import'").get());
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'research_record_contents'").get());
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
  const files = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(directory, "backups")));
  assert.ok(files.some((name) => name.includes("before-research-004_chatgpt_historical_import")));
  await access(databasePath);
});
