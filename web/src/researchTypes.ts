import type { TaskStatus } from "./types";

export const RESEARCH_STATUSES = [
  "inbox",
  "active",
  "waiting",
  "thesis_formed",
  "tracking",
  "archived",
] as const;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const TOPIC_QUESTION_STATUSES = ["open", "resolved", "dropped"] as const;
export const RESEARCH_RECORD_PROVIDERS = ["chatgpt", "codex", "claude", "gemini", "other"] as const;
export const RESEARCH_RECORD_KINDS = ["chat", "deep_research", "workspace", "agent_run", "other"] as const;
export const COGNITION_UPDATE_TYPES = ["add", "reinforce", "revise", "uncertain"] as const;

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type TopicQuestionStatus = (typeof TOPIC_QUESTION_STATUSES)[number];
export type ResearchRecordProvider = (typeof RESEARCH_RECORD_PROVIDERS)[number];
export type ResearchRecordKind = (typeof RESEARCH_RECORD_KINDS)[number];
export type CognitionUpdateType = (typeof COGNITION_UPDATE_TYPES)[number];
export type CognitionUpdateStatus = "draft" | "applied" | "rejected";

export interface ResearchTaskSummary {
  id: string;
  identifier: string;
  projectId: string;
  title: string;
  status: TaskStatus;
}

export interface TopicQuestion {
  id: string;
  topicId: string;
  question: string;
  status: TopicQuestionStatus;
  answerOrNote: string;
  sortOrder: number;
  version: number;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Topic {
  id: string;
  title: string;
  status: ResearchStatus;
  coreQuestion: string;
  currentView: string;
  confidenceLevel: ConfidenceLevel | null;
  nextAction: string;
  reviewTrigger: string;
  labels: string[];
  lastResearchedAt: string | null;
  openQuestionCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TopicDetail extends Topic {
  tasks: ResearchTaskSummary[];
  questions: TopicQuestion[];
}

export interface TopicDraft {
  title: string;
  status: ResearchStatus;
  coreQuestion: string;
  currentView: string;
  confidenceLevel: ConfidenceLevel | null;
  nextAction: string;
  reviewTrigger: string;
  labels: string[];
}

export interface ResearchRecord {
  id: string;
  topicId: string | null;
  title: string;
  provider: ResearchRecordProvider;
  kind: ResearchRecordKind;
  url: string | null;
  externalId: string | null;
  summary: string;
  note: string;
  occurredAt: string;
  captureAdapter: string;
  captureCompleteness: "complete" | "partial" | null;
  lastCapturedAt: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRecordDraft {
  title: string;
  provider: ResearchRecordProvider;
  kind: ResearchRecordKind;
  url: string | null;
  externalId: string | null;
  summary: string;
  note: string;
  content: string;
  occurredAt: string;
}

export interface ResearchRecordSummary {
  id: string;
  recordId: string;
  sourceContentVersionId: string;
  oneLineSummary: string;
  coreContent: string;
  keyEvidence: string;
  unresolved: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRecordSummaryDraft {
  oneLineSummary: string;
  coreContent: string;
  keyEvidence: string;
  unresolved: string;
}

export interface ResearchSummaryAiDraft extends ResearchRecordSummaryDraft {
  sourceContentVersionId: string;
  summaryVersion: number | null;
  sourceTextComplete: boolean;
}

export interface CognitionUpdate {
  id: string;
  topicId: string;
  recordId: string;
  sourceContentVersionId: string | null;
  sourceContentVersionNumber: number | null;
  sourceRecordVersion: number;
  sourceContext: {
    title?: string;
    summary?: string;
    note?: string;
    provider?: ResearchRecordProvider;
    kind?: ResearchRecordKind;
  };
  sourceRecordTitle: string;
  sourceDeleted: boolean;
  updateType: CognitionUpdateType;
  newInformation: string;
  impact: string;
  baseCurrentView: string;
  proposedCurrentView: string;
  baseTopicVersion: number;
  status: CognitionUpdateStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  appliedTopicVersion: number | null;
  rejectedAt: string | null;
}

export interface CognitionAiDraft {
  updateType: CognitionUpdateType;
  newInformation: string;
  impact: string;
  proposedCurrentView: string;
  sourceTextComplete: boolean;
}

export interface ResearchInboxItem extends ResearchRecord {
  preview: string;
  contentAvailable: boolean;
  messageCount: number;
  completenessDetails: CaptureCompletenessDetails | null;
}

export interface ResearchInboxPage {
  total: number;
  page: number;
  pageSize: number;
  records: ResearchInboxItem[];
}

export interface ImportPreviewRecord {
  sourceKey: string;
  externalId: string | null;
  title: string;
  occurredAt: string;
  updatedAt: string | null;
  messageCount: number;
  omittedMessageCount: number;
  sourceFingerprint: string;
  preview: string;
  duplicate: boolean;
  duplicateRecordId: string | null;
  parseError: string | null;
}

export interface ImportPreviewPage {
  id: string;
  page: number;
  pageSize: number;
  total: number;
  records: ImportPreviewRecord[];
}

export interface ResearchRecordContent {
  recordId: string;
  content: {
    version: string;
    externalId: string | null;
    title: string;
    messages: Array<{
      id?: string | null;
      sourceMessageId?: string | null;
      role: "user" | "assistant" | "system" | "tool" | "unknown";
      text?: string;
      parts?: Array<{
        type: "text" | "code" | "link" | "media-placeholder";
        text?: string;
        language?: string | null;
        url?: string;
        label?: string;
        mediaType?: "image" | "video" | "audio" | "file" | "canvas" | "tool-ui" | "unknown";
      }>;
      createdAt?: string | null;
      occurredAt?: string | null;
      order?: number;
    }>;
  };
  contentHash: string;
  messageCount: number;
  omittedMessageCount: number;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  versionId: string | null;
  versionNumber: number;
  captureAdapter: string | null;
  completeness: "complete" | "partial" | null;
  completenessDetails: CaptureCompletenessDetails | null;
  relationToPrevious: "initial" | "identical" | "append" | "conflict" | "legacy" | null;
  capturedAt: string;
}

export interface CaptureCompletenessDetails {
  topBoundaryConfirmed: boolean;
  windowTopConfirmed?: boolean;
  conversationRootConfirmed?: boolean;
  earliestBoundaryConfirmed?: boolean;
  latestBoundaryConfirmed?: boolean;
  stablePasses: number;
  loadingAbsent: boolean;
  conversationIdStable: boolean;
  unresolvedBranches: boolean;
  messageOmissionCount?: number;
  unsupportedContentCounts?: Partial<Record<"image" | "video" | "audio" | "file" | "canvas" | "tool-ui" | "unknown", number>>;
  coverageRelation?: "safe_merge";
  coverage?: {
    messageCount: number;
    earliestMessageId: string | null;
    latestMessageId: string | null;
    earliestBoundaryConfirmed: boolean;
    latestBoundaryConfirmed: boolean;
    captureCompleteness: "complete" | "partial";
    captureSource: string;
    capturedAt: string | null;
  };
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
  orderedHistoryAudit?: {
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
    mismatchCategories: Record<"plainText" | "markdownHeading" | "boldItalic" | "inlineCode" | "codeBlock" | "markdownLink" | "citation" | "list" | "blockquote" | "table" | "math" | "unicodeEntity" | "whitespaceNewline" | "toolPlaceholder" | "other", number>;
    domCompactMatchCount: number;
    domContainsStreamCount: number;
    streamContainsDomCount: number;
    domContiguous: boolean;
    buildDurationMs: number;
  };
}

export interface ResearchRecordContentVersion {
  id: string;
  recordId: string;
  versionNumber: number;
  captureAdapter: string;
  completeness: "complete" | "partial";
  completenessDetails: CaptureCompletenessDetails;
  relationToPrevious: "initial" | "identical" | "append" | "conflict" | "legacy";
  contentHash: string;
  sourceFingerprint: string;
  messageCount: number;
  omittedMessageCount: number;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  capturedAt: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface BrowserCapturePreview {
  id: string;
  status: "receiving" | "ready" | "failed" | "committed";
  title: string;
  sourceUrl: string;
  capturedAt: string;
  messageCount: number;
  messages?: Array<{
    order: number;
    role: "user" | "assistant" | "system" | "tool" | "unknown";
    sourceMessageId: string | null;
    occurredAt: string | null;
    parts: Array<{ type: "text" | "code" | "link" | "media-placeholder"; text?: string; language?: string | null; url?: string; label?: string }>;
    fingerprint: string;
  }>;
  completeness: "complete" | "partial" | "failed" | null;
  completenessDetails: CaptureCompletenessDetails | null;
  relation: "new" | "identical" | "append" | "safe_merge" | "conflict" | null;
  existingRecord: ResearchRecord | null;
  sourceFingerprint: string | null;
  coverage?: {
    existingMessageCount: number;
    incomingMessageCount: number;
    mergedMessageCount: number;
    newCoverageMessageCount: number;
    earliestBoundaryConfirmed: boolean;
    latestBoundaryConfirmed: boolean;
  } | null;
  conflictReason?: string | null;
}

export interface ResearchCaptureClient {
  id: string;
  extensionId: string;
  displayName: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ResearchImportSession {
  id: string;
  sourceFilename: string;
  status: "committed" | "undone";
  selectedCount: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  unclassifiedCount: number;
  version: number;
  createdAt: string;
}
