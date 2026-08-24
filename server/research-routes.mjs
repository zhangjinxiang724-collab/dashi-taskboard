import { isResearchStatus } from "../shared/research-domain.mjs";

const TOPIC_PATH = /^\/api\/research\/topics\/([^/]+)$/;
const TOPIC_TASK_PATH = /^\/api\/research\/topics\/([^/]+)\/tasks\/([^/]+)$/;

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

function parseCreate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set([
    "title", "status", "coreQuestion", "currentView", "nextAction", "labels",
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
    nextAction: text(body.nextAction, "nextAction", ApiError),
    labels: labels(body.labels, ApiError),
  };
}

function parseUpdate(body, ApiError) {
  assertPlainObject(body, ApiError);
  assertAllowedKeys(body, new Set([
    "version", "title", "status", "coreQuestion", "currentView", "nextAction", "labels",
  ]), ApiError);
  if (!Number.isInteger(body.version) || body.version < 1) {
    throw new ApiError(400, "INVALID_FIELD", "version must be a positive integer");
  }
  const changes = {};
  if (body.title !== undefined) changes.title = text(body.title, "title", ApiError, { required: true, maxLength: 300 });
  if (body.status !== undefined) {
    if (!isResearchStatus(body.status)) {
      throw new ApiError(400, "INVALID_FIELD", "status is not a valid research status");
    }
    changes.status = body.status;
  }
  for (const key of ["coreQuestion", "currentView", "nextAction"]) {
    if (body[key] !== undefined) changes[key] = text(body[key], key, ApiError);
  }
  if (body.labels !== undefined) changes.labels = labels(body.labels, ApiError);
  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "INVALID_BODY", "At least one topic field must be changed");
  }
  return { version: body.version, changes };
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
      const result = research.updateTopic(topicId, parseUpdate(await readJson(request), ApiError));
      if (result.kind === "not_found") throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
      if (result.kind === "conflict") {
        throw new ApiError(409, "TOPIC_VERSION_CONFLICT", "Topic was changed by another request", { currentVersion: result.currentVersion });
      }
      sendJson(response, 200, { topic: result.topic });
      return true;
    }
    methodNotAllowed(response, ["GET", "PATCH"]);
    return true;
  }

  throw new ApiError(404, "NOT_FOUND", "Research endpoint not found");
}
