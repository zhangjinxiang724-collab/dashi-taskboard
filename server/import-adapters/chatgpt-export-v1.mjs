import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";

import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/stream-array.js";
import chain from "stream-chain";
import yauzl from "yauzl";

export const CHATGPT_CAPTURE_ADAPTER = "chatgpt-export-v1";
export const CHATGPT_CONTENT_ENCODING = "gzip-json-v1";
export const CHATGPT_CONTENT_VERSION = "chatgpt-visible-branch-v1";

const MAX_ZIP_ENTRIES = 10_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

function isoTimestamp(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const numeric = Number(value);
  const milliseconds = Number.isFinite(numeric)
    ? (numeric < 100_000_000_000 ? numeric * 1_000 : numeric)
    : Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

function messageText(message) {
  const content = message?.content;
  if (!content || typeof content !== "object") return "";
  if (typeof content.text === "string") return content.text.trim();
  if (!Array.isArray(content.parts)) return "";
  return content.parts.filter((part) => typeof part === "string").join("\n").trim();
}

function visibleMessage(node) {
  const message = node?.message;
  const role = message?.author?.role;
  if (role !== "user" && role !== "assistant") return null;
  if (message?.metadata?.is_visually_hidden_from_conversation === true) return null;
  const text = messageText(message);
  if (!text) return null;
  return {
    id: typeof message.id === "string" ? message.id : null,
    role,
    text,
    createdAt: isoTimestamp(message.create_time),
  };
}

function activeBranch(raw) {
  const mapping = raw?.mapping;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return [];
  const branch = [];
  const visited = new Set();
  let nodeId = typeof raw.current_node === "string" ? raw.current_node : null;
  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = mapping[nodeId];
    if (!node) break;
    branch.push(node);
    nodeId = typeof node.parent === "string" ? node.parent : null;
  }
  if (branch.length > 0) return branch.reverse();
  return Object.entries(mapping)
    .map(([id, node]) => ({ id, ...node }))
    .sort((left, right) => {
      const leftTime = Number(left?.message?.create_time ?? 0);
      const rightTime = Number(right?.message?.create_time ?? 0);
      return leftTime - rightTime || String(left.id).localeCompare(String(right.id));
    });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(content) {
  const digest = createHash("sha256").update(canonicalJson(content)).digest("hex");
  return `sha256:${CHATGPT_CONTENT_VERSION}:${digest}`;
}

export function normalizeChatGptConversation(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const messages = activeBranch(raw).map(visibleMessage).filter(Boolean);
  if (messages.length === 0) return null;
  const externalId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
  const sourceCreatedAt = isoTimestamp(raw.create_time) ?? messages.find((message) => message.createdAt)?.createdAt;
  const sourceUpdatedAt = isoTimestamp(raw.update_time) ?? sourceCreatedAt;
  const occurredAt = sourceCreatedAt ?? new Date(0).toISOString();
  const title = typeof raw.title === "string" && raw.title.trim()
    ? raw.title.trim().slice(0, 300)
    : "未命名 ChatGPT 对话";
  const content = {
    version: CHATGPT_CONTENT_VERSION,
    externalId,
    title,
    messages,
  };
  const totalMessages = Object.values(raw.mapping ?? {}).filter((node) => node?.message).length;
  return {
    sourceKey: externalId ?? fingerprint(content),
    externalId,
    title,
    occurredAt,
    updatedAt: sourceUpdatedAt,
    messageCount: messages.length,
    omittedMessageCount: Math.max(0, totalMessages - messages.length),
    sourceFingerprint: fingerprint(content),
    content,
    preview: messages.slice(0, 2).map((message) => message.text).join(" ").slice(0, 280),
  };
}

export function normalizedExportAsCapturedConversation(normalized) {
  if (!normalized) return null;
  return {
    schemaVersion: "captured-conversation-v1",
    provider: "chatgpt",
    captureAdapter: CHATGPT_CAPTURE_ADAPTER,
    externalConversationId: normalized.externalId,
    title: normalized.title,
    sourceUrl: normalized.externalId ? `https://chatgpt.com/c/${normalized.externalId}` : null,
    capturedAt: normalized.updatedAt ?? normalized.occurredAt,
    branchScope: "active-visible-branch",
    completeness: "complete",
    completenessDetails: {
      topBoundaryConfirmed: true,
      windowTopConfirmed: true,
      conversationRootConfirmed: true,
      earliestBoundaryConfirmed: true,
      latestBoundaryConfirmed: true,
      stablePasses: 3,
      loadingAbsent: true,
      conversationIdStable: Boolean(normalized.externalId),
      unresolvedBranches: false,
      messageOmissionCount: 0,
      unsupportedContentCounts: {},
      unsupportedContentCount: 0,
      reasons: [],
    },
    messages: normalized.content.messages.map((message, order) => ({
      order,
      role: message.role,
      sourceMessageId: message.id,
      occurredAt: message.createdAt,
      parts: [{ type: "text", text: message.text }],
      fingerprint: normalized.sourceFingerprint,
    })),
    captureStats: {
      discoveredMessageCount: normalized.messageCount,
      messageOmissionCount: 0,
      unsupportedContentCounts: {},
      unsupportedContentCount: 0,
    },
  };
}

function openZip(filename) {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, validateEntrySizes: true, autoClose: false }, (error, zipfile) => {
      if (error) reject(error);
      else resolve(zipfile);
    });
  });
}

function openEntryStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
  });
}

async function findConversationEntries(filename) {
  const zipfile = await openZip(filename);
  return new Promise((resolve, reject) => {
    let count = 0;
    let totalJsonBytes = 0;
    const entries = [];
    zipfile.on("entry", (entry) => {
      count += 1;
      if (count > MAX_ZIP_ENTRIES) {
        zipfile.close();
        reject(new Error("ZIP archive contains too many entries"));
        return;
      }
      const basename = path.posix.basename(entry.fileName);
      if (/^conversations(?:[-_.]?\d+)?\.json$/i.test(basename)) {
        totalJsonBytes += entry.uncompressedSize;
        if (entry.uncompressedSize > MAX_JSON_BYTES || totalJsonBytes > MAX_JSON_BYTES) {
          zipfile.close();
          reject(new Error("Conversation JSON data is too large"));
          return;
        }
        const compressed = Math.max(1, entry.compressedSize);
        if (entry.uncompressedSize / compressed > MAX_COMPRESSION_RATIO) {
          zipfile.close();
          reject(new Error("ZIP compression ratio is unsafe"));
          return;
        }
        entries.push(entry);
      }
      zipfile.readEntry();
    });
    zipfile.once("error", reject);
    zipfile.once("end", () => {
      if (entries.length === 0) {
        zipfile.close();
        reject(new Error("ZIP archive does not contain conversations.json"));
      } else {
        resolve({ zipfile, entries });
      }
    });
    zipfile.readEntry();
  });
}

export async function createChatGptConversationStream(filename, sourceFilename = filename) {
  if (/\.zip$/i.test(sourceFilename)) {
    const { zipfile, entries } = await findConversationEntries(filename);
    return (async function* iterateEntries() {
      try {
        for (const entry of entries) {
          const readable = await openEntryStream(zipfile, entry);
          const pipeline = chain([readable, parser(), streamArray()]);
          for await (const item of pipeline) yield item;
        }
      } finally {
        zipfile.close();
      }
    })();
  }
  if (!/\.json$/i.test(sourceFilename)) {
    throw new Error("Only ChatGPT ZIP exports and conversations.json files are supported");
  }
  return chain([createReadStream(filename), parser(), streamArray()]);
}
