import type { CapturedMessage, CapturedPart, ContentStructureProfile } from "../model/captured-conversation";

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

type UnsupportedContentType = NonNullable<CapturedPart["mediaType"]>;

function unsupportedTypeOf(element: Element): UnsupportedContentType {
  const tag = element.tagName.toLowerCase();
  if (tag === "img") return "image";
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  if (tag === "canvas") return "canvas";
  const signature = `${element.getAttribute("data-testid") ?? ""} ${element.className ?? ""}`.toLowerCase();
  if (/file|attachment/.test(signature)) return "file";
  if (/tool|research-progress|canvas/.test(signature)) return "tool-ui";
  return "unknown";
}

function comparisonTextOf(node: HTMLElement) {
  const clone = contentRoot(node).cloneNode(true) as HTMLElement;
  clone.querySelectorAll([
    "button", "nav", "svg", "style", "script", "[aria-hidden='true']",
    ".sr-only", "[class*='sr-only']", "[class*='visually-hidden']",
    "[data-testid*='citation']", "[class*='citation']", "sup a[href]",
  ].join(", ")).forEach((element) => element.remove());
  clone.querySelectorAll<HTMLElement>("img, video, audio, canvas").forEach((element) => {
    const label = element.getAttribute("alt") || element.getAttribute("aria-label") || "";
    element.replaceWith(label ? document.createTextNode(label) : document.createTextNode(""));
  });
  return normalizeText(clone.textContent ?? "");
}

function structureOf(node: HTMLElement): ContentStructureProfile {
  const root = contentRoot(node);
  const text = root.textContent ?? "";
  const count = (selector: string) => root.querySelectorAll(selector).length;
  return {
    heading: count("h1, h2, h3, h4, h5, h6"),
    boldItalic: count("strong, b, em, i"),
    inlineCode: [...root.querySelectorAll("code")].filter((element) => !element.closest("pre")).length,
    codeBlock: count("pre"),
    link: count("a[href]"),
    citation: count("[data-testid*='citation'], [class*='citation'], sup a[href]"),
    blockquote: count("blockquote"),
    listItem: count("li"),
    table: count("table"),
    math: count("math, .katex, [data-math], [class*='math']"),
    htmlEntity: /&(?:#\d+|#x[0-9a-f]+|\w+);/i.test(text) ? 1 : 0,
    unicode: /[^\x00-\x7F]/.test(text) ? 1 : 0,
    toolCard: count("[data-testid*='tool'], [data-testid*='research-progress'], [class*='tool-call']"),
    hiddenUi: count("[aria-hidden='true'], .sr-only, [class*='sr-only'], [class*='visually-hidden']"),
    unknownRich: count("canvas, iframe, object, embed"),
  };
}

function partsOf(node: HTMLElement): { parts: CapturedPart[]; comparisonText: string; unsupportedContentCounts: Record<UnsupportedContentType, number> } {
  const root = contentRoot(node);
  const comparisonText = comparisonTextOf(node);
  const clone = root.cloneNode(true) as HTMLElement;
  const parts: CapturedPart[] = [];
  clone.querySelectorAll("pre").forEach((pre) => {
    const text = normalizeText(pre.textContent ?? "");
    if (text) parts.push({ type: "code", text, language: pre.querySelector("code")?.className.match(/language-([^ ]+)/)?.[1] ?? null });
    pre.remove();
  });
  const unsupportedContentCounts: Record<UnsupportedContentType, number> = {
    image: 0, video: 0, audio: 0, file: 0, canvas: 0, "tool-ui": 0, unknown: 0,
  };
  const unsupportedCandidates = [...clone.querySelectorAll(
    "img, video, audio, canvas, [data-testid*='file'], [class*='attachment'], [data-testid*='tool'], [data-testid*='research-progress'], [class*='tool-call']",
  )].filter((candidate, index, candidates) => (
    !candidates.some((parent, parentIndex) => parentIndex !== index && parent.contains(candidate))
  ));
  unsupportedCandidates.forEach((media) => {
    const mediaType = unsupportedTypeOf(media);
    unsupportedContentCounts[mediaType] += 1;
    const fallback = mediaType === "tool-ui" ? "未完整保存的工具界面" : "未完整保存的媒体或附件";
    const label = media.getAttribute("alt") || media.getAttribute("aria-label") || fallback;
    parts.push({ type: "media-placeholder", label: normalizeText(label), mediaType });
    media.remove();
  });
  clone.querySelectorAll("button, nav, svg, style, script, [aria-hidden='true']").forEach((element) => element.remove());
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
  return { parts, comparisonText, unsupportedContentCounts };
}

export function collectVisibleMessages() {
  const unsupportedContentCounts: Record<UnsupportedContentType, number> = {
    image: 0, video: 0, audio: 0, file: 0, canvas: 0, "tool-ui": 0, unknown: 0,
  };
  const messages = messageNodes().map((node, order) => {
    const { parts, comparisonText, unsupportedContentCounts: messageUnsupported } = partsOf(node);
    for (const type of Object.keys(unsupportedContentCounts) as UnsupportedContentType[]) {
      unsupportedContentCounts[type] += messageUnsupported[type];
    }
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
      comparisonText,
      diagnosticStructure: structureOf(node),
    } satisfies CapturedMessage;
  }).filter((message) => message.parts.length > 0);
  return {
    messages,
    unsupportedContentCounts,
    unsupportedContentCount: Object.values(unsupportedContentCounts).reduce((sum, count) => sum + count, 0),
  };
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
