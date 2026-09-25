import { ApiError, request, resolveTaskboardUrl } from "./api";
import type {
  ConfidenceLevel,
  Topic,
  TopicDetail,
  TopicDraft,
  TopicQuestion,
  TopicQuestionStatus,
  ResearchStatus,
  ResearchRecord,
  ResearchRecordDraft,
  ImportPreviewPage,
  ResearchImportSession,
  ResearchRecordContent,
  ResearchRecordContentVersion,
  ResearchRecordSummary,
  ResearchRecordSummaryDraft,
  ResearchSummaryAiDraft,
  BrowserCapturePreview,
  ResearchCaptureClient,
  ResearchInboxPage,
  CognitionUpdate,
  CognitionUpdateType,
  CognitionAiDraft,
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

export async function listResearchRecords(
  topicId: string,
  signal?: AbortSignal,
): Promise<ResearchRecord[]> {
  const data = await request<{ records: ResearchRecord[] }>(
    `/api/research/topics/${encodeURIComponent(topicId)}/records`,
    { signal },
  );
  return data.records;
}

export async function getResearchRecord(
  recordId: string,
  signal?: AbortSignal,
): Promise<ResearchRecord> {
  const data = await request<{ record: ResearchRecord }>(
    `/api/research/records/${encodeURIComponent(recordId)}`,
    { signal },
  );
  return data.record;
}

export async function createResearchRecord(
  topicId: string,
  input: ResearchRecordDraft,
): Promise<ResearchRecord> {
  const data = await request<{ record: ResearchRecord }>(
    `/api/research/topics/${encodeURIComponent(topicId)}/records`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.record;
}

export async function updateResearchRecord(
  record: ResearchRecord,
  changes: Partial<ResearchRecordDraft>,
): Promise<ResearchRecord> {
  const data = await request<{ record: ResearchRecord }>(
    `/api/research/records/${encodeURIComponent(record.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ version: record.version, ...changes }),
    },
  );
  return data.record;
}

export async function deleteResearchRecord(record: ResearchRecord): Promise<void> {
  await request(`/api/research/records/${encodeURIComponent(record.id)}`, {
    method: "DELETE",
    body: JSON.stringify({ version: record.version }),
  });
}

export async function createChatGptImportPreview(file: File): Promise<{
  id: string; sourceFilename: string; sourceHash: string; validCount: number; invalidCount: number;
}> {
  const response = await fetch(resolveTaskboardUrl("/api/research/imports/chatgpt/preview"), {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-research-import-filename": file.name,
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data);
  return data.preview;
}

export async function getImportPreview(
  id: string,
  options: { page?: number; pageSize?: number; search?: string; duplicates?: "all" | "only" | "exclude" } = {},
): Promise<ImportPreviewPage> {
  const query = new URLSearchParams();
  if (options.page) query.set("page", String(options.page));
  if (options.pageSize) query.set("pageSize", String(options.pageSize));
  if (options.search) query.set("search", options.search);
  if (options.duplicates) query.set("duplicates", options.duplicates);
  const data = await request<{ preview: ImportPreviewPage }>(`/api/research/imports/previews/${encodeURIComponent(id)}?${query}`);
  return data.preview;
}

export async function getSelectableImportPreviewKeys(id: string, search = ""): Promise<string[]> {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  const data = await request<{ sourceKeys: string[] }>(
    `/api/research/imports/previews/${encodeURIComponent(id)}/selection?${query}`,
  );
  return data.sourceKeys;
}

export async function confirmResearchImport(
  previewId: string,
  selections: Array<{ sourceKey: string; topicId: string | null }>,
) {
  const data = await request<{ session: { sessionId: string; imported: number; skipped: number; failed: number; unclassified: number } }>(
    `/api/research/imports/previews/${encodeURIComponent(previewId)}/confirm`,
    { method: "POST", body: JSON.stringify({ selections }) },
  );
  return data.session;
}

export async function listUnclassifiedResearchRecords(): Promise<ResearchRecord[]> {
  const data = await request<{ records: ResearchRecord[] }>("/api/research/records/unclassified");
  return data.records;
}

export async function getResearchInboxSummary(signal?: AbortSignal): Promise<number> {
  const data = await request<{ count: number }>("/api/research/inbox/summary", { signal });
  return data.count;
}

export async function listResearchInbox(
  options: { page?: number; pageSize?: number; provider?: string; dateFrom?: string; dateTo?: string } = {},
  signal?: AbortSignal,
): Promise<ResearchInboxPage> {
  const query = new URLSearchParams();
  if (options.page) query.set("page", String(options.page));
  if (options.pageSize) query.set("pageSize", String(options.pageSize));
  if (options.provider) query.set("provider", options.provider);
  if (options.dateFrom) query.set("dateFrom", options.dateFrom);
  if (options.dateTo) query.set("dateTo", options.dateTo);
  const suffix = query.size ? `?${query}` : "";
  return request<ResearchInboxPage>(`/api/research/inbox${suffix}`, { signal });
}

export async function assignResearchRecordsToTopic(recordIds: string[], topicId: string): Promise<number> {
  const data = await request<{ updated: number }>("/api/research/records/assign-topic", {
    method: "POST", body: JSON.stringify({ recordIds, topicId }),
  });
  return data.updated;
}

export async function createTopicAndAssignResearchRecords(
  recordIds: string[],
  topic: Pick<TopicDraft, "title" | "status">,
): Promise<{ topic: Topic; updated: number }> {
  return request<{ topic: Topic; updated: number }>("/api/research/inbox/create-topic-and-assign", {
    method: "POST",
    body: JSON.stringify({ recordIds, topic }),
  });
}

export async function listResearchImportSessions(): Promise<ResearchImportSession[]> {
  const data = await request<{ sessions: ResearchImportSession[] }>("/api/research/imports/sessions");
  return data.sessions;
}

export async function undoResearchImportSession(session: ResearchImportSession) {
  const data = await request<{ result: { kind: string; count?: number } }>(
    `/api/research/imports/sessions/${encodeURIComponent(session.id)}/undo`,
    { method: "POST", body: JSON.stringify({ version: session.version }) },
  );
  return data.result;
}

export async function getResearchRecordContent(recordId: string, version?: number): Promise<ResearchRecordContent> {
  const query = version ? `?version=${encodeURIComponent(String(version))}` : "";
  const data = await request<{ content: ResearchRecordContent }>(`/api/research/records/${encodeURIComponent(recordId)}/content${query}`);
  return data.content;
}

export async function listResearchRecordContentVersions(recordId: string): Promise<ResearchRecordContentVersion[]> {
  const data = await request<{ versions: ResearchRecordContentVersion[] }>(
    `/api/research/records/${encodeURIComponent(recordId)}/content-versions`,
  );
  return data.versions;
}

export async function getResearchRecordSummary(
  recordId: string,
  sourceContentVersionId: string,
): Promise<ResearchRecordSummary | null> {
  const query = new URLSearchParams({ contentVersionId: sourceContentVersionId });
  const data = await request<{ summary: ResearchRecordSummary | null }>(
    `/api/research/records/${encodeURIComponent(recordId)}/summary?${query}`,
  );
  return data.summary;
}

export async function createResearchRecordSummary(
  recordId: string,
  sourceContentVersionId: string,
  draft: ResearchRecordSummaryDraft,
): Promise<ResearchRecordSummary> {
  const data = await request<{ summary: ResearchRecordSummary }>(
    `/api/research/records/${encodeURIComponent(recordId)}/summary`,
    {
      method: "POST",
      body: JSON.stringify({ sourceContentVersionId, ...draft }),
    },
  );
  return data.summary;
}

export async function updateResearchRecordSummary(
  summary: ResearchRecordSummary,
  draft: ResearchRecordSummaryDraft,
): Promise<ResearchRecordSummary> {
  const data = await request<{ summary: ResearchRecordSummary }>(
    `/api/research/summaries/${encodeURIComponent(summary.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ version: summary.version, ...draft }),
    },
  );
  return data.summary;
}

export async function generateResearchSummaryAiDraft(
  recordId: string,
  sourceContentVersionId: string,
  summaryVersion: number | null,
): Promise<ResearchSummaryAiDraft> {
  const data = await request<{
    candidate: ResearchRecordSummaryDraft;
    sourceContentVersionId: string;
    summaryVersion: number | null;
    sourceTextComplete: boolean;
  }>(`/api/research/records/${encodeURIComponent(recordId)}/summary/ai-draft`, {
    method: "POST",
    body: JSON.stringify({ sourceContentVersionId, summaryVersion }),
  });
  return {
    ...data.candidate,
    sourceContentVersionId: data.sourceContentVersionId,
    summaryVersion: data.summaryVersion,
    sourceTextComplete: data.sourceTextComplete,
  };
}

export async function createCognitionUpdate(
  topicId: string,
  recordId: string,
  sourceContentVersionId: string | null,
): Promise<{ update: CognitionUpdate; existing: boolean }> {
  return request(`/api/research/topics/${encodeURIComponent(topicId)}/cognition-updates`, {
    method: "POST",
    body: JSON.stringify({ recordId, sourceContentVersionId }),
  });
}

export async function listCognitionUpdates(topicId: string, recordId?: string): Promise<CognitionUpdate[]> {
  const query = recordId ? `?recordId=${encodeURIComponent(recordId)}` : "";
  const data = await request<{ updates: CognitionUpdate[] }>(
    `/api/research/topics/${encodeURIComponent(topicId)}/cognition-updates${query}`,
  );
  return data.updates;
}

export async function updateCognitionUpdate(
  update: CognitionUpdate,
  changes: Partial<Pick<CognitionUpdate, "updateType" | "newInformation" | "impact" | "proposedCurrentView">>,
): Promise<CognitionUpdate> {
  const data = await request<{ update: CognitionUpdate }>(
    `/api/research/cognition-updates/${encodeURIComponent(update.id)}`,
    { method: "PATCH", body: JSON.stringify({ version: update.version, ...changes }) },
  );
  return data.update;
}

export async function reloadCognitionUpdate(update: CognitionUpdate): Promise<CognitionUpdate> {
  const data = await request<{ update: CognitionUpdate }>(
    `/api/research/cognition-updates/${encodeURIComponent(update.id)}/reload`,
    { method: "POST", body: JSON.stringify({ version: update.version }) },
  );
  return data.update;
}

export async function generateCognitionAiDraft(update: CognitionUpdate): Promise<CognitionAiDraft> {
  const data = await request<{ candidate: Omit<CognitionAiDraft, "sourceTextComplete">; sourceTextComplete: boolean }>(
    `/api/research/cognition-updates/${encodeURIComponent(update.id)}/ai-draft`,
    { method: "POST", body: JSON.stringify({ version: update.version }) },
  );
  return { ...data.candidate, sourceTextComplete: data.sourceTextComplete };
}

export async function applyCognitionUpdate(update: CognitionUpdate): Promise<{ update: CognitionUpdate; topic: TopicDetail }> {
  return request(`/api/research/cognition-updates/${encodeURIComponent(update.id)}/apply`, {
    method: "POST", body: JSON.stringify({ version: update.version }),
  });
}

export async function rejectCognitionUpdate(update: CognitionUpdate): Promise<CognitionUpdate> {
  const data = await request<{ update: CognitionUpdate }>(
    `/api/research/cognition-updates/${encodeURIComponent(update.id)}/reject`,
    { method: "POST", body: JSON.stringify({ version: update.version }) },
  );
  return data.update;
}

export async function deleteCognitionDraft(update: CognitionUpdate): Promise<void> {
  await request(`/api/research/cognition-updates/${encodeURIComponent(update.id)}`, {
    method: "DELETE", body: JSON.stringify({ version: update.version }),
  });
}

export type CognitionUpdateChanges = {
  updateType: CognitionUpdateType;
  newInformation: string;
  impact: string;
  proposedCurrentView: string;
};

export async function startBrowserCapturePairing(): Promise<{ code: string; expiresAt: string }> {
  const data = await request<{ pairing: { code: string; expiresAt: string } }>(
    "/api/research/capture/pairings/start",
    { method: "POST" },
  );
  return data.pairing;
}

export async function listBrowserCaptureClients(): Promise<ResearchCaptureClient[]> {
  const data = await request<{ clients: ResearchCaptureClient[] }>("/api/research/capture/clients");
  return data.clients;
}

export async function revokeBrowserCaptureClient(id: string): Promise<void> {
  await request(`/api/research/capture/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getBrowserCapturePreview(id: string): Promise<BrowserCapturePreview> {
  const data = await request<{ preview: BrowserCapturePreview }>(
    `/api/research/captures/browser/previews/${encodeURIComponent(id)}`,
  );
  return data.preview;
}

export async function confirmBrowserCapturePreview(
  id: string,
  input: {
    topicId: string | null;
    allowPartial: boolean;
    conflictAction: "replace-current" | null;
    expectedRecordVersion: number | null;
  },
) {
  const data = await request<{ result: {
    kind: "created" | "updated" | "already_latest";
    record: ResearchRecord;
    contentVersion?: number;
  } }>(`/api/research/captures/browser/previews/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.result;
}
