import { createHash } from "node:crypto";

export const CAPTURE_SCHEMA_VERSION = "captured-conversation-v1";
export const CHATGPT_BROWSER_ADAPTER = "chatgpt-browser-v1";
export const CAPTURE_COMPLETENESS = ["complete", "partial", "failed"];

const UNSUPPORTED_CONTENT_TYPES = ["image", "video", "audio", "file", "canvas", "tool-ui", "unknown"];

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
      ? message.parts.filter((part) => part?.type !== "media-placeholder").map((part) => ({
        type: part.type,
        text: typeof part.text === "string"
          ? part.text.replace(/\r\n/g, "\n").trim()
          : undefined,
        language: part.language ?? undefined,
      }))
      : [{ type: "text", text: capturedMessageText(message) }],
  };
  return `sha256:captured-message-v1:${createHash("sha256").update(canonicalJson(semantic)).digest("hex")}`;
}

export function capturedMessageIdentity(message) {
  const externalId = message?.sourceMessageId ?? message?.id;
  return typeof externalId === "string" && externalId.trim()
    ? `id:${externalId.trim()}`
    : null;
}

export function capturedConversationFingerprint(conversation) {
  const sequence = conversation.messages.map((message) => semanticMessageFingerprint(message));
  return `sha256:captured-conversation-v1:${createHash("sha256").update(canonicalJson(sequence)).digest("hex")}`;
}

function unsupportedContentCounts(conversation) {
  const counts = Object.fromEntries(UNSUPPORTED_CONTENT_TYPES.map((type) => [type, 0]));
  for (const message of conversation?.messages ?? []) {
    for (const part of message?.parts ?? []) {
      if (part?.type !== "media-placeholder") continue;
      const type = UNSUPPORTED_CONTENT_TYPES.includes(part.mediaType) ? part.mediaType : "unknown";
      counts[type] += 1;
    }
  }
  const declared = conversation?.captureStats?.unsupportedContentCounts
    ?? conversation?.completenessDetails?.unsupportedContentCounts;
  if (declared && typeof declared === "object") {
    for (const type of UNSUPPORTED_CONTENT_TYPES) {
      counts[type] = Math.max(counts[type], Math.max(0, Number(declared[type] ?? 0)));
    }
  }
  return counts;
}

function totalUnsupported(counts) {
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
}

export function captureCoverage(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const details = conversation?.completenessDetails ?? {};
  const unsupportedCounts = unsupportedContentCounts(conversation);
  const authoritativeComplete = conversation?.captureAdapter === "chatgpt-export-v1"
    && conversation?.completeness === "complete";
  const conversationRootConfirmed = details.conversationRootConfirmed === true || authoritativeComplete;
  const windowTopConfirmed = details.windowTopConfirmed === true
    || details.topBoundaryConfirmed === true
    || authoritativeComplete;
  return {
    messageCount: messages.length,
    earliestMessageId: capturedMessageIdentity(messages[0])?.slice(3) ?? null,
    latestMessageId: capturedMessageIdentity(messages.at(-1))?.slice(3) ?? null,
    windowTopConfirmed,
    conversationRootConfirmed,
    earliestBoundaryConfirmed: conversationRootConfirmed
      && (details.earliestBoundaryConfirmed === true || authoritativeComplete),
    latestBoundaryConfirmed: details.latestBoundaryConfirmed === true
      || conversation?.completeness === "complete",
    captureCompleteness: conversation?.completeness === "complete" ? "complete" : "partial",
    captureSource: conversation?.captureAdapter ?? "unknown",
    capturedAt: conversation?.capturedAt ?? null,
    messageOmissionCount: Math.max(0, Number(
      conversation?.captureStats?.messageOmissionCount
      ?? details.messageOmissionCount
      ?? 0,
    )),
    unsupportedContentCounts: unsupportedCounts,
    unsupportedContentCount: totalUnsupported(unsupportedCounts),
  };
}

function indexedMessages(messages) {
  const identities = messages.map(capturedMessageIdentity);
  if (identities.some((identity) => identity === null)) {
    return { ok: false, reason: "missing-stable-message-id" };
  }
  const index = new Map();
  for (let position = 0; position < identities.length; position += 1) {
    const identity = identities[position];
    if (index.has(identity)) return { ok: false, reason: "duplicate-message-id" };
    index.set(identity, position);
  }
  return { ok: true, identities, index };
}

function coverageImproved(previous, incoming, mergedMessageCount) {
  return mergedMessageCount > previous.messageCount
    || (!previous.conversationRootConfirmed && incoming.conversationRootConfirmed)
    || (!previous.earliestBoundaryConfirmed && incoming.earliestBoundaryConfirmed)
    || (!previous.latestBoundaryConfirmed && incoming.latestBoundaryConfirmed)
    || (previous.captureCompleteness !== "complete" && incoming.captureCompleteness === "complete");
}

function mergeDetails(previous, incoming, mergedMessages, relation) {
  const previousCoverage = captureCoverage(previous);
  const incomingCoverage = captureCoverage(incoming);
  const mergedFirst = capturedMessageIdentity(mergedMessages[0]);
  const mergedLast = capturedMessageIdentity(mergedMessages.at(-1));
  const windowTopConfirmed = (
    mergedFirst === capturedMessageIdentity(previous.messages[0])
    && previousCoverage.windowTopConfirmed
  ) || (
    mergedFirst === capturedMessageIdentity(incoming.messages[0])
    && incomingCoverage.windowTopConfirmed
  );
  const conversationRootConfirmed = (
    mergedFirst === capturedMessageIdentity(previous.messages[0])
    && previousCoverage.conversationRootConfirmed
  ) || (
    mergedFirst === capturedMessageIdentity(incoming.messages[0])
    && incomingCoverage.conversationRootConfirmed
  );
  const earliestBoundaryConfirmed = conversationRootConfirmed && ((
    mergedFirst === capturedMessageIdentity(previous.messages[0])
    && previousCoverage.earliestBoundaryConfirmed
  ) || (
    mergedFirst === capturedMessageIdentity(incoming.messages[0])
    && incomingCoverage.earliestBoundaryConfirmed
  ));
  const latestBoundaryConfirmed = (
    mergedLast === capturedMessageIdentity(previous.messages.at(-1))
    && previousCoverage.latestBoundaryConfirmed
  ) || (
    mergedLast === capturedMessageIdentity(incoming.messages.at(-1))
    && incomingCoverage.latestBoundaryConfirmed
  );
  const unsupportedCounts = unsupportedContentCounts({ messages: mergedMessages });
  const unsupportedContentCount = totalUnsupported(unsupportedCounts);
  const messageOmissionCount = Math.max(
    previousCoverage.messageOmissionCount,
    incomingCoverage.messageOmissionCount,
  );
  const unresolvedBranches = previous?.completenessDetails?.unresolvedBranches === true
    || incoming?.completenessDetails?.unresolvedBranches === true;
  const reasons = [...new Set([
    ...(previous?.completenessDetails?.reasons ?? []),
    ...(incoming?.completenessDetails?.reasons ?? []),
  ])].filter((item) => typeof item === "string" && item.length > 0);
  for (const [confirmed, reason] of [
    [earliestBoundaryConfirmed, "earliest-boundary-unconfirmed"],
    [latestBoundaryConfirmed, "latest-boundary-unconfirmed"],
  ]) {
    const index = reasons.indexOf(reason);
    if (confirmed && index >= 0) reasons.splice(index, 1);
    if (!confirmed && index < 0) reasons.push(reason);
  }
  const authoritativeComplete = [previous, incoming].some((conversation) => (
    conversation?.captureAdapter === "chatgpt-export-v1" && conversation?.completeness === "complete"
  ));
  const passiveComplete = [previous, incoming].some((conversation) => {
    const details = conversation?.completenessDetails;
    return conversation?.captureAdapter === "chatgpt-browser-v1"
      && conversation?.completeness === "complete"
      && details?.passiveHistoryExhausted === true
      && details?.hasPreviousPageFinal === false
      && details?.conversationRootConfirmed === true;
  });
  const complete = (authoritativeComplete || passiveComplete)
    && earliestBoundaryConfirmed
    && latestBoundaryConfirmed
    && !unresolvedBranches
    && messageOmissionCount === 0
    && unsupportedContentCount === 0;
  const coverage = {
    messageCount: mergedMessages.length,
    earliestMessageId: capturedMessageIdentity(mergedMessages[0])?.slice(3) ?? null,
    latestMessageId: capturedMessageIdentity(mergedMessages.at(-1))?.slice(3) ?? null,
    earliestBoundaryConfirmed,
    latestBoundaryConfirmed,
    captureCompleteness: complete ? "complete" : "partial",
    captureSource: incoming.captureAdapter ?? "unknown",
    capturedAt: incoming.capturedAt ?? null,
  };
  return {
    ...incoming.completenessDetails,
    topBoundaryConfirmed: windowTopConfirmed,
    windowTopConfirmed,
    conversationRootConfirmed,
    earliestBoundaryConfirmed,
    latestBoundaryConfirmed,
    unresolvedBranches,
    messageOmissionCount,
    unsupportedContentCounts: unsupportedCounts,
    unsupportedContentCount,
    reasons,
    coverageRelation: relation,
    coverage,
  };
}

export function reconcileCapturedConversations(previous, incoming) {
  if (!previous || !incoming || !Array.isArray(previous.messages) || !Array.isArray(incoming.messages)) {
    return { relation: "conflict", reason: "invalid-conversation-sequence" };
  }
  if (previous.provider !== incoming.provider) return { relation: "conflict", reason: "provider-mismatch" };
  if (
    previous.externalConversationId
    && incoming.externalConversationId
    && previous.externalConversationId !== incoming.externalConversationId
  ) return { relation: "conflict", reason: "conversation-id-mismatch" };
  const previousScope = previous.branchScope ?? "active-visible-branch";
  const incomingScope = incoming.branchScope ?? "active-visible-branch";
  if (previousScope !== incomingScope) return { relation: "conflict", reason: "branch-scope-mismatch" };

  const previousIndex = indexedMessages(previous.messages);
  const incomingIndex = indexedMessages(incoming.messages);
  if (!previousIndex.ok) return { relation: "conflict", reason: previousIndex.reason };
  if (!incomingIndex.ok) return { relation: "conflict", reason: incomingIndex.reason };

  const common = previousIndex.identities.filter((identity) => incomingIndex.index.has(identity));
  if (common.length === 0) return { relation: "conflict", reason: "no-reliable-overlap" };
  const incomingCommon = incomingIndex.identities.filter((identity) => previousIndex.index.has(identity));
  if (common.some((identity, index) => incomingCommon[index] !== identity)) {
    return { relation: "conflict", reason: "message-order-changed" };
  }
  for (const identity of common) {
    const previousPosition = previousIndex.index.get(identity);
    const incomingPosition = incomingIndex.index.get(identity);
    if (
      semanticMessageFingerprint(previous.messages[previousPosition])
      !== semanticMessageFingerprint(incoming.messages[incomingPosition])
    ) return { relation: "conflict", reason: "message-content-changed" };
  }

  const mergedMessages = [];
  let previousCursor = 0;
  let incomingCursor = 0;
  for (const anchor of common) {
    const previousAnchor = previousIndex.index.get(anchor);
    const incomingAnchor = incomingIndex.index.get(anchor);
    const previousGap = previous.messages.slice(previousCursor, previousAnchor);
    const incomingGap = incoming.messages.slice(incomingCursor, incomingAnchor);
    if (previousGap.length > 0 && incomingGap.length > 0) {
      return { relation: "conflict", reason: "unexplained-overlap" };
    }
    mergedMessages.push(...(incomingGap.length > 0 ? incomingGap : previousGap));
    mergedMessages.push(incoming.messages[incomingAnchor]);
    previousCursor = previousAnchor + 1;
    incomingCursor = incomingAnchor + 1;
  }
  const previousTail = previous.messages.slice(previousCursor);
  const incomingTail = incoming.messages.slice(incomingCursor);
  if (previousTail.length > 0 && incomingTail.length > 0) {
    return { relation: "conflict", reason: "unexplained-overlap" };
  }
  mergedMessages.push(...(incomingTail.length > 0 ? incomingTail : previousTail));
  const orderedMessages = mergedMessages.map((message, order) => ({ ...message, order }));
  const previousCoverage = captureCoverage(previous);
  const incomingCoverage = captureCoverage(incoming);
  if (
    previousCoverage.earliestBoundaryConfirmed
    && previousCoverage.latestBoundaryConfirmed
    && incomingCoverage.earliestBoundaryConfirmed
    && incomingCoverage.latestBoundaryConfirmed
    && incoming.messages.length < previous.messages.length
  ) return { relation: "conflict", reason: "history-message-deleted" };
  const relation = coverageImproved(previousCoverage, incomingCoverage, orderedMessages.length)
    ? "safe_merge"
    : "identical";
  const completenessDetails = mergeDetails(previous, incoming, orderedMessages, relation);
  const completeness = completenessDetails.coverage.captureCompleteness;
  return {
    relation,
    reason: null,
    conversation: {
      ...previous,
      ...incoming,
      captureAdapter: relation === "identical" ? previous.captureAdapter : incoming.captureAdapter,
      capturedAt: relation === "identical" ? previous.capturedAt : incoming.capturedAt,
      externalConversationId: incoming.externalConversationId ?? previous.externalConversationId,
      branchScope: incoming.branchScope ?? previous.branchScope,
      messages: orderedMessages,
      completeness,
      completenessDetails,
      captureStats: {
        discoveredMessageCount: orderedMessages.length,
        messageOmissionCount: completenessDetails.messageOmissionCount,
        unsupportedContentCounts: completenessDetails.unsupportedContentCounts,
        unsupportedContentCount: completenessDetails.unsupportedContentCount,
      },
    },
    coverage: {
      existingMessageCount: previous.messages.length,
      incomingMessageCount: incoming.messages.length,
      mergedMessageCount: orderedMessages.length,
      newCoverageMessageCount: Math.max(0, orderedMessages.length - previous.messages.length),
      earliestBoundaryConfirmed: completenessDetails.earliestBoundaryConfirmed,
      latestBoundaryConfirmed: completenessDetails.latestBoundaryConfirmed,
    },
  };
}

export function compareCapturedSequences(previous, next) {
  const result = reconcileCapturedConversations(previous, next);
  if (result.relation === "safe_merge") {
    const previousIdentities = previous.messages.map(capturedMessageIdentity);
    const nextIdentities = next.messages.map(capturedMessageIdentity);
    const strictAppend = nextIdentities.length > previousIdentities.length
      && previousIdentities.every((identity, index) => identity === nextIdentities[index]);
    return strictAppend ? "append" : "safe_merge";
  }
  return result.relation;
}
