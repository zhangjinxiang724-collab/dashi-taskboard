import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";

const fixtures = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase40a0-test-"));
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
  const responseText = await response.text();
  return { response, body: responseText ? JSON.parse(responseText) : undefined };
}

async function createManualRecord(baseUrl, content = "第一版脱敏资料正文。") {
  const topic = (await request(baseUrl, "/api/research/topics", {
    method: "POST",
    body: { title: "脱敏研究主题", status: "active", currentView: "我目前的判断。" },
  })).body.topic;
  const record = (await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: {
      title: "手动整理的资料",
      provider: "other",
      kind: "other",
      url: null,
      externalId: null,
      summary: "",
      note: "",
      content,
      occurredAt: "2026-09-23T01:00:00.000Z",
    },
  })).body.record;
  return { topic, record };
}

const summaryDraft = {
  oneLineSummary: "这份资料说明了一个清楚的结论。",
  coreContent: "正文里的主要内容。",
  keyEvidence: "脱敏证据。",
  unresolved: "仍需确认的部分。",
};

test("manual Research Record creates readable V1 that Summary and Cognition can bind", async () => {
  const { baseUrl, directory } = await startServer();
  const { topic, record } = await createManualRecord(baseUrl);
  assert.equal(record.captureAdapter, "manual-v1");

  const versions = (await request(baseUrl, `/api/research/records/${record.id}/content-versions`)).body.versions;
  assert.equal(versions.length, 1);
  assert.equal(versions[0].versionNumber, 1);
  assert.equal(versions[0].isCurrent, true);
  assert.equal(versions[0].captureAdapter, "manual-v1");

  const content = (await request(baseUrl, `/api/research/records/${record.id}/content?version=1`)).body.content;
  assert.equal(content.versionId, versions[0].id);
  assert.equal(content.versionNumber, 1);
  assert.equal(content.content.messages[0].text, "第一版脱敏资料正文。");

  const summary = await request(baseUrl, `/api/research/records/${record.id}/summary`, {
    method: "POST",
    body: { sourceContentVersionId: versions[0].id, ...summaryDraft },
  });
  assert.equal(summary.response.status, 201);
  assert.equal(summary.body.summary.sourceContentVersionId, versions[0].id);

  const cognition = await request(baseUrl, `/api/research/topics/${topic.id}/cognition-updates`, {
    method: "POST",
    body: { recordId: record.id, sourceContentVersionId: versions[0].id },
  });
  assert.equal(cognition.response.status, 201);
  assert.equal(cognition.body.update.sourceContentVersionId, versions[0].id);

  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  database.close();
});

test("manual content changes create V2 while V1 Summary stays bound only to V1", async () => {
  const { baseUrl } = await startServer();
  const { record } = await createManualRecord(baseUrl);
  const v1 = (await request(baseUrl, `/api/research/records/${record.id}/content-versions`)).body.versions[0];
  await request(baseUrl, `/api/research/records/${record.id}/summary`, {
    method: "POST",
    body: { sourceContentVersionId: v1.id, ...summaryDraft },
  });

  const unchanged = (await request(baseUrl, `/api/research/records/${record.id}`, {
    method: "PATCH",
    body: { version: record.version, content: "第一版脱敏资料正文。" },
  })).body.record;
  assert.equal((await request(baseUrl, `/api/research/records/${record.id}/content-versions`)).body.versions.length, 1);

  await request(baseUrl, `/api/research/records/${record.id}`, {
    method: "PATCH",
    body: { version: unchanged.version, content: "第二版脱敏资料正文，增加了新的事实。" },
  });
  const versions = (await request(baseUrl, `/api/research/records/${record.id}/content-versions`)).body.versions;
  assert.equal(versions.length, 2);
  const oldVersion = versions.find((version) => version.versionNumber === 1);
  const currentVersion = versions.find((version) => version.versionNumber === 2);
  assert.equal(oldVersion.isCurrent, false);
  assert.equal(currentVersion.isCurrent, true);
  assert.equal(currentVersion.relationToPrevious, "append");

  const v1Summary = await request(baseUrl, `/api/research/records/${record.id}/summary?contentVersionId=${oldVersion.id}`);
  const v2Summary = await request(baseUrl, `/api/research/records/${record.id}/summary?contentVersionId=${currentVersion.id}`);
  assert.equal(v1Summary.body.summary.oneLineSummary, summaryDraft.oneLineSummary);
  assert.equal(v2Summary.body.summary, null);
  assert.equal((await request(baseUrl, `/api/research/records/${record.id}/content?version=2`)).body.content.content.messages[0].text, "第二版脱敏资料正文，增加了新的事实。");
});
