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

export function isResearchStatus(value) {
  return RESEARCH_STATUSES.includes(value);
}

export function isConfidenceLevel(value) {
  return CONFIDENCE_LEVELS.includes(value);
}

export function isTopicQuestionStatus(value) {
  return TOPIC_QUESTION_STATUSES.includes(value);
}
