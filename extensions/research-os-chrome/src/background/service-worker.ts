import { pairResearchOs, sendConversationToPreview } from "../local/research-os-client";
import {
  DEFAULT_RESEARCH_OS_BASE_URL,
  normalizeResearchOsBaseUrl,
} from "../local/research-os-endpoint";
import type { CapturedConversation, CaptureProgress } from "../model/captured-conversation";
import { parseChatGptConversationUrl } from "../model/chatgpt-conversation-url";

type ExtensionState = {
  phase: "idle" | "capturing" | "sending" | "complete" | "failed" | "cancelled";
  message: string;
  discovered: number;
  tabId: number | null;
};

type PendingCapture = {
  tabId: number;
  sessionId: string;
  conversationId: string;
  armedAt: number;
  started: boolean;
};

const idleState: ExtensionState = { phase: "idle", message: "打开一条 ChatGPT 对话后开始捕获。", discovered: 0, tabId: null };

async function setState(state: ExtensionState) {
  await chrome.storage.session.set({ captureState: state });
}

async function pairedToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get("researchOsCaptureToken");
  return typeof stored.researchOsCaptureToken === "string" ? stored.researchOsCaptureToken : null;
}

async function researchOsBaseUrl() {
  const stored = await chrome.storage.local.get("researchOsBaseUrl");
  return normalizeResearchOsBaseUrl(
    typeof stored.researchOsBaseUrl === "string"
      ? stored.researchOsBaseUrl
      : DEFAULT_RESEARCH_OS_BASE_URL,
  );
}

async function setResearchOsBaseUrl(value: string) {
  const next = normalizeResearchOsBaseUrl(value);
  const current = await researchOsBaseUrl();
  if (next !== current) await chrome.storage.local.remove("researchOsCaptureToken");
  await chrome.storage.local.set({ researchOsBaseUrl: next });
  return next;
}

async function clearPendingCapture() {
  await chrome.storage.session.remove("pendingPassiveCapture");
}

async function beginCaptureAfterReload(pending: PendingCapture) {
  if (pending.started || Date.now() - pending.armedAt > 5 * 60_000) return;
  await chrome.storage.session.set({ pendingPassiveCapture: { ...pending, started: true } });
  await chrome.scripting.executeScript({ target: { tabId: pending.tabId }, files: ["capture-content.js"] });
  await chrome.tabs.sendMessage(pending.tabId, { type: "start-capture", sessionId: pending.sessionId });
}

chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { status?: string }) => {
  if (changeInfo.status !== "complete") return;
  void chrome.storage.session.get("pendingPassiveCapture").then(async ({ pendingPassiveCapture }: { pendingPassiveCapture?: unknown }) => {
    const pending = pendingPassiveCapture as PendingCapture | undefined;
    if (!pending || pending.tabId !== tabId) return;
    try {
      await beginCaptureAfterReload(pending);
    } catch (error) {
      await clearPendingCapture();
      await setState({ phase: "failed", message: error instanceof Error ? error.message : String(error), discovered: 0, tabId: null });
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void setState(idleState);
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});

chrome.runtime.onMessage.addListener((request: any, _sender: any, sendResponse: (value: unknown) => void) => {
  if (request?.type === "get-extension-state") {
    Promise.all([pairedToken(), researchOsBaseUrl(), chrome.storage.session.get("captureState")])
      .then(([token, baseUrl, state]) => sendResponse({ paired: Boolean(token), baseUrl, state: state.captureState ?? idleState }))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (request?.type === "set-research-os-base-url") {
    setResearchOsBaseUrl(String(request.baseUrl ?? ""))
      .then((baseUrl) => sendResponse({ ok: true, baseUrl }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (request?.type === "pair-research-os") {
    researchOsBaseUrl()
      .then((baseUrl) => pairResearchOs(baseUrl, String(request.code ?? "").trim()))
      .then(async ({ token }) => {
        await chrome.storage.local.set({ researchOsCaptureToken: token });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (request?.type === "start-browser-capture") {
    (async () => {
      const token = await pairedToken();
      if (!token) throw new Error("请先使用 Research OS 生成的配对码连接扩展。");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || typeof tab.url !== "string" || !parseChatGptConversationUrl(tab.url)) {
        throw new Error("请先打开一条 ChatGPT 对话。支持普通对话和 Project 内对话。");
      }
      const identity = parseChatGptConversationUrl(tab.url)!;
      const sessionId = crypto.randomUUID();
      const armedAt = Date.now();
      const marker = `__research_os_capture_v1__${JSON.stringify({
        sessionId,
        conversationId: identity.conversationId,
        armedAt,
        previousWindowName: "",
      })}`;
      await setState({ phase: "capturing", message: "正在读取当前对话…", discovered: 0, tabId: tab.id });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (nextMarker: string) => {
          const previousWindowName = window.name || "";
          const parsed = JSON.parse(nextMarker.slice("__research_os_capture_v1__".length));
          window.name = `__research_os_capture_v1__${JSON.stringify({ ...parsed, previousWindowName })}`;
        },
        args: [marker],
      });
      const pending: PendingCapture = { tabId: tab.id, sessionId, conversationId: identity.conversationId, armedAt, started: false };
      await chrome.storage.session.set({ pendingPassiveCapture: pending });
      await chrome.tabs.reload(tab.id);
      return { ok: true };
    })().then(sendResponse).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await setState({ phase: "failed", message, discovered: 0, tabId: null });
      sendResponse({ ok: false, error: message });
    });
    return true;
  }

  if (request?.type === "cancel-browser-capture") {
    chrome.storage.session.get("captureState").then(async ({ captureState }: { captureState: ExtensionState | undefined }) => {
      if (captureState?.tabId) await chrome.tabs.sendMessage(captureState.tabId, { type: "cancel-capture" }).catch(() => undefined);
      await clearPendingCapture();
      await setState({ phase: "cancelled", message: "捕获已取消。", discovered: captureState?.discovered ?? 0, tabId: null });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (request?.type === "capture-progress") {
    const progress = request.progress as CaptureProgress;
    chrome.storage.session.get("captureState").then(({ captureState }: { captureState: ExtensionState | undefined }) => setState({
      phase: "capturing",
      message: progress.message,
      discovered: progress.discovered,
      tabId: captureState?.tabId ?? null,
    }));
    return;
  }

  if (request?.type === "capture-cancelled" || request?.type === "capture-failed") {
    void clearPendingCapture();
    void setState({
      phase: request.type === "capture-cancelled" ? "cancelled" : "failed",
      message: String(request.error ?? "捕获失败。"),
      discovered: 0,
      tabId: null,
    });
    return;
  }

  if (request?.type === "capture-result") {
    (async () => {
      await clearPendingCapture();
      const token = await pairedToken();
      if (!token) throw new Error("扩展配对已经失效，请重新配对。");
      const baseUrl = await researchOsBaseUrl();
      const conversation = request.conversation as CapturedConversation;
      await setState({ phase: "sending", message: "正在发送到 Research OS Preview…", discovered: conversation.messages.length, tabId: null });
      const result = await sendConversationToPreview(baseUrl, conversation, token);
      await setState({ phase: "complete", message: "捕获完成，已打开 Research OS Preview。", discovered: conversation.messages.length, tabId: null });
      await chrome.tabs.create({ url: result.previewUrl });
    })().catch(async (error) => {
      await setState({ phase: "failed", message: error instanceof Error ? error.message : String(error), discovered: 0, tabId: null });
    });
  }
});
