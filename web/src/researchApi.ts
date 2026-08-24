import { request } from "./api";
import type { Topic, TopicDetail, TopicDraft, ResearchStatus } from "./researchTypes";

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
  changes: Partial<Pick<TopicDraft, "title" | "status" | "coreQuestion" | "currentView" | "nextAction" | "labels">>,
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
