import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";

const fixtures = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const { app, directory } = fixtures.pop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-layer-test-"));
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
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

test("Topic and existing Task form the minimal Research OS loop", async () => {
  const { baseUrl, directory } = await startServer();

  const taskResult = await request(baseUrl, "/api/tasks", {
    method: "POST",
    body: { title: "研究 Penumbra 收购", status: "todo" },
  });
  assert.equal(taskResult.response.status, 201);
  const task = taskResult.body.task;

  const createResult = await request(baseUrl, "/api/research/topics", {
    method: "POST",
    body: {
      title: "BSX 长期投资研究",
      status: "active",
      coreQuestion: "Penumbra 收购是否提升长期竞争力？",
      currentView: "收购可能扩大产品组合，但整合与稀释仍需验证。",
      nextAction: "阅读并购文件并建立证据清单。",
      labels: ["医疗器械", "长期投资"],
    },
  });
  assert.equal(createResult.response.status, 201);
  assert.equal(createResult.body.topic.version, 1);
  const topic = createResult.body.topic;

  const linkResult = await request(
    baseUrl,
    `/api/research/topics/${topic.id}/tasks/${task.id}`,
    { method: "POST" },
  );
  assert.equal(linkResult.response.status, 201);
  assert.deepEqual(linkResult.body.topic.tasks.map((linked) => linked.id), [task.id]);

  const otherTopic = await request(baseUrl, "/api/research/topics", {
    method: "POST",
    body: { title: "另一个研究主题" },
  });
  const duplicateLink = await request(
    baseUrl,
    `/api/research/topics/${otherTopic.body.topic.id}/tasks/${task.id}`,
    { method: "POST" },
  );
  assert.equal(duplicateLink.response.status, 409);
  assert.equal(duplicateLink.body.error.code, "TASK_ALREADY_LINKED");

  const moveResult = await request(baseUrl, `/api/research/topics/${topic.id}`, {
    method: "PATCH",
    body: { version: topic.version, status: "tracking" },
  });
  assert.equal(moveResult.response.status, 200);
  assert.equal(moveResult.body.topic.status, "tracking");
  assert.equal(moveResult.body.topic.version, 2);

  const staleUpdate = await request(baseUrl, `/api/research/topics/${topic.id}`, {
    method: "PATCH",
    body: { version: topic.version, title: "过期写入" },
  });
  assert.equal(staleUpdate.response.status, 409);
  assert.equal(staleUpdate.body.error.code, "TOPIC_VERSION_CONFLICT");

  const unlinkResult = await request(
    baseUrl,
    `/api/research/topics/${topic.id}/tasks/${task.id}`,
    { method: "DELETE" },
  );
  assert.equal(unlinkResult.response.status, 204);
  const taskStillExists = await request(baseUrl, `/api/tasks/${task.id}`);
  assert.equal(taskStillExists.response.status, 200);
  assert.equal(taskStillExists.body.task.id, task.id);

  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  try {
    assert.deepEqual(
      database.prepare("SELECT version FROM research_schema_migrations ORDER BY version").all()
        .map((row) => row.version),
      ["001_topic_task_core"],
    );
    assert.equal(
      database.prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'topic_id'").get(),
      undefined,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
