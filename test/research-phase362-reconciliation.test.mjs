import assert from "node:assert/strict";
import test from "node:test";

import { reconcileCapturedConversations } from "../shared/captured-conversation-domain.mjs";

function capturedMessage(number, { text = `消息 ${number}`, id = `M${number}` } = {}) {
  return {
    order: 0,
    role: number % 2 ? "user" : "assistant",
    sourceMessageId: id,
    occurredAt: null,
    parts: [{ type: "text", text }],
    fingerprint: `fixture-${id}`,
  };
}

function conversation(from, to, {
  adapter = "chatgpt-browser-v1",
  earliest = false,
  latest = false,
  completeness = "partial",
  mutate = null,
} = {}) {
  const messages = [];
  for (let number = from; number <= to; number += 1) {
    const message = capturedMessage(number);
    messages.push(mutate?.(message, number) ?? message);
  }
  return {
    schemaVersion: "captured-conversation-v1",
    provider: "chatgpt",
    captureAdapter: adapter,
    externalConversationId: "conversation-progressive",
    title: "渐进捕获测试",
    sourceUrl: "https://chatgpt.com/c/conversation-progressive",
    capturedAt: "2026-09-05T10:00:00.000Z",
    branchScope: "active-visible-branch",
    completeness,
    completenessDetails: {
      topBoundaryConfirmed: earliest,
      windowTopConfirmed: earliest,
      conversationRootConfirmed: earliest,
      earliestBoundaryConfirmed: earliest,
      latestBoundaryConfirmed: latest,
      stablePasses: earliest ? 3 : 0,
      loadingAbsent: true,
      conversationIdStable: true,
      unresolvedBranches: false,
      messageOmissionCount: 0,
      unsupportedContentCounts: {},
      unsupportedContentCount: 0,
      reasons: [],
    },
    messages: messages.map((message, order) => ({ ...message, order })),
    captureStats: {
      discoveredMessageCount: messages.length,
      messageOmissionCount: 0,
      unsupportedContentCounts: {},
      unsupportedContentCount: 0,
    },
  };
}

test("partial M50-M100 plus M30-M70 safely merges to M30-M100", () => {
  const result = reconcileCapturedConversations(conversation(50, 100, { latest: true }), conversation(30, 70));
  assert.equal(result.relation, "safe_merge");
  assert.equal(result.conversation.messages.length, 71);
  assert.equal(result.conversation.messages[0].sourceMessageId, "M30");
  assert.equal(result.conversation.messages.at(-1).sourceMessageId, "M100");
  assert.equal(result.coverage.newCoverageMessageCount, 20);
  assert.equal(result.conversation.completeness, "partial");
});

test("stable anchors safely merge a message omitted by one virtualized window", () => {
  const previous = conversation(1, 5);
  previous.messages = previous.messages.filter((message) => message.sourceMessageId !== "M3")
    .map((message, order) => ({ ...message, order }));
  const incoming = conversation(2, 4);
  const result = reconcileCapturedConversations(previous, incoming);
  assert.equal(result.relation, "safe_merge");
  assert.deepEqual(result.conversation.messages.map((message) => message.sourceMessageId), ["M1", "M2", "M3", "M4", "M5"]);
});

test("an identical coverage window is up to date", () => {
  const result = reconcileCapturedConversations(conversation(50, 100), conversation(50, 100));
  assert.equal(result.relation, "identical");
  assert.equal(result.conversation.messages.length, 51);
});

test("transient link targets and media labels do not create a false content conflict", () => {
  const first = conversation(1, 2, {
    mutate: (message, number) => number === 2
      ? {
        ...message,
        parts: [
          { type: "text", text: "同一条可见正文" },
          { type: "link", text: "来源", url: "https://example.com/report?token=first" },
          { type: "media-placeholder", label: "图片 A", mediaType: "image" },
        ],
      }
      : message,
  });
  const second = conversation(1, 2, {
    mutate: (message, number) => number === 2
      ? {
        ...message,
        parts: [
          { type: "text", text: "同一条可见正文" },
          { type: "link", text: "来源", url: "https://example.com/report?token=second" },
          { type: "media-placeholder", label: "重新渲染后的图片标签", mediaType: "image" },
        ],
      }
      : message,
  });
  assert.equal(reconcileCapturedConversations(first, second).relation, "identical");
});

test("changed overlap content, missing overlap, order changes and complete-history deletion conflict", () => {
  const changed = conversation(30, 70, {
    mutate: (message, number) => number === 55
      ? { ...message, parts: [{ type: "text", text: "被修改的历史消息" }] }
      : message,
  });
  assert.equal(reconcileCapturedConversations(conversation(50, 100), changed).reason, "message-content-changed");
  assert.equal(reconcileCapturedConversations(conversation(1, 10), conversation(20, 30)).reason, "no-reliable-overlap");
  const reordered = conversation(3, 8);
  [reordered.messages[1], reordered.messages[2]] = [reordered.messages[2], reordered.messages[1]];
  assert.equal(reconcileCapturedConversations(conversation(1, 6), reordered).reason, "message-order-changed");
  assert.equal(reconcileCapturedConversations(
    conversation(1, 5, { earliest: true, latest: true, completeness: "complete" }),
    conversation(1, 4, { earliest: true, latest: true, completeness: "complete" }),
  ).reason, "history-message-deleted");
});

test("repeated message text is merged by stable message id rather than text", () => {
  const repeated = (message) => ({ ...message, parts: [{ type: "text", text: "相同文字" }] });
  const first = conversation(1, 4, { mutate: repeated });
  const second = conversation(3, 6, { mutate: repeated });
  const result = reconcileCapturedConversations(first, second);
  assert.equal(result.relation, "safe_merge");
  assert.deepEqual(result.conversation.messages.map((message) => message.sourceMessageId), ["M1", "M2", "M3", "M4", "M5", "M6"]);
});

test("partial to partial to authoritative export becomes complete", () => {
  const firstMerge = reconcileCapturedConversations(
    conversation(50, 100, { latest: true }),
    conversation(30, 70),
  );
  const completed = reconcileCapturedConversations(
    firstMerge.conversation,
    conversation(1, 100, {
      adapter: "chatgpt-export-v1",
      earliest: true,
      latest: true,
      completeness: "complete",
    }),
  );
  assert.equal(completed.relation, "safe_merge");
  assert.equal(completed.conversation.completeness, "complete");
  assert.equal(completed.conversation.messages.length, 100);
  assert.equal(completed.conversation.captureAdapter, "chatgpt-export-v1");
});

test("authoritative export followed by a browser subset is up to date; overlap conflict remains blocked", () => {
  const exported = conversation(1, 100, {
    adapter: "chatgpt-export-v1",
    earliest: true,
    latest: true,
    completeness: "complete",
  });
  const subset = reconcileCapturedConversations(exported, conversation(50, 100, { latest: true }));
  assert.equal(subset.relation, "identical");
  assert.equal(subset.conversation.messages.length, 100);
  assert.equal(subset.conversation.completeness, "complete");
  const conflictingExport = conversation(1, 100, {
    adapter: "chatgpt-export-v1",
    earliest: true,
    latest: true,
    completeness: "complete",
    mutate: (message, number) => number === 75
      ? { ...message, parts: [{ type: "text", text: "导出内容冲突" }] }
      : message,
  });
  assert.equal(reconcileCapturedConversations(conversation(50, 100), conflictingExport).reason, "message-content-changed");
});

test("boundary flags never become complete from message count alone", () => {
  const result = reconcileCapturedConversations(conversation(1, 100), conversation(50, 120, { latest: true }));
  assert.equal(result.relation, "safe_merge");
  assert.equal(result.conversation.completeness, "partial");
  assert.equal(result.coverage.earliestBoundaryConfirmed, false);
  assert.equal(result.coverage.latestBoundaryConfirmed, true);
});
