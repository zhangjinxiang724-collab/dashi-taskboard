export type CaptureCompleteness = "complete" | "partial" | "failed";

export interface CapturedPart {
  type: "text" | "code" | "link" | "media-placeholder";
  text?: string;
  language?: string | null;
  url?: string;
  label?: string;
  mediaType?: "image" | "video" | "audio" | "file" | "canvas" | "tool-ui" | "unknown";
}

export interface CapturedMessage {
  order: number;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  sourceMessageId: string | null;
  occurredAt: string | null;
  parts: CapturedPart[];
  fingerprint: string;
  /** DOM-only text in rendered document order, used for local integrity checks. */
  comparisonText?: string;
  /** Session-local anonymous identity used only by capture diagnostics. */
  diagnosticMessageHash?: string;
  /** Anonymous rendered/source structure counts used only by capture diagnostics. */
  diagnosticStructure?: ContentStructureProfile;
  diagnosticContentKind?: string;
}

export interface ContentStructureProfile {
  heading: number;
  boldItalic: number;
  inlineCode: number;
  codeBlock: number;
  link: number;
  citation: number;
  blockquote: number;
  listItem: number;
  table: number;
  math: number;
  htmlEntity: number;
  unicode: number;
  toolCard: number;
  hiddenUi: number;
  unknownRich: number;
}

export interface OrderedHistoryAudit {
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
    sourceStructure: ContentStructureProfile;
    domStructure: ContentStructureProfile;
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
}

export interface CaptureCompletenessDetails {
  topBoundaryConfirmed: boolean;
  windowTopConfirmed: boolean;
  conversationRootConfirmed: boolean;
  earliestBoundaryConfirmed: boolean;
  latestBoundaryConfirmed: boolean;
  stablePasses: number;
  loadingAbsent: boolean;
  conversationIdStable: boolean;
  unresolvedBranches: boolean;
  messageOmissionCount: number;
  unsupportedContentCounts: Record<"image" | "video" | "audio" | "file" | "canvas" | "tool-ui" | "unknown", number>;
  unsupportedContentCount: number;
  reasons: string[];
  passiveDataAvailable?: boolean;
  initialPassiveNodeCount?: number;
  historyPagesLoaded?: number;
  passiveNodeProgression?: number[];
  finalGraphNodeCount?: number;
  visibleMessageCount?: number;
  hasPreviousPageFinal?: boolean | null;
  passiveHistoryExhausted?: boolean;
  passiveHistoryStalled?: boolean;
  paginationLoopDetected?: boolean;
  activeLeafConfirmed?: boolean;
  activePathLength?: number;
  missingParentCount?: number;
  cycleCount?: number;
  parentConflictCount?: number;
  pageDataConflictCount?: number;
  firstUserConfirmed?: boolean;
  domMatchedCount?: number;
  domUnmatchedCount?: number;
  domFingerprintMismatchCount?: number;
  domFormattingOnlyMismatchCount?: number;
  domCitationOnlyMismatchCount?: number;
  domToolUiOnlyMismatchCount?: number;
  domRealTextMismatchCount?: number;
  activeBranchUniquelyValidated?: boolean;
  orderedVisibleIdentityStable?: boolean;
  textTranscriptComplete?: boolean;
  richContentComplete?: boolean;
  visibleConversationComplete?: boolean;
  passiveCaptureDurationMs?: number;
  fallbackUsed?: boolean;
  orderedHistoryAudit?: OrderedHistoryAudit;
}

export interface CapturedConversation {
  schemaVersion: "captured-conversation-v1";
  provider: "chatgpt";
  captureAdapter: "chatgpt-browser-v1";
  externalConversationId: string | null;
  title: string;
  sourceUrl: string;
  capturedAt: string;
  branchScope: "active-visible-branch";
  completeness: CaptureCompleteness;
  completenessDetails: CaptureCompletenessDetails;
  messages: CapturedMessage[];
  captureStats: {
    discoveredMessageCount: number;
    messageOmissionCount: number;
    unsupportedContentCounts: Record<"image" | "video" | "audio" | "file" | "canvas" | "tool-ui" | "unknown", number>;
    unsupportedContentCount: number;
  };
}

export interface CaptureProgress {
  phase: "reading" | "loading-older" | "verifying" | "complete" | "failed" | "cancelled";
  message: string;
  discovered: number;
}
