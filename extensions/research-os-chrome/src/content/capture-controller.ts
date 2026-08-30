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
  const containsCurrent = incomingKeys.some((_, start) => (
    start + currentKeys.length <= incomingKeys.length
      && currentKeys.every((value, offset) => incomingKeys[start + offset] === value)
  ));
  if (containsCurrent) return incoming;
  let best = 0;
  for (let size = Math.min(current.length, incoming.length); size > 0; size -= 1) {
    if (incomingKeys.slice(-size).every((value, index) => value === currentKeys[index])) {
      best = size;
      break;
    }
  }
  if (best > 0) return [...incoming, ...current.slice(best)];
  for (let size = Math.min(current.length, incoming.length); size > 0; size -= 1) {
    if (currentKeys.slice(-size).every((value, index) => value === incomingKeys[index])) {
      return [...current, ...incoming.slice(size)];
    }
  }
  const knownIds = new Set(current.filter((message) => message.sourceMessageId).map(key));
  return [...incoming.filter((message) => !message.sourceMessageId || !knownIds.has(key(message))), ...current];
}

function waitForSettledMutation(container: HTMLElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let settleTimer = window.setTimeout(done, 700);
    const hardTimer = window.setTimeout(done, 2400);
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

async function capture(signal: AbortSignal): Promise<CapturedConversation> {
  if (!pageIsSupported()) throw new Error("当前页面不是可读取的 ChatGPT 对话，请打开普通对话或 Project 内对话后再捕获。");
  const initialIdentity = conversationIdentity();
  const container = findScrollContainer();
  const anchor = messageNodes().find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  const anchorId = anchor?.dataset.messageId ?? anchor?.getAttribute("data-message-id") ?? anchor?.id ?? null;
  const anchorOffset = anchor?.getBoundingClientRect().top ?? 0;
  const originalScrollTop = container.scrollTop;
  let sequence: CapturedMessage[] = [];
  let unsupportedContentCount = 0;
  let stablePasses = 0;
  let lastScrollHeight = -1;
  const deadline = Date.now() + 90_000;
  try {
    for (let round = 0; round < 120 && Date.now() < deadline; round += 1) {
      if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
      const scan = collectVisibleMessages();
      const before = sequence.length;
      sequence = mergeSequence(sequence, scan.messages);
      unsupportedContentCount = Math.max(unsupportedContentCount, scan.unsupportedContentCount);
      sequence = sequence.map((message, order) => ({ ...message, order }));
      sendProgress({
        phase: round === 0 ? "reading" : "loading-older",
        message: round === 0 ? "正在读取当前对话…" : `正在加载更早内容… 已发现 ${sequence.length} 条`,
        discovered: sequence.length,
      });
      container.scrollTo({ top: 0, behavior: "auto" });
      await waitForSettledMutation(container, signal);
      const top = container.scrollTop <= 2;
      const loading = isLoadingOlderMessages();
      const sameHeight = Math.abs(container.scrollHeight - lastScrollHeight) <= 2;
      stablePasses = top && !loading && sameHeight && sequence.length === before ? stablePasses + 1 : 0;
      lastScrollHeight = container.scrollHeight;
      if (stablePasses >= 3) break;
    }
    sendProgress({ phase: "verifying", message: "正在验证完整性…", discovered: sequence.length });
    const finalScan = collectVisibleMessages();
    sequence = mergeSequence(sequence, finalScan.messages).map((message, order) => ({ ...message, order }));
    unsupportedContentCount = Math.max(unsupportedContentCount, finalScan.unsupportedContentCount);
    const finalIdentity = conversationIdentity();
    const topBoundaryConfirmed = container.scrollTop <= 2 && sequence[0]?.role === "user" && stablePasses >= 3;
    const loadingAbsent = !isLoadingOlderMessages();
    const conversationIdStable = initialIdentity.externalConversationId !== null
      && initialIdentity.externalConversationId === finalIdentity.externalConversationId;
    const unresolvedBranches = hasBranchControls() || sequence.some((message) => message.role === "unknown");
    const reasons: string[] = [];
    if (!topBoundaryConfirmed) reasons.push("无法确认已经到达对话开头");
    if (!loadingAbsent) reasons.push("页面仍显示正在加载的内容");
    if (!conversationIdStable) reasons.push("捕获期间 Conversation ID 发生变化或无法识别");
    if (unresolvedBranches) reasons.push("当前回答分支无法可靠判断");
    if (hasUnexpandedContent()) reasons.push("页面中仍有未展开内容");
    if (unsupportedContentCount > 0) reasons.push(`有 ${unsupportedContentCount} 处媒体或附件只能保存占位`);
    const completeness = reasons.length === 0 ? "complete" : "partial";
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
        topBoundaryConfirmed,
        stablePasses,
        loadingAbsent,
        conversationIdStable,
        unresolvedBranches,
        unsupportedContentCount,
        reasons,
      },
      messages: sequence,
      captureStats: { discoveredMessageCount: sequence.length, unsupportedContentCount },
    };
  } finally {
    const currentNodes = messageNodes();
    const restoredAnchor = anchorId
      ? currentNodes.find((node) => node.dataset.messageId === anchorId || node.getAttribute("data-message-id") === anchorId || node.id === anchorId)
      : null;
    if (restoredAnchor) {
      restoredAnchor.scrollIntoView({ block: "start" });
      container.scrollBy({ top: -anchorOffset, behavior: "auto" });
    } else {
      container.scrollTo({ top: originalScrollTop, behavior: "auto" });
    }
  }
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
    activeController = new AbortController();
    capture(activeController.signal)
      .then((conversation) => chrome.runtime.sendMessage({ type: "capture-result", conversation }))
      .catch((error) => {
        const cancelled = error instanceof DOMException && error.name === "AbortError";
        void chrome.runtime.sendMessage({
          type: cancelled ? "capture-cancelled" : "capture-failed",
          error: cancelled ? "捕获已取消。" : error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => { activeController = null; });
    sendResponse({ ok: true });
    return true;
  });
}
