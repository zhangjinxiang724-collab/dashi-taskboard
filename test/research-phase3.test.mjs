import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { ResearchDatabase } from "../server/research-database.mjs";
import { createTaskboardServer } from "../server/index.mjs";

const execFileAsync = promisify(execFile);
const fixtures = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture.app) await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase3-test-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  fixtures.push({ app, directory });
  return { baseUrl: `http://127.0.0.1:${address.port}`, directory };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body === undefined ? options.headers : {
      "content-type": "application/json",
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const responseText = await response.text();
  return { response, body: responseText ? JSON.parse(responseText) : undefined };
}

function recordDraft(overrides = {}) {
  return {
    title: "BSX 深度投资研究",
    provider: "chatgpt",
    kind: "deep_research",
    url: "https://chatgpt.com/c/example",
    externalId: "opaque-example",
    summary: "研究 Penumbra 收购后的资本回报与资本成本。",
    note: "保留反方证据。",
    occurredAt: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
}

test("Research Record CRUD is topic-scoped, ordered, versioned, and soft-deleted", async () => {
  const { baseUrl, directory } = await startServer();

  const topicResult = await request(baseUrl, "/api/research/topics", {
    method: "POST",
    body: { title: "BSX 长期投资研究", status: "active" },
  });
  const topic = topicResult.body.topic;

  const first = await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: recordDraft(),
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.record.captureAdapter, "manual-v1");
  assert.equal(first.body.record.version, 1);
  assert.equal(first.body.record.topicId, topic.id);

  const older = await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: recordDraft({
      title: "Penumbra 收购与股权稀释分析",
      kind: "chat",
      occurredAt: "2026-08-25T10:00:00.000Z",
    }),
  });
  const newest = await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: recordDraft({
      title: "Research OS BSX 数据整理",
      provider: "codex",
      kind: "agent_run",
      url: null,
      occurredAt: "2026-08-28T10:00:00.000Z",
    }),
  });

  const list = await request(baseUrl, `/api/research/topics/${topic.id}/records`);
  assert.equal(list.response.status, 200);
  assert.deepEqual(
    list.body.records.map((record) => record.id),
    [newest.body.record.id, first.body.record.id, older.body.record.id],
  );

  const detail = await request(baseUrl, `/api/research/records/${first.body.record.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.record.title, "BSX 深度投资研究");

  const updated = await request(baseUrl, `/api/research/records/${first.body.record.id}`, {
    method: "PATCH",
    body: { version: 1, title: "BSX 深度投资研究（已更新）", url: null },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.record.version, 2);
  assert.equal(updated.body.record.url, null);

  const stale = await request(baseUrl, `/api/research/records/${first.body.record.id}`, {
    method: "PATCH",
    body: { version: 1, title: "过期写入" },
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "RESEARCH_RECORD_VERSION_CONFLICT");

  const topicAfterRecordChanges = await request(baseUrl, `/api/research/topics/${topic.id}`);
  assert.equal(topicAfterRecordChanges.body.topic.version, topic.version);

  const invalidUrl = await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: recordDraft({ url: "javascript:alert(1)" }),
  });
  assert.equal(invalidUrl.response.status, 400);
  assert.equal(invalidUrl.body.error.code, "INVALID_FIELD");

  const unknownField = await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: { ...recordDraft(), captureAdapter: "forged-adapter" },
  });
  assert.equal(unknownField.response.status, 400);
  assert.equal(unknownField.body.error.code, "UNKNOWN_FIELD");

  const taskOne = await request(baseUrl, "/api/tasks", {
    method: "POST",
    body: { title: "研究 Penumbra 收购", status: "todo" },
  });
  const taskTwo = await request(baseUrl, "/api/tasks", {
    method: "POST",
    body: { title: "更新 BSX 估值模型", status: "todo" },
  });
  const databasePath = path.join(directory, "taskboard.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  try {
    const research = new ResearchDatabase(database, { databasePath });
    assert.equal(research.linkResearchRecordTask(newest.body.record.id, taskOne.body.task.id).kind, "linked");
    assert.equal(research.linkResearchRecordTask(newest.body.record.id, taskTwo.body.task.id).kind, "linked");
    assert.equal(research.linkResearchRecordTask(older.body.record.id, taskOne.body.task.id).kind, "linked");
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM research_record_tasks WHERE record_id = ?").get(newest.body.record.id).count,
      2,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM research_record_tasks WHERE task_id = ?").get(taskOne.body.task.id).count,
      2,
    );
  } finally {
    database.close();
  }

  const deleted = await request(baseUrl, `/api/research/records/${first.body.record.id}`, {
    method: "DELETE",
    body: { version: updated.body.record.version },
  });
  assert.equal(deleted.response.status, 204);
  assert.equal((await request(baseUrl, `/api/research/records/${first.body.record.id}`)).response.status, 404);
  const afterDelete = await request(baseUrl, `/api/research/topics/${topic.id}/records`);
  assert.equal(afterDelete.body.records.some((record) => record.id === first.body.record.id), false);

  const check = new DatabaseSync(databasePath);
  check.exec("PRAGMA foreign_keys = ON");
  try {
    const deletedRow = check.prepare("SELECT deleted_at, version FROM research_records WHERE id = ?").get(first.body.record.id);
    assert.ok(Date.parse(deletedRow.deleted_at));
    assert.equal(deletedRow.version, 3);
    check.prepare("DELETE FROM topics WHERE id = ?").run(topic.id);
    assert.equal(
      check.prepare("SELECT primary_topic_id FROM research_records WHERE id = ?").get(newest.body.record.id).primary_topic_id,
      null,
    );
    assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    check.close();
  }
});

test("Phase 3 migration backs up and preserves a Phase 2 database", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase2-upgrade-"));
  fixtures.push({ directory });
  const databasePath = path.join(directory, "taskboard.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, identifier TEXT NOT NULL, project_id TEXT NOT NULL,
      title TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE topics (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
      core_question TEXT NOT NULL DEFAULT '', current_view TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '', labels TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      confidence_level TEXT, review_trigger TEXT NOT NULL DEFAULT '', last_researched_at TEXT
    );
    CREATE TABLE topic_tasks (
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, PRIMARY KEY (topic_id, task_id), UNIQUE (task_id)
    );
    CREATE TABLE topic_questions (
      id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      question TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', answer_or_note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, resolved_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE research_schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO research_schema_migrations VALUES ('001_topic_task_core', '2026-01-01T00:00:00.000Z');
    INSERT INTO research_schema_migrations VALUES ('002_topic_current_state', '2026-02-01T00:00:00.000Z');
    INSERT INTO topics VALUES (
      'phase2-topic', 'Phase 2 Topic', 'active', '核心问题', '当前观点', '下一步', '["长期研究"]',
      4, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z',
      'medium', '下一次财报', '2026-02-01T00:00:00.000Z'
    );
    INSERT INTO topic_questions VALUES (
      'phase2-question', 'phase2-topic', '仍需回答的问题', 'open', '', 0, 1, NULL,
      '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
    );
  `);

  try {
    const research = new ResearchDatabase(database, { databasePath });
    assert.deepEqual(research.migrationResult.applied, [
      "003_research_records",
      "004_chatgpt_historical_import",
      "005_browser_capture",
    ]);
    await access(research.migrationResult.backupPath);
    assert.equal(research.getTopic("phase2-topic").currentView, "当前观点");
    assert.equal(research.getTopic("phase2-topic").questions[0].question, "仍需回答的问题");
    assert.deepEqual(
      database.prepare("SELECT version FROM research_schema_migrations ORDER BY version").all().map((row) => row.version),
      [
        "001_topic_task_core",
        "002_topic_current_state",
        "003_research_records",
        "004_chatgpt_historical_import",
        "005_browser_capture",
      ],
    );
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'research_records'").get());
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    const backup = new DatabaseSync(research.migrationResult.backupPath, { readOnly: true });
    try {
      assert.equal(backup.prepare("SELECT current_view FROM topics WHERE id = 'phase2-topic'").get().current_view, "当前观点");
      assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name = 'research_records'").get(), undefined);
    } finally {
      backup.close();
    }
  } finally {
    database.close();
  }
});

test("manual SQLite backup tool creates verified, non-overwriting snapshots", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-backup-tool-"));
  fixtures.push({ directory });
  const databasePath = path.join(directory, "taskboard.sqlite");
  const backupDirectory = path.join(directory, "manual-backups");
  const source = new DatabaseSync(databasePath);
  source.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE parent (id TEXT PRIMARY KEY);
    CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));
    INSERT INTO parent VALUES ('kept');
    INSERT INTO child VALUES ('child', 'kept');
  `);
  source.close();

  const script = path.resolve("scripts/backup-research-os.mjs");
  const first = await execFileAsync(process.execPath, [script, databasePath, backupDirectory]);
  const second = await execFileAsync(process.execPath, [script, databasePath, backupDirectory]);
  const firstPath = first.stdout.trim();
  const secondPath = second.stdout.trim();
  assert.notEqual(firstPath, secondPath);
  await access(firstPath);
  await access(secondPath);

  for (const backupPath of [firstPath, secondPath]) {
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(backup.prepare("SELECT id FROM parent").get().id, "kept");
      assert.deepEqual(backup.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      backup.close();
    }
  }
});
