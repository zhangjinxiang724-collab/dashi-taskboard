import type { CapturedMessage, CapturedPart } from "../model/captured-conversation";

const MESSAGE_SELECTORS = [
  "[data-message-author-role]",
  "article[data-testid^='conversation-turn-']",
] as const;

// chrome.scripting.executeScript injects this entry as a classic script, so it
// must remain self-contained instead of importing a shared runtime chunk.
function currentConversationId() {
  if (location.protocol !== "https:" || location.hostname !== "chatgpt.com") return null;
  const segments = location.pathname.split("/").filter(Boolean);
  const validConversationId = (value: string | undefined) => (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/.test(value)
  );
  if (segments.length === 2 && segments[0] === "c" && validConversationId(segments[1])) {
    return segments[1];
  }
  if (
    segments.length === 4
    && segments[0] === "g"
    && /^g-p-[A-Za-z0-9_-]{3,200}$/.test(segments[1] ?? "")
    && segments[2] === "c"
    && validConversationId(segments[3])
  ) {
    return segments[3];
  }
  return null;
}

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fastFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `browser-v1:${(hash >>> 0).toString(16).padStart(8, "0")}:${value.length}`;
}

export function messageNodes(): HTMLElement[] {
  for (const selector of MESSAGE_SELECTORS) {
    const nodes = [...document.querySelectorAll<HTMLElement>(selector)];
    if (nodes.length > 0) return nodes.filter((node, index) => !nodes.some((candidate, candidateIndex) => candidateIndex !== index && candidate.contains(node)));
  }
  return [];
}

function roleOf(node: HTMLElement): CapturedMessage["role"] {
  const direct = node.dataset.messageAuthorRole?.toLowerCase();
  if (direct === "user" || direct === "assistant" || direct === "system" || direct === "tool") return direct;
  const label = `${node.getAttribute("aria-label") ?? ""} ${node.querySelector("[aria-label]")?.getAttribute("aria-label") ?? ""}`.toLowerCase();
  if (label.includes("user") || label.includes("you") || label.includes("你")) return "user";
  if (label.includes("assistant") || label.includes("chatgpt")) return "assistant";
  return "unknown";
}

function contentRoot(node: HTMLElement) {
  return node.querySelector<HTMLElement>("[data-message-content], .markdown, [class*='markdown']") ?? node;
}

function partsOf(node: HTMLElement): { parts: CapturedPart[]; unsupported: number } {
  const root = contentRoot(node);
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, nav, svg, style, script, [aria-hidden='true']").forEach((element) => element.remove());
  const parts: CapturedPart[] = [];
  clone.querySelectorAll("pre").forEach((pre) => {
    const text = normalizeText(pre.textContent ?? "");
    if (text) parts.push({ type: "code", text, language: pre.querySelector("code")?.className.match(/language-([^ ]+)/)?.[1] ?? null });
    pre.remove();
  });
  let unsupported = 0;
  clone.querySelectorAll("img, video, audio, canvas, [data-testid*='file'], [class*='attachment']").forEach((media) => {
    unsupported += 1;
    const label = media.getAttribute("alt") || media.getAttribute("aria-label") || "未捕获的媒体或附件";
    parts.push({ type: "media-placeholder", label: normalizeText(label) });
    media.remove();
  });
  clone.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    const text = normalizeText(link.textContent ?? "");
    try {
      const url = new URL(link.href, location.href).toString();
      if (/^https?:/i.test(url)) {
        parts.push({ type: "link", text: text || url, url });
      } else if (text) {
        parts.push({ type: "text", text });
      }
    } catch {}
    link.remove();
  });
  const text = normalizeText(clone.textContent ?? "");
  if (text) parts.unshift({ type: "text", text });
  return { parts, unsupported };
}

export function collectVisibleMessages() {
  let unsupportedContentCount = 0;
  const messages = messageNodes().map((node, order) => {
    const { parts, unsupported } = partsOf(node);
    unsupportedContentCount += unsupported;
    const role = roleOf(node);
    const sourceMessageId = node.dataset.messageId
      ?? node.getAttribute("data-message-id")
      ?? (node.id || null);
    const signature = `${role}\n${parts.map((part) => `${part.type}:${part.text ?? part.label ?? part.url ?? ""}`).join("\n")}`;
    return {
      order,
      role,
      sourceMessageId,
      occurredAt: null,
      parts,
      fingerprint: fastFingerprint(signature),
    } satisfies CapturedMessage;
  }).filter((message) => message.parts.length > 0);
  return { messages, unsupportedContentCount };
}

export function findScrollContainer(): HTMLElement {
  const first = messageNodes()[0];
  let current = first?.parentElement ?? null;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 20) return current;
    current = current.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function isLoadingOlderMessages() {
  return Boolean(document.querySelector("[aria-busy='true'], [role='progressbar'], [data-testid*='loading']"));
}

export function hasUnexpandedContent() {
  return [...document.querySelectorAll<HTMLElement>("button")].some((button) => /show more|load more|展开|显示更多|继续生成/i.test(button.textContent ?? button.getAttribute("aria-label") ?? ""));
}

export function hasBranchControls() {
  return [...document.querySelectorAll<HTMLElement>("button[aria-label]")].some((button) => /previous response|next response|上一个回答|下一个回答/i.test(button.getAttribute("aria-label") ?? ""));
}

export function conversationIdentity() {
  const externalConversationId = currentConversationId();
  return {
    externalConversationId,
    sourceUrl: location.href,
    title: normalizeText(document.title.replace(/\s*[|\-–—]\s*ChatGPT\s*$/i, "")) || "未命名 ChatGPT 对话",
  };
}

export function pageIsSupported() {
  return currentConversationId() !== null && messageNodes().length > 0;
}
