export const DEFAULT_RESEARCH_OS_BASE_URL = "http://127.0.0.1:47823";

export function normalizeResearchOsBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Research OS 地址格式不正确。");
  }
  if (
    parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Research OS 地址必须是带端口的本机地址，例如 http://127.0.0.1:47823。");
  }
  return parsed.origin;
}
