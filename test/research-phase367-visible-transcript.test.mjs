import assert from "node:assert/strict";
import test from "node:test";

import {
  PageDataAccumulator,
  auditOrderedHistory,
  historyRetryDecision,
  normalizeVisibleContent,
  projectOrderedVisibleMessages,
  sourceContentFingerprint,
  visibleConversationComplete,
  visibleSemanticFingerprint,
} from "../shared/chatgpt-page-data-domain.mjs";
import { reconcileCapturedConversations } from "../shared/captured-conversation-domain.mjs";

function node(id, parentId, role, text, occurredAt, extra = {}) {
  return {
    messageId: id,
    sourceMessageId: id,
    parentId,
    parentKnown: true,
    role,
    nodeType: role,
    parts: text ? [{ type: "text", text }] : [],
    occurredAt,
    visibleContentOmitted: false,
    ...extra,
  };
}

function batch(sequence, nodes, { hasPreviousPage, cursor, currentNode = nodes.at(-1)?.messageId ?? null } = {}) {
  return {
    schemaVersion: "chatgpt-page-data-v1",
    batchId: `batch-${sequence}`,
    conversationId: "conversation-visible-stream",
    currentNode,
    nodes,
    pageInfo: { hasPreviousPage, startCursor: cursor, endCursor: null, before: null, previousCursor: null },
    orderedPage: {
      responseSequence: sequence,
      collection: "messages",
      cursorHash: `session:${String(sequence).padStart(8, "0")}`,
      hasPreviousPage,
      items: nodes.map((item, itemPosition) => ({
        messageId: item.messageId,
        graphNodeHash: `node-${itemPosition}`,
        messageIdHash: `message-${itemPosition}`,
        role: item.role,
        nodeType: item.nodeType,
        hasVisibleContent: item.parts.length > 0,
        createTimePresent: true,
        parentPresent: item.parentKnown,
        itemPosition,
      })),
    },
  };
}

function completeEvidence(overrides = {}) {
  return {
    conversationIdStable: true,
    passiveHistoryExhausted: true,
    hasPreviousPageFinal: false,
    pageOrderValidated: true,
    itemOrderValidated: true,
    activeBranchUniquelyValidated: true,
    firstVisibleUserFound: true,
    paginationGapCount: 0,
    paginationLoopDetected: false,
    pageDataConflictCount: 0,
    orderedVisibleIdentityStable: true,
    domUnmatchedCount: 0,
    domOrderingMismatchCount: 0,
    domRealTextMismatchCount: 0,
    confirmedTextMessageOmissionCount: 0,
    adapterHealthy: true,
    ...overrides,
  };
}

test("ordered pagination projects oldest-to-newest and dedupes overlap by stable identity", () => {
  const accumulator = new PageDataAccumulator("conversation-visible-stream");
  const m1 = node("M1", null, "user", "first", "2026-01-01T00:00:01.000Z");
  const m2 = node("M2", "M1", "assistant", "second", "2026-01-01T00:00:02.000Z");
  const m3 = node("M3", "M2", "user", "third", "2026-01-01T00:00:03.000Z");
  const m4 = node("M4", "M3", "assistant", "fourth", "2026-01-01T00:00:04.000Z");
  accumulator.ingest(batch(1, [m3, m4], { hasPreviousPage: true, cursor: "new" }));
  accumulator.ingest(batch(2, [m1, m2, m3], { hasPreviousPage: false, cursor: "old" }));
  assert.deepEqual(projectOrderedVisibleMessages(accumulator).map((message) => message.sourceMessageId), ["M1", "M2", "M3", "M4"]);
});

test("same text with different message identities remains two messages", () => {
  const accumulator = new PageDataAccumulator("conversation-visible-stream");
  const first = node("A", null, "user", "same", "2026-01-01T00:00:01.000Z");
  const second = node("B", "A", "assistant", "same", "2026-01-01T00:00:02.000Z");
  accumulator.ingest(batch(1, [first, second], { hasPreviousPage: false, cursor: "only" }));
  assert.equal(projectOrderedVisibleMessages(accumulator).length, 2);
});

test("visible projection filters internal nodes and only admits DOM-confirmed tool results", () => {
  const accumulator = new PageDataAccumulator("conversation-visible-stream");
  const user = node("U", null, "user", "question", "2026-01-01T00:00:01.000Z");
  const thought = node("T", "U", "assistant", "hidden", "2026-01-01T00:00:02.000Z", { nodeType: "thoughts" });
  const tool = node("X", "T", "tool", "visible result", "2026-01-01T00:00:03.000Z");
  const assistant = node("A", "X", "assistant", "answer", "2026-01-01T00:00:04.000Z");
  accumulator.ingest(batch(1, [user, thought, tool, assistant], { hasPreviousPage: false, cursor: "only" }));
  assert.deepEqual(projectOrderedVisibleMessages(accumulator).map((message) => message.sourceMessageId), ["U", "A"]);
  const domTool = [{ order: 0, role: "tool", sourceMessageId: "X", occurredAt: null, parts: [{ type: "text", text: "visible result" }], fingerprint: "dom" }];
  assert.deepEqual(projectOrderedVisibleMessages(accumulator, domTool).map((message) => message.sourceMessageId), ["U", "X", "A"]);
});

test("edited and regenerate fixtures project only the active page-data branch", () => {
  for (const selected of ["edited-answer", "regenerated-answer"]) {
    const accumulator = new PageDataAccumulator("conversation-visible-stream");
    const user = node("U", null, "user", "question", "2026-01-01T00:00:01.000Z");
    const answer = node(selected === "edited-answer" ? "EDITED" : "REGENERATED", "U", "assistant", selected, "2026-01-01T00:00:02.000Z");
    accumulator.ingest(batch(1, [user, answer], { hasPreviousPage: false, cursor: selected, currentNode: answer.messageId }));
    const transcript = projectOrderedVisibleMessages(accumulator);
    assert.deepEqual(transcript.map((message) => message.sourceMessageId), ["U", answer.messageId]);
    assert.equal(transcript.some((message) => message.parts[0]?.text?.includes("hidden")), false);
  }
});

test("source fingerprint preserves Markdown while semantic fingerprint normalizes rendering", () => {
  const source = "# Heading\r\n\r\n**bold** and `code` with [link](https://example.test)\n\n- item";
  const rendered = "Heading\nbold and code with link\nitem";
  assert.equal(normalizeVisibleContent(source), normalizeVisibleContent(rendered));
  assert.equal(visibleSemanticFingerprint("assistant", source), visibleSemanticFingerprint("assistant", rendered));
  assert.notEqual(sourceContentFingerprint("assistant", [{ type: "text", text: source }]), sourceContentFingerprint("assistant", [{ type: "text", text: rendered }]));
  assert.notEqual(visibleSemanticFingerprint("assistant", source), visibleSemanticFingerprint("assistant", "different"));
});

test("DOM audit separates formatting-only from real text mismatch and detects ordering", () => {
  const accumulator = new PageDataAccumulator("conversation-visible-stream");
  const user = node("U", null, "user", "# question", "2026-01-01T00:00:01.000Z");
  const answer = node("A", "U", "assistant", "**answer**", "2026-01-01T00:00:02.000Z");
  accumulator.ingest(batch(1, [user, answer], { hasPreviousPage: false, cursor: "only" }));
  const dom = [
    { order: 0, role: "user", sourceMessageId: "U", occurredAt: null, parts: [{ type: "text", text: "question" }], comparisonText: "question", fingerprint: "dom-u" },
    { order: 1, role: "assistant", sourceMessageId: "A", occurredAt: null, parts: [{ type: "text", text: "answer" }], comparisonText: "answer", fingerprint: "dom-a" },
  ];
  const formatted = auditOrderedHistory(accumulator, dom);
  assert.equal(formatted.domFormattingOnlyMismatchCount, 2);
  assert.equal(formatted.domRealTextMismatchCount, 0);
  const changed = auditOrderedHistory(accumulator, [{ ...dom[0], comparisonText: "different" }, dom[1]]);
  assert.equal(changed.domRealTextMismatchCount, 1);
  const reversed = auditOrderedHistory(accumulator, [dom[1], dom[0]]);
  assert.ok(reversed.domOrderingMismatchCount > 0 || reversed.domUnmatchedCount > 0);
});

test("DOM audit treats punctuation-only rendering of structured Markdown as formatting, not lost text", () => {
  const accumulator = new PageDataAccumulator("conversation-visible-stream");
  const source = node(
    "A",
    null,
    "assistant",
    "## Result\n\n> **Important:** use `alpha_beta()`\n\n- first\n- second",
    "2026-01-01T00:00:01.000Z",
  );
  accumulator.ingest(batch(1, [source], { hasPreviousPage: false, cursor: "only" }));
  const audit = auditOrderedHistory(accumulator, [{
    order: 0,
    role: "assistant",
    sourceMessageId: "A",
    occurredAt: null,
    parts: [{ type: "text", text: "Result Important: use alpha_beta() first second" }],
    comparisonText: "Result Important: use alpha_beta() first second",
    fingerprint: "dom-a",
  }]);
  assert.equal(audit.domFormattingOnlyMismatchCount, 1);
  assert.equal(audit.domRealTextMismatchCount, 0);
});

test("ChatGPT citation control tokens are presentation metadata while cited prose remains semantic", () => {
  const accumulator = new PageDataAccumulator("conversation-visible-stream");
  const source = node(
    "A",
    null,
    "assistant",
    "结论正文。\uE200cite\uE202turn0search0\uE202turn0search1\uE201 后续正文。",
    "2026-01-01T00:00:01.000Z",
  );
  accumulator.ingest(batch(1, [source], { hasPreviousPage: false, cursor: "only" }));
  const rendered = {
    order: 0,
    role: "assistant",
    sourceMessageId: "A",
    occurredAt: null,
    parts: [{ type: "text", text: "结论正文。 后续正文。" }],
    comparisonText: "结论正文。 后续正文。",
    fingerprint: "dom-a",
  };
  const audit = auditOrderedHistory(accumulator, [rendered]);
  assert.equal(audit.domRealTextMismatchCount, 0);
  assert.equal(audit.domCitationOnlyMismatchCount, 1);

  const changed = auditOrderedHistory(accumulator, [{ ...rendered, comparisonText: "不同正文。 后续正文。" }]);
  assert.equal(changed.domRealTextMismatchCount, 1);
});

test("DOM presentation elision keeps ordered visible text as a formatting-only difference", () => {
  const accumulator = new PageDataAccumulator("conversation-visible-stream");
  const source = node(
    "U",
    null,
    "user",
    "开头完整保留 中间折叠但源正文保留 结尾完整保留",
    "2026-01-01T00:00:01.000Z",
  );
  accumulator.ingest(batch(1, [source], { hasPreviousPage: false, cursor: "only" }));
  const audit = auditOrderedHistory(accumulator, [{
    order: 0,
    role: "user",
    sourceMessageId: "U",
    occurredAt: null,
    parts: [{ type: "text", text: "开头完整保留 结尾完整保留" }],
    comparisonText: "开头完整保留 结尾完整保留",
    fingerprint: "dom-u",
  }]);
  assert.equal(audit.domFormattingOnlyMismatchCount, 1);
  assert.equal(audit.domRealTextMismatchCount, 0);
  assert.equal(audit.mismatchProfiles[0].domIsOrderedSubset, true);
});

test("three runs produce the same ordered identity set", () => {
  const results = Array.from({ length: 3 }, () => {
    const accumulator = new PageDataAccumulator("conversation-visible-stream");
    const nodes = [
      node("U", null, "user", "question", "2026-01-01T00:00:01.000Z"),
      node("A", "U", "assistant", "answer", "2026-01-01T00:00:02.000Z"),
    ];
    accumulator.ingest(batch(1, nodes, { hasPreviousPage: false, cursor: "only" }));
    return projectOrderedVisibleMessages(accumulator).map((message) => message.sourceMessageId);
  });
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});

test("visible completeness allows internal missing parent but rejects ambiguity and DOM mismatch", () => {
  assert.equal(visibleConversationComplete(completeEvidence({ internalMissingParentCount: 1 })), true);
  assert.equal(visibleConversationComplete(completeEvidence({ activeBranchUniquelyValidated: false })), false);
  assert.equal(visibleConversationComplete(completeEvidence({ domOrderingMismatchCount: 1 })), false);
});

test("history stall retry is bounded by attempts and total duration", () => {
  const snapshot = { hasPreviousPage: true };
  assert.deepEqual(historyRetryDecision(snapshot, { stallAttempts: 2, elapsedMs: 10_000 }), { retry: true, stalled: false });
  assert.deepEqual(historyRetryDecision(snapshot, { stallAttempts: 3, elapsedMs: 10_000 }), { retry: false, stalled: true });
  assert.deepEqual(historyRetryDecision(snapshot, { stallAttempts: 0, elapsedMs: 180_000 }), { retry: false, stalled: true });
  assert.deepEqual(historyRetryDecision({ hasPreviousPage: false }), { retry: false, stalled: false });
});

test("progressive merge and authoritative ZIP completeness remain intact", () => {
  const message = (id, role, text, order) => ({ sourceMessageId: id, role, parts: [{ type: "text", text }], order, occurredAt: null });
  const previous = { captureAdapter: "chatgpt-browser-v1", completeness: "partial", capturedAt: "2026-01-01T00:00:00.000Z", messages: [message("1", "user", "one", 0)], completenessDetails: {}, captureStats: {} };
  const incoming = { ...previous, capturedAt: "2026-01-02T00:00:00.000Z", messages: [message("1", "user", "one", 0), message("2", "assistant", "two", 1)] };
  assert.equal(reconcileCapturedConversations(previous, incoming).relation, "safe_merge");
  const zip = { ...incoming, captureAdapter: "chatgpt-export-v1", completeness: "complete", completenessDetails: { earliestBoundaryConfirmed: true, latestBoundaryConfirmed: true }, captureStats: {} };
  assert.equal(reconcileCapturedConversations(incoming, zip).conversation.completeness, "complete");
});
