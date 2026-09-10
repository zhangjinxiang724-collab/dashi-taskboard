import type { CapturedConversation } from "../model/captured-conversation";

export class ResearchOsConnectionError extends Error {}

async function localFetch(baseUrl: string, path: string, init: RequestInit = {}) {
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new ResearchOsConnectionError(
      `无法连接 Research OS。\n当前尝试地址：${baseUrl}\n请确认 Research OS 已启动，并检查本地地址。`,
    );
  }
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? `Research OS 请求失败（${response.status}）`);
  return data;
}

export async function checkResearchOsHealth(baseUrl: string) {
  const response = await localFetch(baseUrl, "/api/research/capture/health");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status !== "ok") {
    throw new ResearchOsConnectionError(
      `无法连接 Research OS。\n当前尝试地址：${baseUrl}\n请确认 Research OS 已启动，并检查本地地址。`,
    );
  }
}

export async function pairResearchOs(baseUrl: string, code: string) {
  await checkResearchOsHealth(baseUrl);
  const response = await localFetch(baseUrl, "/api/research/capture/pairings/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, displayName: "Research OS Chrome" }),
  });
  if (response.status === 401) throw new Error("配对码无效或已过期。");
  return responseJson(response) as Promise<{ token: string; client: { id: string } }>;
}

async function authenticatedFetch(baseUrl: string, path: string, token: string, init: RequestInit = {}) {
  const response = await localFetch(baseUrl, path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  return responseJson(response);
}

export async function sendConversationToPreview(baseUrl: string, conversation: CapturedConversation, token: string) {
  const created = await authenticatedFetch(baseUrl, "/api/research/captures/browser/previews", token, {
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
    await authenticatedFetch(baseUrl, `/api/research/captures/browser/previews/${encodeURIComponent(previewId)}/batches`, token, {
      method: "POST",
      body: JSON.stringify({ batchIndex, messages: conversation.messages.slice(offset, offset + 50) }),
    });
  }
  const finalized = await authenticatedFetch(baseUrl, `/api/research/captures/browser/previews/${encodeURIComponent(previewId)}/finalize`, token, {
    method: "POST",
    body: JSON.stringify({
      completeness: conversation.completeness,
      completenessDetails: conversation.completenessDetails,
    }),
  }) as { preview: { status: string } };
  if (finalized.preview.status === "failed") throw new Error("Research OS 无法形成安全的捕获预览。");
  return {
    previewId,
    previewUrl: `${baseUrl}/?capturePreview=${encodeURIComponent(previewId)}`,
  };
}
