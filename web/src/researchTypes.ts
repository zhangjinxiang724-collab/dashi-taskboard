import type { TaskStatus } from "./types";

export const RESEARCH_STATUSES = [
  "inbox",
  "active",
  "waiting",
  "thesis_formed",
  "tracking",
  "archived",
] as const;

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export interface ResearchTaskSummary {
  id: string;
  identifier: string;
  projectId: string;
  title: string;
  status: TaskStatus;
}

export interface Topic {
  id: string;
  title: string;
  status: ResearchStatus;
  coreQuestion: string;
  currentView: string;
  nextAction: string;
  labels: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TopicDetail extends Topic {
  tasks: ResearchTaskSummary[];
}

export interface TopicDraft {
  title: string;
  status: ResearchStatus;
  coreQuestion: string;
  currentView: string;
  nextAction: string;
  labels: string[];
}
