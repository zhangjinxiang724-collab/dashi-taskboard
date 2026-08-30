import type { CapturedConversation } from "../model/captured-conversation";

declare const __RESEARCH_OS_BASE_URL__: string;

const BASE_URL = __RESEARCH_OS_BASE_URL__;

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? `Research OS 请求失败（${response.status}）`);
  return data;
}

export async function pairResearchOs(code: string) {
  const response = await fetch(`${BASE_URL}/api/research/capture/pairings/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, displayName: "Research OS Chrome" }),
  });
  return responseJson(response) as Promise<{ token: string; client: { id: string } }>;
}

async function authenticatedFetch(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  return responseJson(response);
}

export async function sendConversationToPreview(conversation: CapturedConversation, token: string) {
  const created = await authenticatedFetch("/api/research/captures/browser/previews", token, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: conversation.schemaVersion,
      provider: conversation.provider,
      captureAdapter: conversation.captureAdapter,
      externalConversationId: conversation.externalConversationId,
      title: conversation.title,
      sourceUrl: conversation.sourceUrl,
      capturedAt: conversation.capturedAt,
      branchScope: conversation.branchScope,
    }),
  }) as { preview: { id: string } };
  const previewId = created.preview.id;
  for (let offset = 0, batchIndex = 0; offset < conversation.messages.length; offset += 50, batchIndex += 1) {
    await authenticatedFetch(`/api/research/captures/browser/previews/${encodeURIComponent(previewId)}/batches`, token, {
      method: "POST",
      body: JSON.stringify({ batchIndex, messages: conversation.messages.slice(offset, offset + 50) }),
    });
  }
  const finalized = await authenticatedFetch(`/api/research/captures/browser/previews/${encodeURIComponent(previewId)}/finalize`, token, {
    method: "POST",
    body: JSON.stringify({
      completeness: conversation.completeness,
      completenessDetails: conversation.completenessDetails,
    }),
  }) as { preview: { status: string } };
  if (finalized.preview.status === "failed") throw new Error("Research OS 无法形成安全的捕获预览。");
  return {
    previewId,
    previewUrl: `${BASE_URL}/?capturePreview=${encodeURIComponent(previewId)}`,
  };
}
