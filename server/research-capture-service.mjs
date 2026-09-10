import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  CAPTURE_SCHEMA_VERSION,
  CHATGPT_BROWSER_ADAPTER,
  captureCoverage,
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
  if (part.type === "media-placeholder") {
    return typeof part.label === "string"
      && part.label.length > 0
      && (part.mediaType === undefined
        || ["image", "video", "audio", "file", "canvas", "tool-ui", "unknown"].includes(part.mediaType));
  }
  if (part.type !== "link" || typeof part.text !== "string" || typeof part.url !== "string") return false;
  try {
    const url = new URL(part.url);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function completenessIsProven(details) {
  return details?.conversationRootConfirmed === true
    && details?.earliestBoundaryConfirmed === true
    && details?.latestBoundaryConfirmed === true
    && details?.passiveDataAvailable === true
    && details?.passiveHistoryExhausted === true
    && details?.hasPreviousPageFinal === false
    && details?.activeLeafConfirmed === true
    && Number(details?.missingParentCount ?? 0) === 0
    && Number(details?.cycleCount ?? 0) === 0
    && Number(details?.parentConflictCount ?? 0) === 0
    && Number(details?.pageDataConflictCount ?? 0) === 0
    && details?.firstUserConfirmed === true
    && Number(details?.domUnmatchedCount ?? 0) === 0
    && Number(details?.domFingerprintMismatchCount ?? 0) === 0
    && details?.loadingAbsent === true
    && details?.conversationIdStable === true
    && details?.unresolvedBranches === false
    && Number(details?.messageOmissionCount ?? 0) === 0
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
    const declaredUnsupported = input?.completenessDetails?.unsupportedContentCounts;
    const orderedAuditInput = input?.completenessDetails?.orderedHistoryAudit;
    const orderedHistoryAudit = orderedAuditInput && typeof orderedAuditInput === "object" ? {
      pageOrderRule: orderedAuditInput.pageOrderRule === "capture-sequence-newest-to-oldest"
        ? orderedAuditInput.pageOrderRule : "capture-sequence-newest-to-oldest",
      pageOrderValidated: orderedAuditInput.pageOrderValidated === true,
      pageTimeOrderViolationCount: Math.max(0, Number(orderedAuditInput.pageTimeOrderViolationCount ?? 0)),
      itemOrderRule: ["oldest-to-newest", "newest-to-oldest", "unresolved"].includes(orderedAuditInput.itemOrderRule)
        ? orderedAuditInput.itemOrderRule : "unresolved",
      itemOrderValidated: orderedAuditInput.itemOrderValidated === true,
      timestampAscendingPairs: Math.max(0, Number(orderedAuditInput.timestampAscendingPairs ?? 0)),
      timestampDescendingPairs: Math.max(0, Number(orderedAuditInput.timestampDescendingPairs ?? 0)),
      parentForwardLinks: Math.max(0, Number(orderedAuditInput.parentForwardLinks ?? 0)),
      parentBackwardLinks: Math.max(0, Number(orderedAuditInput.parentBackwardLinks ?? 0)),
      pageSummaries: Array.isArray(orderedAuditInput.pageSummaries) ? orderedAuditInput.pageSummaries.slice(0, 100).map((page) => ({
        responseSequence: Math.max(0, Number(page?.responseSequence ?? 0)),
        cursorHash: typeof page?.cursorHash === "string" && /^(?:session:[a-f0-9]{8}|none)$/.test(page.cursorHash) ? page.cursorHash : "none",
        hasPreviousPage: typeof page?.hasPreviousPage === "boolean" ? page.hasPreviousPage : null,
        itemCount: Math.max(0, Number(page?.itemCount ?? 0)),
        collection: page?.collection === "mapping" ? "mapping" : "messages",
      })) : [],
      orderedUniqueNodeCount: Math.max(0, Number(orderedAuditInput.orderedUniqueNodeCount ?? 0)),
      unpagedNodeCount: Math.max(0, Number(orderedAuditInput.unpagedNodeCount ?? 0)),
      roleCounts: Object.fromEntries(["user", "assistant", "thoughts", "tool", "system", "internal", "unknown"].map((role) => [
        role, Math.max(0, Number(orderedAuditInput.roleCounts?.[role] ?? 0)),
      ])),
      hasVisibleContentNodeCount: Math.max(0, Number(orderedAuditInput.hasVisibleContentNodeCount ?? 0)),
      visibleMessageCount: Math.max(0, Number(orderedAuditInput.visibleMessageCount ?? 0)),
      visibleToolMessageCount: Math.max(0, Number(orderedAuditInput.visibleToolMessageCount ?? 0)),
      firstVisibleUserFound: orderedAuditInput.firstVisibleUserFound === true,
      graphBranchPointCount: Math.max(0, Number(orderedAuditInput.graphBranchPointCount ?? 0)),
      visibleBranchPointCount: Math.max(0, Number(orderedAuditInput.visibleBranchPointCount ?? 0)),
      branchScoped: typeof orderedAuditInput.branchScoped === "boolean" ? orderedAuditInput.branchScoped : null,
      domVisibleCount: Math.max(0, Number(orderedAuditInput.domVisibleCount ?? 0)),
      domMatchedCount: Math.max(0, Number(orderedAuditInput.domMatchedCount ?? 0)),
      domUnmatchedCount: Math.max(0, Number(orderedAuditInput.domUnmatchedCount ?? 0)),
      domOrderingMismatchCount: Math.max(0, Number(orderedAuditInput.domOrderingMismatchCount ?? 0)),
      domFingerprintMismatchCount: Math.max(0, Number(orderedAuditInput.domFingerprintMismatchCount ?? 0)),
      domFormattingOnlyMismatchCount: Math.max(0, Number(orderedAuditInput.domFormattingOnlyMismatchCount ?? 0)),
      domCitationOnlyMismatchCount: Math.max(0, Number(orderedAuditInput.domCitationOnlyMismatchCount ?? 0)),
      domToolUiOnlyMismatchCount: Math.max(0, Number(orderedAuditInput.domToolUiOnlyMismatchCount ?? 0)),
      domRealTextMismatchCount: Math.max(0, Number(orderedAuditInput.domRealTextMismatchCount ?? 0)),
      mismatchProfiles: Array.isArray(orderedAuditInput.mismatchProfiles) ? orderedAuditInput.mismatchProfiles.slice(0, 20).map((profile) => ({
        messageHash: typeof profile?.messageHash === "string" && /^(?:session:[a-f0-9]{8}|none)$/.test(profile.messageHash) ? profile.messageHash : "none",
        domOrder: Math.max(0, Number(profile?.domOrder ?? 0)),
        streamOrder: Math.max(0, Number(profile?.streamOrder ?? 0)),
        role: ["user", "assistant", "tool"].includes(profile?.role) ? profile.role : "unknown",
        domLength: Math.max(0, Number(profile?.domLength ?? 0)),
        streamLength: Math.max(0, Number(profile?.streamLength ?? 0)),
        compactEqual: profile?.compactEqual === true,
        domContainsStream: profile?.domContainsStream === true,
        streamContainsDom: profile?.streamContainsDom === true,
        domIsOrderedSubset: profile?.domIsOrderedSubset === true,
        placeholderCount: Math.max(0, Number(profile?.placeholderCount ?? 0)),
        sourceContentKind: typeof profile?.sourceContentKind === "string" ? profile.sourceContentKind.slice(0, 100) : "unknown",
        sourceStructure: Object.fromEntries([
          "heading", "boldItalic", "inlineCode", "codeBlock", "link", "citation", "blockquote", "listItem",
          "table", "math", "htmlEntity", "unicode", "toolCard", "hiddenUi", "unknownRich",
        ].map((kind) => [kind, Math.max(0, Number(profile?.sourceStructure?.[kind] ?? 0))])),
        domStructure: Object.fromEntries([
          "heading", "boldItalic", "inlineCode", "codeBlock", "link", "citation", "blockquote", "listItem",
          "table", "math", "htmlEntity", "unicode", "toolCard", "hiddenUi", "unknownRich",
        ].map((kind) => [kind, Math.max(0, Number(profile?.domStructure?.[kind] ?? 0))])),
        firstDifferenceRegion: ["start", "early", "middle", "late", "end"].includes(profile?.firstDifferenceRegion) ? profile.firstDifferenceRegion : "start",
        firstDifferenceDomType: ["alphanumeric", "whitespace", "punctuation", "end", "other"].includes(profile?.firstDifferenceDomType) ? profile.firstDifferenceDomType : "other",
        firstDifferenceSourceType: ["alphanumeric", "whitespace", "punctuation", "end", "other"].includes(profile?.firstDifferenceSourceType) ? profile.firstDifferenceSourceType : "other",
        classification: ["formatting", "citation", "tool-ui", "real"].includes(profile?.classification) ? profile.classification : "real",
      })) : [],
      omittedVisibleContentKinds: Object.fromEntries(["text", "image", "video", "audio", "file", "canvas", "tool-ui", "unknown", "other"].map((kind) => [
        kind, Math.max(0, Number(orderedAuditInput.omittedVisibleContentKinds?.[kind] ?? 0)),
      ])),
      mismatchCategories: Object.fromEntries([
        "plainText", "markdownHeading", "boldItalic", "inlineCode", "codeBlock", "markdownLink", "citation",
        "list", "blockquote", "table", "math", "unicodeEntity", "whitespaceNewline", "toolPlaceholder", "other",
      ].map((category) => [category, Math.max(0, Number(orderedAuditInput.mismatchCategories?.[category] ?? 0))])),
      domCompactMatchCount: Math.max(0, Number(orderedAuditInput.domCompactMatchCount ?? 0)),
      domContainsStreamCount: Math.max(0, Number(orderedAuditInput.domContainsStreamCount ?? 0)),
      streamContainsDomCount: Math.max(0, Number(orderedAuditInput.streamContainsDomCount ?? 0)),
      domContiguous: orderedAuditInput.domContiguous === true,
      buildDurationMs: Math.max(0, Number(orderedAuditInput.buildDurationMs ?? 0)),
    } : null;
    const observedUnsupported = captureCoverage({ messages }).unsupportedContentCounts;
    const unsupportedContentCounts = Object.fromEntries(
      ["image", "video", "audio", "file", "canvas", "tool-ui", "unknown"].map((type) => [
        type,
        Math.max(
          0,
          Number(declaredUnsupported?.[type] ?? 0),
          Number(observedUnsupported?.[type] ?? 0),
        ),
      ]),
    );
    const windowTopConfirmed = input?.completenessDetails?.windowTopConfirmed === true
      || input?.completenessDetails?.topBoundaryConfirmed === true;
    const conversationRootConfirmed = input?.completenessDetails?.conversationRootConfirmed === true;
    const details = {
      topBoundaryConfirmed: windowTopConfirmed,
      windowTopConfirmed,
      conversationRootConfirmed,
      earliestBoundaryConfirmed: conversationRootConfirmed
        && input?.completenessDetails?.earliestBoundaryConfirmed === true,
      latestBoundaryConfirmed: input?.completenessDetails?.latestBoundaryConfirmed === true,
      stablePasses: Number(input?.completenessDetails?.stablePasses ?? 0),
      loadingAbsent: input?.completenessDetails?.loadingAbsent === true,
      conversationIdStable: input?.completenessDetails?.conversationIdStable === true,
      unresolvedBranches: input?.completenessDetails?.unresolvedBranches === true
        || messages.some((message) => message.role === "unknown"),
      messageOmissionCount: Math.max(0, Number(input?.completenessDetails?.messageOmissionCount ?? 0)),
      unsupportedContentCounts,
      unsupportedContentCount: Object.values(unsupportedContentCounts).reduce((sum, count) => sum + count, 0),
      reasons: Array.isArray(input?.completenessDetails?.reasons)
        ? input.completenessDetails.reasons.filter((reason) => typeof reason === "string").slice(0, 50)
        : [],
      passiveDataAvailable: input?.completenessDetails?.passiveDataAvailable === true,
      initialPassiveNodeCount: Math.max(0, Number(input?.completenessDetails?.initialPassiveNodeCount ?? 0)),
      historyPagesLoaded: Math.max(0, Number(input?.completenessDetails?.historyPagesLoaded ?? 0)),
      passiveNodeProgression: Array.isArray(input?.completenessDetails?.passiveNodeProgression)
        ? input.completenessDetails.passiveNodeProgression.filter(Number.isFinite).map(Number).slice(0, 500)
        : [],
      finalGraphNodeCount: Math.max(0, Number(input?.completenessDetails?.finalGraphNodeCount ?? 0)),
      visibleMessageCount: Math.max(0, Number(input?.completenessDetails?.visibleMessageCount ?? messages.length)),
      hasPreviousPageFinal: typeof input?.completenessDetails?.hasPreviousPageFinal === "boolean"
        ? input.completenessDetails.hasPreviousPageFinal
        : null,
      passiveHistoryExhausted: input?.completenessDetails?.passiveHistoryExhausted === true,
      passiveHistoryStalled: input?.completenessDetails?.passiveHistoryStalled === true,
      paginationLoopDetected: input?.completenessDetails?.paginationLoopDetected === true,
      activeLeafConfirmed: input?.completenessDetails?.activeLeafConfirmed === true,
      activePathLength: Math.max(0, Number(input?.completenessDetails?.activePathLength ?? 0)),
      missingParentCount: Math.max(0, Number(input?.completenessDetails?.missingParentCount ?? 0)),
      cycleCount: Math.max(0, Number(input?.completenessDetails?.cycleCount ?? 0)),
      parentConflictCount: Math.max(0, Number(input?.completenessDetails?.parentConflictCount ?? 0)),
      pageDataConflictCount: Math.max(0, Number(input?.completenessDetails?.pageDataConflictCount ?? 0)),
      firstUserConfirmed: input?.completenessDetails?.firstUserConfirmed === true,
      domMatchedCount: Math.max(0, Number(input?.completenessDetails?.domMatchedCount ?? 0)),
      domUnmatchedCount: Math.max(0, Number(input?.completenessDetails?.domUnmatchedCount ?? 0)),
      domFingerprintMismatchCount: Math.max(0, Number(input?.completenessDetails?.domFingerprintMismatchCount ?? 0)),
      domFormattingOnlyMismatchCount: Math.max(0, Number(input?.completenessDetails?.domFormattingOnlyMismatchCount ?? 0)),
      domCitationOnlyMismatchCount: Math.max(0, Number(input?.completenessDetails?.domCitationOnlyMismatchCount ?? 0)),
      domToolUiOnlyMismatchCount: Math.max(0, Number(input?.completenessDetails?.domToolUiOnlyMismatchCount ?? 0)),
      domRealTextMismatchCount: Math.max(0, Number(input?.completenessDetails?.domRealTextMismatchCount ?? 0)),
      activeBranchUniquelyValidated: input?.completenessDetails?.activeBranchUniquelyValidated === true,
      orderedVisibleIdentityStable: input?.completenessDetails?.orderedVisibleIdentityStable === true,
      textTranscriptComplete: input?.completenessDetails?.textTranscriptComplete === true,
      richContentComplete: input?.completenessDetails?.richContentComplete === true,
      visibleConversationComplete: input?.completenessDetails?.visibleConversationComplete === true,
      passiveCaptureDurationMs: Math.max(0, Number(input?.completenessDetails?.passiveCaptureDurationMs ?? 0)),
      fallbackUsed: input?.completenessDetails?.fallbackUsed === true,
      orderedHistoryAudit,
    };
    if (!details.earliestBoundaryConfirmed && !details.reasons.includes("earliest-boundary-unconfirmed")) {
      details.reasons.push("earliest-boundary-unconfirmed");
    }
    if (!details.latestBoundaryConfirmed && !details.reasons.includes("latest-boundary-unconfirmed")) {
      details.reasons.push("latest-boundary-unconfirmed");
    }
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
        messageOmissionCount: details.messageOmissionCount,
        unsupportedContentCounts: details.unsupportedContentCounts,
        unsupportedContentCount: details.unsupportedContentCount,
      },
    };
    const incomingFingerprint = capturedConversationFingerprint(conversation);
    const existing = this.research.findCapturedConversation("chatgpt", conversation.externalConversationId, incomingFingerprint);
    const comparison = existing
      ? this.research.compareCapturedConversation(existing.id, conversation)
      : null;
    const relation = comparison?.relation ?? "new";
    const canonicalConversation = comparison?.conversation ?? conversation;
    const sourceFingerprint = capturedConversationFingerprint(canonicalConversation);
    preview.status = "ready";
    preview.finalized = {
      conversation: canonicalConversation,
      incomingConversation: conversation,
      sourceFingerprint,
      existing,
      relation,
      coverage: comparison?.coverage ?? {
        existingMessageCount: 0,
        incomingMessageCount: conversation.messages.length,
        mergedMessageCount: conversation.messages.length,
        newCoverageMessageCount: conversation.messages.length,
        ...captureCoverage(conversation),
      },
      conflictReason: comparison?.reason ?? null,
    };
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
      messages: finalized?.conversation?.messages ?? [],
      completeness: finalized?.conversation?.completeness ?? (preview.status === "failed" ? "failed" : null),
      completenessDetails: finalized?.conversation?.completenessDetails ?? null,
      relation: finalized?.relation ?? null,
      coverage: finalized?.coverage ?? null,
      conflictReason: finalized?.conflictReason ?? null,
      existingRecord: finalized?.existing ?? null,
      sourceFingerprint: finalized?.sourceFingerprint ?? null,
      committed: preview.committed ?? null,
    };
  }
}

export function isChromeExtensionOrigin(origin) {
  return extensionIdFromOrigin(origin) !== null;
}
