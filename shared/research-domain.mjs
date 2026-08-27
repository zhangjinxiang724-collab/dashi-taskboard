export const RESEARCH_STATUSES = [
  "inbox",
  "active",
  "waiting",
  "thesis_formed",
  "tracking",
  "archived",
];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"];
export const TOPIC_QUESTION_STATUSES = ["open", "resolved", "dropped"];
export const RESEARCH_RECORD_PROVIDERS = [
  "chatgpt",
  "codex",
  "claude",
  "gemini",
  "other",
];
export const RESEARCH_RECORD_KINDS = [
  "chat",
  "deep_research",
  "workspace",
  "agent_run",
  "other",
];

export function isResearchStatus(value) {
  return RESEARCH_STATUSES.includes(value);
}

export function isConfidenceLevel(value) {
  return CONFIDENCE_LEVELS.includes(value);
}

export function isTopicQuestionStatus(value) {
  return TOPIC_QUESTION_STATUSES.includes(value);
}

export function isResearchRecordProvider(value) {
  return RESEARCH_RECORD_PROVIDERS.includes(value);
}

export function isResearchRecordKind(value) {
  return RESEARCH_RECORD_KINDS.includes(value);
}
