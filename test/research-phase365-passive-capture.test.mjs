import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PageDataAccumulator,
  crossCheckDomMessages,
  paginationProgress,
  passiveHistoryState,
  projectVisibleMessages,
  resolveActivePath,
} from "../shared/chatgpt-page-data-domain.mjs";

function node(messageId, parentId, role = "assistant", text = messageId, extra = {}) {
  return {
    messageId,
    parentId,
    parentKnown: true,
    role,
    nodeType: role,
    parts: text ? [{ type: "text", text }] : [],
    occurredAt: null,
    visibleContentOmitted: false,
    ...extra,
  };
}

function batch(number, nodes, {
  currentNode = nodes.at(-1)?.messageId ?? null,
  hasPreviousPage = true,
  cursor = `cursor-${number}`,
  conversationId = "conversation-passive",
} = {}) {
  return {
    schemaVersion: "chatgpt-page-data-v1",
    batchId: `session:${number}`,
    conversationId,
    currentNode,
    nodes,
    pageInfo: { hasPreviousPage, startCursor: cursor, endCursor: null, before: null, previousCursor: null },
  };
}

test("DOM stability does not exhaust passive history while has_previous_page remains true", () => {
  const accumulator = new PageDataAccumulator("conversation-passive");
  accumulator.ingest(batch(1, [node("M3", "M2")], { hasPreviousPage: true }));
  assert.deepEqual(passiveHistoryState(accumulator.snapshot()), { state: "continue", reason: null });
  assert.equal(accumulator.snapshot().hasPreviousPage, true);
});

test("has_previous_page false is the explicit passive history exhaustion proof", () => {
  const accumulator = new PageDataAccumulator("conversation-passive");
  accumulator.ingest(batch(1, [node("M1", null, "user")], { hasPreviousPage: false }));
  assert.deepEqual(passiveHistoryState(accumulator.snapshot()), { state: "exhausted", reason: null });
});

test("pagination cursor and node progression are distinguished from stalls and loops", () => {
  const accumulator = new PageDataAccumulator("conversation-passive");
  accumulator.ingest(batch(1, [node("M3", "M2")], { cursor: "cursor-newest" }));
  const before = accumulator.snapshot();
  accumulator.ingest(batch(2, [node("M2", "M1")], { cursor: "cursor-older" }));
  const progress = paginationProgress(before, accumulator.snapshot());
  assert.equal(progress.progressed, true);
  assert.equal(progress.cursorChanged, true);
  assert.equal(progress.newNodeCount, 1);
  assert.equal(passiveHistoryState(accumulator.snapshot(), { stalled: true }).reason, "history_loading_stalled");
  assert.equal(passiveHistoryState(accumulator.snapshot(), { cursorLoop: true }).reason, "pagination_loop_detected");
});

test("multiple chunks merge by message.id and internal nodes bridge current_node to the first user", () => {
  const accumulator = new PageDataAccumulator("conversation-passive");
  accumulator.ingest(batch(1, [
    node("M3", "I2", "assistant", "最终回答"),
    node("I2", "M1", "assistant", "内部推理", { nodeType: "thoughts" }),
  ], { currentNode: "M3", cursor: "cursor-newer" }));
  accumulator.ingest(batch(2, [
    node("M1", "ROOT", "user", "第一个问题"),
    node("ROOT", null, "system", "", { nodeType: "system" }),
  ], { currentNode: "M3", cursor: "cursor-root", hasPreviousPage: false }));
  const graph = resolveActivePath(accumulator, "M3");
  assert.equal(graph.conversationRootConfirmed, true);
  assert.equal(graph.pathLength, 4);
  assert.equal(graph.missingParentCount, 0);
  assert.equal(graph.cycleCount, 0);
  assert.equal(graph.firstUserConfirmed, true);
  assert.deepEqual(projectVisibleMessages(graph.path).map((message) => message.sourceMessageId), ["M1", "M3"]);
});

test("older pagination current_node does not replace the full active leaf", () => {
  const accumulator = new PageDataAccumulator("conversation-passive");
  accumulator.ingest(batch(1, [node("M3", "M2", "assistant", "最新回答")], { currentNode: "M3" }));
  accumulator.ingest(batch(2, [
    node("M2", "M1", "assistant", "较早回答"),
    node("M1", null, "user", "第一个问题"),
  ], { currentNode: "M1", hasPreviousPage: false }));
  const graph = resolveActivePath(accumulator);
  assert.equal(graph.activeLeaf, "M3");
  assert.equal(graph.pathLength, 3);
  assert.equal(graph.conversationRootConfirmed, true);
});

test("graph node identity may differ from the source message identity", () => {
  const accumulator = new PageDataAccumulator("conversation-passive");
  accumulator.ingest(batch(1, [
    node("NODE_ROOT", null, "system", "", { nodeType: "system", sourceMessageId: "MSG_ROOT" }),
    node("NODE_USER", "MSG_ROOT", "user", "问题", { sourceMessageId: "MSG_USER" }),
    node("NODE_REPLY", "MSG_USER", "assistant", "回答", { sourceMessageId: "MSG_REPLY" }),
  ], { currentNode: "MSG_REPLY", hasPreviousPage: false }));
  const graph = resolveActivePath(accumulator, "MSG_REPLY");
  assert.equal(graph.activeLeaf, "NODE_REPLY");
  assert.equal(graph.conversationRootConfirmed, true);
  assert.deepEqual(projectVisibleMessages(graph.path).map((message) => message.sourceMessageId), ["MSG_USER", "MSG_REPLY"]);
});

test("missing parent, cycle, self-parent and ambiguous active leaves cannot confirm a root", () => {
  const missing = new PageDataAccumulator("conversation-passive");
  missing.ingest(batch(1, [node("M3", "missing")], { currentNode: "M3" }));
  assert.equal(resolveActivePath(missing).missingParentCount, 1);

  const cycle = new PageDataAccumulator("conversation-passive");
  cycle.ingest(batch(1, [node("M1", "M2", "user"), node("M2", "M1")], { currentNode: "M2" }));
  assert.equal(resolveActivePath(cycle).cycleCount, 1);

  const self = new PageDataAccumulator("conversation-passive");
  self.ingest(batch(1, [node("M1", "M1", "user")], { currentNode: "M1" }));
  assert.equal(resolveActivePath(self).selfParentCount, 1);

  const branch = new PageDataAccumulator("conversation-passive");
  branch.ingest(batch(1, [node("ROOT", null, "system", ""), node("A", "ROOT", "user")], { currentNode: "A" }));
  branch.ingest(batch(2, [node("B", "ROOT", "assistant")], { currentNode: "B" }));
  assert.equal(resolveActivePath(branch).branchAmbiguityCount, 1);
});

test("conflicting page data is recorded instead of silently overwriting", () => {
  const accumulator = new PageDataAccumulator("conversation-passive");
  accumulator.ingest(batch(1, [node("M1", null, "user", "原文")], { hasPreviousPage: false }));
  accumulator.ingest(batch(2, [node("M1", null, "user", "被改写")], { hasPreviousPage: false }));
  assert.equal(accumulator.pageDataConflicts.size, 1);
});

test("DOM cross-check normalizes Markdown presentation but detects real content changes", () => {
  const graph = [{
    order: 0, role: "assistant", sourceMessageId: "M1", occurredAt: null,
    parts: [{ type: "text", text: "**结论**\n\n- 第一项" }], fingerprint: "graph",
  }];
  const sameDom = [{ ...graph[0], parts: [{ type: "text", text: "结论\n第一项" }], fingerprint: "dom" }];
  assert.deepEqual(crossCheckDomMessages(sameDom, graph), { matchedCount: 1, unmatchedCount: 0, fingerprintMismatchCount: 0 });
  const changedDom = [{ ...sameDom[0], parts: [{ type: "text", text: "不同结论" }] }];
  assert.equal(crossCheckDomMessages(changedDom, graph).fingerprintMismatchCount, 1);
});

test("MAIN-world observer and isolated bridge expose only normalized page-data batches", async () => {
  const observer = await readFile(new URL("../extensions/research-os-chrome/src/page/page-data-observer.ts", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../extensions/research-os-chrome/src/content/page-data-bridge.ts", import.meta.url), "utf8");
  assert.match(observer, /response\.clone\(\)/);
  assert.match(observer, /relationId\(fallbackId\).*relationId\(message\?\.id\)/s);
  assert.match(observer, /objectValue\(message\?\.metadata\).*parent_id/s);
  assert.match(observer, /research-os-page-data-v1/);
  assert.doesNotMatch(observer, /document\.cookie|authorization/i);
  assert.match(bridge, /validBatch/);
  assert.match(bridge, /event\.origin !== location\.origin/);
  assert.doesNotMatch(bridge, /Raw Response|requestHeaders|cookie/i);
});
