import {
  PageDataAccumulator,
  auditOrderedHistory,
  crossCheckDomMessages,
  historyRetryDecision,
  paginationProgress,
  projectOrderedVisibleMessages,
  resolveActivePath,
  visibleConversationComplete,
} from "../../../../shared/chatgpt-page-data-domain.mjs";
import {
  collectVisibleMessages,
  conversationIdentity,
  findScrollContainer,
  hasBranchControls,
  hasUnexpandedContent,
  isLoadingOlderMessages,
  messageNodes,
  pageIsSupported,
} from "../adapters/chatgpt-browser-v1";
import type { CapturedConversation, CapturedMessage, CaptureProgress } from "../model/captured-conversation";

let activeController: AbortController | null = null;

declare global {
  interface Window {
    __researchOsCaptureControllerInstalled?: boolean;
  }
}

function sendProgress(progress: CaptureProgress) {
  void chrome.runtime.sendMessage({ type: "capture-progress", progress });
}

function key(message: CapturedMessage) {
  return message.sourceMessageId ? `id:${message.sourceMessageId}` : `fp:${message.fingerprint}`;
}

function mergeSequence(current: CapturedMessage[], incoming: CapturedMessage[]) {
  if (current.length === 0) return incoming;
  if (incoming.length === 0) return current;
  const currentKeys = current.map(key);
  const incomingKeys = incoming.map(key);
  const currentIndex = new Map(currentKeys.map((value, index) => [value, index]));
  const incomingIndex = new Map(incomingKeys.map((value, index) => [value, index]));
  const anchors = currentKeys.filter((value) => incomingIndex.has(value));
  if (anchors.length === 0) return [...incoming, ...current];
  const incomingAnchors = incomingKeys.filter((value) => currentIndex.has(value));
  if (anchors.some((value, index) => incomingAnchors[index] !== value)) return current;
  const merged: CapturedMessage[] = [];
  let currentCursor = 0;
  let incomingCursor = 0;
  for (const anchor of anchors) {
    const currentAnchor = currentIndex.get(anchor)!;
    const incomingAnchor = incomingIndex.get(anchor)!;
    const currentGap = current.slice(currentCursor, currentAnchor);
    const incomingGap = incoming.slice(incomingCursor, incomingAnchor);
    if (currentGap.length > 0 && incomingGap.length > 0) return current;
    merged.push(...(incomingGap.length > 0 ? incomingGap : currentGap));
    merged.push(incoming[incomingAnchor]);
    currentCursor = currentAnchor + 1;
    incomingCursor = incomingAnchor + 1;
  }
  const currentTail = current.slice(currentCursor);
  const incomingTail = incoming.slice(incomingCursor);
  if (currentTail.length > 0 && incomingTail.length > 0) return current;
  return [...merged, ...(incomingTail.length > 0 ? incomingTail : currentTail)];
}

function unsupportedCounts(messages: CapturedMessage[]) {
  const counts = { image: 0, video: 0, audio: 0, file: 0, canvas: 0, "tool-ui": 0, unknown: 0 };
  for (const message of messages) for (const part of message.parts) {
    if (part.type === "media-placeholder") counts[part.mediaType ?? "unknown"] += 1;
  }
  return counts;
}

function withoutComparisonText(message: CapturedMessage): CapturedMessage {
  const {
    comparisonText: _comparisonText,
    diagnosticMessageHash: _diagnosticMessageHash,
    diagnosticStructure: _diagnosticStructure,
    diagnosticContentKind: _diagnosticContentKind,
    ...captured
  } = message;
  return captured;
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      window.clearTimeout(timer);
      reject(new DOMException("Capture cancelled", "AbortError"));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function waitForSettledMutation(container: HTMLElement, signal: AbortSignal, hardLimitMs = 2_500) {
  return new Promise<void>((resolve, reject) => {
    let settleTimer = window.setTimeout(done, 700);
    const hardTimer = window.setTimeout(done, hardLimitMs);
    const observer = new MutationObserver(() => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(done, 700);
    });
    function done() {
      observer.disconnect();
      window.clearTimeout(settleTimer);
      window.clearTimeout(hardTimer);
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      observer.disconnect();
      window.clearTimeout(settleTimer);
      window.clearTimeout(hardTimer);
      reject(new DOMException("Capture cancelled", "AbortError"));
    }
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function triggerOlderHistory(container: HTMLElement, signal: AbortSignal, attempt = 0) {
  if (container.scrollTop <= 2 && container.scrollHeight > container.clientHeight + 80) {
    container.scrollTo({ top: Math.min(320, container.scrollHeight - container.clientHeight), behavior: "auto" });
    await delay(90, signal);
  }
  messageNodes()[0]?.scrollIntoView({ block: attempt > 0 ? "center" : "start", behavior: "auto" });
  container.scrollTo({ top: 0, behavior: "auto" });
  container.dispatchEvent(new Event("scroll", { bubbles: true }));
  if (attempt > 0) {
    await delay(120 * attempt, signal);
    container.scrollBy({ top: 1, behavior: "auto" });
    container.scrollTo({ top: 0, behavior: "auto" });
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
}

async function waitForInitialPageData(sessionId: string, signal: AbortSignal) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
    const bridge = window.__researchOsPageDataBridge;
    if (bridge?.sessionId === sessionId) {
      const snapshot = bridge.snapshot();
      if (snapshot.batches.length > 0) return bridge;
      await bridge.waitForChange(snapshot.version, Math.min(1_500, deadline - Date.now()));
    } else {
      await delay(250, signal);
    }
  }
  return null;
}

function restoreReadingPosition(container: HTMLElement, anchorId: string | null, anchorOffset: number, originalScrollTop: number) {
  const restoredAnchor = anchorId
    ? messageNodes().find((node) => node.dataset.messageId === anchorId || node.getAttribute("data-message-id") === anchorId || node.id === anchorId)
    : null;
  if (restoredAnchor) {
    restoredAnchor.scrollIntoView({ block: "start" });
    container.scrollBy({ top: -anchorOffset, behavior: "auto" });
  } else {
    container.scrollTo({ top: originalScrollTop, behavior: "auto" });
  }
}

async function captureDomFallback(signal: AbortSignal, fallbackReason: string): Promise<CapturedConversation> {
  const initialIdentity = conversationIdentity();
  const container = findScrollContainer();
  let sequence: CapturedMessage[] = [];
  let stablePasses = 0;
  let lastScrollHeight = -1;
  const deadline = Date.now() + 45_000;
  for (let round = 0; round < 40 && Date.now() < deadline; round += 1) {
    const scan = collectVisibleMessages();
    const before = sequence.length;
    sequence = mergeSequence(sequence, scan.messages).map((message, order) => ({ ...message, order }));
    sendProgress({ phase: round === 0 ? "reading" : "loading-older", message: `页面数据不可用，使用可见窗口读取… 已发现 ${sequence.length} 条`, discovered: sequence.length });
    container.scrollTo({ top: 0, behavior: "auto" });
    await waitForSettledMutation(container, signal);
    const sameHeight = Math.abs(container.scrollHeight - lastScrollHeight) <= 2;
    stablePasses = container.scrollTop <= 2 && !isLoadingOlderMessages() && sameHeight && sequence.length === before ? stablePasses + 1 : 0;
    lastScrollHeight = container.scrollHeight;
    if (stablePasses >= 3) break;
  }
  const identity = conversationIdentity();
  const unsupportedContentCounts = unsupportedCounts(sequence);
  const unsupportedContentCount = Object.values(unsupportedContentCounts).reduce((sum, count) => sum + count, 0);
  return {
    schemaVersion: "captured-conversation-v1",
    provider: "chatgpt",
    captureAdapter: "chatgpt-browser-v1",
    externalConversationId: identity.externalConversationId,
    title: identity.title,
    sourceUrl: identity.sourceUrl,
    capturedAt: new Date().toISOString(),
    branchScope: "active-visible-branch",
    completeness: "partial",
    completenessDetails: {
      topBoundaryConfirmed: container.scrollTop <= 2,
      windowTopConfirmed: container.scrollTop <= 2,
      conversationRootConfirmed: false,
      earliestBoundaryConfirmed: false,
      latestBoundaryConfirmed: false,
      stablePasses,
      loadingAbsent: !isLoadingOlderMessages(),
      conversationIdStable: initialIdentity.externalConversationId !== null && initialIdentity.externalConversationId === identity.externalConversationId,
      unresolvedBranches: hasBranchControls() || sequence.some((message) => message.role === "unknown"),
      messageOmissionCount: 0,
      unsupportedContentCounts,
      unsupportedContentCount,
      reasons: [fallbackReason, "earliest-boundary-unconfirmed", "passive-history-unproven"],
      passiveDataAvailable: false,
      hasPreviousPageFinal: null,
      passiveHistoryExhausted: false,
      fallbackUsed: true,
    },
    messages: sequence.map(withoutComparisonText),
    captureStats: { discoveredMessageCount: sequence.length, messageOmissionCount: 0, unsupportedContentCounts, unsupportedContentCount },
  };
}

async function capturePassive(sessionId: string, signal: AbortSignal): Promise<CapturedConversation> {
  const startedAt = Date.now();
  const initialIdentity = conversationIdentity();
  const container = findScrollContainer();
  const originalScrollTop = container.scrollTop;
  const originalScrollHeight = container.scrollHeight;
  const anchor = messageNodes().find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  const anchorId = anchor?.dataset.messageId ?? anchor?.getAttribute("data-message-id") ?? anchor?.id ?? null;
  const anchorOffset = anchor?.getBoundingClientRect().top ?? 0;
  const latestBoundaryConfirmed = originalScrollTop + container.clientHeight >= originalScrollHeight - Math.max(200, container.clientHeight * 0.25);
  let domSequence: CapturedMessage[] = collectVisibleMessages().messages;
  const originalDomLeafId = domSequence.at(-1)?.sourceMessageId ?? null;
  const bridge = await waitForInitialPageData(sessionId, signal);
  if (!bridge) return captureDomFallback(signal, "passive-page-data-unavailable");

  const accumulator = new PageDataAccumulator(initialIdentity.externalConversationId);
  accumulator.ingestAll(bridge.snapshot().batches);
  let passiveHistoryStalled = false;
  let paginationLoopDetected = false;
  let stallAttempts = 0;
  let repeatedCursorAttempts = 0;
  const seenCursors = new Set<string>();
  const firstCursor = accumulator.snapshot().cursor;
  if (firstCursor) seenCursors.add(firstCursor);
  const deadline = Date.now() + 180_000;
  try {
    while (accumulator.snapshot().hasPreviousPage === true && Date.now() < deadline) {
      if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
      const before = accumulator.snapshot();
      const bridgeBefore = bridge.snapshot();
      sendProgress({ phase: "loading-older", message: `正在加载更早历史… 已读取 ${before.nodeCount} 个对话节点`, discovered: before.nodeCount });
      const passiveWait = bridge.waitForChange(bridgeBefore.version, 10_000);
      await triggerOlderHistory(container, signal, stallAttempts);
      await Promise.all([passiveWait, waitForSettledMutation(container, signal)]);
      await delay(500, signal);
      domSequence = mergeSequence(domSequence, collectVisibleMessages().messages).map((message, order) => ({ ...message, order }));
      accumulator.ingestAll(bridge.snapshot().batches);
      const after = accumulator.snapshot();
      const progress = paginationProgress(before, after);
      if (after.hasPreviousPage === false) break;
      if (progress.progressed) {
        stallAttempts = 0;
        if (after.cursor && seenCursors.has(after.cursor) && progress.newNodeCount === 0) repeatedCursorAttempts += 1;
        else repeatedCursorAttempts = 0;
        if (after.cursor) seenCursors.add(after.cursor);
      } else {
        stallAttempts += 1;
        if (after.cursor && seenCursors.has(after.cursor) && progress.batchAdvanced) repeatedCursorAttempts += 1;
      }
      if (repeatedCursorAttempts >= 2) {
        paginationLoopDetected = true;
        break;
      }
      const retry = historyRetryDecision(after, { stallAttempts, elapsedMs: Date.now() - startedAt });
      if (retry.stalled) {
        passiveHistoryStalled = true;
        break;
      }
    }
    if (Date.now() >= deadline && accumulator.snapshot().hasPreviousPage === true) passiveHistoryStalled = true;
    sendProgress({ phase: "verifying", message: "正在还原对话路径并验证完整性…", discovered: accumulator.nodes.size });
    domSequence = mergeSequence(domSequence, collectVisibleMessages().messages).map((message, order) => ({ ...message, order }));
    const finalIdentity = conversationIdentity();
    const graph = resolveActivePath(accumulator, originalDomLeafId);
    const messages = projectOrderedVisibleMessages(accumulator, domSequence).map((message, order) => ({ ...message, order }));
    const domCrossCheck = crossCheckDomMessages(domSequence, messages);
    const orderedHistoryAudit = auditOrderedHistory(accumulator, domSequence);
    const finalPage = accumulator.snapshot();
    const passiveHistoryExhausted = finalPage.hasPreviousPage === false;
    const conversationIdStable = initialIdentity.externalConversationId !== null
      && initialIdentity.externalConversationId === finalIdentity.externalConversationId
      && accumulator.crossConversationResponses === 0;
    const messageOmissionCount = [...accumulator.nodes.values()].filter((node) => (node.role === "user" || node.role === "assistant") && node.visibleContentOmitted).length;
    const unresolvedBranches = graph.branchAmbiguityCount > 0;
    const unsupportedContentCounts = unsupportedCounts(messages);
    const unsupportedContentCount = Object.values(unsupportedContentCounts).reduce((sum, count) => sum + count, 0);
    const reasons: string[] = [];
    if (!passiveHistoryExhausted) reasons.push("passive-history-unproven");
    if (passiveHistoryStalled) reasons.push("history_loading_stalled");
    if (paginationLoopDetected) reasons.push("pagination_loop_detected");
    if (!graph.activeLeafConfirmed) reasons.push("active-leaf-unconfirmed");
    if (!graph.conversationRootConfirmed) reasons.push("earliest-boundary-unconfirmed");
    if (graph.missingParentCount > 0) reasons.push("graph-missing-parent");
    if (graph.cycleCount > 0) reasons.push("graph-cycle-detected");
    if (graph.parentConflictCount > 0) reasons.push("graph-parent-conflict");
    if (graph.pageDataConflictCount > 0) reasons.push("PAGE_DATA_CONFLICT");
    if (graph.branchAmbiguityCount > 0) reasons.push("active-branch-ambiguous");
    if (!graph.firstUserConfirmed) reasons.push("first-user-unconfirmed");
    if (
      orderedHistoryAudit.domUnmatchedCount > 0
      || orderedHistoryAudit.domOrderingMismatchCount > 0
      || orderedHistoryAudit.domRealTextMismatchCount > 0
    ) reasons.push("dom-cross-check-failed");
    if (messageOmissionCount > 0) reasons.push("text-message-omission");
    if (!latestBoundaryConfirmed) reasons.push("latest-boundary-unconfirmed");
    if (!conversationIdStable) reasons.push("conversation-id-not-stable");
    if (hasUnexpandedContent()) reasons.push("unexpanded-content-remains");
    if (unsupportedContentCount > 0) reasons.push("unsupported-content-present");
    const loadingAbsent = !isLoadingOlderMessages();
    if (!loadingAbsent) reasons.push("older-content-still-loading");
    const completeness = reasons.length === 0 ? "complete" : "partial";
    const orderedVisibleIdentities = messages.map((message) => message.sourceMessageId).filter(Boolean);
    const activeBranchUniquelyValidated = orderedHistoryAudit.branchScoped === true
      && orderedHistoryAudit.visibleBranchPointCount === 0
      && graph.branchAmbiguityCount === 0;
    const textTranscriptComplete = visibleConversationComplete({
      conversationIdStable,
      passiveHistoryExhausted,
      hasPreviousPageFinal: finalPage.hasPreviousPage,
      pageOrderValidated: orderedHistoryAudit.pageOrderValidated,
      itemOrderValidated: orderedHistoryAudit.itemOrderValidated,
      activeBranchUniquelyValidated,
      firstVisibleUserFound: orderedHistoryAudit.firstVisibleUserFound,
      paginationGapCount: orderedHistoryAudit.pageTimeOrderViolationCount,
      paginationLoopDetected,
      pageDataConflictCount: graph.pageDataConflictCount,
      orderedVisibleIdentityStable: orderedVisibleIdentities.length === messages.length
        && new Set(orderedVisibleIdentities).size === messages.length,
      domUnmatchedCount: orderedHistoryAudit.domUnmatchedCount,
      domOrderingMismatchCount: orderedHistoryAudit.domOrderingMismatchCount,
      domRealTextMismatchCount: orderedHistoryAudit.domRealTextMismatchCount,
      confirmedTextMessageOmissionCount: messageOmissionCount,
      adapterHealthy: pageIsSupported(),
    });
    const richContentComplete = textTranscriptComplete && unsupportedContentCount === 0 && !hasUnexpandedContent();
    return {
      schemaVersion: "captured-conversation-v1",
      provider: "chatgpt",
      captureAdapter: "chatgpt-browser-v1",
      externalConversationId: finalIdentity.externalConversationId,
      title: finalIdentity.title,
      sourceUrl: finalIdentity.sourceUrl,
      capturedAt: new Date().toISOString(),
      branchScope: "active-visible-branch",
      completeness,
      completenessDetails: {
        topBoundaryConfirmed: passiveHistoryExhausted,
        windowTopConfirmed: container.scrollTop <= 2,
        conversationRootConfirmed: graph.conversationRootConfirmed,
        earliestBoundaryConfirmed: passiveHistoryExhausted && graph.conversationRootConfirmed,
        latestBoundaryConfirmed,
        stablePasses: stallAttempts,
        loadingAbsent,
        conversationIdStable,
        unresolvedBranches,
        messageOmissionCount,
        unsupportedContentCounts,
        unsupportedContentCount,
        reasons,
        passiveDataAvailable: true,
        initialPassiveNodeCount: accumulator.initialPassiveNodeCount,
        historyPagesLoaded: accumulator.historyPagesLoaded,
        passiveNodeProgression: accumulator.nodeProgression,
        finalGraphNodeCount: accumulator.nodes.size,
        visibleMessageCount: messages.length,
        hasPreviousPageFinal: finalPage.hasPreviousPage,
        passiveHistoryExhausted,
        passiveHistoryStalled,
        paginationLoopDetected,
        activeLeafConfirmed: graph.activeLeafConfirmed,
        activePathLength: graph.pathLength,
        missingParentCount: graph.missingParentCount,
        cycleCount: graph.cycleCount,
        parentConflictCount: graph.parentConflictCount,
        pageDataConflictCount: graph.pageDataConflictCount,
        firstUserConfirmed: graph.firstUserConfirmed,
        domMatchedCount: domCrossCheck.matchedCount,
        domUnmatchedCount: domCrossCheck.unmatchedCount,
        domFingerprintMismatchCount: domCrossCheck.fingerprintMismatchCount,
        domFormattingOnlyMismatchCount: orderedHistoryAudit.domFormattingOnlyMismatchCount,
        domCitationOnlyMismatchCount: orderedHistoryAudit.domCitationOnlyMismatchCount,
        domToolUiOnlyMismatchCount: orderedHistoryAudit.domToolUiOnlyMismatchCount,
        domRealTextMismatchCount: orderedHistoryAudit.domRealTextMismatchCount,
        activeBranchUniquelyValidated,
        orderedVisibleIdentityStable: orderedVisibleIdentities.length === messages.length
          && new Set(orderedVisibleIdentities).size === messages.length,
        textTranscriptComplete,
        richContentComplete,
        visibleConversationComplete: textTranscriptComplete,
        passiveCaptureDurationMs: Date.now() - startedAt,
        fallbackUsed: false,
        orderedHistoryAudit,
      },
      messages,
      captureStats: { discoveredMessageCount: messages.length, messageOmissionCount, unsupportedContentCounts, unsupportedContentCount },
    };
  } finally {
    restoreReadingPosition(container, anchorId, anchorOffset, originalScrollTop);
  }
}

async function capture(sessionId: string, signal: AbortSignal) {
  const readinessDeadline = Date.now() + 30_000;
  while (!pageIsSupported() && Date.now() < readinessDeadline) {
    sendProgress({ phase: "reading", message: "正在等待 ChatGPT 对话加载…", discovered: 0 });
    await delay(250, signal);
  }
  if (!pageIsSupported()) throw new Error("ChatGPT 对话加载超时，请确认对话内容已经显示后重试。");
  return capturePassive(sessionId, signal);
}

if (!window.__researchOsCaptureControllerInstalled) {
  window.__researchOsCaptureControllerInstalled = true;
  chrome.runtime.onMessage.addListener((request: any, _sender: any, sendResponse: (value: unknown) => void) => {
    if (request?.type === "cancel-capture") {
      activeController?.abort();
      sendResponse({ ok: true });
      return;
    }
    if (request?.type !== "start-capture") return;
    if (activeController) {
      sendResponse({ ok: false, error: "当前页面已有捕获正在进行。" });
      return;
    }
    if (typeof request.sessionId !== "string") {
      sendResponse({ ok: false, error: "捕获会话无效，请重新开始。" });
      return;
    }
    activeController = new AbortController();
    capture(request.sessionId, activeController.signal)
      .then((conversation) => chrome.runtime.sendMessage({ type: "capture-result", conversation }))
      .catch((error) => {
        const cancelled = error instanceof DOMException && error.name === "AbortError";
        void chrome.runtime.sendMessage({ type: cancelled ? "capture-cancelled" : "capture-failed", error: cancelled ? "捕获已取消。" : error instanceof Error ? error.message : String(error) });
      })
      .finally(() => { activeController = null; });
    sendResponse({ ok: true });
    return true;
  });
}
