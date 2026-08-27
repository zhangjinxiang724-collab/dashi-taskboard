import {
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
  readJson,
  sendJson,
  sendEmpty,
  methodNotAllowed,
  ApiError,
}) {
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/research/")) return false;
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
