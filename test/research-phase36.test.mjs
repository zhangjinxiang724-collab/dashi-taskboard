import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";

const fixtures = [];
const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    if (fixture.app) await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase36-test-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  fixtures.push({ app, directory });
  return { app, directory, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function request(baseUrl, pathname, { body, headers, ...options } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

function message(order, role, text) {
  return {
    order,
    role,
    sourceMessageId: `message-${order}`,
    occurredAt: `2026-08-29T00:0${order}:00.000Z`,
    parts: [{ type: "text", text }],
    fingerprint: `browser-test-${order}-${text}`,
  };
}

function windowMessages(from, to) {
  return Array.from({ length: to - from + 1 }, (_, offset) => ({
    ...message(from + offset, (from + offset) % 2 ? "user" : "assistant", `消息 ${from + offset}`),
    order: offset,
    occurredAt: null,
  }));
}

function metadata(externalConversationId = "conversation-1") {
  return {
    schemaVersion: "captured-conversation-v1",
    provider: "chatgpt",
    captureAdapter: "chatgpt-browser-v1",
    externalConversationId,
    title: "BSX 当前对话",
    sourceUrl: `https://chatgpt.com/c/${externalConversationId}`,
    capturedAt: "2026-08-29T01:00:00.000Z",
    branchScope: "active-visible-branch",
  };
}

const completeEvidence = {
  completeness: "complete",
  completenessDetails: {
    topBoundaryConfirmed: true,
    windowTopConfirmed: true,
    conversationRootConfirmed: true,
    earliestBoundaryConfirmed: true,
    latestBoundaryConfirmed: true,
    stablePasses: 3,
    loadingAbsent: true,
    conversationIdStable: true,
    unresolvedBranches: false,
    messageOmissionCount: 0,
    unsupportedContentCounts: {},
    unsupportedContentCount: 0,
    reasons: [],
    passiveDataAvailable: true,
    hasPreviousPageFinal: false,
    passiveHistoryExhausted: true,
    activeLeafConfirmed: true,
    missingParentCount: 0,
    cycleCount: 0,
    parentConflictCount: 0,
    pageDataConflictCount: 0,
    firstUserConfirmed: true,
    domUnmatchedCount: 0,
    domFingerprintMismatchCount: 0,
  },
};

async function pair(baseUrl) {
  const started = await request(baseUrl, "/api/research/capture/pairings/start", { method: "POST" });
  assert.equal(started.response.status, 201);
  const completed = await request(baseUrl, "/api/research/capture/pairings/complete", {
    method: "POST",
    headers: { origin: extensionOrigin },
    body: { code: started.body.pairing.code, displayName: "Phase 3.6 Test" },
  });
  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
  return { token: completed.body.token, client: completed.body.client };
}

async function createCapture(baseUrl, token, captureMetadata, messages, evidence = completeEvidence) {
  const headers = { origin: extensionOrigin, authorization: `Bearer ${token}` };
  const created = await request(baseUrl, "/api/research/captures/browser/previews", {
    method: "POST", headers, body: captureMetadata,
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const id = created.body.preview.id;
  const batch = await request(baseUrl, `/api/research/captures/browser/previews/${id}/batches`, {
    method: "POST", headers, body: { batchIndex: 0, messages },
  });
  assert.equal(batch.response.status, 201, JSON.stringify(batch.body));
  const finalized = await request(baseUrl, `/api/research/captures/browser/previews/${id}/finalize`, {
    method: "POST", headers, body: evidence,
  });
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.body));
  return finalized.body.preview;
}

test("browser capture pairs with exact extension origin and preserves append/conflict content versions", async () => {
  const { baseUrl, directory } = await startServer();
  const topicResult = await request(baseUrl, "/api/research/topics", {
    method: "POST", body: { title: "BSX 长期投资研究", status: "active" },
  });
  const topic = topicResult.body.topic;

  const preflight = await request(baseUrl, "/api/research/capture/pairings/complete", {
    method: "OPTIONS",
    headers: { origin: extensionOrigin, "access-control-request-method": "POST" },
  });
  assert.equal(preflight.response.status, 204);
  assert.equal(preflight.response.headers.get("access-control-allow-origin"), extensionOrigin);

  const { token } = await pair(baseUrl);
  const unauthenticated = await request(baseUrl, "/api/research/captures/browser/previews", {
    method: "POST", headers: { origin: extensionOrigin }, body: metadata(),
  });
  assert.equal(unauthenticated.response.status, 401);

  const firstMessages = [
    message(0, "user", "研究 Penumbra 收购后的资本回报。"),
    message(1, "assistant", "先比较 ROIC 与资本成本。"),
  ];
  const first = await createCapture(baseUrl, token, metadata(), firstMessages);
  assert.equal(first.completeness, "complete");
  assert.equal(first.relation, "new");
  const firstConfirm = await request(baseUrl, `/api/research/captures/browser/previews/${first.id}/confirm`, {
    method: "POST", body: { topicId: topic.id },
  });
  assert.equal(firstConfirm.response.status, 201, JSON.stringify(firstConfirm.body));
  assert.equal(firstConfirm.body.result.kind, "created");
  assert.equal(firstConfirm.body.result.contentVersion, 1);
  const record = firstConfirm.body.result.record;

  const appendedMessages = [...firstMessages, message(2, "user", "再检查协同效应兑现节奏。")];
  const appended = await createCapture(baseUrl, token, metadata(), appendedMessages);
  assert.equal(appended.relation, "safe_merge");
  const appendConfirm = await request(baseUrl, `/api/research/captures/browser/previews/${appended.id}/confirm`, {
    method: "POST",
    body: { topicId: topic.id, expectedRecordVersion: record.version },
  });
  assert.equal(appendConfirm.response.status, 200, JSON.stringify(appendConfirm.body));
  assert.equal(appendConfirm.body.result.kind, "updated");
  assert.equal(appendConfirm.body.result.contentVersion, 2);

  const identical = await createCapture(baseUrl, token, metadata(), appendedMessages);
  assert.equal(identical.relation, "identical");
  const identicalConfirm = await request(baseUrl, `/api/research/captures/browser/previews/${identical.id}/confirm`, {
    method: "POST", body: { topicId: topic.id, expectedRecordVersion: appendConfirm.body.result.record.version },
  });
  assert.equal(identicalConfirm.response.status, 200);
  assert.equal(identicalConfirm.body.result.kind, "already_latest");

  const changedMessages = [
    message(0, "user", "历史第一条消息已经变化。"),
    message(1, "assistant", "这不是严格追加。"),
  ];
  const changed = await createCapture(baseUrl, token, metadata(), changedMessages);
  assert.equal(changed.relation, "conflict");
  const unsafeConflict = await request(baseUrl, `/api/research/captures/browser/previews/${changed.id}/confirm`, {
    method: "POST", body: { topicId: topic.id, expectedRecordVersion: appendConfirm.body.result.record.version },
  });
  assert.equal(unsafeConflict.response.status, 409);
  assert.equal(unsafeConflict.body.error.code, "CAPTURE_CONFLICT_CONFIRMATION_REQUIRED");
  const acceptedConflict = await request(baseUrl, `/api/research/captures/browser/previews/${changed.id}/confirm`, {
    method: "POST",
    body: {
      topicId: topic.id,
      expectedRecordVersion: appendConfirm.body.result.record.version,
      conflictAction: "replace-current",
    },
  });
  assert.equal(acceptedConflict.response.status, 200, JSON.stringify(acceptedConflict.body));
  assert.equal(acceptedConflict.body.result.contentVersion, 3);

  const versions = await request(baseUrl, `/api/research/records/${record.id}/content-versions`);
  assert.deepEqual(versions.body.versions.map((version) => version.versionNumber), [3, 2, 1]);
  assert.deepEqual(versions.body.versions.map((version) => version.relationToPrevious), ["conflict", "append", "initial"]);
  assert.equal(versions.body.versions[1].completenessDetails.coverageRelation, "safe_merge");
  const historical = await request(baseUrl, `/api/research/records/${record.id}/content?version=1`);
  assert.equal(historical.body.content.content.messages[0].parts[0].text, firstMessages[0].parts[0].text);
  const current = await request(baseUrl, `/api/research/records/${record.id}/content`);
  assert.equal(current.body.content.versionNumber, 3);
  assert.equal(current.body.content.content.messages[0].parts[0].text, changedMessages[0].parts[0].text);

  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"), { readOnly: true });
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_record_content_versions WHERE record_id = ?").get(record.id).count, 3);
  database.close();
});

test("browser capture does not create a content version when only capture evidence improves", async () => {
  const { baseUrl, directory } = await startServer();
  const { token } = await pair(baseUrl);
  const firstMessages = [
    { ...message(0, "user", "研究长期资本回报。"), diagnosticMessageHash: "session:first-user" },
    { ...message(1, "assistant", "先核对投入资本与现金回报。"), diagnosticMessageHash: "session:first-assistant" },
  ];
  const firstEvidence = {
    completeness: "partial",
    completenessDetails: {
      ...completeEvidence.completenessDetails,
      latestBoundaryConfirmed: false,
      reasons: ["latest-boundary-unconfirmed"],
      passiveCaptureDurationMs: 100,
    },
  };
  const first = await createCapture(baseUrl, token, metadata("no-op-evidence-conversation"), firstMessages, firstEvidence);
  const firstConfirm = await request(baseUrl, `/api/research/captures/browser/previews/${first.id}/confirm`, {
    method: "POST", body: { topicId: null, allowPartial: true },
  });
  assert.equal(firstConfirm.response.status, 201, JSON.stringify(firstConfirm.body));
  assert.equal(firstConfirm.body.result.contentVersion, 1);

  const secondMessages = firstMessages.map((capturedMessage) => ({
    ...capturedMessage,
    diagnosticMessageHash: `${capturedMessage.diagnosticMessageHash}-next-capture`,
  }));
  const secondMetadata = {
    ...metadata("no-op-evidence-conversation"),
    capturedAt: "2026-08-29T02:00:00.000Z",
  };
  const secondEvidence = {
    ...completeEvidence,
    completenessDetails: {
      ...completeEvidence.completenessDetails,
      passiveCaptureDurationMs: 250,
    },
  };
  const second = await createCapture(baseUrl, token, secondMetadata, secondMessages, secondEvidence);
  assert.equal(second.relation, "safe_merge");
  assert.equal(second.coverage.newCoverageMessageCount, 0);
  assert.equal(second.sourceFingerprint, first.sourceFingerprint);

  const secondConfirm = await request(baseUrl, `/api/research/captures/browser/previews/${second.id}/confirm`, {
    method: "POST",
    body: {
      topicId: null,
      expectedRecordVersion: firstConfirm.body.result.record.version,
    },
  });
  assert.equal(secondConfirm.response.status, 200, JSON.stringify(secondConfirm.body));
  assert.equal(secondConfirm.body.result.kind, "already_latest");
  assert.equal(secondConfirm.body.result.contentVersion, 1);
  assert.equal(
    secondConfirm.body.result.record.version,
    firstConfirm.body.result.record.version + 1,
  );

  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"), { readOnly: true });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_records WHERE deleted_at IS NULL").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_record_content_versions").get().count, 1);
  const current = database.prepare(`
    SELECT version_number, is_current FROM research_record_content_versions WHERE record_id = ?
  `).get(firstConfirm.body.result.record.id);
  assert.equal(current.version_number, 1);
  assert.equal(current.is_current, 1);
  const currentContentConsistency = database.prepare(`
    SELECT
      contents.content_hash = versions.content_hash AS content_hash_equal,
      contents.content_blob = versions.content_blob AS content_blob_equal,
      records.source_fingerprint = versions.source_fingerprint AS source_fingerprint_equal
    FROM research_records records
    JOIN research_record_contents contents ON contents.record_id = records.id
    JOIN research_record_content_versions versions
      ON versions.record_id = records.id AND versions.is_current = 1
    WHERE records.id = ?
  `).get(firstConfirm.body.result.record.id);
  assert.equal(currentContentConsistency.content_hash_equal, 1);
  assert.equal(currentContentConsistency.content_blob_equal, 1);
  assert.equal(currentContentConsistency.source_fingerprint_equal, 1);
  const record = database.prepare(`
    SELECT capture_completeness, last_captured_at FROM research_records WHERE id = ?
  `).get(firstConfirm.body.result.record.id);
  assert.equal(record.capture_completeness, "complete");
  assert.equal(record.last_captured_at, secondMetadata.capturedAt);
  database.close();

  const concurrentMetadata = {
    ...secondMetadata,
    capturedAt: "2026-08-29T03:00:00.000Z",
  };
  const [concurrentA, concurrentB] = await Promise.all([
    createCapture(baseUrl, token, concurrentMetadata, secondMessages, secondEvidence),
    createCapture(baseUrl, token, concurrentMetadata, secondMessages, secondEvidence),
  ]);
  const concurrentResults = await Promise.all([
    request(baseUrl, `/api/research/captures/browser/previews/${concurrentA.id}/confirm`, {
      method: "POST",
      body: { topicId: null, expectedRecordVersion: secondConfirm.body.result.record.version },
    }),
    request(baseUrl, `/api/research/captures/browser/previews/${concurrentB.id}/confirm`, {
      method: "POST",
      body: { topicId: null, expectedRecordVersion: secondConfirm.body.result.record.version },
    }),
  ]);
  assert.deepEqual(concurrentResults.map(({ response }) => response.status).sort(), [200, 409]);
  const afterConcurrent = new DatabaseSync(path.join(directory, "taskboard.sqlite"), { readOnly: true });
  assert.equal(afterConcurrent.prepare("SELECT COUNT(*) AS count FROM research_records WHERE deleted_at IS NULL").get().count, 1);
  assert.equal(afterConcurrent.prepare("SELECT COUNT(*) AS count FROM research_record_content_versions").get().count, 1);
  assert.equal(afterConcurrent.prepare(`
    SELECT COUNT(*) AS count FROM research_record_content_versions WHERE is_current = 1
  `).get().count, 1);
  afterConcurrent.close();
});

test("overlapping partial browser windows persist one merged canonical version", async () => {
  const { baseUrl } = await startServer();
  const { token } = await pair(baseUrl);
  const partialLatest = {
    completeness: "partial",
    completenessDetails: {
      topBoundaryConfirmed: false,
      earliestBoundaryConfirmed: false,
      latestBoundaryConfirmed: true,
      stablePasses: 0,
      loadingAbsent: true,
      conversationIdStable: true,
      unresolvedBranches: false,
      messageOmissionCount: 0,
      unsupportedContentCounts: {},
      unsupportedContentCount: 0,
      reasons: ["earliest-boundary-unconfirmed"],
    },
  };
  const partialEarlier = {
    ...partialLatest,
    completenessDetails: {
      ...partialLatest.completenessDetails,
      latestBoundaryConfirmed: false,
      reasons: ["earliest-boundary-unconfirmed", "latest-boundary-unconfirmed"],
    },
  };
  const first = await createCapture(baseUrl, token, metadata("overlap-conversation"), windowMessages(50, 100), partialLatest);
  const firstConfirm = await request(baseUrl, `/api/research/captures/browser/previews/${first.id}/confirm`, {
    method: "POST", body: { topicId: null, allowPartial: true },
  });
  assert.equal(firstConfirm.response.status, 201, JSON.stringify(firstConfirm.body));
  const record = firstConfirm.body.result.record;

  const second = await createCapture(baseUrl, token, metadata("overlap-conversation"), windowMessages(30, 70), partialEarlier);
  assert.equal(second.relation, "safe_merge");
  assert.deepEqual(second.coverage, {
    existingMessageCount: 51,
    incomingMessageCount: 41,
    mergedMessageCount: 71,
    newCoverageMessageCount: 20,
    earliestBoundaryConfirmed: false,
    latestBoundaryConfirmed: true,
  });
  const secondConfirm = await request(baseUrl, `/api/research/captures/browser/previews/${second.id}/confirm`, {
    method: "POST",
    body: { topicId: null, allowPartial: true, expectedRecordVersion: record.version },
  });
  assert.equal(secondConfirm.response.status, 200, JSON.stringify(secondConfirm.body));
  assert.equal(secondConfirm.body.result.contentVersion, 2);

  const current = await request(baseUrl, `/api/research/records/${record.id}/content`);
  assert.equal(current.body.content.messageCount, 71);
  assert.equal(current.body.content.content.messages[0].sourceMessageId, "message-30");
  assert.equal(current.body.content.content.messages.at(-1).sourceMessageId, "message-100");
  assert.equal(current.body.content.completeness, "partial");
  assert.equal(current.body.content.completenessDetails.coverageRelation, "safe_merge");
});

test("server downgrades unverifiable captures to partial and requires explicit acceptance", async () => {
  const { baseUrl } = await startServer();
  const { token, client } = await pair(baseUrl);
  const unknownRole = [message(0, "unknown", "页面结构无法确认这条消息的角色。")];
  const preview = await createCapture(baseUrl, token, metadata("partial-conversation"), unknownRole);
  assert.equal(preview.completeness, "partial");
  assert.ok(preview.completenessDetails.reasons.includes("unresolved-or-unknown-message-role"));

  const rejected = await request(baseUrl, `/api/research/captures/browser/previews/${preview.id}/confirm`, {
    method: "POST", body: { topicId: null },
  });
  assert.equal(rejected.response.status, 409);
  assert.equal(rejected.body.error.code, "PARTIAL_CONFIRMATION_REQUIRED");
  const accepted = await request(baseUrl, `/api/research/captures/browser/previews/${preview.id}/confirm`, {
    method: "POST", body: { topicId: null, allowPartial: true },
  });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.body.result.record.captureCompleteness, "partial");

  const badLink = [
    { ...message(0, "user", "bad link"), parts: [{ type: "link", text: "危险链接", url: "javascript:alert(1)" }] },
  ];
  const headers = { origin: extensionOrigin, authorization: `Bearer ${token}` };
  const created = await request(baseUrl, "/api/research/captures/browser/previews", {
    method: "POST", headers, body: metadata("invalid-link"),
  });
  const invalidBatch = await request(baseUrl, `/api/research/captures/browser/previews/${created.body.preview.id}/batches`, {
    method: "POST", headers, body: { batchIndex: 0, messages: badLink },
  });
  assert.equal(invalidBatch.response.status, 400);

  const revoked = await request(baseUrl, `/api/research/capture/clients/${client.id}`, { method: "DELETE" });
  assert.equal(revoked.response.status, 204);
  const afterRevoke = await request(baseUrl, "/api/research/captures/browser/previews", {
    method: "POST", headers, body: metadata("revoked-client"),
  });
  assert.equal(afterRevoke.response.status, 401);
});

test("browser window top cannot be used as conversation root evidence", async () => {
  const { baseUrl } = await startServer();
  const { token } = await pair(baseUrl);
  const windowOnlyEvidence = {
    completeness: "complete",
    completenessDetails: {
      topBoundaryConfirmed: true,
      windowTopConfirmed: true,
      conversationRootConfirmed: false,
      earliestBoundaryConfirmed: true,
      latestBoundaryConfirmed: true,
      stablePasses: 3,
      loadingAbsent: true,
      conversationIdStable: true,
      unresolvedBranches: false,
      messageOmissionCount: 0,
      unsupportedContentCounts: {},
      unsupportedContentCount: 0,
      reasons: [],
    },
  };
  const preview = await createCapture(
    baseUrl,
    token,
    metadata("window-top-is-not-root"),
    [message(0, "user", "窗口顶部不是整场会话的根节点。")],
    windowOnlyEvidence,
  );
  assert.equal(preview.completeness, "partial");
  assert.equal(preview.completenessDetails.windowTopConfirmed, true);
  assert.equal(preview.completenessDetails.conversationRootConfirmed, false);
  assert.equal(preview.completenessDetails.earliestBoundaryConfirmed, false);
  assert.ok(preview.completenessDetails.reasons.includes("earliest-boundary-unconfirmed"));
  assert.ok(preview.completenessDetails.reasons.includes("complete-evidence-insufficient"));
});
