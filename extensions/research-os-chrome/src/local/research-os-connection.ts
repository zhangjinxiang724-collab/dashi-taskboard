import { DEFAULT_RESEARCH_OS_BASE_URL, normalizeResearchOsBaseUrl } from "./research-os-endpoint";

export const RESEARCH_OS_CONNECTION_KEY = "researchOsCaptureConnection";
const LEGACY_TOKEN_KEY = "researchOsCaptureToken";
const BASE_URL_KEY = "researchOsBaseUrl";

export type CaptureConnection = {
  schemaVersion: 1;
  endpoint: string;
  clientId: string | null;
  token: string;
  pairedAt: string | null;
};

export type ExtensionLocalStorage = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

function parseConnection(value: unknown): CaptureConnection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CaptureConnection>;
  if (
    candidate.schemaVersion !== 1
    || typeof candidate.endpoint !== "string"
    || typeof candidate.token !== "string"
    || !candidate.token
    || (candidate.clientId !== null && typeof candidate.clientId !== "string")
    || (candidate.pairedAt !== null && typeof candidate.pairedAt !== "string")
  ) return null;
  try {
    return { ...candidate, endpoint: normalizeResearchOsBaseUrl(candidate.endpoint) } as CaptureConnection;
  } catch {
    return null;
  }
}

function sameConnection(left: CaptureConnection | null, right: CaptureConnection) {
  return Boolean(left)
    && left!.schemaVersion === right.schemaVersion
    && left!.endpoint === right.endpoint
    && left!.clientId === right.clientId
    && left!.token === right.token
    && left!.pairedAt === right.pairedAt;
}

export async function persistCaptureConnection(storage: ExtensionLocalStorage, connection: CaptureConnection) {
  const normalized: CaptureConnection = {
    ...connection,
    endpoint: normalizeResearchOsBaseUrl(connection.endpoint),
  };
  try {
    await storage.set({
      [RESEARCH_OS_CONNECTION_KEY]: normalized,
      [BASE_URL_KEY]: normalized.endpoint,
    });
    const stored = await storage.get(RESEARCH_OS_CONNECTION_KEY);
    if (!sameConnection(parseConnection(stored[RESEARCH_OS_CONNECTION_KEY]), normalized)) throw new Error("readback failed");
    await storage.remove(LEGACY_TOKEN_KEY);
    return normalized;
  } catch {
    await storage.remove(RESEARCH_OS_CONNECTION_KEY).catch(() => undefined);
    throw new Error("连接信息没有保存成功，请重新配对。");
  }
}

export async function loadCaptureConnection(storage: ExtensionLocalStorage): Promise<CaptureConnection | null> {
  const stored = await storage.get([RESEARCH_OS_CONNECTION_KEY, LEGACY_TOKEN_KEY, BASE_URL_KEY]);
  const connection = parseConnection(stored[RESEARCH_OS_CONNECTION_KEY]);
  if (connection) return connection;

  const legacyToken = stored[LEGACY_TOKEN_KEY];
  if (typeof legacyToken !== "string" || !legacyToken) return null;
  const endpoint = normalizeResearchOsBaseUrl(
    typeof stored[BASE_URL_KEY] === "string" ? stored[BASE_URL_KEY] : DEFAULT_RESEARCH_OS_BASE_URL,
  );
  return persistCaptureConnection(storage, {
    schemaVersion: 1,
    endpoint,
    clientId: null,
    token: legacyToken,
    pairedAt: null,
  }).catch(() => null);
}

export async function configuredResearchOsBaseUrl(storage: ExtensionLocalStorage) {
  const connection = await loadCaptureConnection(storage);
  if (connection) return connection.endpoint;
  const stored = await storage.get(BASE_URL_KEY);
  return normalizeResearchOsBaseUrl(
    typeof stored[BASE_URL_KEY] === "string" ? stored[BASE_URL_KEY] : DEFAULT_RESEARCH_OS_BASE_URL,
  );
}

export async function setConfiguredResearchOsBaseUrl(storage: ExtensionLocalStorage, value: string) {
  const next = normalizeResearchOsBaseUrl(value);
  const connection = await loadCaptureConnection(storage);
  if (connection && connection.endpoint !== next) await clearCaptureConnection(storage);
  await storage.set({ [BASE_URL_KEY]: next });
  return next;
}

export async function clearCaptureConnection(storage: ExtensionLocalStorage) {
  await storage.remove([RESEARCH_OS_CONNECTION_KEY, LEGACY_TOKEN_KEY]);
}

