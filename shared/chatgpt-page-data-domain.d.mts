import type { CapturedMessage, CapturedPart } from "../extensions/research-os-chrome/src/model/captured-conversation";

export type PageGraphNode = {
  messageId: string;
  sourceMessageId?: string | null;
  parentId: string | null;
  parentKnown: boolean;
  role: CapturedMessage["role"];
  nodeType: string;
  contentKind: string;
  parts: CapturedPart[];
  occurredAt: string | null;
  visibleContentOmitted: boolean;
  diagnosticMessageHash?: string;
  diagnosticStructure?: import("../extensions/research-os-chrome/src/model/captured-conversation").ContentStructureProfile;
};

export type PageDataBatch = {
  schemaVersion: "chatgpt-page-data-v1";
  batchId: string;
  conversationId: string | null;
  currentNode: string | null;
  nodes: PageGraphNode[];
  pageInfo: null | {
    hasPreviousPage: boolean | null;
    startCursor: string | null;
    endCursor: string | null;
    before: string | null;
    previousCursor: string | null;
  };
  orderedPage?: null | {
    responseSequence: number;
    collection: "messages" | "mapping";
    cursorHash: string;
    hasPreviousPage: boolean | null;
    items: Array<{
      messageId: string;
      graphNodeHash: string;
      messageIdHash: string;
      role: CapturedMessage["role"];
      nodeType: string;
      hasVisibleContent: boolean;
      createTimePresent: boolean;
      parentPresent: boolean;
      itemPosition: number;
    }>;
  };
};

export class PageDataAccumulator {
  constructor(expectedConversationId: string | null);
  expectedConversationId: string | null;
  nodes: Map<string, PageGraphNode>;
  parentConflicts: Set<string>;
  pageDataConflicts: Set<string>;
  crossConversationResponses: number;
  currentNodes: string[];
  pageStates: Array<PageDataBatch["pageInfo"] & { batchId: string }>;
  nodeProgression: number[];
  ingestedBatchIds: Set<string>;
  initialPassiveNodeCount: number;
  historyPagesLoaded: number;
  pageKeys: Set<string>;
  sourceMessageNodeIds: Map<string, string>;
  orderedPages: Array<NonNullable<PageDataBatch["orderedPage"]> & { batchId: string; pageKey: string }>;
  orderedPageKeys: Set<string>;
  ingest(batch: PageDataBatch): { accepted: boolean; newNodeCount: number };
  ingestAll(batches: PageDataBatch[]): { acceptedBatchCount: number; newNodeCount: number };
  latestPageState(): (PageDataBatch["pageInfo"] & { batchId: string }) | null;
  latestCurrentNode(): string | null;
  snapshot(): { batchCount: number; nodeCount: number; cursor: string | null; hasPreviousPage: boolean | null };
}

export function normalizeVisibleText(value: unknown): string;
export function normalizeVisibleContent(value: unknown): string;
export function messageVisibleText(message: { parts?: CapturedPart[] }): string;
export function visibleContentFingerprint(role: string, text: string): string;
export function sourceContentFingerprint(role: string, parts: CapturedPart[]): string;
export function visibleSemanticFingerprint(role: string, value: unknown): string;
export function resolveActivePath(accumulator: PageDataAccumulator, domLeafId?: string | null): {
  activeLeaf: string | null;
  activeLeafConfirmed: boolean;
  path: PageGraphNode[];
  pathLength: number;
  reachedExplicitRoot: boolean;
  missingParentCount: number;
  cycleCount: number;
  selfParentCount: number;
  parentConflictCount: number;
  pageDataConflictCount: number;
  branchAmbiguityCount: number;
  firstUserConfirmed: boolean;
  conversationRootConfirmed: boolean;
};
export function projectVisibleMessages(path: PageGraphNode[]): CapturedMessage[];
export function projectOrderedVisibleMessages(accumulator: PageDataAccumulator, domMessages?: CapturedMessage[]): CapturedMessage[];
export function crossCheckDomMessages(domMessages: CapturedMessage[], graphMessages: CapturedMessage[]): {
  matchedCount: number;
  unmatchedCount: number;
  fingerprintMismatchCount: number;
};
export function auditOrderedHistory(accumulator: PageDataAccumulator, domMessages?: CapturedMessage[]): {
  pageOrderRule: "capture-sequence-newest-to-oldest";
  pageOrderValidated: boolean;
  pageTimeOrderViolationCount: number;
  itemOrderRule: "oldest-to-newest" | "newest-to-oldest" | "unresolved";
  itemOrderValidated: boolean;
  timestampAscendingPairs: number;
  timestampDescendingPairs: number;
  parentForwardLinks: number;
  parentBackwardLinks: number;
  pageSummaries: Array<{ responseSequence: number; cursorHash: string; hasPreviousPage: boolean | null; itemCount: number; collection: "messages" | "mapping" }>;
  orderedUniqueNodeCount: number;
  unpagedNodeCount: number;
  roleCounts: Record<"user" | "assistant" | "thoughts" | "tool" | "system" | "internal" | "unknown", number>;
  hasVisibleContentNodeCount: number;
  visibleMessageCount: number;
  visibleToolMessageCount: number;
  firstVisibleUserFound: boolean;
  graphBranchPointCount: number;
  visibleBranchPointCount: number;
  branchScoped: boolean | null;
  domVisibleCount: number;
  domMatchedCount: number;
  domUnmatchedCount: number;
  domOrderingMismatchCount: number;
  domFingerprintMismatchCount: number;
  domFormattingOnlyMismatchCount: number;
  domCitationOnlyMismatchCount: number;
  domToolUiOnlyMismatchCount: number;
  domRealTextMismatchCount: number;
  mismatchProfiles: Array<{
    messageHash: string;
    domOrder: number;
    streamOrder: number;
    role: string;
    domLength: number;
    streamLength: number;
    compactEqual: boolean;
    domContainsStream: boolean;
    streamContainsDom: boolean;
    domIsOrderedSubset: boolean;
    placeholderCount: number;
    sourceContentKind: string;
    sourceStructure: import("../extensions/research-os-chrome/src/model/captured-conversation").ContentStructureProfile;
    domStructure: import("../extensions/research-os-chrome/src/model/captured-conversation").ContentStructureProfile;
    firstDifferenceRegion: "start" | "early" | "middle" | "late" | "end";
    firstDifferenceDomType: "alphanumeric" | "whitespace" | "punctuation" | "end" | "other";
    firstDifferenceSourceType: "alphanumeric" | "whitespace" | "punctuation" | "end" | "other";
    classification: "formatting" | "citation" | "tool-ui" | "real";
  }>;
  omittedVisibleContentKinds: Record<"text" | "image" | "video" | "audio" | "file" | "canvas" | "tool-ui" | "unknown" | "other", number>;
  mismatchCategories: Record<"plainText" | "markdownHeading" | "boldItalic" | "inlineCode" | "codeBlock" | "markdownLink" | "citation" | "list" | "blockquote" | "table" | "math" | "unicodeEntity" | "whitespaceNewline" | "toolPlaceholder" | "other", number>;
  domCompactMatchCount: number;
  domContainsStreamCount: number;
  streamContainsDomCount: number;
  domContiguous: boolean;
  buildDurationMs: number;
};
export function visibleConversationComplete(evidence: Record<string, unknown>): boolean;
export function paginationProgress(previous: ReturnType<PageDataAccumulator["snapshot"]>, next: ReturnType<PageDataAccumulator["snapshot"]>): {
  batchAdvanced: boolean;
  newNodeCount: number;
  cursorChanged: boolean;
  hasPreviousChanged: boolean;
  progressed: boolean;
};
export function passiveHistoryState(snapshot: ReturnType<PageDataAccumulator["snapshot"]>, options?: {
  stalled?: boolean;
  cursorLoop?: boolean;
}): { state: "exhausted" | "partial" | "continue" | "unproven"; reason: string | null };
export function historyRetryDecision(snapshot: ReturnType<PageDataAccumulator["snapshot"]>, options?: {
  stallAttempts?: number;
  elapsedMs?: number;
  maxStallAttempts?: number;
  maxDurationMs?: number;
}): { retry: boolean; stalled: boolean };
