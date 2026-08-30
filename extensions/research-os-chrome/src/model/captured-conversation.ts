export type CaptureCompleteness = "complete" | "partial" | "failed";

export interface CapturedPart {
  type: "text" | "code" | "link" | "media-placeholder";
  text?: string;
  language?: string | null;
  url?: string;
  label?: string;
}

export interface CapturedMessage {
  order: number;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  sourceMessageId: string | null;
  occurredAt: string | null;
  parts: CapturedPart[];
  fingerprint: string;
}

export interface CaptureCompletenessDetails {
  topBoundaryConfirmed: boolean;
  stablePasses: number;
  loadingAbsent: boolean;
  conversationIdStable: boolean;
  unresolvedBranches: boolean;
  unsupportedContentCount: number;
  reasons: string[];
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
    unsupportedContentCount: number;
  };
}

export interface CaptureProgress {
  phase: "reading" | "loading-older" | "verifying" | "complete" | "failed" | "cancelled";
  message: string;
  discovered: number;
}
