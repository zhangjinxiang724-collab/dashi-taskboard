(() => {
  "use strict";

  const MARKER_PREFIX = "__research_os_capture_v1__";
  const rawMarker = window.name || "";
  if (!rawMarker.startsWith(MARKER_PREFIX)) return;

  let marker: { sessionId?: string; conversationId?: string; armedAt?: number; previousWindowName?: string };
  try {
    marker = JSON.parse(rawMarker.slice(MARKER_PREFIX.length));
  } catch {
    return;
  }
  if (
    typeof marker.sessionId !== "string"
    || !/^[a-f0-9-]{20,80}$/i.test(marker.sessionId)
    || Date.now() - Number(marker.armedAt ?? 0) > 120_000
  ) return;
  window.setTimeout(() => {
    window.name = typeof marker.previousWindowName === "string" ? marker.previousWindowName : "";
  }, 0);

  const sessionId = marker.sessionId;
  const expectedConversationId = typeof marker.conversationId === "string" ? marker.conversationId : null;
  const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
  let batchSequence = 0;
  let stopped = false;
  window.setTimeout(() => { stopped = true; }, 5 * 60_000);

  type Part = {
    type: "text" | "code" | "link" | "media-placeholder";
    text?: string;
    language?: string | null;
    url?: string;
    label?: string;
    mediaType?: "image" | "video" | "audio" | "file" | "canvas" | "tool-ui" | "unknown";
  };
  type GraphNode = {
    messageId: string;
    sourceMessageId: string | null;
    parentId: string | null;
    parentKnown: boolean;
    role: "user" | "assistant" | "system" | "tool" | "unknown";
    nodeType: string;
    contentKind: string;
    parts: Part[];
    occurredAt: string | null;
    visibleContentOmitted: boolean;
    diagnosticMessageHash: string;
    diagnosticStructure: {
      heading: number; boldItalic: number; inlineCode: number; codeBlock: number; link: number;
      citation: number; blockquote: number; listItem: number; table: number; math: number;
      htmlEntity: number; unicode: number; toolCard: number; hiddenUi: number; unknownRich: number;
    };
  };
  type OrderedPageItem = {
    messageId: string;
    graphNodeHash: string;
    messageIdHash: string;
    role: GraphNode["role"];
    nodeType: string;
    hasVisibleContent: boolean;
    createTimePresent: boolean;
    parentPresent: boolean;
    itemPosition: number;
  };

  const objectValue = (value: unknown): Record<string, any> | null => (
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null
  );
  const validId = (value: unknown) => (
    typeof value === "string" && value.length >= 8 && value.length <= 300 ? value : null
  );
  const relationId = (value: unknown): string | null => {
    const object = objectValue(value);
    return validId(value)
      ?? validId(object?.id)
      ?? validId(object?.message_id)
      ?? validId(object?.messageId)
      ?? validId(object?.node_id)
      ?? validId(object?.nodeId);
  };
  const hasOwn = (value: unknown, key: string) => Boolean(objectValue(value) && Object.prototype.hasOwnProperty.call(value, key));
  const firstField = (value: unknown, names: string[]) => {
    const object = objectValue(value);
    if (!object) return { present: false, value: undefined };
    for (const name of names) if (hasOwn(object, name)) return { present: true, value: object[name] };
    return { present: false, value: undefined };
  };
  const sourceText = (value: unknown) => String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  const sessionHash = (value: string | null) => {
    if (!value) return "none";
    const input = `${sessionId}:${value}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `session:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };
  const normalizedRole = (message: Record<string, any> | null): GraphNode["role"] => {
    const raw = String(message?.author?.role ?? message?.role ?? "unknown").toLowerCase();
    return raw === "user" || raw === "assistant" || raw === "system" || raw === "tool" ? raw : "unknown";
  };
  const nodeTypeOf = (rawNode: Record<string, any>, message: Record<string, any> | null) => {
    const value = rawNode.node_type ?? rawNode.nodeType ?? message?.content?.content_type ?? message?.content?.type ?? normalizedRole(message);
    return typeof value === "string" ? value.slice(0, 100) : "unknown";
  };
  const occurredAtOf = (message: Record<string, any> | null) => {
    const value = message?.create_time ?? message?.created_at ?? message?.createdAt ?? null;
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    return null;
  };
  const structureOf = (message: Record<string, any> | null) => {
    const content = objectValue(message?.content);
    const values: unknown[] = [];
    if (typeof content?.text === "string") values.push(content.text);
    if (Array.isArray(content?.parts)) values.push(...content.parts);
    const text = values.filter((value) => typeof value === "string").join("\n");
    const objectParts = values.map(objectValue).filter((value): value is Record<string, any> => value !== null);
    const types = objectParts.map((part) => String(part.content_type ?? part.type ?? "unknown").toLowerCase());
    const metadata = objectValue(message?.metadata);
    const annotationCount = Array.isArray(content?.annotations) ? content.annotations.length
      : Array.isArray(metadata?.citations) ? metadata.citations.length : 0;
    return {
      heading: (text.match(/^\s{0,3}#{1,6}\s+/gm) ?? []).length,
      boldItalic: (text.match(/\*\*|__|(?<!\w)[*_][^\n]+[*_](?!\w)/g) ?? []).length,
      inlineCode: (text.match(/`[^`\n]+`/g) ?? []).length,
      codeBlock: (text.match(/```[\s\S]*?```/g) ?? []).length + types.filter((type) => /code/.test(type)).length,
      link: (text.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length + types.filter((type) => /link|url/.test(type)).length,
      citation: (text.match(/\uE200cite\uE202[^\uE201]*\uE201|[【\[]\s*\d+(?:\s*[-,–]\s*\d+)*\s*[】\]]|[¹²³⁴⁵⁶⁷⁸⁹⁰]/gi) ?? []).length + annotationCount + types.filter((type) => /citation|reference/.test(type)).length,
      blockquote: (text.match(/^\s{0,3}>\s?/gm) ?? []).length,
      listItem: (text.match(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/gm) ?? []).length,
      table: (text.match(/^\s*\|.+\|\s*$/gm) ?? []).length,
      math: (text.match(/\$\$?[\s\S]+?\$\$?|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g) ?? []).length + types.filter((type) => /math|latex/.test(type)).length,
      htmlEntity: /&(?:#\d+|#x[0-9a-f]+|\w+);/i.test(text) ? 1 : 0,
      unicode: /[^\x00-\x7F]/.test(text) ? 1 : 0,
      toolCard: types.filter((type) => /tool|research|result|card/.test(type)).length,
      hiddenUi: 0,
      unknownRich: objectParts.filter((part, index) => !part.text && !/code|link|url|citation|reference|math|latex|tool|research|result|card|image|video|audio|file|attachment|canvas/.test(types[index])).length,
    };
  };
  const partsOf = (message: Record<string, any> | null, role: GraphNode["role"], nodeType: string) => {
    if (
      !message
      || (role !== "user" && role !== "assistant")
      || /thought|reasoning|system|tool|metadata|computer|model_editable_context|web.run/i.test(nodeType)
    ) {
      return { parts: [] as Part[], visibleContentOmitted: false, contentKind: "internal" };
    }
    const content = objectValue(message.content);
    if (!content) return { parts: [] as Part[], visibleContentOmitted: false, contentKind: "none" };
    const parts: Part[] = [];
    const textValues: string[] = [];
    if (typeof content.text === "string") textValues.push(content.text);
    for (const partValue of Array.isArray(content.parts) ? content.parts : []) {
      if (typeof partValue === "string") {
        textValues.push(partValue);
        continue;
      }
      const part = objectValue(partValue);
      if (!part) continue;
      if (typeof part.text === "string") {
        textValues.push(part.text);
        continue;
      }
      const partType = String(part.content_type ?? part.type ?? "unknown").toLowerCase();
      const mediaType: Part["mediaType"] = /image/.test(partType) ? "image"
        : /video/.test(partType) ? "video"
          : /audio/.test(partType) ? "audio"
            : /file|attachment/.test(partType) ? "file"
              : /canvas/.test(partType) ? "canvas"
                : /tool|research/.test(partType) ? "tool-ui" : "unknown";
      parts.push({ type: "media-placeholder", label: `未完整保存的 ${partType || "内容"}`, mediaType });
    }
    const text = sourceText(textValues.join("\n"));
    if (text) {
      const type: Part["type"] = /code/.test(String(content.content_type ?? nodeType).toLowerCase()) ? "code" : "text";
      parts.unshift({ type, text, language: type === "code" ? null : undefined });
    }
    const contentType = String(content.content_type ?? content.type ?? "").toLowerCase();
    if (parts.length === 0 && /image|video|audio|file|attachment|canvas/.test(contentType)) {
      const mediaType: Part["mediaType"] = /image/.test(contentType) ? "image"
        : /video/.test(contentType) ? "video"
          : /audio/.test(contentType) ? "audio"
            : /file|attachment/.test(contentType) ? "file"
              : "canvas";
      parts.push({ type: "media-placeholder", label: `未完整保存的 ${contentType || "媒体内容"}`, mediaType });
    }
    return {
      parts,
      // ChatGPT keeps empty text nodes in its history graph. With no parsed
      // parts there is no user-visible transcript content to report missing.
      visibleContentOmitted: false,
      contentKind: contentType.slice(0, 100) || "unknown",
    };
  };
  const pageInfoOf = (value: unknown) => {
    const info = objectValue(value);
    if (!info) return null;
    const hasPrevious = firstField(info, ["has_previous_page", "hasPreviousPage"]);
    if (!hasPrevious.present) return null;
    const start = firstField(info, ["start_cursor", "startCursor"]);
    const end = firstField(info, ["end_cursor", "endCursor"]);
    const before = firstField(info, ["before"]);
    const previous = firstField(info, ["previous_cursor", "previousCursor"]);
    return {
      hasPreviousPage: typeof hasPrevious.value === "boolean" ? hasPrevious.value : null,
      startCursor: validId(start.value),
      endCursor: validId(end.value),
      before: validId(before.value),
      previousCursor: validId(previous.value),
    };
  };
  const responseCategory = (url: string) => {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return null;
      const path = parsed.pathname.toLowerCase();
      if (expectedConversationId && path.includes(expectedConversationId.toLowerCase())) return "conversation-id";
      if (/(conversation|message|history)/.test(path)) return "conversation-data";
      return null;
    } catch {
      return null;
    }
  };
  const decodePayloads = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    try { return [JSON.parse(trimmed)]; } catch {}
    const values: unknown[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const candidate = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
      if (!candidate || candidate === "[DONE]") continue;
      try { values.push(JSON.parse(candidate)); } catch {}
    }
    return values;
  };
  const inspectPayload = (root: unknown, category: string) => {
    if (stopped) return;
    const nodes = new Map<string, GraphNode>();
    const seen = new Set<unknown>();
    const observedConversationIds = new Set<string>();
    let currentNode: string | null = null;
    let pageInfo: ReturnType<typeof pageInfoOf> = null;
    let orderedPageItems: OrderedPageItem[] = [];
    let orderedPageCollection: "messages" | "mapping" | null = null;

    const upsert = (rawValue: unknown, messageValue: unknown, fallbackId: unknown) => {
      const raw = objectValue(rawValue) ?? {};
      const message = objectValue(messageValue);
      // current_node and parent point at mapping-node IDs. A message's own ID
      // can differ, so keep it separately for DOM/message identity checks.
      const messageId = relationId(fallbackId) ?? relationId(raw.id) ?? relationId(message?.id);
      if (!messageId) return null;
      const directParent = firstField(raw, ["parent", "parent_id", "parentId", "parent_message_id", "parentMessageId"]);
      const metadataParent = firstField(objectValue(message?.metadata), ["parent", "parent_id", "parentId", "parent_message_id", "parentMessageId"]);
      const parent = directParent.present ? directParent : metadataParent;
      const role = normalizedRole(message);
      const nodeType = nodeTypeOf(raw, message);
      const content = partsOf(message, role, nodeType);
      const candidate: GraphNode = {
        messageId,
        sourceMessageId: relationId(message?.id) ?? messageId,
        parentId: parent.present ? relationId(parent.value) : null,
        parentKnown: parent.present,
        role,
        nodeType,
        contentKind: content.contentKind,
        parts: content.parts,
        occurredAt: occurredAtOf(message),
        visibleContentOmitted: content.visibleContentOmitted,
        diagnosticMessageHash: sessionHash(relationId(message?.id) ?? messageId),
        diagnosticStructure: structureOf(message),
      };
      const existing = nodes.get(messageId);
      if (!existing || candidate.parts.length > existing.parts.length || (!existing.parentKnown && candidate.parentKnown)) nodes.set(messageId, candidate);
      return candidate;
    };

    const orderedItem = (rawValue: unknown, messageValue: unknown, fallbackId: unknown, itemPosition: number) => {
      const node = upsert(rawValue, messageValue, fallbackId);
      if (!node) return null;
      return {
        messageId: node.messageId,
        graphNodeHash: sessionHash(node.messageId),
        messageIdHash: sessionHash(node.sourceMessageId),
        role: node.role,
        nodeType: node.nodeType,
        hasVisibleContent: node.parts.length > 0,
        createTimePresent: node.occurredAt !== null,
        parentPresent: node.parentKnown,
        itemPosition,
      } satisfies OrderedPageItem;
    };

    const walk = (value: unknown) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
        return;
      }
      const object = value as Record<string, any>;
      const conversation = firstField(object, ["conversation_id", "conversationId"]);
      const conversationId = validId(conversation.value);
      if (conversationId) observedConversationIds.add(conversationId);
      const current = firstField(object, ["current_node", "currentNode", "current_message_id", "currentMessageId"]);
      currentNode = relationId(current.value) ?? currentNode;
      const objectPageInfo = pageInfoOf(object.page_info ?? object.pageInfo);
      pageInfo = objectPageInfo ?? pageInfo;
      if (objectPageInfo && orderedPageItems.length === 0 && Array.isArray(object.messages)) {
        orderedPageItems = object.messages.map((rawItem, itemPosition) => {
          const item = objectValue(rawItem);
          const message = objectValue(item?.message) ?? item;
          return orderedItem(item, message, item?.id, itemPosition);
        }).filter((item): item is OrderedPageItem => item !== null);
        if (orderedPageItems.length > 0) orderedPageCollection = "messages";
      }
      if (object.mapping && typeof object.mapping === "object" && !Array.isArray(object.mapping)) {
        const mappingEntries = Object.entries(object.mapping);
        if (objectPageInfo && orderedPageItems.length === 0) {
          orderedPageItems = mappingEntries.map(([id, rawNode], itemPosition) => {
            const node = objectValue(rawNode);
            return node ? orderedItem(node, node.message, id, itemPosition) : null;
          }).filter((item): item is OrderedPageItem => item !== null);
          if (orderedPageItems.length > 0) orderedPageCollection = "mapping";
        }
        for (const [id, rawNode] of mappingEntries) {
          const node = objectValue(rawNode);
          if (node) upsert(node, node.message, id);
        }
      }
      if (object.message && typeof object.message === "object") upsert(object, object.message, object.id);
      if (object.author && object.content) upsert(object, object, object.id);
      for (const child of Object.values(object)) walk(child);
    };
    walk(root);

    const targetAssociated = category === "conversation-id"
      || !expectedConversationId
      || observedConversationIds.has(expectedConversationId);
    if (!targetAssociated || (nodes.size === 0 && !pageInfo && !currentNode)) return;
    const finalPageInfo = pageInfo as ReturnType<typeof pageInfoOf>;
    const pageCursor = finalPageInfo?.startCursor ?? finalPageInfo?.before ?? finalPageInfo?.previousCursor ?? null;
    window.postMessage({
      source: "research-os-page-data-v1",
      sessionId,
      payload: {
        schemaVersion: "chatgpt-page-data-v1",
        batchId: `${sessionId}:${batchSequence += 1}`,
        conversationId: expectedConversationId ?? [...observedConversationIds][0] ?? null,
        currentNode,
        nodes: [...nodes.values()],
        pageInfo: finalPageInfo,
        orderedPage: finalPageInfo && orderedPageItems.length > 0 ? {
          responseSequence: batchSequence,
          collection: orderedPageCollection,
          cursorHash: sessionHash(pageCursor),
          hasPreviousPage: finalPageInfo.hasPreviousPage,
          items: orderedPageItems,
        } : null,
        adapterVersion: "chatgpt-page-observer-v1",
        receivedAt: new Date().toISOString(),
      },
    }, location.origin);
  };
  const inspectText = (text: string, category: string) => {
    for (const payload of decodePayloads(text)) inspectPayload(payload, category);
  };
  const readClone = async (response: Response) => {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return "";
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  };
  const inspectResponse = async (response: Response) => {
    if (stopped) return;
    const category = responseCategory(response.url || location.href);
    if (!category) return;
    try {
      const text = await readClone(response.clone());
      if (text) inspectText(text, category);
    } catch {}
  };

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    return originalFetch.apply(this, args).then((response) => {
      void inspectResponse(response);
      return response;
    });
  };

  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  OriginalXHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
    this.addEventListener("loadend", () => {
      const category = responseCategory(this.responseURL || String(url));
      if (!category) return;
      if (stopped) return;
      try {
        if (this.responseType === "json") inspectPayload(this.response, category);
        else if (this.responseType === "" || this.responseType === "text") inspectText(this.responseText || "", category);
      } catch {}
    }, { once: true });
    return (originalOpen as any).call(this, method, url, ...rest);
  } as typeof OriginalXHR.prototype.open;
})();
