import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  CAPTURE_SCHEMA_VERSION,
  CHATGPT_BROWSER_ADAPTER,
  capturedConversationFingerprint,
} from "../shared/captured-conversation-domain.mjs";

const PREVIEW_TTL_MS = 2 * 60 * 60 * 1_000;
const PAIRING_TTL_MS = 5 * 60 * 1_000;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function extensionIdFromOrigin(origin) {
  return EXTENSION_ORIGIN.exec(String(origin ?? ""))?.[1] ?? null;
}

function assertConversationMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Capture metadata is required");
  if (value.schemaVersion !== CAPTURE_SCHEMA_VERSION) throw new Error("Capture schema version is not supported");
  if (value.provider !== "chatgpt" || value.captureAdapter !== CHATGPT_BROWSER_ADAPTER) {
    throw new Error("Only the ChatGPT browser adapter is supported");
  }
  if (typeof value.title !== "string" || !value.title.trim()) throw new Error("Conversation title is required");
  const sourceUrl = new URL(value.sourceUrl);
  if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "chatgpt.com") {
    throw new Error("Capture source must be a chatgpt.com conversation");
  }
  if (!Number.isFinite(Date.parse(value.capturedAt))) throw new Error("capturedAt is invalid");
}

function messageIsValid(message) {
  return message
    && typeof message === "object"
    && Number.isInteger(message.order)
    && message.order >= 0
    && ["user", "assistant", "system", "tool", "unknown"].includes(message.role)
    && (message.sourceMessageId === null || typeof message.sourceMessageId === "string")
    && (message.occurredAt === null || Number.isFinite(Date.parse(message.occurredAt)))
    && typeof message.fingerprint === "string"
    && message.fingerprint.length > 0
    && message.fingerprint.length <= 500
    && Array.isArray(message.parts)
    && message.parts.length > 0
    && message.parts.every(partIsValid);
}

function partIsValid(part) {
  if (!part || typeof part !== "object" || Array.isArray(part)) return false;
  if (part.type === "text") return typeof part.text === "string" && part.text.length > 0;
  if (part.type === "code") {
    return typeof part.text === "string"
      && part.text.length > 0
      && (part.language === undefined || part.language === null || typeof part.language === "string");
  }
  if (part.type === "media-placeholder") return typeof part.label === "string" && part.label.length > 0;
  if (part.type !== "link" || typeof part.text !== "string" || typeof part.url !== "string") return false;
  try {
    const url = new URL(part.url);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function completenessIsProven(details) {
  return details?.topBoundaryConfirmed === true
    && Number(details?.stablePasses) >= 3
    && details?.loadingAbsent === true
    && details?.conversationIdStable === true
    && details?.unresolvedBranches === false
    && Number(details?.unsupportedContentCount ?? 0) === 0
    && Array.isArray(details?.reasons)
    && details.reasons.length === 0;
}

export class ResearchCaptureService {
  constructor(research) {
    this.research = research;
    this.pairingCodes = new Map();
    this.previews = new Map();
  }

  startPairing() {
    const code = randomBytes(8).toString("hex").toUpperCase();
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.pairingCodes.set(tokenHash(code), expiresAt);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  completePairing({ code, origin, displayName = "Research OS Chrome" }) {
    const extensionId = extensionIdFromOrigin(origin);
    if (!extensionId) return { kind: "invalid_origin" };
    const hashedCode = tokenHash(String(code ?? "").trim().toUpperCase());
    const expiresAt = this.pairingCodes.get(hashedCode);
    if (!expiresAt || expiresAt < Date.now()) {
      this.pairingCodes.delete(hashedCode);
      return { kind: "invalid_code" };
    }
    this.pairingCodes.delete(hashedCode);
    const token = randomBytes(32).toString("base64url");
    const client = this.research.createCaptureClient({
      extensionId,
      displayName: String(displayName).trim().slice(0, 100) || "Research OS Chrome",
      tokenHash: tokenHash(token),
    });
    return { kind: "paired", client, token };
  }

  authenticate(request) {
    const origin = String(request.headers.origin ?? "");
    const extensionId = extensionIdFromOrigin(origin);
    if (!extensionId) return null;
    const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/.exec(String(request.headers.authorization ?? ""));
    if (!match) return null;
    const client = this.research.findCaptureClientByTokenHash(tokenHash(match[1]));
    if (!client || client.extensionId !== extensionId) return null;
    this.research.touchCaptureClient(client.id);
    return client;
  }

  createPreview(client, metadata) {
    assertConversationMetadata(metadata);
    const id = randomUUID();
    const preview = {
      id,
      clientId: client.id,
      metadata: {
        schemaVersion: metadata.schemaVersion,
        provider: "chatgpt",
        captureAdapter: CHATGPT_BROWSER_ADAPTER,
        externalConversationId: typeof metadata.externalConversationId === "string"
          ? metadata.externalConversationId.trim().slice(0, 500) || null
          : null,
        title: metadata.title.trim().slice(0, 300),
        sourceUrl: metadata.sourceUrl,
        capturedAt: new Date(metadata.capturedAt).toISOString(),
        branchScope: "active-visible-branch",
      },
      batches: new Map(),
      status: "receiving",
      finalized: null,
      createdAt: Date.now(),
    };
    this.previews.set(id, preview);
    return { id, status: preview.status };
  }

  appendBatch(client, id, batchIndex, messages) {
    const preview = this.getPreviewInternal(id);
    if (!preview || preview.clientId !== client.id || preview.status !== "receiving") return null;
    if (!Number.isInteger(batchIndex) || batchIndex < 0 || !Array.isArray(messages) || messages.length > 100) {
      throw new Error("Capture batch is invalid");
    }
    if (messages.some((message) => !messageIsValid(message))) throw new Error("Capture message is invalid");
    const serialized = JSON.stringify(messages);
    if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw new Error("Capture batch is too large");
    const existing = preview.batches.get(batchIndex);
    if (existing && JSON.stringify(existing) !== serialized) throw new Error("Capture batch conflicts with an earlier batch");
    preview.batches.set(batchIndex, messages);
    return { id, batchIndex, receivedMessages: messages.length };
  }

  finalizePreview(client, id, input) {
    const preview = this.getPreviewInternal(id);
    if (!preview || preview.clientId !== client.id || preview.status !== "receiving") return null;
    const indexes = [...preview.batches.keys()].sort((left, right) => left - right);
    if (indexes.some((index, position) => index !== position)) throw new Error("Capture batches are incomplete");
    const messages = indexes.flatMap((index) => preview.batches.get(index));
    if (messages.length === 0 || messages.some((message, index) => message.order !== index)) {
      preview.status = "failed";
      preview.finalized = { completeness: "failed", reasons: ["no-stable-message-sequence"] };
      return this.publicPreview(preview);
    }
    const details = {
      topBoundaryConfirmed: input?.completenessDetails?.topBoundaryConfirmed === true,
      stablePasses: Number(input?.completenessDetails?.stablePasses ?? 0),
      loadingAbsent: input?.completenessDetails?.loadingAbsent === true,
      conversationIdStable: input?.completenessDetails?.conversationIdStable === true,
      unresolvedBranches: input?.completenessDetails?.unresolvedBranches === true
        || messages.some((message) => message.role === "unknown"),
      unsupportedContentCount: Math.max(0, Number(input?.completenessDetails?.unsupportedContentCount ?? 0)),
      reasons: Array.isArray(input?.completenessDetails?.reasons)
        ? input.completenessDetails.reasons.filter((reason) => typeof reason === "string").slice(0, 50)
        : [],
    };
    if (details.unresolvedBranches && !details.reasons.includes("unresolved-or-unknown-message-role")) {
      details.reasons.push("unresolved-or-unknown-message-role");
    }
    const completeness = input?.completeness === "complete" && completenessIsProven(details)
      ? "complete"
      : "partial";
    if (input?.completeness === "complete" && completeness === "partial" && !details.reasons.includes("complete-evidence-insufficient")) {
      details.reasons.push("complete-evidence-insufficient");
    }
    const conversation = {
      ...preview.metadata,
      messages,
      completeness,
      completenessDetails: details,
      captureStats: {
        discoveredMessageCount: messages.length,
        unsupportedContentCount: details.unsupportedContentCount,
      },
    };
    const sourceFingerprint = capturedConversationFingerprint(conversation);
    const existing = this.research.findCapturedConversation("chatgpt", conversation.externalConversationId, sourceFingerprint);
    const relation = existing
      ? this.research.compareCapturedConversation(existing.id, conversation)
      : "new";
    preview.status = "ready";
    preview.finalized = { conversation, sourceFingerprint, existing, relation };
    return this.publicPreview(preview);
  }

  getPreview(id) {
    const preview = this.getPreviewInternal(id);
    return preview ? this.publicPreview(preview) : null;
  }

  confirmPreview(id, { topicId = null, allowPartial = false, conflictAction = null, expectedRecordVersion = null } = {}) {
    const preview = this.getPreviewInternal(id);
    if (!preview || preview.status !== "ready" || !preview.finalized) return { kind: "not_found" };
    const { conversation, existing, relation } = preview.finalized;
    if (conversation.completeness === "partial" && allowPartial !== true) return { kind: "partial_confirmation_required" };
    if (relation === "identical") return { kind: "already_latest", record: existing };
    if (relation === "conflict" && conflictAction !== "replace-current") return { kind: "conflict_confirmation_required", record: existing };
    const result = this.research.commitCapturedConversation({
      conversation,
      topicId,
      completeness: conversation.completeness,
      completenessDetails: conversation.completenessDetails,
      relation: existing ? relation : "initial",
      existingRecordId: existing?.id ?? null,
      expectedRecordVersion: existing ? expectedRecordVersion : null,
    });
    if (result.kind === "created" || result.kind === "updated") {
      preview.status = "committed";
      preview.committed = result;
    }
    return result;
  }

  cancelPreview(client, id) {
    const preview = this.getPreviewInternal(id);
    if (!preview || preview.clientId !== client.id) return false;
    this.previews.delete(id);
    return true;
  }

  getPreviewInternal(id) {
    const preview = this.previews.get(id);
    if (!preview) return null;
    if (Date.now() - preview.createdAt > PREVIEW_TTL_MS) {
      this.previews.delete(id);
      return null;
    }
    return preview;
  }

  publicPreview(preview) {
    const finalized = preview.finalized;
    return {
      id: preview.id,
      status: preview.status,
      title: preview.metadata.title,
      sourceUrl: preview.metadata.sourceUrl,
      capturedAt: preview.metadata.capturedAt,
      messageCount: finalized?.conversation?.messages.length
        ?? [...preview.batches.values()].reduce((total, batch) => total + batch.length, 0),
      completeness: finalized?.conversation?.completeness ?? (preview.status === "failed" ? "failed" : null),
      completenessDetails: finalized?.conversation?.completenessDetails ?? null,
      relation: finalized?.relation ?? null,
      existingRecord: finalized?.existing ?? null,
      sourceFingerprint: finalized?.sourceFingerprint ?? null,
      committed: preview.committed ?? null,
    };
  }
}

export function isChromeExtensionOrigin(origin) {
  return extensionIdFromOrigin(origin) !== null;
}
