(() => {
  "use strict";

  const MARKER_PREFIX = "__research_os_capture_v1__";
  const rawMarker = window.name || "";
  if (!rawMarker.startsWith(MARKER_PREFIX)) return;
  let marker: { sessionId?: string; armedAt?: number };
  try { marker = JSON.parse(rawMarker.slice(MARKER_PREFIX.length)); } catch { return; }
  if (typeof marker.sessionId !== "string" || Date.now() - Number(marker.armedAt ?? 0) > 120_000) return;
  const sessionId = marker.sessionId;
  const batches: any[] = [];
  let version = 0;
  const waiters = new Set<(value: number) => void>();
  const validId = (value: unknown) => value === null || (typeof value === "string" && value.length >= 8 && value.length <= 400);
  const validPart = (part: any) => part && typeof part === "object"
    && ["text", "code", "link", "media-placeholder"].includes(part.type)
    && (part.text === undefined || (typeof part.text === "string" && part.text.length <= 2_000_000))
    && (part.url === undefined || (typeof part.url === "string" && part.url.length <= 10_000))
    && (part.label === undefined || (typeof part.label === "string" && part.label.length <= 10_000));
  const validNode = (node: any) => node && typeof node === "object"
    && validId(node.messageId) && node.messageId !== null
    && validId(node.sourceMessageId)
    && validId(node.parentId)
    && typeof node.parentKnown === "boolean"
    && ["user", "assistant", "system", "tool", "unknown"].includes(node.role)
    && typeof node.nodeType === "string" && node.nodeType.length <= 100
    && typeof node.contentKind === "string" && node.contentKind.length <= 100
    && Array.isArray(node.parts) && node.parts.length <= 100 && node.parts.every(validPart)
    && (node.occurredAt === null || typeof node.occurredAt === "string")
    && typeof node.visibleContentOmitted === "boolean";
  const validPageInfo = (info: any) => info === null || (
    info && typeof info === "object"
    && (info.hasPreviousPage === null || typeof info.hasPreviousPage === "boolean")
    && validId(info.startCursor) && validId(info.endCursor) && validId(info.before) && validId(info.previousCursor)
  );
  const validAuditHash = (value: unknown) => typeof value === "string" && /^session:[a-f0-9]{8}$|^none$/.test(value);
  const validOrderedPageItem = (item: any) => item && typeof item === "object"
    && validId(item.messageId) && item.messageId !== null
    && validAuditHash(item.graphNodeHash) && validAuditHash(item.messageIdHash)
    && ["user", "assistant", "system", "tool", "unknown"].includes(item.role)
    && typeof item.nodeType === "string" && item.nodeType.length <= 100
    && typeof item.hasVisibleContent === "boolean"
    && typeof item.createTimePresent === "boolean"
    && typeof item.parentPresent === "boolean"
    && Number.isInteger(item.itemPosition) && item.itemPosition >= 0;
  const validOrderedPage = (page: any) => page === null || (
    page && typeof page === "object"
    && Number.isInteger(page.responseSequence) && page.responseSequence > 0
    && (page.collection === "messages" || page.collection === "mapping")
    && validAuditHash(page.cursorHash)
    && (page.hasPreviousPage === null || typeof page.hasPreviousPage === "boolean")
    && Array.isArray(page.items) && page.items.length <= 10_000 && page.items.every(validOrderedPageItem)
  );
  const validBatch = (batch: any) => batch && typeof batch === "object"
    && batch.schemaVersion === "chatgpt-page-data-v1"
    && typeof batch.batchId === "string" && batch.batchId.startsWith(`${sessionId}:`)
    && validId(batch.conversationId)
    && validId(batch.currentNode)
    && Array.isArray(batch.nodes) && batch.nodes.length <= 10_000 && batch.nodes.every(validNode)
    && validPageInfo(batch.pageInfo)
    && validOrderedPage(batch.orderedPage)
    && batch.adapterVersion === "chatgpt-page-observer-v1"
    && typeof batch.receivedAt === "string";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== "research-os-page-data-v1" || event.data?.sessionId !== sessionId) return;
    const batch = event.data.payload;
    if (!validBatch(batch)) return;
    const serialized = JSON.stringify(batch);
    if (serialized.length > 16 * 1024 * 1024 || batches.some((item) => item.batchId === batch.batchId)) return;
    batches.push(batch);
    if (batches.length > 300) batches.shift();
    version += 1;
    for (const resolve of waiters) resolve(version);
    waiters.clear();
  });

  window.__researchOsPageDataBridge = {
    sessionId,
    snapshot: () => ({ version, batches: batches.slice() }),
    waitForChange(afterVersion: number, timeoutMs: number) {
      if (version > afterVersion) return Promise.resolve(version);
      return new Promise<number>((resolve) => {
        const done = (value: number) => {
          window.clearTimeout(timer);
          waiters.delete(done);
          resolve(value);
        };
        const timer = window.setTimeout(() => done(version), Math.max(0, Math.min(timeoutMs, 15_000)));
        waiters.add(done);
      });
    },
  };
})();

declare global {
  interface Window {
    __researchOsPageDataBridge?: {
      sessionId: string;
      snapshot(): { version: number; batches: any[] };
      waitForChange(afterVersion: number, timeoutMs: number): Promise<number>;
    };
  }
}

export {};
