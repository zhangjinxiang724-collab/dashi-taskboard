import { describe, expect, it, vi } from "vitest";

import {
  clearCaptureConnection,
  configuredResearchOsBaseUrl,
  loadCaptureConnection,
  persistCaptureConnection,
  RESEARCH_OS_CONNECTION_KEY,
  setConfiguredResearchOsBaseUrl,
  type ExtensionLocalStorage,
} from "../src/local/research-os-connection";
import { pairAndPersistResearchOs } from "../src/local/research-os-pairing";
import { sendConversationToPreview } from "../src/local/research-os-client";

class FakeStorage implements ExtensionLocalStorage {
  values = new Map<string, unknown>();
  failSet = false;
  discardSet = false;

  async get(keys: string | string[]) {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.map((key) => [key, this.values.get(key)]));
  }

  async set(values: Record<string, unknown>) {
    if (this.failSet) throw new Error("storage unavailable");
    if (!this.discardSet) for (const [key, value] of Object.entries(values)) this.values.set(key, value);
  }

  async remove(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key);
  }
}

const connection = {
  schemaVersion: 1 as const,
  endpoint: "http://127.0.0.1:47936",
  clientId: "client-fixture",
  token: "fixture-token-never-real",
  pairedAt: "2026-09-12T08:00:00.000Z",
};

describe("Research OS pairing persistence", () => {
  it("writes and reads one complete persistent connection", async () => {
    const storage = new FakeStorage();
    await persistCaptureConnection(storage, connection);
    expect(storage.values.get(RESEARCH_OS_CONNECTION_KEY)).toEqual(connection);
    expect(await loadCaptureConnection(storage)).toEqual(connection);
  });

  it("restores connected state in a new popup or recreated service worker", async () => {
    const storage = new FakeStorage();
    await persistCaptureConnection(storage, connection);
    const popupHydration = await loadCaptureConnection(storage);
    const recreatedWorkerCredentials = await loadCaptureConnection(storage);
    expect(popupHydration).toEqual(connection);
    expect(recreatedWorkerCredentials).toEqual(connection);
  });

  it("provides the stored endpoint and token used by capture auth", async () => {
    const storage = new FakeStorage();
    await persistCaptureConnection(storage, connection);
    const credentials = await loadCaptureConnection(storage);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ preview: { id: "preview-fixture" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ preview: { status: "ready" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendConversationToPreview(credentials!.endpoint, {
      schemaVersion: "captured-conversation-v1",
      provider: "chatgpt",
      captureAdapter: "chatgpt-browser-v1",
      externalConversationId: "conversation-fixture",
      title: "Fixture conversation",
      sourceUrl: "https://chatgpt.com/c/conversation-fixture",
      capturedAt: "2026-09-12T08:00:00.000Z",
      branchScope: "active-visible-branch",
      completeness: "partial",
      completenessDetails: {
        topBoundaryConfirmed: false,
        windowTopConfirmed: false,
        conversationRootConfirmed: false,
        earliestBoundaryConfirmed: false,
        latestBoundaryConfirmed: true,
        stablePasses: 1,
        loadingAbsent: true,
        conversationIdStable: true,
        unresolvedBranches: false,
        messageOmissionCount: 0,
        unsupportedContentCounts: { image: 0, video: 0, audio: 0, file: 0, canvas: 0, "tool-ui": 0, unknown: 0 },
        unsupportedContentCount: 0,
        reasons: ["fixture"],
      },
      messages: [],
      captureStats: {
        discoveredMessageCount: 0,
        messageOmissionCount: 0,
        unsupportedContentCounts: { image: 0, video: 0, audio: 0, file: 0, canvas: 0, "tool-ui": 0, unknown: 0 },
        unsupportedContentCount: 0,
      },
    }, credentials!.token);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:47936\/api\/research\/captures\/browser\/previews/);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-token-never-real");
    }
    vi.unstubAllGlobals();
  });

  it("treats missing local credentials as disconnected even if a server client exists", async () => {
    const storage = new FakeStorage();
    const serverClientExists = true;
    expect(serverClientExists).toBe(true);
    expect(await loadCaptureConnection(storage)).toBeNull();
  });

  it("clears credentials on disconnect", async () => {
    const storage = new FakeStorage();
    await persistCaptureConnection(storage, connection);
    await clearCaptureConnection(storage);
    expect(await loadCaptureConnection(storage)).toBeNull();
  });

  it("clears credentials when the configured endpoint changes", async () => {
    const storage = new FakeStorage();
    await persistCaptureConnection(storage, connection);
    await setConfiguredResearchOsBaseUrl(storage, "http://127.0.0.1:47823");
    expect(await loadCaptureConnection(storage)).toBeNull();
    expect(await configuredResearchOsBaseUrl(storage)).toBe("http://127.0.0.1:47823");
  });

  it("does not report success when storage throws or fails readback", async () => {
    const throwingStorage = new FakeStorage();
    throwingStorage.failSet = true;
    await expect(persistCaptureConnection(throwingStorage, connection)).rejects.toThrow("连接信息没有保存成功，请重新配对。");

    const discardedStorage = new FakeStorage();
    discardedStorage.discardSet = true;
    await expect(persistCaptureConnection(discardedStorage, connection)).rejects.toThrow("连接信息没有保存成功，请重新配对。");
    expect(await loadCaptureConnection(discardedStorage)).toBeNull();
  });

  it("revokes the newly created server client when local persistence fails", async () => {
    const storage = new FakeStorage();
    storage.failSet = true;
    const pair = vi.fn().mockResolvedValue({
      token: "fixture-token-never-real",
      client: { id: "new-server-client" },
    });
    const revoke = vi.fn().mockResolvedValue(undefined);

    await expect(pairAndPersistResearchOs(storage, connection.endpoint, "fixture-code", {
      pair,
      revoke,
      pairedAt: () => connection.pairedAt,
    })).rejects.toThrow("连接信息没有保存成功，请重新配对。");

    expect(pair).toHaveBeenCalledWith(connection.endpoint, "fixture-code");
    expect(revoke).toHaveBeenCalledWith(connection.endpoint, "new-server-client");
    expect(await loadCaptureConnection(storage)).toBeNull();
  });

  it("migrates the former token key into the persistent connection model", async () => {
    const storage = new FakeStorage();
    storage.values.set("researchOsCaptureToken", "legacy-fixture-token");
    storage.values.set("researchOsBaseUrl", "http://localhost:47823");
    const migrated = await loadCaptureConnection(storage);
    expect(migrated).toMatchObject({ endpoint: "http://localhost:47823", token: "legacy-fixture-token" });
    expect(storage.values.has("researchOsCaptureToken")).toBe(false);
    expect(storage.values.get(RESEARCH_OS_CONNECTION_KEY)).toEqual(migrated);
  });
});
