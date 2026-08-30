import { createHash } from "node:crypto";

export const CAPTURE_SCHEMA_VERSION = "captured-conversation-v1";
export const CHATGPT_BROWSER_ADAPTER = "chatgpt-browser-v1";
export const CAPTURE_COMPLETENESS = ["complete", "partial", "failed"];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function capturedMessageText(message) {
  if (typeof message?.text === "string") return message.text.trim();
  if (!Array.isArray(message?.parts)) return "";
  return message.parts.map((part) => {
    if (!part || typeof part !== "object") return "";
    if (part.type === "media-placeholder") return `[${part.label || "不支持的媒体"}]`;
    return typeof part.text === "string" ? part.text : "";
  }).filter(Boolean).join("\n").trim();
}

export function semanticMessageFingerprint(message) {
  const semantic = {
    role: message.role,
    parts: Array.isArray(message.parts)
      ? message.parts.map((part) => ({
        type: part.type,
        text: typeof part.text === "string" ? part.text.replace(/\r\n/g, "\n").trim() : undefined,
        language: part.language ?? undefined,
        url: part.url ?? undefined,
        label: part.label ?? undefined,
      }))
      : [{ type: "text", text: capturedMessageText(message) }],
  };
  return `sha256:captured-message-v1:${createHash("sha256").update(canonicalJson(semantic)).digest("hex")}`;
}

export function capturedConversationFingerprint(conversation) {
  const sequence = conversation.messages.map((message) => semanticMessageFingerprint(message));
  return `sha256:captured-conversation-v1:${createHash("sha256").update(canonicalJson(sequence)).digest("hex")}`;
}

export function compareCapturedSequences(previous, next) {
  const previousFingerprints = previous.messages.map(semanticMessageFingerprint);
  const nextFingerprints = next.messages.map(semanticMessageFingerprint);
  if (
    previousFingerprints.length === nextFingerprints.length
    && previousFingerprints.every((fingerprint, index) => fingerprint === nextFingerprints[index])
  ) return "identical";
  if (
    nextFingerprints.length > previousFingerprints.length
    && previousFingerprints.every((fingerprint, index) => fingerprint === nextFingerprints[index])
  ) return "append";
  return "conflict";
}
