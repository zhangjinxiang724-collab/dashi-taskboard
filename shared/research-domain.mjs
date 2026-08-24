export const RESEARCH_STATUSES = [
  "inbox",
  "active",
  "waiting",
  "thesis_formed",
  "tracking",
  "archived",
];

export function isResearchStatus(value) {
  return RESEARCH_STATUSES.includes(value);
}
