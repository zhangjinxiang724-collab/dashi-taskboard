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

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type TopicQuestionStatus = (typeof TOPIC_QUESTION_STATUSES)[number];

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
