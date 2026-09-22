import {
  isCognitionUpdateType,
  isConfidenceLevel,
  isResearchRecordKind,
  isResearchRecordProvider,
  isResearchStatus,
  isTopicQuestionStatus,
} from "../shared/research-domain.mjs";

const TOPIC_PATH = /^\/api\/research\/topics\/([^/]+)$/;
const TOPIC_MARK_RESEARCHED_PATH = /^\/api\/research\/topics\/([^/]+)\/mark-researched$/;
const TOPIC_QUESTIONS_PATH = /^\/api\/research\/topics\/([^/]+)\/questions$/;
const TOPIC_QUESTION_PATH = /^\/api\/research\/topics\/([^/]+)\/questions\/([^/]+)$/;
const TOPIC_QUESTION_MOVE_PATH = /^\/api\/research\/topics\/([^/]+)\/questions\/([^/]+)\/move$/;
const TOPIC_TASK_PATH = /^\/api\/research\/topics\/([^/]+)\/tasks\/([^/]+)$/;
const TOPIC_RECORDS_PATH = /^\/api\/research\/topics\/([^/]+)\/records$/;
const RESEARCH_RECORD_PATH = /^\/api\/research\/records\/([^/]+)$/;
const RESEARCH_RECORD_CONTENT_PATH = /^\/api\/research\/records\/([^/]+)\/content$/;
const RESEARCH_RECORD_CONTENT_VERSIONS_PATH = /^\/api\/research\/records\/([^/]+)\/content-versions$/;
const RESEARCH_RECORD_SUMMARY_PATH = /^\/api\/research\/records\/([^/]+)\/summary$/;
const RESEARCH_RECORD_SUMMARY_AI_DRAFT_PATH = /^\/api\/research\/records\/([^/]+)\/summary\/ai-draft$/;
const RESEARCH_SUMMARY_PATH = /^\/api\/research\/summaries\/([^/]+)$/;
const IMPORT_PREVIEW_PATH = /^\/api\/research\/imports\/previews\/([^/]+)$/;
const IMPORT_PREVIEW_CONFIRM_PATH = /^\/api\/research\/imports\/previews\/([^/]+)\/confirm$/;
const IMPORT_PREVIEW_SELECTION_PATH = /^\/api\/research\/imports\/previews\/([^/]+)\/selection$/;
const IMPORT_SESSION_UNDO_PATH = /^\/api\/research\/imports\/sessions\/([^/]+)\/undo$/;
const CAPTURE_CLIENT_PATH = /^\/api\/research\/capture\/clients\/([^/]+)$/;
const CAPTURE_PREVIEW_PATH = /^\/api\/research\/captures\/browser\/previews\/([^/]+)$/;
const CAPTURE_PREVIEW_BATCH_PATH = /^\/api\/research\/captures\/browser\/previews\/([^/]+)\/batches$/;
const CAPTURE_PREVIEW_FINALIZE_PATH = /^\/api\/research\/captures\/browser\/previews\/([^/]+)\/finalize$/;
const CAPTURE_PREVIEW_CONFIRM_PATH = /^\/api\/research\/captures\/browser\/previews\/([^/]+)\/confirm$/;
const TOPIC_COGNITION_UPDATES_PATH = /^\/api\/research\/topics\/([^/]+)\/cognition-updates$/;
const COGNITION_UPDATE_PATH = /^\/api\/research\/cognition-updates\/([^/]+)$/;
const COGNITION_UPDATE_APPLY_PATH = /^\/api\/research\/cognition-updates\/([^/]+)\/apply$/;
const COGNITION_UPDATE_REJECT_PATH = /^\/api\/research\/cognition-updates\/([^/]+)\/reject$/;
const COGNITION_UPDATE_AI_DRAFT_PATH = /^\/api\/research\/cognition-updates\/([^/]+)\/ai-draft$/;

function assertPlainObject(value, ApiError) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_BODY", "Request body must be a JSON object");
  }
}

function assertAllowedKeys(value, allowed, ApiError) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ApiError(400, "UNKNOWN_FIELD", `Unknown field: ${unknown[0]}`);
  }
}

function text(value, field, ApiError, { required = false, maxLength = 20_000 } = {}) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_FIELD", `${field} must be a string`);
  }
  const result = value.trim();
  if (required && !result) {
    throw new ApiError(400, "INVALID_FIELD", `${field} is required`);
  }
  if (result.length > maxLength) {
    throw new ApiError(400, "INVALID_FIELD", `${field} is too long`);
  }
  return result;
}

function labels(value, ApiError) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((label) => typeof label !== "string")) {
    throw new ApiError(400, "INVALID_FIELD", "labels must be an array of strings");
  }
  return [...new Set(value.map((label) => label.trim()).filter(Boolean))];
}

function confidenceLevel(value, ApiError) {
  if (value === undefined || value === null || value === "") return null;
  if (!isConfidenceLevel(value)) {
    throw new ApiError(400, "INVALID_FIELD", "confidenceLevel must be low, medium, high, or null");
  }
  return value;
}

function positiveVersion(value, ApiError) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(400, "INVALID_FIELD", "version must be a positive integer");
  }
  return value;
}

function nullableText(value, field, ApiError, { maxLength = 20_000 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  return text(value, field, ApiError, { maxLength }) || null;
}

function occurredAt(value, ApiError) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "INVALID_FIELD", "occurredAt is required");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new ApiError(400, "INVALID_FIELD", "occurredAt must be a valid date and time");
  }
  return new Date(timestamp).toISOString();
}

function queryDate(value, field, ApiError, { endOfDay = false } = {}) {
  if (value === null || value === "") return null;
  const timestamp = Date.parse(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59.999Z`
    : value);
  if (!Number.isFinite(timestamp)) {
    throw new ApiError(400, "INVALID_QUERY_PARAMETER", `${field} must be a valid date`);
  }
  return new Date(timestamp).toISOString();
}

function positiveQueryInteger(value, field, ApiError, { defaultValue, maximum }) {
  if (value === null || value === "") return defaultValue;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new ApiError(400, "INVALID_QUERY_PARAMETER", `${field} must be between 1 and ${maximum}`);
  }
  return number;
}

function externalUrl(value, ApiError) {
  const candidate = nullableText(value, "url", ApiError, { maxLength: 4_000 });
  if (candidate === null) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ApiError(400, "INVALID_FIELD", "url must be a valid http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(400, "INVALID_FIELD", "url must use http or https");
  }
  return parsed.toString();
}

function researchRecordProvider(value, ApiError) {
  if (!isResearchRecordProvider(value)) {
    throw new ApiError(400, "INVALID_FIELD", "provider is not supported");
  }
  return value;
}

function researchRecordKind(value, ApiError) {
  if (!isResearchRecordKind(value)) {
    throw new ApiError(400, "INVALID_FIELD", "kind is not supported");
  }
  return value;
}

const RESEARCH_RECORD_FIELDS = new Set([
  "title", "provider", "kind", "url", "externalId", "summary", "note", "occurredAt",
]);

function parseResearchRecordCreate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, RESEARCH_RECORD_FIELDS, ApiError);
  return {
    title: text(body.title, "title", ApiError, { required: true, maxLength: 300 }),
    provider: researchRecordProvider(body.provider, ApiError),
    kind: researchRecordKind(body.kind, ApiError),
    url: externalUrl(body.url, ApiError),
    externalId: nullableText(body.externalId, "externalId", ApiError, { maxLength: 1_000 }),
    summary: text(body.summary, "summary", ApiError),
    note: text(body.note, "note", ApiError),
    occurredAt: occurredAt(body.occurredAt, ApiError),
  };
}

function parseResearchRecordUpdate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set(["version", ...RESEARCH_RECORD_FIELDS]), ApiError);
  const version = positiveVersion(body.version, ApiError);
  const changes = {};
  if (body.title !== undefined) {
    changes.title = text(body.title, "title", ApiError, { required: true, maxLength: 300 });
  }
  if (body.provider !== undefined) {
    changes.provider = researchRecordProvider(body.provider, ApiError);
  }
  if (body.kind !== undefined) changes.kind = researchRecordKind(body.kind, ApiError);
  if (body.url !== undefined) changes.url = externalUrl(body.url, ApiError);
  if (body.externalId !== undefined) {
    changes.externalId = nullableText(body.externalId, "externalId", ApiError, { maxLength: 1_000 });
  }
  if (body.summary !== undefined) changes.summary = text(body.summary, "summary", ApiError);
  if (body.note !== undefined) changes.note = text(body.note, "note", ApiError);
  if (body.occurredAt !== undefined) changes.occurredAt = occurredAt(body.occurredAt, ApiError);
  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "INVALID_BODY", "At least one research record field must be changed");
  }
  return { version, changes };
}

function parseCognitionUpdateCreate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set(["recordId", "sourceContentVersionId"]), ApiError);
  return {
    recordId: text(body.recordId, "recordId", ApiError, { required: true, maxLength: 1_000 }),
    sourceContentVersionId: nullableText(body.sourceContentVersionId, "sourceContentVersionId", ApiError, { maxLength: 1_000 }),
  };
}

function parseResearchSummaryFields(body, ApiError, { creating = false } = {}) {
  assertPlainObject(body, ApiError);
  const allowed = creating
    ? new Set(["sourceContentVersionId", "oneLineSummary", "coreContent", "keyEvidence", "unresolved"])
    : new Set(["version", "oneLineSummary", "coreContent", "keyEvidence", "unresolved"]);
  assertAllowedKeys(body, allowed, ApiError);
  return {
    ...(creating ? {
      sourceContentVersionId: text(body.sourceContentVersionId, "sourceContentVersionId", ApiError, { required: true, maxLength: 1_000 }),
    } : {
      version: positiveVersion(body.version, ApiError),
    }),
    oneLineSummary: text(body.oneLineSummary, "oneLineSummary", ApiError, { required: true, maxLength: 1_000 }),
    coreContent: text(body.coreContent, "coreContent", ApiError),
    keyEvidence: text(body.keyEvidence, "keyEvidence", ApiError),
    unresolved: text(body.unresolved, "unresolved", ApiError),
  };
}

function parseResearchSummaryAiDraft(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set(["sourceContentVersionId", "summaryVersion"]), ApiError);
  const summaryVersion = body.summaryVersion === undefined || body.summaryVersion === null
    ? null
    : positiveVersion(body.summaryVersion, ApiError);
  return {
    sourceContentVersionId: text(body.sourceContentVersionId, "sourceContentVersionId", ApiError, { required: true, maxLength: 1_000 }),
    summaryVersion,
  };
}

function parseCognitionUpdatePatch(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set([
    "version", "updateType", "newInformation", "impact", "proposedCurrentView",
  ]), ApiError);
  const version = positiveVersion(body.version, ApiError);
  const changes = {};
  if (body.updateType !== undefined) {
    if (!isCognitionUpdateType(body.updateType)) {
      throw new ApiError(400, "INVALID_FIELD", "updateType is not supported");
    }
    changes.updateType = body.updateType;
  }
  if (body.newInformation !== undefined) {
    changes.newInformation = text(body.newInformation, "newInformation", ApiError);
  }
  if (body.impact !== undefined) changes.impact = text(body.impact, "impact", ApiError);
  if (body.proposedCurrentView !== undefined) {
    changes.proposedCurrentView = text(body.proposedCurrentView, "proposedCurrentView", ApiError);
  }
  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "INVALID_BODY", "At least one cognition update field must be changed");
  }
  return { version, changes };
}

function cognitionUpdateResult(result, ApiError) {
  if (result.kind === "not_found") throw new ApiError(404, "COGNITION_UPDATE_NOT_FOUND", "Cognition update not found");
  if (result.kind === "conflict") {
    throw new ApiError(409, "COGNITION_UPDATE_VERSION_CONFLICT", "Cognition update was changed by another request", { currentVersion: result.currentVersion });
  }
  if (result.kind === "not_draft") {
    throw new ApiError(409, "COGNITION_UPDATE_NOT_DRAFT", "Only draft cognition updates can be changed", { status: result.status });
  }
  return result.update;
}

function parseCreate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set([
    "title", "status", "coreQuestion", "currentView", "confidenceLevel",
    "nextAction", "reviewTrigger", "labels",
  ]), ApiError);
  const status = body.status ?? "inbox";
  if (!isResearchStatus(status)) {
    throw new ApiError(400, "INVALID_FIELD", "status is not a valid research status");
  }
  return {
    title: text(body.title, "title", ApiError, { required: true, maxLength: 300 }),
    status,
    coreQuestion: text(body.coreQuestion, "coreQuestion", ApiError),
    currentView: text(body.currentView, "currentView", ApiError),
    confidenceLevel: confidenceLevel(body.confidenceLevel, ApiError),
    nextAction: text(body.nextAction, "nextAction", ApiError),
    reviewTrigger: text(body.reviewTrigger, "reviewTrigger", ApiError),
    labels: labels(body.labels, ApiError),
  };
}

function parseUpdate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set([
    "version", "title", "status", "coreQuestion", "currentView",
    "confidenceLevel", "nextAction", "reviewTrigger", "labels",
  ]), ApiError);
  const version = positiveVersion(body.version, ApiError);
  const changes = {};
  if (body.title !== undefined) {
    changes.title = text(body.title, "title", ApiError, { required: true, maxLength: 300 });
  }
  if (body.status !== undefined) {
    if (!isResearchStatus(body.status)) {
      throw new ApiError(400, "INVALID_FIELD", "status is not a valid research status");
    }
    changes.status = body.status;
  }
  for (const key of ["coreQuestion", "currentView", "nextAction", "reviewTrigger"]) {
    if (body[key] !== undefined) changes[key] = text(body[key], key, ApiError);
  }
  if (body.confidenceLevel !== undefined) {
    changes.confidenceLevel = confidenceLevel(body.confidenceLevel, ApiError);
  }
  if (body.labels !== undefined) changes.labels = labels(body.labels, ApiError);
  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "INVALID_BODY", "At least one topic field must be changed");
  }
  return { version, changes };
}

function parseVersionOnly(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set(["version"]), ApiError);
  return positiveVersion(body.version, ApiError);
}

function parseQuestionCreate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set(["question"]), ApiError);
  return {
    question: text(body.question, "question", ApiError, { required: true, maxLength: 2_000 }),
  };
}

function parseQuestionUpdate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set([
    "version", "question", "status", "answerOrNote",
  ]), ApiError);
  const version = positiveVersion(body.version, ApiError);
  const changes = {};
  if (body.question !== undefined) {
    changes.question = text(body.question, "question", ApiError, { required: true, maxLength: 2_000 });
  }
  if (body.status !== undefined) {
    if (!isTopicQuestionStatus(body.status)) {
      throw new ApiError(400, "INVALID_FIELD", "status is not a valid question status");
    }
    changes.status = body.status;
  }
  if (body.answerOrNote !== undefined) {
    changes.answerOrNote = text(body.answerOrNote, "answerOrNote", ApiError);
  }
  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "INVALID_BODY", "At least one question field must be changed");
  }
  return { version, changes };
}

function parseQuestionMove(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set(["version", "direction"]), ApiError);
  const version = positiveVersion(body.version, ApiError);
  if (body.direction !== "up" && body.direction !== "down") {
    throw new ApiError(400, "INVALID_FIELD", "direction must be up or down");
  }
  return { version, direction: body.direction };
}

function topicResult(result, ApiError) {
  if (result.kind === "not_found") {
    throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
  }
  if (result.kind === "conflict") {
    throw new ApiError(409, "TOPIC_VERSION_CONFLICT", "Topic was changed by another request", {
      currentVersion: result.currentVersion,
    });
  }
  return result.topic;
}

function questionResult(result, ApiError) {
  if (result.kind === "topic_not_found") {
    throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
  }
  if (result.kind === "not_found") {
    throw new ApiError(404, "QUESTION_NOT_FOUND", "Open question not found");
  }
  if (result.kind === "conflict") {
    throw new ApiError(409, "QUESTION_VERSION_CONFLICT", "Question was changed by another request", {
      currentVersion: result.currentVersion,
    });
  }
  return result.topic;
}

function researchRecordResult(result, ApiError) {
  if (result.kind === "not_found") {
    throw new ApiError(404, "RESEARCH_RECORD_NOT_FOUND", "Research record not found");
  }
  if (result.kind === "conflict") {
    throw new ApiError(
      409,
      "RESEARCH_RECORD_VERSION_CONFLICT",
      "Research record was changed by another request",
      { currentVersion: result.currentVersion },
    );
  }
  return result.record;
}

export async function handleResearchRequest({
  request,
  response,
  url,
  research,
  researchImports,
  researchCaptures,
  researchAiDrafts,
  researchSummaryAiDrafts,
  readJson,
  sendJson,
  sendEmpty,
  methodNotAllowed,
  ApiError,
}) {
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/research/")) return false;

  if (pathname === "/api/research/capture/health") {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Capture health does not accept query parameters");
    sendJson(response, 200, { status: "ok" });
    return true;
  }

  if (pathname === "/api/research/capture/pairings/start") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Pairing does not accept query parameters");
    sendJson(response, 201, { pairing: researchCaptures.startPairing() });
    return true;
  }

  if (pathname === "/api/research/capture/pairings/complete") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    const body = await readJson(request, 64 * 1024, "Pairing request is too large");
    assertPlainObject(body, ApiError);
    assertAllowedKeys(body, new Set(["code", "displayName"]), ApiError);
    const result = researchCaptures.completePairing({
      code: text(body.code, "code", ApiError, { required: true, maxLength: 100 }),
      displayName: text(body.displayName ?? "Research OS Chrome", "displayName", ApiError, { required: true, maxLength: 100 }),
      origin: request.headers.origin,
    });
    if (result.kind === "invalid_origin") throw new ApiError(403, "INVALID_EXTENSION_ORIGIN", "Pairing must come from a Chrome extension");
    if (result.kind === "invalid_code") throw new ApiError(401, "INVALID_PAIRING_CODE", "Pairing code is invalid or expired");
    sendJson(response, 201, { client: result.client, token: result.token });
    return true;
  }

  if (pathname === "/api/research/capture/clients") {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    sendJson(response, 200, { clients: research.listCaptureClients() });
    return true;
  }

  const captureClientMatch = pathname.match(CAPTURE_CLIENT_PATH);
  if (captureClientMatch) {
    if (request.method !== "DELETE") {
      methodNotAllowed(response, ["DELETE"]);
      return true;
    }
    if (!research.revokeCaptureClient(decodeURIComponent(captureClientMatch[1]))) {
      throw new ApiError(404, "CAPTURE_CLIENT_NOT_FOUND", "Capture client was not found");
    }
    sendEmpty(response, 204);
    return true;
  }

  if (pathname === "/api/research/captures/browser/previews") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    const client = researchCaptures.authenticate(request);
    if (!client) throw new ApiError(401, "CAPTURE_AUTH_REQUIRED", "A paired browser extension is required");
    const body = await readJson(request, 256 * 1024, "Capture metadata is too large");
    try {
      sendJson(response, 201, { preview: researchCaptures.createPreview(client, body) });
    } catch (error) {
      throw new ApiError(400, "INVALID_CAPTURE", error instanceof Error ? error.message : "Capture metadata is invalid");
    }
    return true;
  }

  const captureBatchMatch = pathname.match(CAPTURE_PREVIEW_BATCH_PATH);
  if (captureBatchMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    const client = researchCaptures.authenticate(request);
    if (!client) throw new ApiError(401, "CAPTURE_AUTH_REQUIRED", "A paired browser extension is required");
    const body = await readJson(request, 5 * 1024 * 1024, "Capture batch is too large");
    assertPlainObject(body, ApiError);
    assertAllowedKeys(body, new Set(["batchIndex", "messages"]), ApiError);
    try {
      const batch = researchCaptures.appendBatch(
        client,
        decodeURIComponent(captureBatchMatch[1]),
        body.batchIndex,
        body.messages,
      );
      if (!batch) throw new ApiError(404, "CAPTURE_PREVIEW_NOT_FOUND", "Capture preview expired or was not found");
      sendJson(response, 201, { batch });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "INVALID_CAPTURE_BATCH", error instanceof Error ? error.message : "Capture batch is invalid");
    }
    return true;
  }

  const captureFinalizeMatch = pathname.match(CAPTURE_PREVIEW_FINALIZE_PATH);
  if (captureFinalizeMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    const client = researchCaptures.authenticate(request);
    if (!client) throw new ApiError(401, "CAPTURE_AUTH_REQUIRED", "A paired browser extension is required");
    const body = await readJson(request, 256 * 1024, "Capture result is too large");
    try {
      const preview = researchCaptures.finalizePreview(client, decodeURIComponent(captureFinalizeMatch[1]), body);
      if (!preview) throw new ApiError(404, "CAPTURE_PREVIEW_NOT_FOUND", "Capture preview expired or was not found");
      sendJson(response, 200, { preview });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "INVALID_CAPTURE_RESULT", error instanceof Error ? error.message : "Capture result is invalid");
    }
    return true;
  }

  const captureConfirmMatch = pathname.match(CAPTURE_PREVIEW_CONFIRM_PATH);
  if (captureConfirmMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    const body = await readJson(request, 64 * 1024, "Capture confirmation is too large");
    assertPlainObject(body, ApiError);
    assertAllowedKeys(body, new Set(["topicId", "allowPartial", "conflictAction", "expectedRecordVersion"]), ApiError);
    const result = researchCaptures.confirmPreview(decodeURIComponent(captureConfirmMatch[1]), {
      topicId: nullableText(body.topicId, "topicId", ApiError, { maxLength: 100 }),
      allowPartial: body.allowPartial === true,
      conflictAction: body.conflictAction === "replace-current" ? "replace-current" : null,
      expectedRecordVersion: body.expectedRecordVersion === null || body.expectedRecordVersion === undefined
        ? null
        : positiveVersion(body.expectedRecordVersion, ApiError),
    });
    if (result.kind === "not_found") throw new ApiError(404, "CAPTURE_PREVIEW_NOT_FOUND", "Capture preview expired or was not found");
    if (result.kind === "partial_confirmation_required") throw new ApiError(409, "PARTIAL_CONFIRMATION_REQUIRED", "Partial capture must be explicitly accepted");
    if (result.kind === "conflict_confirmation_required") throw new ApiError(409, "CAPTURE_CONFLICT_CONFIRMATION_REQUIRED", "Conflicting content must be explicitly accepted");
    if (result.kind === "topic_not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
    if (result.kind === "conflict") throw new ApiError(409, "RESEARCH_RECORD_VERSION_CONFLICT", "Research record changed", { currentVersion: result.currentVersion });
    sendJson(response, result.kind === "created" ? 201 : 200, { result });
    return true;
  }

  const capturePreviewMatch = pathname.match(CAPTURE_PREVIEW_PATH);
  if (capturePreviewMatch) {
    const previewId = decodeURIComponent(capturePreviewMatch[1]);
    if (request.method === "GET") {
      const preview = researchCaptures.getPreview(previewId);
      if (!preview) throw new ApiError(404, "CAPTURE_PREVIEW_NOT_FOUND", "Capture preview expired or was not found");
      sendJson(response, 200, { preview });
      return true;
    }
    if (request.method === "DELETE") {
      const client = researchCaptures.authenticate(request);
      if (!client) throw new ApiError(401, "CAPTURE_AUTH_REQUIRED", "A paired browser extension is required");
      if (!researchCaptures.cancelPreview(client, previewId)) throw new ApiError(404, "CAPTURE_PREVIEW_NOT_FOUND", "Capture preview expired or was not found");
      sendEmpty(response, 204);
      return true;
    }
    methodNotAllowed(response, ["GET", "DELETE"]);
    return true;
  }

  if (pathname === "/api/research/imports/chatgpt/preview") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) {
      throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Preview upload does not accept query parameters");
    }
    const sourceFilename = String(request.headers["x-research-import-filename"] ?? "").trim();
    if (!sourceFilename || sourceFilename.length > 255 || sourceFilename.includes("/") || sourceFilename.includes("\\")) {
      throw new ApiError(400, "INVALID_IMPORT_FILENAME", "A safe import filename is required");
    }
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (!new Set(["application/zip", "application/json", "application/octet-stream"]).has(contentType)) {
      throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Import must be a ZIP or JSON file");
    }
    try {
      const preview = await researchImports.createPreview(request, sourceFilename);
      sendJson(response, 201, { preview });
    } catch (error) {
      throw new ApiError(400, "INVALID_CHATGPT_EXPORT", error instanceof Error ? error.message : "Import could not be parsed");
    }
    return true;
  }

  const previewConfirmMatch = pathname.match(IMPORT_PREVIEW_CONFIRM_PATH);
  if (previewConfirmMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) {
      throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Import confirmation does not accept query parameters");
    }
    const body = await readJson(request, 16 * 1024 * 1024, "Import selection cannot exceed 16 MiB");
    assertPlainObject(body, ApiError);
    assertAllowedKeys(body, new Set(["selections"]), ApiError);
    if (!Array.isArray(body.selections) || body.selections.length === 0 || body.selections.length > 100_000) {
      throw new ApiError(400, "INVALID_SELECTION", "Choose between 1 and 100000 conversations");
    }
    const selections = body.selections.map((selection) => {
      assertPlainObject(selection, ApiError);
      assertAllowedKeys(selection, new Set(["sourceKey", "topicId"]), ApiError);
      return {
        sourceKey: text(selection.sourceKey, "sourceKey", ApiError, { required: true, maxLength: 500 }),
        topicId: nullableText(selection.topicId, "topicId", ApiError, { maxLength: 100 }),
      };
    });
    const result = researchImports.confirmImport(decodeURIComponent(previewConfirmMatch[1]), selections);
    if (result.kind === "preview_not_found") {
      throw new ApiError(404, "IMPORT_PREVIEW_NOT_FOUND", "Import preview expired or was not found");
    }
    sendJson(response, 201, { session: result });
    return true;
  }

  const previewSelectionMatch = pathname.match(IMPORT_PREVIEW_SELECTION_PATH);
  if (previewSelectionMatch) {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    for (const key of url.searchParams.keys()) {
      if (key !== "search" || url.searchParams.getAll(key).length !== 1) {
        throw new ApiError(400, "INVALID_QUERY_PARAMETER", `Invalid selection query parameter: ${key}`);
      }
    }
    const search = String(url.searchParams.get("search") ?? "").trim();
    if (search.length > 500) throw new ApiError(400, "INVALID_QUERY_PARAMETER", "Search is too long");
    const sourceKeys = researchImports.listSelectablePreviewKeys(
      decodeURIComponent(previewSelectionMatch[1]),
      { search },
    );
    if (!sourceKeys) throw new ApiError(404, "IMPORT_PREVIEW_NOT_FOUND", "Import preview expired or was not found");
    sendJson(response, 200, { sourceKeys });
    return true;
  }

  const previewMatch = pathname.match(IMPORT_PREVIEW_PATH);
  if (previewMatch) {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    const allowed = new Set(["page", "pageSize", "search", "duplicates"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
        throw new ApiError(400, "INVALID_QUERY_PARAMETER", `Invalid preview query parameter: ${key}`);
      }
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 50);
    const search = String(url.searchParams.get("search") ?? "").trim();
    const duplicates = url.searchParams.get("duplicates") ?? "all";
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new ApiError(400, "INVALID_QUERY_PARAMETER", "page and pageSize are invalid");
    }
    if (!new Set(["all", "only", "exclude"]).has(duplicates) || search.length > 500) {
      throw new ApiError(400, "INVALID_QUERY_PARAMETER", "Preview filters are invalid");
    }
    const preview = researchImports.listPreview(decodeURIComponent(previewMatch[1]), { page, pageSize, search, duplicates });
    if (!preview) throw new ApiError(404, "IMPORT_PREVIEW_NOT_FOUND", "Import preview expired or was not found");
    sendJson(response, 200, { preview });
    return true;
  }

  if (pathname === "/api/research/imports/sessions") {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) {
      throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Import sessions do not accept query parameters");
    }
    sendJson(response, 200, { sessions: research.listImportSessions() });
    return true;
  }

  const undoMatch = pathname.match(IMPORT_SESSION_UNDO_PATH);
  if (undoMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) {
      throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Import undo does not accept query parameters");
    }
    const version = parseVersionOnly(await readJson(request), ApiError);
    const result = research.undoImportSession(decodeURIComponent(undoMatch[1]), version);
    if (result.kind === "not_found") throw new ApiError(404, "IMPORT_SESSION_NOT_FOUND", "Import session not found");
    if (result.kind === "conflict") throw new ApiError(409, "IMPORT_SESSION_VERSION_CONFLICT", "Import session changed", { currentVersion: result.currentVersion });
    if (result.kind === "unsafe") throw new ApiError(409, "IMPORT_UNDO_UNSAFE", "Imported records changed or became linked to tasks", { recordId: result.recordId });
    sendJson(response, 200, { result });
    return true;
  }

  if (pathname === "/api/research/records/unclassified") {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Unclassified records do not accept query parameters");
    sendJson(response, 200, { records: research.listUnclassifiedResearchRecords() });
    return true;
  }

  if (pathname === "/api/research/inbox/summary") {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Inbox summary does not accept query parameters");
    sendJson(response, 200, research.getResearchInboxSummary());
    return true;
  }

  if (pathname === "/api/research/inbox") {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    const allowed = new Set(["page", "pageSize", "provider", "dateFrom", "dateTo"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
        throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", `Inbox does not accept query parameter: ${key}`);
      }
    }
    const provider = url.searchParams.get("provider");
    if (provider && !isResearchRecordProvider(provider)) {
      throw new ApiError(400, "INVALID_QUERY_PARAMETER", "provider is not supported");
    }
    const page = positiveQueryInteger(url.searchParams.get("page"), "page", ApiError, { defaultValue: 1, maximum: 1_000_000 });
    const pageSize = positiveQueryInteger(url.searchParams.get("pageSize"), "pageSize", ApiError, { defaultValue: 50, maximum: 100 });
    const dateFrom = queryDate(url.searchParams.get("dateFrom"), "dateFrom", ApiError);
    const dateTo = queryDate(url.searchParams.get("dateTo"), "dateTo", ApiError, { endOfDay: true });
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new ApiError(400, "INVALID_QUERY_PARAMETER", "dateFrom must not be after dateTo");
    }
    sendJson(response, 200, research.listResearchInbox({ page, pageSize, provider: provider || null, dateFrom, dateTo }));
    return true;
  }

  if (pathname === "/api/research/inbox/create-topic-and-assign") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Create topic and assign does not accept query parameters");
    const body = await readJson(request);
    assertPlainObject(body, ApiError);
    assertAllowedKeys(body, new Set(["recordIds", "topic"]), ApiError);
    if (!Array.isArray(body.recordIds) || body.recordIds.length === 0 || body.recordIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new ApiError(400, "INVALID_FIELD", "recordIds must be a non-empty string array");
    }
    const result = research.createTopicAndAssignResearchRecords(body.recordIds, parseCreate(body.topic, ApiError));
    if (result.kind === "records_not_in_inbox") {
      throw new ApiError(409, "RESEARCH_RECORDS_NOT_IN_INBOX", "One or more records are no longer in the inbox", { recordIds: result.recordIds });
    }
    sendJson(response, 201, { topic: result.topic, updated: result.updated });
    return true;
  }

  if (pathname === "/api/research/records/assign-topic") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Topic assignment does not accept query parameters");
    const body = await readJson(request);
    assertPlainObject(body, ApiError);
    assertAllowedKeys(body, new Set(["recordIds", "topicId"]), ApiError);
    if (!Array.isArray(body.recordIds) || body.recordIds.length === 0 || body.recordIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new ApiError(400, "INVALID_FIELD", "recordIds must be a non-empty string array");
    }
    const result = research.assignResearchRecords(body.recordIds, text(body.topicId, "topicId", ApiError, { required: true, maxLength: 100 }));
    if (result.kind === "topic_not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
    if (result.kind === "records_not_in_inbox") {
      throw new ApiError(409, "RESEARCH_RECORDS_NOT_IN_INBOX", "One or more records are no longer in the inbox", { recordIds: result.recordIds });
    }
    sendJson(response, 200, { updated: result.updated });
    return true;
  }

  const recordSummaryAiDraftMatch = pathname.match(RESEARCH_RECORD_SUMMARY_AI_DRAFT_PATH);
  if (recordSummaryAiDraftMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Summary AI draft does not accept query parameters");
    const recordId = decodeURIComponent(recordSummaryAiDraftMatch[1]);
    const result = await researchSummaryAiDrafts.generate(
      recordId,
      parseResearchSummaryAiDraft(await readJson(request), ApiError),
    );
    if (result.kind === "record_not_found") throw new ApiError(404, "RESEARCH_RECORD_NOT_FOUND", "Research record not found");
    if (result.kind === "source_version_invalid") throw new ApiError(400, "SOURCE_CONTENT_VERSION_INVALID", "The content version does not belong to this research record");
    if (result.kind === "summary_conflict") throw new ApiError(409, "RESEARCH_SUMMARY_VERSION_CONFLICT", "Research summary changed elsewhere", { currentVersion: result.currentVersion });
    if (result.kind === "source_unavailable") throw new ApiError(409, "RESEARCH_SUMMARY_SOURCE_UNAVAILABLE", "The source content version is unavailable");
    if (result.kind === "source_too_long") throw new ApiError(413, "RESEARCH_AI_SOURCE_TOO_LONG", "The source content is too long for a complete AI draft");
    if (result.kind === "not_configured") throw new ApiError(503, "RESEARCH_AI_NOT_CONFIGURED", "Research AI is not configured");
    if (result.kind === "timeout") throw new ApiError(504, "RESEARCH_AI_TIMEOUT", "Research AI request timed out");
    if (result.kind === "provider_error" || result.kind === "invalid_output") throw new ApiError(502, "RESEARCH_AI_DRAFT_FAILED", "Research AI could not produce a valid draft");
    sendJson(response, 200, {
      candidate: result.candidate,
      sourceContentVersionId: result.sourceContentVersionId,
      summaryVersion: result.summaryVersion,
      sourceTextComplete: result.sourceTextComplete,
    });
    return true;
  }

  const recordSummaryMatch = pathname.match(RESEARCH_RECORD_SUMMARY_PATH);
  if (recordSummaryMatch) {
    const recordId = decodeURIComponent(recordSummaryMatch[1]);
    if (request.method === "GET") {
      for (const key of url.searchParams.keys()) {
        if (key !== "contentVersionId" || url.searchParams.getAll(key).length !== 1) {
          throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Record summary only accepts one contentVersionId parameter");
        }
      }
      const sourceContentVersionId = text(
        url.searchParams.get("contentVersionId"),
        "contentVersionId",
        ApiError,
        { required: true, maxLength: 1_000 },
      );
      const result = research.getResearchRecordSummary(recordId, sourceContentVersionId);
      if (result.kind === "record_not_found") throw new ApiError(404, "RESEARCH_RECORD_NOT_FOUND", "Research record not found");
      if (result.kind === "source_version_invalid") throw new ApiError(400, "SOURCE_CONTENT_VERSION_INVALID", "The content version does not belong to this research record");
      sendJson(response, 200, { summary: result.summary });
      return true;
    }
    if (request.method === "POST") {
      if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Record summary creation does not accept query parameters");
      const result = research.createResearchRecordSummary(
        recordId,
        parseResearchSummaryFields(await readJson(request), ApiError, { creating: true }),
      );
      if (result.kind === "record_not_found") throw new ApiError(404, "RESEARCH_RECORD_NOT_FOUND", "Research record not found");
      if (result.kind === "source_version_invalid") throw new ApiError(400, "SOURCE_CONTENT_VERSION_INVALID", "The content version does not belong to this research record");
      if (result.kind === "already_exists") throw new ApiError(409, "RESEARCH_SUMMARY_ALREADY_EXISTS", "This content version already has a summary", { summary: result.summary });
      sendJson(response, 201, { summary: result.summary });
      return true;
    }
    methodNotAllowed(response, ["GET", "POST"]);
    return true;
  }

  const summaryMatch = pathname.match(RESEARCH_SUMMARY_PATH);
  if (summaryMatch) {
    if (request.method !== "PATCH") {
      methodNotAllowed(response, ["PATCH"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Summary update does not accept query parameters");
    const result = research.updateResearchRecordSummary(
      decodeURIComponent(summaryMatch[1]),
      parseResearchSummaryFields(await readJson(request), ApiError),
    );
    if (result.kind === "not_found") throw new ApiError(404, "RESEARCH_SUMMARY_NOT_FOUND", "Research summary not found");
    if (result.kind === "conflict") throw new ApiError(409, "RESEARCH_SUMMARY_VERSION_CONFLICT", "Research summary changed elsewhere", { currentVersion: result.currentVersion });
    sendJson(response, 200, { summary: result.summary });
    return true;
  }

  const contentMatch = pathname.match(RESEARCH_RECORD_CONTENT_PATH);
  if (contentMatch) {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    for (const key of url.searchParams.keys()) {
      if (key !== "version" || url.searchParams.getAll(key).length !== 1) {
        throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Record content only accepts one version parameter");
      }
    }
    const rawVersion = url.searchParams.get("version");
    const version = rawVersion === null ? null : Number(rawVersion);
    if (version !== null && (!Number.isInteger(version) || version < 1)) {
      throw new ApiError(400, "INVALID_QUERY_PARAMETER", "version must be a positive integer");
    }
    const content = research.getResearchRecordContent(decodeURIComponent(contentMatch[1]), version);
    if (!content) throw new ApiError(404, "RESEARCH_RECORD_CONTENT_NOT_FOUND", "Imported conversation content not found");
    sendJson(response, 200, { content });
    return true;
  }

  const contentVersionsMatch = pathname.match(RESEARCH_RECORD_CONTENT_VERSIONS_PATH);
  if (contentVersionsMatch) {
    if (request.method !== "GET") {
      methodNotAllowed(response, ["GET"]);
      return true;
    }
    const versions = research.listResearchRecordContentVersions(decodeURIComponent(contentVersionsMatch[1]));
    if (!versions) throw new ApiError(404, "RESEARCH_RECORD_NOT_FOUND", "Research record not found");
    sendJson(response, 200, { versions });
    return true;
  }

  const cognitionUpdatesMatch = pathname.match(TOPIC_COGNITION_UPDATES_PATH);
  if (cognitionUpdatesMatch) {
    const topicId = decodeURIComponent(cognitionUpdatesMatch[1]);
    if (request.method === "GET") {
      for (const key of url.searchParams.keys()) {
        if (key !== "recordId" || url.searchParams.getAll(key).length !== 1) {
          throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Cognition update list only accepts one recordId parameter");
        }
      }
      const updates = research.listCognitionUpdates(topicId, { recordId: url.searchParams.get("recordId") });
      if (!updates) throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      sendJson(response, 200, { updates });
      return true;
    }
    if (request.method === "POST") {
      if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Cognition update creation does not accept query parameters");
      const result = research.createCognitionUpdate(topicId, parseCognitionUpdateCreate(await readJson(request), ApiError));
      if (result.kind === "topic_not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      if (result.kind === "record_not_found") throw new ApiError(404, "RESEARCH_RECORD_NOT_FOUND", "Research record not found");
      if (result.kind === "record_unclassified") throw new ApiError(409, "RESEARCH_RECORD_UNCLASSIFIED", "Research record must be assigned to a topic first");
      if (result.kind === "record_topic_mismatch") throw new ApiError(409, "RESEARCH_RECORD_TOPIC_MISMATCH", "Research record belongs to another topic");
      if (result.kind === "source_version_required") throw new ApiError(400, "SOURCE_CONTENT_VERSION_REQUIRED", "The content version being read is required");
      if (result.kind === "source_version_invalid") throw new ApiError(400, "SOURCE_CONTENT_VERSION_INVALID", "The content version does not belong to this research record");
      sendJson(response, result.kind === "created" ? 201 : 200, { update: result.update, existing: result.kind === "existing_draft" });
      return true;
    }
    methodNotAllowed(response, ["GET", "POST"]);
    return true;
  }

  const cognitionReloadMatch = pathname.match(/^\/api\/research\/cognition-updates\/([^/]+)\/reload$/);
  if (cognitionReloadMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Reload does not accept query parameters");
    const result = research.reloadCognitionUpdate(decodeURIComponent(cognitionReloadMatch[1]), parseVersionOnly(await readJson(request), ApiError));
    if (result.kind === "topic_not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
    const update = cognitionUpdateResult(result, ApiError);
    sendJson(response, 200, { update });
    return true;
  }

  const cognitionAiDraftMatch = pathname.match(COGNITION_UPDATE_AI_DRAFT_PATH);
  if (cognitionAiDraftMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "AI draft does not accept query parameters");
    const version = parseVersionOnly(await readJson(request), ApiError);
    const result = await researchAiDrafts.generate(decodeURIComponent(cognitionAiDraftMatch[1]), version);
    if (result.kind === "not_found") throw new ApiError(404, "COGNITION_UPDATE_NOT_FOUND", "Cognition update not found");
    if (result.kind === "conflict") throw new ApiError(409, "COGNITION_UPDATE_VERSION_CONFLICT", "Cognition update was changed by another request", { currentVersion: result.currentVersion });
    if (result.kind === "not_draft") throw new ApiError(409, "COGNITION_UPDATE_NOT_DRAFT", "Only draft cognition updates can use AI drafting", { status: result.status });
    if (result.kind === "topic_not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
    if (result.kind === "topic_conflict") throw new ApiError(409, "COGNITION_TOPIC_VERSION_CONFLICT", "Current view changed while this update was being edited", { currentVersion: result.currentVersion });
    if (result.kind === "source_unavailable") throw new ApiError(409, "COGNITION_SOURCE_UNAVAILABLE", "The source research record is no longer available");
    if (result.kind === "record_topic_mismatch") throw new ApiError(409, "RESEARCH_RECORD_TOPIC_MISMATCH", "Research record no longer belongs to this topic");
    if (result.kind === "source_version_invalid") throw new ApiError(409, "SOURCE_CONTENT_VERSION_INVALID", "The locked source content version is unavailable");
    if (result.kind === "source_too_long") throw new ApiError(413, "RESEARCH_AI_SOURCE_TOO_LONG", "The source content is too long for a complete AI draft");
    if (result.kind === "not_configured") throw new ApiError(503, "RESEARCH_AI_NOT_CONFIGURED", "Research AI is not configured");
    if (result.kind === "timeout") throw new ApiError(504, "RESEARCH_AI_TIMEOUT", "Research AI request timed out");
    if (result.kind === "provider_error" || result.kind === "invalid_output") throw new ApiError(502, "RESEARCH_AI_DRAFT_FAILED", "Research AI could not produce a valid draft");
    sendJson(response, 200, { candidate: result.candidate, sourceTextComplete: result.sourceTextComplete });
    return true;
  }

  const cognitionApplyMatch = pathname.match(COGNITION_UPDATE_APPLY_PATH);
  if (cognitionApplyMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Apply does not accept query parameters");
    const result = research.applyCognitionUpdate(decodeURIComponent(cognitionApplyMatch[1]), parseVersionOnly(await readJson(request), ApiError));
    if (result.kind === "not_found") throw new ApiError(404, "COGNITION_UPDATE_NOT_FOUND", "Cognition update not found");
    if (result.kind === "conflict") throw new ApiError(409, "COGNITION_UPDATE_VERSION_CONFLICT", "Cognition update was changed by another request", { currentVersion: result.currentVersion });
    if (result.kind === "not_draft") throw new ApiError(409, "COGNITION_UPDATE_NOT_DRAFT", "Only draft cognition updates can be applied", { status: result.status });
    if (result.kind === "topic_not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
    if (result.kind === "topic_conflict") throw new ApiError(409, "COGNITION_TOPIC_VERSION_CONFLICT", "Current view changed while this update was being edited", { currentVersion: result.currentVersion });
    if (result.kind === "source_unavailable") throw new ApiError(409, "COGNITION_SOURCE_UNAVAILABLE", "The source research record is no longer available");
    if (result.kind === "record_topic_mismatch") throw new ApiError(409, "RESEARCH_RECORD_TOPIC_MISMATCH", "Research record no longer belongs to this topic");
    if (result.kind === "source_version_invalid") throw new ApiError(409, "SOURCE_CONTENT_VERSION_INVALID", "The source content version is no longer available");
    if (result.kind === "incomplete") throw new ApiError(400, "COGNITION_UPDATE_INCOMPLETE", "New information and impact are required");
    if (result.kind === "uncertain_changes_view") throw new ApiError(400, "UNCERTAIN_CANNOT_CHANGE_VIEW", "An uncertain update must keep the current view unchanged");
    sendJson(response, 200, { update: result.update, topic: result.topic, alreadyApplied: result.kind === "already_applied" });
    return true;
  }

  const cognitionRejectMatch = pathname.match(COGNITION_UPDATE_REJECT_PATH);
  if (cognitionRejectMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return true;
    }
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Reject does not accept query parameters");
    const update = cognitionUpdateResult(
      research.rejectCognitionUpdate(decodeURIComponent(cognitionRejectMatch[1]), parseVersionOnly(await readJson(request), ApiError)),
      ApiError,
    );
    sendJson(response, 200, { update });
    return true;
  }

  const cognitionUpdateMatch = pathname.match(COGNITION_UPDATE_PATH);
  if (cognitionUpdateMatch) {
    const updateId = decodeURIComponent(cognitionUpdateMatch[1]);
    if ([...url.searchParams.keys()].length > 0) throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Cognition update does not accept query parameters");
    if (request.method === "GET") {
      const update = research.getCognitionUpdate(updateId);
      if (!update) throw new ApiError(404, "COGNITION_UPDATE_NOT_FOUND", "Cognition update not found");
      sendJson(response, 200, { update });
      return true;
    }
    if (request.method === "PATCH") {
      const update = cognitionUpdateResult(
        research.updateCognitionUpdate(updateId, parseCognitionUpdatePatch(await readJson(request), ApiError)),
        ApiError,
      );
      sendJson(response, 200, { update });
      return true;
    }
    methodNotAllowed(response, ["GET", "PATCH"]);
    return true;
  }

  if ([...url.searchParams.keys()].length > 0) {
    throw new ApiError(400, "UNKNOWN_QUERY_PARAMETER", "Research endpoints do not accept query parameters");
  }

  if (pathname === "/api/research/topics") {
    if (request.method === "GET") {
      sendJson(response, 200, { topics: research.listTopics() });
      return true;
    }
    if (request.method === "POST") {
      const topic = research.createTopic(parseCreate(await readJson(request), ApiError));
      sendJson(response, 201, { topic });
      return true;
    }
    methodNotAllowed(response, ["GET", "POST"]);
    return true;
  }

  const recordsMatch = pathname.match(TOPIC_RECORDS_PATH);
  if (recordsMatch) {
    const topicId = decodeURIComponent(recordsMatch[1]);
    if (request.method === "GET") {
      const result = research.listResearchRecords(topicId);
      if (result.kind === "topic_not_found") {
        throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      }
      sendJson(response, 200, { records: result.records });
      return true;
    }
    if (request.method === "POST") {
      const result = research.createResearchRecord(
        topicId,
        parseResearchRecordCreate(await readJson(request), ApiError),
      );
      if (result.kind === "topic_not_found") {
        throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      }
      sendJson(response, 201, { record: result.record });
      return true;
    }
    methodNotAllowed(response, ["GET", "POST"]);
    return true;
  }

  const researchRecordMatch = pathname.match(RESEARCH_RECORD_PATH);
  if (researchRecordMatch) {
    const recordId = decodeURIComponent(researchRecordMatch[1]);
    if (request.method === "GET") {
      const record = research.getResearchRecord(recordId);
      if (!record) {
        throw new ApiError(404, "RESEARCH_RECORD_NOT_FOUND", "Research record not found");
      }
      sendJson(response, 200, { record });
      return true;
    }
    if (request.method === "PATCH") {
      const record = researchRecordResult(
        research.updateResearchRecord(
          recordId,
          parseResearchRecordUpdate(await readJson(request), ApiError),
        ),
        ApiError,
      );
      sendJson(response, 200, { record });
      return true;
    }
    if (request.method === "DELETE") {
      researchRecordResult(
        research.deleteResearchRecord(
          recordId,
          parseVersionOnly(await readJson(request), ApiError),
        ),
        ApiError,
      );
      sendEmpty(response, 204);
      return true;
    }
    methodNotAllowed(response, ["GET", "PATCH", "DELETE"]);
    return true;
  }

  const moveMatch = pathname.match(TOPIC_QUESTION_MOVE_PATH);
  if (moveMatch) {
    const topicId = decodeURIComponent(moveMatch[1]);
    const questionId = decodeURIComponent(moveMatch[2]);
    if (request.method === "POST") {
      const topic = questionResult(
        research.moveQuestion(topicId, questionId, parseQuestionMove(await readJson(request), ApiError)),
        ApiError,
      );
      sendJson(response, 200, { topic });
      return true;
    }
    methodNotAllowed(response, ["POST"]);
    return true;
  }

  const questionMatch = pathname.match(TOPIC_QUESTION_PATH);
  if (questionMatch) {
    const topicId = decodeURIComponent(questionMatch[1]);
    const questionId = decodeURIComponent(questionMatch[2]);
    if (request.method === "PATCH") {
      const topic = questionResult(
        research.updateQuestion(topicId, questionId, parseQuestionUpdate(await readJson(request), ApiError)),
        ApiError,
      );
      sendJson(response, 200, { topic });
      return true;
    }
    methodNotAllowed(response, ["PATCH"]);
    return true;
  }

  const questionsMatch = pathname.match(TOPIC_QUESTIONS_PATH);
  if (questionsMatch) {
    const topicId = decodeURIComponent(questionsMatch[1]);
    if (request.method === "POST") {
      const topic = questionResult(
        research.createQuestion(topicId, parseQuestionCreate(await readJson(request), ApiError)),
        ApiError,
      );
      sendJson(response, 201, { topic });
      return true;
    }
    methodNotAllowed(response, ["POST"]);
    return true;
  }

  const markMatch = pathname.match(TOPIC_MARK_RESEARCHED_PATH);
  if (markMatch) {
    const topicId = decodeURIComponent(markMatch[1]);
    if (request.method === "POST") {
      const topic = topicResult(
        research.markTopicResearched(topicId, parseVersionOnly(await readJson(request), ApiError)),
        ApiError,
      );
      sendJson(response, 200, { topic });
      return true;
    }
    methodNotAllowed(response, ["POST"]);
    return true;
  }

  const taskMatch = pathname.match(TOPIC_TASK_PATH);
  if (taskMatch) {
    const [, topicId, taskId] = taskMatch.map((value) => decodeURIComponent(value));
    if (request.method === "POST") {
      const result = research.linkTask(topicId, taskId);
      if (result.kind === "topic_not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      if (result.kind === "task_not_found") throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
      if (result.kind === "task_linked_elsewhere") {
        throw new ApiError(409, "TASK_ALREADY_LINKED", "Task is already linked to another topic", { topicId: result.topicId });
      }
      sendJson(response, result.kind === "linked" ? 201 : 200, {
        topic: result.kind === "linked" ? result.topic : research.getTopic(topicId),
      });
      return true;
    }
    if (request.method === "DELETE") {
      if (!research.getTopic(topicId)) throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      research.unlinkTask(topicId, taskId);
      sendEmpty(response, 204);
      return true;
    }
    methodNotAllowed(response, ["POST", "DELETE"]);
    return true;
  }

  const topicMatch = pathname.match(TOPIC_PATH);
  if (topicMatch) {
    const topicId = decodeURIComponent(topicMatch[1]);
    if (request.method === "GET") {
      const topic = research.getTopic(topicId);
      if (!topic) throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      sendJson(response, 200, { topic });
      return true;
    }
    if (request.method === "PATCH") {
      const topic = topicResult(
        research.updateTopic(topicId, parseUpdate(await readJson(request), ApiError)),
        ApiError,
      );
      sendJson(response, 200, { topic });
      return true;
    }
    methodNotAllowed(response, ["GET", "PATCH"]);
    return true;
  }

  throw new ApiError(404, "NOT_FOUND", "Research endpoint not found");
}
