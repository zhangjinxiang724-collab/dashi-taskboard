import { request } from "./api";
import type {
  ConfidenceLevel,
  Topic,
  TopicDetail,
  TopicDraft,
  TopicQuestion,
  TopicQuestionStatus,
  ResearchStatus,
} from "./researchTypes";

export async function listTopics(signal?: AbortSignal): Promise<Topic[]> {
  const data = await request<{ topics: Topic[] }>("/api/research/topics", { signal });
  return data.topics;
}

export async function getTopic(id: string, signal?: AbortSignal): Promise<TopicDetail> {
  const data = await request<{ topic: TopicDetail }>(
    `/api/research/topics/${encodeURIComponent(id)}`,
    { signal },
  );
  return data.topic;
}

export async function createTopic(input: TopicDraft): Promise<Topic> {
  const data = await request<{ topic: Topic }>("/api/research/topics", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.topic;
}

export async function updateTopic(
  topic: Topic,
  changes: Partial<{
    title: string;
    status: ResearchStatus;
    coreQuestion: string;
    currentView: string;
    confidenceLevel: ConfidenceLevel | null;
    nextAction: string;
    reviewTrigger: string;
    labels: string[];
  }>,
): Promise<TopicDetail> {
  const data = await request<{ topic: TopicDetail }>(
    `/api/research/topics/${encodeURIComponent(topic.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ version: topic.version, ...changes }),
    },
  );
  return data.topic;
}

export function moveTopic(topic: Topic, status: ResearchStatus): Promise<TopicDetail> {
  return updateTopic(topic, { status });
}

export async function markTopicResearched(topic: Topic): Promise<TopicDetail> {
  const data = await request<{ topic: TopicDetail }>(
    `/api/research/topics/${encodeURIComponent(topic.id)}/mark-researched`,
    {
      method: "POST",
      body: JSON.stringify({ version: topic.version }),
    },
  );
  return data.topic;
}

export async function createTopicQuestion(topicId: string, question: string): Promise<TopicDetail> {
  const data = await request<{ topic: TopicDetail }>(
    `/api/research/topics/${encodeURIComponent(topicId)}/questions`,
    {
      method: "POST",
      body: JSON.stringify({ question }),
    },
  );
  return data.topic;
}

export async function updateTopicQuestion(
  question: TopicQuestion,
  changes: Partial<Pick<TopicQuestion, "question" | "status" | "answerOrNote">>,
): Promise<TopicDetail> {
  const data = await request<{ topic: TopicDetail }>(
    `/api/research/topics/${encodeURIComponent(question.topicId)}/questions/${encodeURIComponent(question.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ version: question.version, ...changes }),
    },
  );
  return data.topic;
}

export function setTopicQuestionStatus(
  question: TopicQuestion,
  status: TopicQuestionStatus,
  answerOrNote?: string,
): Promise<TopicDetail> {
  return updateTopicQuestion(question, {
    status,
    ...(answerOrNote === undefined ? {} : { answerOrNote }),
  });
}

export async function moveTopicQuestion(
  question: TopicQuestion,
  direction: "up" | "down",
): Promise<TopicDetail> {
  const data = await request<{ topic: TopicDetail }>(
    `/api/research/topics/${encodeURIComponent(question.topicId)}/questions/${encodeURIComponent(question.id)}/move`,
    {
      method: "POST",
      body: JSON.stringify({ version: question.version, direction }),
    },
  );
  return data.topic;
}

export async function linkTopicTask(topicId: string, taskId: string): Promise<TopicDetail> {
  const data = await request<{ topic: TopicDetail }>(
    `/api/research/topics/${encodeURIComponent(topicId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "POST" },
  );
  return data.topic;
}

export async function unlinkTopicTask(topicId: string, taskId: string): Promise<void> {
  await request(
    `/api/research/topics/${encodeURIComponent(topicId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
  );
}
