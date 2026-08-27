import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { ResearchDatabase } from "../server/research-database.mjs";
import { createTaskboardServer } from "../server/index.mjs";

const fixtures = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture.app) await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase2-test-"));
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
  return {
    response,
    body: responseText ? JSON.parse(responseText) : undefined,
  };
}

test("Topic current state and open questions keep independent lifecycles", async () => {
  const { baseUrl, directory } = await startServer();

  const created = await request(baseUrl, "/api/research/topics", {
    method: "POST",
    body: {
      title: "BSX 长期投资研究",
      status: "active",
      coreQuestion: "BSX未来3—5年的增长能否覆盖当前估值及收购产生的资本成本？",
      currentView: "长期基本面仍值得研究，但Penumbra收购提高了资本配置风险。",
      confidenceLevel: "medium",
      nextAction: "进一步验证Penumbra收购后的利润贡献和资本回报。",
      reviewTrigger: "下一季度财报发布",
      labels: ["医疗器械"],
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.topic.confidenceLevel, "medium");
  assert.equal(created.body.topic.reviewTrigger, "下一季度财报发布");
  assert.equal(created.body.topic.lastResearchedAt, null);
  assert.equal(created.body.topic.openQuestionCount, 0);

  const topicId = created.body.topic.id;
  const marked = await request(baseUrl, `/api/research/topics/${topicId}/mark-researched`, {
    method: "POST",
    body: { version: created.body.topic.version },
  });
  assert.equal(marked.response.status, 200);
  assert.ok(Date.parse(marked.body.topic.lastResearchedAt));
  const researchedAt = marked.body.topic.lastResearchedAt;

  const labelOnly = await request(baseUrl, `/api/research/topics/${topicId}`, {
    method: "PATCH",
    body: { version: marked.body.topic.version, labels: ["医疗器械", "长期投资"] },
  });
  assert.equal(labelOnly.response.status, 200);
  assert.equal(labelOnly.body.topic.lastResearchedAt, researchedAt);

  const questionTexts = [
    "Penumbra长期ROIC能否超过BSX资本成本？",
    "收购后的股权稀释最终会对EPS造成多大影响？",
    "BSX净债务什么时候能够明显下降？",
  ];
  let detail;
  for (const question of questionTexts) {
    const result = await request(baseUrl, `/api/research/topics/${topicId}/questions`, {
      method: "POST",
      body: { question },
    });
    assert.equal(result.response.status, 201);
    detail = result.body.topic;
  }
  assert.equal(detail.openQuestionCount, 3);
  assert.deepEqual(detail.questions.map((question) => question.question), questionTexts);

  const first = detail.questions[0];
  const resolved = await request(
    baseUrl,
    `/api/research/topics/${topicId}/questions/${first.id}`,
    {
      method: "PATCH",
      body: {
        version: first.version,
        status: "resolved",
        answerOrNote: "目前仍不能确认长期ROIC，但管理层指引和最新利润率显示趋势改善。",
      },
    },
  );
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.topic.openQuestionCount, 2);
  const resolvedQuestion = resolved.body.topic.questions.find((question) => question.id === first.id);
  assert.equal(resolvedQuestion.status, "resolved");
  assert.ok(Date.parse(resolvedQuestion.resolvedAt));
  assert.match(resolvedQuestion.answerOrNote, /利润率显示趋势改善/);

  const stale = await request(
    baseUrl,
    `/api/research/topics/${topicId}/questions/${first.id}`,
    {
      method: "PATCH",
      body: { version: first.version, question: "过期问题写入" },
    },
  );
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "QUESTION_VERSION_CONFLICT");

  let second = resolved.body.topic.questions[1];
  const dropped = await request(
    baseUrl,
    `/api/research/topics/${topicId}/questions/${second.id}`,
    { method: "PATCH", body: { version: second.version, status: "dropped" } },
  );
  assert.equal(dropped.body.topic.openQuestionCount, 1);
  second = dropped.body.topic.questions.find((question) => question.id === second.id);
  const restored = await request(
    baseUrl,
    `/api/research/topics/${topicId}/questions/${second.id}`,
    { method: "PATCH", body: { version: second.version, status: "open" } },
  );
  assert.equal(restored.body.topic.openQuestionCount, 2);

  let third = restored.body.topic.questions[2];
  const edited = await request(
    baseUrl,
    `/api/research/topics/${topicId}/questions/${third.id}`,
    {
      method: "PATCH",
      body: { version: third.version, question: "BSX净债务何时能够明显下降？" },
    },
  );
  third = edited.body.topic.questions.find((question) => question.id === third.id);
  const moved = await request(
    baseUrl,
    `/api/research/topics/${topicId}/questions/${third.id}/move`,
    { method: "POST", body: { version: third.version, direction: "up" } },
  );
  assert.equal(moved.response.status, 200);
  assert.deepEqual(
    moved.body.topic.questions.map((question) => question.id),
    [first.id, third.id, second.id],
  );

  const topics = await request(baseUrl, "/api/research/topics");
  assert.equal(topics.response.status, 200);
  assert.equal(topics.body.topics[0].openQuestionCount, 2);

  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"), { readOnly: true });
  try {
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
  const backups = await readdir(path.join(directory, "backups"));
  assert.equal(backups.filter((name) => name.endsWith(".sqlite")).length, 1);
});

test("Phase 2 migration backs up and preserves Phase 1 Topic data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase1-upgrade-"));
  fixtures.push({ directory });
  const databasePath = path.join(directory, "taskboard.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'inbox', 'active', 'waiting', 'thesis_formed', 'tracking', 'archived'
      )),
      core_question TEXT NOT NULL DEFAULT '',
      current_view TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      labels TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE topic_tasks (
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (topic_id, task_id),
      UNIQUE (task_id)
    );
    CREATE TABLE research_schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    INSERT INTO research_schema_migrations VALUES ('001_topic_task_core', '2026-01-01T00:00:00.000Z');
    INSERT INTO topics (
      id, title, status, core_question, current_view, next_action,
      labels, version, created_at, updated_at
    ) VALUES (
      'phase1-topic', 'Phase 1 Topic', 'active', '旧核心问题', '旧当前观点',
      '旧下一步', '["旧标签"]', 3,
      '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
    );
  `);

  try {
    const research = new ResearchDatabase(database, { databasePath });
    assert.deepEqual(research.migrationResult.applied, [
      "002_topic_current_state",
      "003_research_records",
    ]);
    assert.ok(research.migrationResult.backupPath);
    await access(research.migrationResult.backupPath);

    const topic = research.getTopic("phase1-topic");
    assert.equal(topic.currentView, "旧当前观点");
    assert.equal(topic.confidenceLevel, null);
    assert.equal(topic.reviewTrigger, "");
    assert.equal(topic.lastResearchedAt, null);
    assert.deepEqual(topic.questions, []);
    assert.deepEqual(
      database.prepare("SELECT version FROM research_schema_migrations ORDER BY version").all()
        .map((row) => row.version),
      ["001_topic_task_core", "002_topic_current_state", "003_research_records"],
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    const backup = new DatabaseSync(research.migrationResult.backupPath, { readOnly: true });
    try {
      assert.equal(
        backup.prepare("SELECT current_view FROM topics WHERE id = 'phase1-topic'").get().current_view,
        "旧当前观点",
      );
      assert.equal(
        backup.prepare("SELECT 1 FROM pragma_table_info('topics') WHERE name = 'confidence_level'").get(),
        undefined,
      );
    } finally {
      backup.close();
    }
  } finally {
    database.close();
  }
});
