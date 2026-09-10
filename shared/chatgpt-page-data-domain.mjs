const VISIBLE_ROLES = new Set(["user", "assistant"]);
const INTERNAL_NODE_TYPES = /thought|reasoning|system|tool|metadata|computer|model_editable_context|web.run/i;

export function normalizeVisibleText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeVisibleEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const codePoint = entity[1].toLowerCase() === "x"
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function stripChatGptCitationControls(value) {
  // ChatGPT Page Data embeds citations as private-use control tokens such as
  // \uE200cite\uE202...\uE201. The browser renders these as separate citation
  // chips, so the token payload is presentation metadata, not transcript text.
  return String(value ?? "").replace(/\uE200cite\uE202[^\uE201]*\uE201/gi, "");
}

/** Normalizes presentation differences only. It is never used for stored source content. */
export function normalizeVisibleContent(value) {
  return normalizeVisibleText(stripChatGptCitationControls(decodeVisibleEntities(value)))
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\[(?:[^\]]*)\]/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s+\S+\s*$/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(?<!\w)(\*|_)([^\n]+?)\1(?!\w)/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function messageVisibleText(message) {
  return normalizeVisibleText((message?.parts ?? []).map((part) => (
    part?.type === "media-placeholder"
      ? `[${part.label ?? "未完整保存的内容"}]`
      : part?.text ?? ""
  )).filter(Boolean).join("\n"));
}

function comparableVisibleText(value) { return normalizeVisibleContent(value); }

function domComparableVisibleText(message) {
  return comparableVisibleText(message?.comparisonText ?? messageVisibleText(message));
}

function compactVisibleText(value) {
  return comparableVisibleText(value)
    .replace(/^(?:you said|chatgpt said|你说|chatgpt 说)\s*:*/i, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isOrderedSubsequence(visible, source) {
  if (!visible || !source || visible.length >= source.length) return false;
  let visibleIndex = 0;
  for (let sourceIndex = 0; sourceIndex < source.length && visibleIndex < visible.length; sourceIndex += 1) {
    if (source[sourceIndex] === visible[visibleIndex]) visibleIndex += 1;
  }
  return visibleIndex === visible.length;
}

function hashFingerprint(prefix, value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, "0")}:${value.length}`;
}

export function visibleContentFingerprint(role, text) {
  const value = `${role}\n${normalizeVisibleText(text)}`;
  return hashFingerprint("browser-v1", value);
}

export function sourceContentFingerprint(role, parts) {
  const value = `${role}\n${JSON.stringify((parts ?? []).map((part) => ({
    type: part?.type ?? "text",
    text: String(part?.text ?? "").replace(/\r\n/g, "\n"),
    language: part?.language ?? null,
    url: part?.url ?? null,
    label: part?.label ?? null,
    mediaType: part?.mediaType ?? null,
  })))}`;
  return hashFingerprint("browser-source-v1", value);
}

export function visibleSemanticFingerprint(role, value) {
  return visibleContentFingerprint(role, normalizeVisibleContent(value));
}

function canonicalNode(node) {
  return JSON.stringify({
    sourceMessageId: node.sourceMessageId ?? node.messageId,
    parentId: node.parentId,
    parentKnown: node.parentKnown,
    role: node.role,
    nodeType: node.nodeType,
    contentKind: node.contentKind,
    parts: node.parts,
    occurredAt: node.occurredAt,
    visibleContentOmitted: node.visibleContentOmitted === true,
  });
}

export class PageDataAccumulator {
  constructor(expectedConversationId) {
    this.expectedConversationId = expectedConversationId;
    this.nodes = new Map();
    this.parentConflicts = new Set();
    this.pageDataConflicts = new Set();
    this.crossConversationResponses = 0;
    this.currentNodes = [];
    this.pageStates = [];
    this.nodeProgression = [];
    this.ingestedBatchIds = new Set();
    this.initialPassiveNodeCount = 0;
    this.historyPagesLoaded = 0;
    this.pageKeys = new Set();
    this.sourceMessageNodeIds = new Map();
    this.orderedPages = [];
    this.orderedPageKeys = new Set();
  }

  ingest(batch) {
    if (!batch || batch.schemaVersion !== "chatgpt-page-data-v1") return { accepted: false, newNodeCount: 0 };
    if (batch.conversationId && this.expectedConversationId && batch.conversationId !== this.expectedConversationId) {
      this.crossConversationResponses += 1;
      return { accepted: false, newNodeCount: 0 };
    }
    if (this.ingestedBatchIds.has(batch.batchId)) return { accepted: false, newNodeCount: 0 };
    this.ingestedBatchIds.add(batch.batchId);
    const before = this.nodes.size;
    for (const node of batch.nodes ?? []) {
      if (node.sourceMessageId) {
        const existingNodeId = this.sourceMessageNodeIds.get(node.sourceMessageId);
        if (existingNodeId && existingNodeId !== node.messageId) this.pageDataConflicts.add(node.messageId);
        else this.sourceMessageNodeIds.set(node.sourceMessageId, node.messageId);
      }
      const existing = this.nodes.get(node.messageId);
      if (!existing) {
        this.nodes.set(node.messageId, node);
        continue;
      }
      if (existing.parentKnown && node.parentKnown && existing.parentId !== node.parentId) {
        this.parentConflicts.add(node.messageId);
      }
      if (canonicalNode(existing) !== canonicalNode(node)) {
        const existingText = messageVisibleText(existing);
        const incomingText = messageVisibleText(node);
        if (
          existing.parentId !== node.parentId
          || existing.role !== node.role
          || existingText !== incomingText
          || existing.visibleContentOmitted !== node.visibleContentOmitted
        ) this.pageDataConflicts.add(node.messageId);
      }
      if (messageVisibleText(node).length > messageVisibleText(existing).length) this.nodes.set(node.messageId, node);
    }
    if (batch.currentNode) this.currentNodes.push(batch.currentNode);
    if (batch.pageInfo) {
      this.pageStates.push({ ...batch.pageInfo, batchId: batch.batchId });
      const pageKey = batch.pageInfo.startCursor ?? batch.pageInfo.before ?? batch.pageInfo.previousCursor ?? `batch:${batch.batchId}`;
      if (!this.pageKeys.has(pageKey)) {
        if (this.pageKeys.size > 0) this.historyPagesLoaded += 1;
        this.pageKeys.add(pageKey);
      }
      if (batch.orderedPage && !this.orderedPageKeys.has(pageKey)) {
        this.orderedPageKeys.add(pageKey);
        this.orderedPages.push({ ...batch.orderedPage, batchId: batch.batchId, pageKey });
      }
    }
    const newNodeCount = this.nodes.size - before;
    if (this.nodeProgression.length === 0) this.initialPassiveNodeCount = this.nodes.size;
    if (newNodeCount > 0 || this.nodeProgression.length === 0) this.nodeProgression.push(this.nodes.size);
    return { accepted: true, newNodeCount };
  }

  ingestAll(batches) {
    let acceptedBatchCount = 0;
    let newNodeCount = 0;
    for (const batch of batches ?? []) {
      const result = this.ingest(batch);
      if (result.accepted) acceptedBatchCount += 1;
      newNodeCount += result.newNodeCount;
    }
    return { acceptedBatchCount, newNodeCount };
  }

  latestPageState() {
    return this.pageStates.at(-1) ?? null;
  }

  latestCurrentNode() {
    return [...this.currentNodes].reverse().find((id) => this.nodes.has(id)) ?? null;
  }

  snapshot() {
    const page = this.latestPageState();
    return {
      batchCount: this.ingestedBatchIds.size,
      nodeCount: this.nodes.size,
      cursor: page?.startCursor ?? page?.before ?? page?.previousCursor ?? null,
      hasPreviousPage: page?.hasPreviousPage ?? null,
    };
  }
}

function resolveNodeIdentity(accumulator, id) {
  if (!id) return null;
  if (accumulator.nodes.has(id)) return id;
  return accumulator.sourceMessageNodeIds.get(id) ?? null;
}

function isAncestor(accumulator, ancestor, descendant) {
  const nodes = accumulator.nodes;
  const seen = new Set();
  let cursor = descendant;
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestor) return true;
    seen.add(cursor);
    cursor = resolveNodeIdentity(accumulator, nodes.get(cursor)?.parentId ?? null);
  }
  return false;
}

function parentChainLength(accumulator, candidate) {
  const nodes = accumulator.nodes;
  const seen = new Set();
  let cursor = candidate;
  let length = 0;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = nodes.get(cursor);
    if (!node) break;
    length += 1;
    if (!node.parentKnown || node.parentId === null || node.parentId === node.messageId) break;
    cursor = resolveNodeIdentity(accumulator, node.parentId);
  }
  return length;
}

export function resolveActivePath(accumulator, domLeafId = null) {
  const nodes = accumulator.nodes;
  const currentCandidates = [...new Set(accumulator.currentNodes.map((id) => resolveNodeIdentity(accumulator, id)).filter(Boolean))];
  const domLeafNodeId = resolveNodeIdentity(accumulator, domLeafId);
  let activeLeaf = domLeafNodeId ?? currentCandidates.reduce((best, candidate) => (
    !best || parentChainLength(accumulator, candidate) > parentChainLength(accumulator, best) ? candidate : best
  ), null);
  if (!activeLeaf) activeLeaf = accumulator.latestCurrentNode();
  const unrelatedCandidates = activeLeaf
    ? currentCandidates.filter((id) => id !== activeLeaf && !isAncestor(accumulator, id, activeLeaf) && !isAncestor(accumulator, activeLeaf, id))
    : currentCandidates;
  const path = [];
  const seen = new Set();
  let missingParentCount = 0;
  let cycleCount = 0;
  let selfParentCount = 0;
  let reachedExplicitRoot = false;
  let cursor = activeLeaf;
  while (cursor) {
    if (seen.has(cursor)) {
      cycleCount += 1;
      break;
    }
    seen.add(cursor);
    const node = nodes.get(cursor);
    if (!node) {
      missingParentCount += 1;
      break;
    }
    path.push(node);
    if (!node.parentKnown) {
      missingParentCount += 1;
      break;
    }
    if (node.parentId === null) {
      reachedExplicitRoot = true;
      break;
    }
    const resolvedParentId = resolveNodeIdentity(accumulator, node.parentId);
    if (resolvedParentId === node.messageId) {
      selfParentCount += 1;
      cycleCount += 1;
      break;
    }
    if (!resolvedParentId) {
      missingParentCount += 1;
      break;
    }
    cursor = resolvedParentId;
  }
  path.reverse();
  const firstUserIndex = path.findIndex((node) => node.role === "user" && messageVisibleText(node));
  return {
    activeLeaf,
    activeLeafConfirmed: Boolean(activeLeaf && nodes.has(activeLeaf)),
    path,
    pathLength: path.length,
    reachedExplicitRoot,
    missingParentCount,
    cycleCount,
    selfParentCount,
    parentConflictCount: accumulator.parentConflicts.size,
    pageDataConflictCount: accumulator.pageDataConflicts.size,
    branchAmbiguityCount: unrelatedCandidates.length,
    firstUserConfirmed: firstUserIndex >= 0,
    conversationRootConfirmed: Boolean(
      activeLeaf
      && reachedExplicitRoot
      && missingParentCount === 0
      && cycleCount === 0
      && accumulator.parentConflicts.size === 0
      && unrelatedCandidates.length === 0
      && firstUserIndex >= 0
    ),
  };
}

export function projectVisibleMessages(path) {
  return (path ?? []).filter((node) => VISIBLE_ROLES.has(node.role) && !INTERNAL_NODE_TYPES.test(node.nodeType) && messageVisibleText(node)).map((node, order) => ({
    order,
    role: node.role,
    sourceMessageId: node.sourceMessageId ?? node.messageId,
    occurredAt: node.occurredAt ?? null,
    parts: node.parts,
    fingerprint: sourceContentFingerprint(node.role, node.parts),
  }));
}

export function crossCheckDomMessages(domMessages, graphMessages) {
  const graphById = new Map((graphMessages ?? []).filter((message) => message.sourceMessageId).map((message) => [message.sourceMessageId, message]));
  let matchedCount = 0;
  let unmatchedCount = 0;
  let fingerprintMismatchCount = 0;
  for (const dom of domMessages ?? []) {
    const graph = dom.sourceMessageId ? graphById.get(dom.sourceMessageId) : null;
    if (!graph || graph.role !== dom.role) {
      unmatchedCount += 1;
      continue;
    }
    matchedCount += 1;
    const domText = dom?.comparisonText ?? messageVisibleText(dom);
    const graphText = messageVisibleText(graph);
    if (comparableVisibleText(domText) !== comparableVisibleText(graphText)) fingerprintMismatchCount += 1;
  }
  return { matchedCount, unmatchedCount, fingerprintMismatchCount };
}

function semanticNodeType(node) {
  if (node.role === "user") return "user";
  if (node.role === "assistant") return "assistant";
  if (/thought|reasoning/i.test(node.nodeType)) return "thoughts";
  if (node.role === "tool" || /tool|computer|web\.run/i.test(node.nodeType)) return "tool";
  if (node.role === "system") return "system";
  if (INTERNAL_NODE_TYPES.test(node.nodeType)) return "internal";
  return "unknown";
}

function orderedVisibleProjection(nodes, domVisibleIds = new Set()) {
  return nodes.filter((node) => (
    (VISIBLE_ROLES.has(node.role) && !INTERNAL_NODE_TYPES.test(node.nodeType) && messageVisibleText(node))
    || (node.role === "tool" && domVisibleIds.has(node.sourceMessageId ?? node.messageId) && messageVisibleText(node))
  )).map((node, order) => ({
    order,
    role: node.role,
    sourceMessageId: node.sourceMessageId ?? node.messageId,
    occurredAt: node.occurredAt ?? null,
    parts: node.parts,
    fingerprint: sourceContentFingerprint(node.role, node.parts),
    diagnosticMessageHash: node.diagnosticMessageHash ?? "none",
    diagnosticStructure: node.diagnosticStructure,
    diagnosticContentKind: node.contentKind,
  }));
}

const EMPTY_STRUCTURE = Object.freeze({
  heading: 0, boldItalic: 0, inlineCode: 0, codeBlock: 0, link: 0,
  citation: 0, blockquote: 0, listItem: 0, table: 0, math: 0,
  htmlEntity: 0, unicode: 0, toolCard: 0, hiddenUi: 0, unknownRich: 0,
});

function safeStructure(value) {
  return Object.fromEntries(Object.keys(EMPTY_STRUCTURE).map((key) => [
    key, Math.max(0, Number(value?.[key] ?? 0)),
  ]));
}

function characterType(value) {
  if (value === undefined) return "end";
  if (/\s/u.test(value)) return "whitespace";
  if (/\p{L}|\p{N}/u.test(value)) return "alphanumeric";
  if (/\p{P}|\p{S}/u.test(value)) return "punctuation";
  return "other";
}

function firstDifferenceProfile(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  const denominator = Math.max(left.length, right.length, 1);
  const ratio = index / denominator;
  return {
    region: index >= denominator ? "end" : ratio < 0.1 ? "start" : ratio < 0.35 ? "early" : ratio < 0.75 ? "middle" : "late",
    leftType: characterType(left[index]),
    rightType: characterType(right[index]),
  };
}

function citationComparable(value) {
  return normalizeVisibleContent(value)
    .replace(/[【\[]\s*\d+(?:\s*[-,–]\s*\d+)*\s*[】\]]/g, "")
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, "")
    .trim();
}

function toolUiComparable(value) {
  return citationComparable(value)
    .replace(/^(?:you said|chatgpt said|你说|chatgpt 说)\s*:*/i, "")
    .replace(/(?:copy code|复制代码|sources?|来源|download|下载)\s*$/gim, "")
    .trim();
}

function sourceFormattingCategories(value) {
  const text = String(value ?? "");
  return {
    plainText: text.length > 0 ? 1 : 0,
    markdownHeading: /^\s{0,3}#{1,6}\s+/m.test(text) ? 1 : 0,
    boldItalic: /(\*\*|__|(?<!\w)[*_][^\n]+[*_](?!\w))/.test(text) ? 1 : 0,
    inlineCode: /`[^`\n]+`/.test(text) ? 1 : 0,
    codeBlock: /```[\s\S]*?```/.test(text) ? 1 : 0,
    markdownLink: /\[[^\]]+\]\([^)]+\)/.test(text) ? 1 : 0,
    citation: /\uE200cite\uE202[^\uE201]*\uE201|[【\[]\s*\d+(?:\s*[-,–]\s*\d+)*\s*[】\]]|[¹²³⁴⁵⁶⁷⁸⁹⁰]/i.test(text) ? 1 : 0,
    list: /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/m.test(text) ? 1 : 0,
    blockquote: /^\s{0,3}>\s?/m.test(text) ? 1 : 0,
    table: /^\s*\|.+\|\s*$/m.test(text) ? 1 : 0,
    math: /\$\$?[\s\S]+?\$\$?|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(text) ? 1 : 0,
    unicodeEntity: /&(?:#\d+|#x[0-9a-f]+|\w+);|[^\x00-\x7F]/i.test(text) ? 1 : 0,
    whitespaceNewline: /\r\n|[ \t]{2,}|\n{3,}/.test(text) ? 1 : 0,
    toolPlaceholder: /(?:copy code|复制代码|sources?|来源|download|下载)/i.test(text) ? 1 : 0,
    other: 0,
  };
}

function hasPresentationSyntax(categories) {
  return [
    "markdownHeading", "boldItalic", "inlineCode", "codeBlock", "markdownLink", "citation",
    "list", "blockquote", "table", "math", "whitespaceNewline", "toolPlaceholder",
  ].some((category) => categories[category] > 0);
}

function orderedDomMatch(domMessages, streamMessages) {
  const indexesById = new Map();
  for (let index = 0; index < streamMessages.length; index += 1) {
    const id = streamMessages[index].sourceMessageId;
    if (!id) continue;
    const indexes = indexesById.get(id) ?? [];
    indexes.push(index);
    indexesById.set(id, indexes);
  }
  let cursor = -1;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let orderingMismatchCount = 0;
  let fingerprintMismatchCount = 0;
  let formattingOnlyMismatchCount = 0;
  let citationOnlyMismatchCount = 0;
  let toolUiOnlyMismatchCount = 0;
  let realTextMismatchCount = 0;
  const mismatchCategories = {
    plainText: 0, markdownHeading: 0, boldItalic: 0, inlineCode: 0, codeBlock: 0,
    markdownLink: 0, citation: 0, list: 0, blockquote: 0, table: 0, math: 0,
    unicodeEntity: 0, whitespaceNewline: 0, toolPlaceholder: 0, other: 0,
  };
  let compactMatchCount = 0;
  let domContainsStreamCount = 0;
  let streamContainsDomCount = 0;
  const matchedIndexes = [];
  const mismatchProfiles = [];
  for (const dom of domMessages ?? []) {
    const indexes = dom.sourceMessageId ? indexesById.get(dom.sourceMessageId) ?? [] : [];
    const nextIndex = indexes.find((index) => index > cursor);
    if (nextIndex === undefined) {
      if (indexes.length > 0) orderingMismatchCount += 1;
      else unmatchedCount += 1;
      continue;
    }
    const stream = streamMessages[nextIndex];
    if (stream.role !== dom.role) {
      unmatchedCount += 1;
      continue;
    }
    cursor = nextIndex;
    matchedIndexes.push(nextIndex);
    matchedCount += 1;
    const domRaw = dom?.comparisonText ?? messageVisibleText(dom);
    const streamRaw = messageVisibleText(stream);
    const domComparable = domComparableVisibleText(dom);
    const streamComparable = comparableVisibleText(streamRaw);
    const domCompact = compactVisibleText(domComparable);
    const streamCompact = compactVisibleText(streamComparable);
    const domIsOrderedSubset = isOrderedSubsequence(domCompact, streamCompact);
    if (domCompact && domCompact === streamCompact) compactMatchCount += 1;
    if (domCompact && streamCompact && domCompact.includes(streamCompact)) domContainsStreamCount += 1;
    if (domCompact && streamCompact && streamCompact.includes(domCompact)) streamContainsDomCount += 1;
    if (domComparable !== streamComparable) {
      fingerprintMismatchCount += 1;
      const categories = sourceFormattingCategories(streamRaw);
      let classification = "real";
      if (citationComparable(domRaw) === citationComparable(streamRaw)) { citationOnlyMismatchCount += 1; classification = "citation"; }
      else if (toolUiComparable(domRaw) === toolUiComparable(streamRaw)) { toolUiOnlyMismatchCount += 1; classification = "tool-ui"; }
      else if (domCompact && domCompact === streamCompact && hasPresentationSyntax(categories)) { formattingOnlyMismatchCount += 1; classification = "formatting"; }
      else if (domIsOrderedSubset) { formattingOnlyMismatchCount += 1; classification = "formatting"; }
      else realTextMismatchCount += 1;
      const firstDifference = firstDifferenceProfile(domComparable, streamComparable);
      mismatchProfiles.push({
        messageHash: typeof stream.diagnosticMessageHash === "string" && /^(?:session:[a-f0-9]{8}|none)$/.test(stream.diagnosticMessageHash)
          ? stream.diagnosticMessageHash : "none",
        domOrder: Math.max(0, Number(dom.order ?? 0)),
        streamOrder: nextIndex,
        role: dom.role,
        domLength: domComparable.length,
        streamLength: streamComparable.length,
        compactEqual: Boolean(domCompact && domCompact === streamCompact),
        domContainsStream: Boolean(domCompact && streamCompact && domCompact.includes(streamCompact)),
        streamContainsDom: Boolean(domCompact && streamCompact && streamCompact.includes(domCompact)),
        domIsOrderedSubset,
        placeholderCount: (stream.parts ?? []).filter((part) => part?.type === "media-placeholder").length,
        sourceContentKind: String(stream.diagnosticContentKind ?? "unknown").slice(0, 100),
        sourceStructure: safeStructure(stream.diagnosticStructure),
        domStructure: safeStructure(dom.diagnosticStructure),
        firstDifferenceRegion: firstDifference.region,
        firstDifferenceDomType: firstDifference.leftType,
        firstDifferenceSourceType: firstDifference.rightType,
        classification,
      });
      for (const [category, count] of Object.entries(categories)) mismatchCategories[category] += count;
    } else if (normalizeVisibleText(domRaw) !== normalizeVisibleText(streamRaw)) {
      const categories = sourceFormattingCategories(streamRaw);
      if (categories.citation > 0) citationOnlyMismatchCount += 1;
      else formattingOnlyMismatchCount += 1;
      for (const [category, count] of Object.entries(categories)) mismatchCategories[category] += count;
    }
  }
  return {
    matchedCount,
    unmatchedCount,
    orderingMismatchCount,
    fingerprintMismatchCount,
    formattingOnlyMismatchCount,
    citationOnlyMismatchCount,
    toolUiOnlyMismatchCount,
    realTextMismatchCount,
    mismatchCategories,
    compactMatchCount,
    domContainsStreamCount,
    streamContainsDomCount,
    mismatchProfiles,
    contiguous: matchedIndexes.every((value, index) => index === 0 || value === matchedIndexes[index - 1] + 1),
  };
}

function contentKindCategory(value) {
  const kind = String(value ?? "").toLowerCase();
  if (/image/.test(kind)) return "image";
  if (/video/.test(kind)) return "video";
  if (/audio/.test(kind)) return "audio";
  if (/file|attachment/.test(kind)) return "file";
  if (/canvas/.test(kind)) return "canvas";
  if (/tool|research/.test(kind)) return "tool-ui";
  if (/text|code/.test(kind)) return "text";
  if (!kind || kind === "unknown" || kind === "none") return "unknown";
  return "other";
}

function orderedHistoryProjection(accumulator, domMessages = []) {
  const pages = [...accumulator.orderedPages].sort((left, right) => left.responseSequence - right.responseSequence);
  let timestampAscendingPairs = 0;
  let timestampDescendingPairs = 0;
  let parentForwardLinks = 0;
  let parentBackwardLinks = 0;
  for (const page of pages) {
    const ids = page.items.map((item) => resolveNodeIdentity(accumulator, item.messageId)).filter(Boolean);
    const positions = new Map(ids.map((id, index) => [id, index]));
    for (let index = 1; index < ids.length; index += 1) {
      const previousTime = Date.parse(accumulator.nodes.get(ids[index - 1])?.occurredAt ?? "");
      const currentTime = Date.parse(accumulator.nodes.get(ids[index])?.occurredAt ?? "");
      if (Number.isFinite(previousTime) && Number.isFinite(currentTime) && previousTime !== currentTime) {
        if (previousTime < currentTime) timestampAscendingPairs += 1;
        else timestampDescendingPairs += 1;
      }
    }
    for (const id of ids) {
      const parentId = resolveNodeIdentity(accumulator, accumulator.nodes.get(id)?.parentId ?? null);
      if (!parentId || !positions.has(parentId)) continue;
      if (positions.get(parentId) < positions.get(id)) parentForwardLinks += 1;
      else parentBackwardLinks += 1;
    }
  }
  const asObservedScore = timestampAscendingPairs + (parentForwardLinks * 2);
  const reversedScore = timestampDescendingPairs + (parentBackwardLinks * 2);
  const itemOrderRule = asObservedScore > reversedScore
    ? "oldest-to-newest"
    : reversedScore > asObservedScore ? "newest-to-oldest" : "unresolved";
  const orderedIds = [];
  const seen = new Set();
  for (const page of [...pages].reverse()) {
    const items = itemOrderRule === "newest-to-oldest" ? [...page.items].reverse() : page.items;
    for (const item of items) {
      const id = resolveNodeIdentity(accumulator, item.messageId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      orderedIds.push(id);
    }
  }
  const nodes = orderedIds.map((id) => accumulator.nodes.get(id)).filter(Boolean);
  const domVisibleIds = new Set(domMessages.map((message) => message.sourceMessageId).filter(Boolean));
  return {
    pages,
    nodes,
    messages: orderedVisibleProjection(nodes, domVisibleIds),
    itemOrderRule,
    itemOrderValidated: itemOrderRule !== "unresolved",
  };
}

/** The canonical visible transcript: exhausted pagination pages, oldest to newest, stable identity dedupe. */
export function projectOrderedVisibleMessages(accumulator, domMessages = []) {
  return orderedHistoryProjection(accumulator, domMessages).messages;
}

export function auditOrderedHistory(accumulator, domMessages = []) {
  const startedAt = Date.now();
  const pages = [...accumulator.orderedPages].sort((left, right) => left.responseSequence - right.responseSequence);
  let timestampAscendingPairs = 0;
  let timestampDescendingPairs = 0;
  let parentForwardLinks = 0;
  let parentBackwardLinks = 0;
  const pageSummaries = [];
  for (const page of pages) {
    const ids = page.items.map((item) => resolveNodeIdentity(accumulator, item.messageId)).filter(Boolean);
    const positions = new Map(ids.map((id, index) => [id, index]));
    for (let index = 1; index < ids.length; index += 1) {
      const previousTime = Date.parse(accumulator.nodes.get(ids[index - 1])?.occurredAt ?? "");
      const currentTime = Date.parse(accumulator.nodes.get(ids[index])?.occurredAt ?? "");
      if (Number.isFinite(previousTime) && Number.isFinite(currentTime) && previousTime !== currentTime) {
        if (previousTime < currentTime) timestampAscendingPairs += 1;
        else timestampDescendingPairs += 1;
      }
    }
    for (const id of ids) {
      const parentId = resolveNodeIdentity(accumulator, accumulator.nodes.get(id)?.parentId ?? null);
      if (!parentId || !positions.has(parentId)) continue;
      if (positions.get(parentId) < positions.get(id)) parentForwardLinks += 1;
      else parentBackwardLinks += 1;
    }
    pageSummaries.push({
      responseSequence: page.responseSequence,
      cursorHash: page.cursorHash,
      hasPreviousPage: page.hasPreviousPage,
      itemCount: page.items.length,
      collection: page.collection,
    });
  }

  const asObservedScore = timestampAscendingPairs + (parentForwardLinks * 2);
  const reversedScore = timestampDescendingPairs + (parentBackwardLinks * 2);
  const itemOrderRule = asObservedScore > reversedScore
    ? "oldest-to-newest"
    : reversedScore > asObservedScore ? "newest-to-oldest" : "unresolved";
  const itemOrderValidated = itemOrderRule !== "unresolved";
  const orderedIds = [];
  const seen = new Set();
  for (const page of [...pages].reverse()) {
    const items = itemOrderRule === "newest-to-oldest" ? [...page.items].reverse() : page.items;
    for (const item of items) {
      const id = resolveNodeIdentity(accumulator, item.messageId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      orderedIds.push(id);
    }
  }
  const orderedNodes = orderedIds.map((id) => accumulator.nodes.get(id)).filter(Boolean);
  const roleCounts = { user: 0, assistant: 0, thoughts: 0, tool: 0, system: 0, internal: 0, unknown: 0 };
  for (const node of accumulator.nodes.values()) roleCounts[semanticNodeType(node)] += 1;
  const visibleMessages = orderedVisibleProjection(orderedNodes);
  const domMatch = orderedDomMatch(domMessages, visibleMessages);
  const omittedVisibleContentKinds = { text: 0, image: 0, video: 0, audio: 0, file: 0, canvas: 0, "tool-ui": 0, unknown: 0, other: 0 };
  for (const node of accumulator.nodes.values()) {
    if ((node.role === "user" || node.role === "assistant") && node.visibleContentOmitted) {
      omittedVisibleContentKinds[contentKindCategory(node.contentKind)] += 1;
    }
  }
  const childrenByParent = new Map();
  for (const node of accumulator.nodes.values()) {
    const parentId = resolveNodeIdentity(accumulator, node.parentId);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(node);
    childrenByParent.set(parentId, children);
  }
  let graphBranchPointCount = 0;
  let visibleBranchPointCount = 0;
  for (const children of childrenByParent.values()) {
    if (children.length > 1) graphBranchPointCount += 1;
    const visibleChildren = children.filter((node) => VISIBLE_ROLES.has(node.role) && !INTERNAL_NODE_TYPES.test(node.nodeType) && messageVisibleText(node));
    if (visibleChildren.length > 1) visibleBranchPointCount += 1;
  }
  let pageTimeOrderViolationCount = 0;
  for (let index = 1; index < pages.length; index += 1) {
    const newerTimes = pages[index - 1].items.map((item) => Date.parse(accumulator.nodes.get(resolveNodeIdentity(accumulator, item.messageId))?.occurredAt ?? "")).filter(Number.isFinite);
    const olderTimes = pages[index].items.map((item) => Date.parse(accumulator.nodes.get(resolveNodeIdentity(accumulator, item.messageId))?.occurredAt ?? "")).filter(Number.isFinite);
    if (newerTimes.length > 0 && olderTimes.length > 0 && Math.min(...olderTimes) > Math.max(...newerTimes)) pageTimeOrderViolationCount += 1;
  }
  const finalPage = pages.at(-1);
  const pageOrderValidated = pages.length > 0
    && finalPage?.hasPreviousPage === false
    && pageTimeOrderViolationCount === 0;
  return {
    pageOrderRule: "capture-sequence-newest-to-oldest",
    pageOrderValidated,
    pageTimeOrderViolationCount,
    itemOrderRule,
    itemOrderValidated,
    timestampAscendingPairs,
    timestampDescendingPairs,
    parentForwardLinks,
    parentBackwardLinks,
    pageSummaries,
    orderedUniqueNodeCount: orderedNodes.length,
    unpagedNodeCount: Math.max(0, accumulator.nodes.size - orderedNodes.length),
    roleCounts,
    hasVisibleContentNodeCount: [...accumulator.nodes.values()].filter((node) => messageVisibleText(node)).length,
    visibleMessageCount: visibleMessages.length,
    visibleToolMessageCount: visibleMessages.filter((message) => message.role === "tool").length,
    firstVisibleUserFound: visibleMessages[0]?.role === "user" || visibleMessages.some((message) => message.role === "user"),
    graphBranchPointCount,
    visibleBranchPointCount,
    branchScoped: visibleBranchPointCount > 0 ? false : domMatch.unmatchedCount === 0 && domMatch.orderingMismatchCount === 0,
    domVisibleCount: domMessages.length,
    domMatchedCount: domMatch.matchedCount,
    domUnmatchedCount: domMatch.unmatchedCount,
    domOrderingMismatchCount: domMatch.orderingMismatchCount,
    domFingerprintMismatchCount: domMatch.fingerprintMismatchCount,
    domFormattingOnlyMismatchCount: domMatch.formattingOnlyMismatchCount,
    domCitationOnlyMismatchCount: domMatch.citationOnlyMismatchCount,
    domToolUiOnlyMismatchCount: domMatch.toolUiOnlyMismatchCount,
    domRealTextMismatchCount: domMatch.realTextMismatchCount,
    mismatchProfiles: domMatch.mismatchProfiles,
    omittedVisibleContentKinds,
    mismatchCategories: domMatch.mismatchCategories,
    domCompactMatchCount: domMatch.compactMatchCount,
    domContainsStreamCount: domMatch.domContainsStreamCount,
    streamContainsDomCount: domMatch.streamContainsDomCount,
    domContiguous: domMatch.contiguous,
    buildDurationMs: Date.now() - startedAt,
  };
}

export function visibleConversationComplete(evidence) {
  return evidence?.conversationIdStable === true
    && evidence?.passiveHistoryExhausted === true
    && evidence?.hasPreviousPageFinal === false
    && evidence?.pageOrderValidated === true
    && evidence?.itemOrderValidated === true
    && evidence?.activeBranchUniquelyValidated === true
    && evidence?.firstVisibleUserFound === true
    && evidence?.paginationGapCount === 0
    && evidence?.paginationLoopDetected !== true
    && evidence?.pageDataConflictCount === 0
    && evidence?.orderedVisibleIdentityStable === true
    && evidence?.domUnmatchedCount === 0
    && evidence?.domOrderingMismatchCount === 0
    && evidence?.domRealTextMismatchCount === 0
    && evidence?.confirmedTextMessageOmissionCount === 0
    && evidence?.adapterHealthy === true;
}

export function paginationProgress(previous, next) {
  return {
    batchAdvanced: next.batchCount > previous.batchCount,
    newNodeCount: Math.max(0, next.nodeCount - previous.nodeCount),
    cursorChanged: Boolean(next.cursor && next.cursor !== previous.cursor),
    hasPreviousChanged: next.hasPreviousPage !== previous.hasPreviousPage,
    progressed: next.batchCount > previous.batchCount
      || next.nodeCount > previous.nodeCount
      || Boolean(next.cursor && next.cursor !== previous.cursor)
      || next.hasPreviousPage !== previous.hasPreviousPage,
  };
}

export function passiveHistoryState(snapshot, { stalled = false, cursorLoop = false } = {}) {
  if (snapshot?.hasPreviousPage === false) return { state: "exhausted", reason: null };
  if (cursorLoop) return { state: "partial", reason: "pagination_loop_detected" };
  if (stalled) return { state: "partial", reason: "history_loading_stalled" };
  if (snapshot?.hasPreviousPage === true) return { state: "continue", reason: null };
  return { state: "unproven", reason: "passive-history-unproven" };
}

export function historyRetryDecision(snapshot, {
  stallAttempts = 0,
  elapsedMs = 0,
  maxStallAttempts = 3,
  maxDurationMs = 180_000,
} = {}) {
  if (snapshot?.hasPreviousPage !== true) return { retry: false, stalled: false };
  const stalled = stallAttempts >= maxStallAttempts || elapsedMs >= maxDurationMs;
  return { retry: !stalled, stalled };
}
