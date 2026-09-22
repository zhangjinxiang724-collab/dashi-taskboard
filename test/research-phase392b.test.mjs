import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";
import { createResearchAiProvider } from "../server/research-ai-draft-service.mjs";
import {
  ResearchSummaryAiDraftService,
  SUMMARY_OUTPUT_SCHEMA,
  hasNewNumericFact,
  hasUnknownToFactViolation,
  validateSummaryCandidate,
} from "../server/research-summary-ai-draft-service.mjs";

const fixtures = [];
const VALID_OUTPUT = {
  one_line_summary: "资料记录了脱敏项目的阶段性结果。",
  core_content: "项目已经完成第一阶段。\n后续安排仍未确定。",
  key_evidence: "第一阶段已经完成",
  unresolved: "后续安排仍未确定。",
};

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    await fixture.app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body === undefined ? options.headers : { "content-type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const responseText = await response.text();
  return { response, body: responseText ? JSON.parse(responseText) : undefined };
}

function insertContentVersion(database, recordId, versionNumber, sourceText, { current = true, textComplete = true } = {}) {
  const id = randomUUID();
  const content = Buffer.from(JSON.stringify({
    version: "research-record-content-v1",
    title: "脱敏资料",
    messages: [{ id: `message-${versionNumber}`, role: "user", text: sourceText }],
  }), "utf8");
  const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (current) database.prepare("UPDATE research_record_content_versions SET is_current = 0 WHERE record_id = ?").run(recordId);
  database.prepare(`
    INSERT INTO research_record_content_versions (
      id, record_id, version_number, capture_adapter, completeness, completeness_details,
      relation_to_previous, content_encoding, content_blob, content_hash, source_fingerprint,
      message_count, omitted_message_count, source_created_at, source_updated_at,
      captured_at, is_current, created_at
    ) VALUES (?, ?, ?, 'chatgpt-browser-v1', ?, ?, ?, 'gzip-json-v1', ?, ?, ?, 1, 0,
      NULL, NULL, '2026-09-22T01:00:00.000Z', ?, '2026-09-22T01:00:00.000Z')
  `).run(
    id,
    recordId,
    versionNumber,
    textComplete ? "complete" : "partial",
    JSON.stringify({ textTranscriptComplete: textComplete, richContentComplete: textComplete }),
    versionNumber === 1 ? "initial" : "append",
    gzipSync(content),
    hash,
    `fixture-${recordId}-${versionNumber}`,
    current ? 1 : 0,
  );
  database.prepare("UPDATE research_records SET capture_adapter = 'chatgpt-browser-v1', capture_completeness = ? WHERE id = ?")
    .run(textComplete ? "complete" : "partial", recordId);
  return id;
}

async function setup({ outputs = [VALID_OUTPUT], providerError = null, configured = true, maxSourceChars = "120000", sourceText = "脱敏项目已经完成第一阶段，但后续安排仍未确定。", textComplete = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase392b-test-"));
  let calls = 0;
  const inputs = [];
  const providerOptions = [];
  const provider = {
    name: "mock",
    model: "mock-summary",
    async generate(input, options) {
      inputs.push(input);
      providerOptions.push(options);
      calls += 1;
      if (providerError) throw providerError;
      const output = outputs[Math.min(calls - 1, outputs.length - 1)];
      return { text: typeof output === "string" ? output : JSON.stringify(output) };
    },
  };
  const app = createTaskboardServer({
    dataDirectory: directory,
    ...(configured ? { researchAiProvider: provider } : {}),
    processEnv: { RESEARCH_AI_MAX_SOURCE_CHARS: maxSourceChars },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  fixtures.push({ app, directory });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const topic = (await request(baseUrl, "/api/research/topics", {
    method: "POST",
    body: { title: "脱敏主题", status: "active", currentView: "不会被 AI Summary 修改的观点。" },
  })).body.topic;
  const record = (await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: {
      title: "脱敏资料", provider: "chatgpt", kind: "chat", url: null, externalId: null,
      summary: "", note: "", occurredAt: "2026-09-22T01:00:00.000Z",
    },
  })).body.record;
  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  const versionId = insertContentVersion(database, record.id, 1, sourceText, { textComplete });
  return { baseUrl, database, topic, record, versionId, calls: () => calls, inputs, providerOptions };
}

function generate(baseUrl, recordId, sourceContentVersionId, summaryVersion = null) {
  return request(baseUrl, `/api/research/records/${recordId}/summary/ai-draft`, {
    method: "POST",
    body: { sourceContentVersionId, summaryVersion },
  });
}

test("AI Summary Draft returns four editable fields with the Summary schema", async () => {
  const context = await setup();
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.sourceContentVersionId, context.versionId);
  assert.equal(result.body.candidate.oneLineSummary, VALID_OUTPUT.one_line_summary);
  assert.deepEqual(context.providerOptions[0].outputSchema, SUMMARY_OUTPUT_SCHEMA);
  assert.equal(context.providerOptions[0].schemaName, "research_summary_draft");
  context.database.close();
});

test("the existing Ollama provider accepts the Summary schema without a second client", async () => {
  let requestBody;
  const provider = createResearchAiProvider({
    environment: {
      RESEARCH_AI_PROVIDER: "ollama",
      RESEARCH_AI_MODEL: "qwen3.5:4b",
      RESEARCH_AI_BASE_URL: "http://127.0.0.1:11434",
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ message: { content: JSON.stringify(VALID_OUTPUT) } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await provider.generate("脱敏资料", {
    outputSchema: SUMMARY_OUTPUT_SCHEMA,
    systemInstructions: "Summary instructions",
    schemaName: "research_summary_draft",
  });
  assert.deepEqual(requestBody.format.required, SUMMARY_OUTPUT_SCHEMA.required);
  assert.equal(requestBody.messages[0].content, "Summary instructions");
  assert.equal(requestBody.model, "qwen3.5:4b");
});

test("AI generation performs zero business database writes", async () => {
  const context = await setup();
  const before = {
    summaries: context.database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries").get().count,
    record: context.database.prepare("SELECT * FROM research_records WHERE id = ?").get(context.record.id),
    topic: context.database.prepare("SELECT * FROM topics WHERE id = ?").get(context.topic.id),
    cognition: context.database.prepare("SELECT COUNT(*) AS count FROM cognition_updates").get().count,
    imports: context.database.prepare("SELECT COUNT(*) AS count FROM research_import_sessions").get().count,
  };
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId)).response.status, 200);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries").get().count, before.summaries);
  assert.deepEqual(context.database.prepare("SELECT * FROM research_records WHERE id = ?").get(context.record.id), before.record);
  assert.deepEqual(context.database.prepare("SELECT * FROM topics WHERE id = ?").get(context.topic.id), before.topic);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM cognition_updates").get().count, before.cognition);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM research_import_sessions").get().count, before.imports);
  context.database.close();
});

test("V1 generation reads V1 even when V2 is current", async () => {
  const context = await setup({ sourceText: "这是只属于 V1 的脱敏正文，后续仍未确定。" });
  insertContentVersion(context.database, context.record.id, 2, "这是只属于 V2 的另一份正文。", { current: true });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 200);
  assert.match(context.inputs[0], /只属于 V1/);
  assert.doesNotMatch(context.inputs[0], /只属于 V2/);
  context.database.close();
});

test("rejects a made-up content version before calling the provider", async () => {
  const context = await setup();
  const result = await generate(context.baseUrl, context.record.id, randomUUID());
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "SOURCE_CONTENT_VERSION_INVALID");
  assert.equal(context.calls(), 0);
  context.database.close();
});

test("rejects another record's content version", async () => {
  const context = await setup();
  const other = (await request(context.baseUrl, `/api/research/topics/${context.topic.id}/records`, {
    method: "POST",
    body: { title: "另一资料", provider: "chatgpt", kind: "chat", url: null, externalId: null, summary: "", note: "", occurredAt: "2026-09-22T02:00:00.000Z" },
  })).body.record;
  const otherVersion = insertContentVersion(context.database, other.id, 1, "另一条正文。", { current: true });
  const result = await generate(context.baseUrl, context.record.id, otherVersion);
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "SOURCE_CONTENT_VERSION_INVALID");
  assert.equal(context.calls(), 0);
  context.database.close();
});

test("invalid structured output gets exactly one repair", async () => {
  const context = await setup({ outputs: ["not-json", VALID_OUTPUT] });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 200);
  assert.equal(context.calls(), 2);
  assert.equal(context.providerOptions[1].repair, true);
  context.database.close();
});

test("a second invalid output fails safely without writing a Summary", async () => {
  const context = await setup({ outputs: ["not-json", "still-not-json"] });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error.code, "RESEARCH_AI_DRAFT_FAILED");
  assert.equal(context.calls(), 2);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries").get().count, 0);
  context.database.close();
});

test("Unknown to Fact is rejected and may recover once", async () => {
  const invalid = { ...VALID_OUTPUT, one_line_summary: "项目后续安排尚未发生。", unresolved: "" };
  const context = await setup({ outputs: [invalid, VALID_OUTPUT] });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 200);
  assert.equal(context.calls(), 2);
  assert.equal(hasUnknownToFactViolation("后续安排仍未确定。", "后续安排尚未发生。"), true);
  context.database.close();
});

test("a new numeric fact is rejected", async () => {
  const invalid = { ...VALID_OUTPUT, one_line_summary: "项目在 1957 年完成，并增长 37%。" };
  const context = await setup({ outputs: [invalid, VALID_OUTPUT] });
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId)).response.status, 200);
  assert.equal(context.calls(), 2);
  assert.equal(hasNewNumericFact("项目大约增长。", "项目增长 37%。"), true);
  context.database.close();
});

test("Chinese and Arabic representations of the same year do not trigger repair", async () => {
  const output = { ...VALID_OUTPUT, one_line_summary: "1956 年完成厂房扩建。", key_evidence: "1956 年" };
  const context = await setup({ sourceText: "一份一九五六年的档案记载了厂房扩建，后续产量未知。", outputs: [output] });
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId)).response.status, 200);
  assert.equal(context.calls(), 1);
  context.database.close();
});

test("list numbering and punctuation changes do not become numeric facts", async () => {
  const output = { ...VALID_OUTPUT, core_content: "1. 已完成准备。\n2. 已开始测试。\n3. 后续仍未确定。" };
  const context = await setup({ outputs: [output] });
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId)).response.status, 200);
  assert.equal(context.calls(), 1);
  assert.equal(hasNewNumericFact("比例是 3.8％。", "比例是 3.8%。"), false);
  context.database.close();
});

test("a user's guess cannot be upgraded into a fact", async () => {
  const invalid = {
    one_line_summary: "工厂已经停产，所以交货延迟。",
    core_content: "工厂已经停产。",
    key_evidence: "交货延迟",
    unresolved: "",
  };
  const repaired = {
    one_line_summary: "发生了交货延迟，但无法确认工厂是否停产。",
    core_content: "用户猜测工厂可能停产。现有资料只能确认交货延迟。",
    key_evidence: "交货延迟",
    unresolved: "工厂是否停产仍未确认。",
  };
  const context = await setup({
    sourceText: "用户猜测某工厂可能已经停产，所以交货延迟。目前只有交货延迟这一事实，证据不足以判断是否停产。",
    outputs: [invalid, repaired],
  });
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId)).response.status, 200);
  assert.equal(context.calls(), 2);
  context.database.close();
});

test("Cognition language is rejected from Summary output", async () => {
  const invalid = { ...VALID_OUTPUT, one_line_summary: "我现在认为以后应该更看好这个项目。" };
  const context = await setup({ outputs: [invalid, VALID_OUTPUT] });
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId)).response.status, 200);
  assert.equal(context.calls(), 2);
  context.database.close();
});

test("existing Summary remains unchanged after AI drafting", async () => {
  const context = await setup();
  const saved = (await request(context.baseUrl, `/api/research/records/${context.record.id}/summary`, {
    method: "POST",
    body: { sourceContentVersionId: context.versionId, oneLineSummary: "人工总结", coreContent: "人工内容", keyEvidence: "", unresolved: "" },
  })).body.summary;
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId, saved.version)).response.status, 200);
  assert.equal(context.database.prepare("SELECT one_line_summary FROM research_record_summaries WHERE id = ?").get(saved.id).one_line_summary, "人工总结");
  context.database.close();
});

test("stale Summary version stops generation before provider use", async () => {
  const context = await setup();
  const saved = (await request(context.baseUrl, `/api/research/records/${context.record.id}/summary`, {
    method: "POST",
    body: { sourceContentVersionId: context.versionId, oneLineSummary: "人工总结", coreContent: "", keyEvidence: "", unresolved: "" },
  })).body.summary;
  const result = await generate(context.baseUrl, context.record.id, context.versionId, saved.version + 1);
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "RESEARCH_SUMMARY_VERSION_CONFLICT");
  assert.equal(context.calls(), 0);
  context.database.close();
});

test("manual Save remains the only operation that inserts a Summary", async () => {
  const context = await setup();
  const generated = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries").get().count, 0);
  const saved = await request(context.baseUrl, `/api/research/records/${context.record.id}/summary`, {
    method: "POST",
    body: { sourceContentVersionId: context.versionId, ...generated.body.candidate },
  });
  assert.equal(saved.response.status, 201);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries").get().count, 1);
  context.database.close();
});

test("provider failure does not damage an existing manual Summary", async () => {
  const providerError = new Error("provider unavailable");
  providerError.code = "provider_error";
  const context = await setup({ providerError });
  await request(context.baseUrl, `/api/research/records/${context.record.id}/summary`, {
    method: "POST",
    body: { sourceContentVersionId: context.versionId, oneLineSummary: "人工总结", coreContent: "", keyEvidence: "", unresolved: "" },
  });
  assert.equal((await generate(context.baseUrl, context.record.id, context.versionId, 1)).response.status, 502);
  assert.equal(context.database.prepare("SELECT one_line_summary FROM research_record_summaries").get().one_line_summary, "人工总结");
  context.database.close();
});

test("unconfigured Ollama path returns a quiet service error", async () => {
  const context = await setup({ configured: false });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error.code, "RESEARCH_AI_NOT_CONFIGURED");
  context.database.close();
});

test("provider timeout is reported without a business write", async () => {
  const timeout = new Error("timeout");
  timeout.code = "timeout";
  const context = await setup({ providerError: timeout });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 504);
  assert.equal(context.database.prepare("SELECT COUNT(*) AS count FROM research_record_summaries").get().count, 0);
  context.database.close();
});

test("incomplete source remains explicitly marked in the response", async () => {
  const context = await setup({ textComplete: false });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.sourceTextComplete, false);
  context.database.close();
});

test("oversized source fails closed before provider use", async () => {
  const context = await setup({ maxSourceChars: "20" });
  const result = await generate(context.baseUrl, context.record.id, context.versionId);
  assert.equal(result.response.status, 413);
  assert.equal(context.calls(), 0);
  context.database.close();
});

test("safe engineering logs omit source, prompt and model response", async () => {
  const entries = [];
  const logger = {
    info(message, details) { entries.push({ message, details }); },
    warn(message, details) { entries.push({ message, details }); },
  };
  const source = "PRIVATE_SOURCE_TEXT_SHOULD_NOT_BE_LOGGED";
  const output = { ...VALID_OUTPUT, one_line_summary: "PRIVATE_MODEL_TEXT_SHOULD_NOT_BE_LOGGED" };
  const fakeResearch = {
    getResearchRecord: () => ({ id: "record-1", title: "脱敏标题", provider: "chatgpt", kind: "chat", occurredAt: "2026-09-22T01:00:00.000Z" }),
    listResearchRecordContentVersions: () => [{ id: "version-1", versionNumber: 1 }],
    getResearchRecordContent: () => ({ versionId: "version-1", versionNumber: 1, completeness: "complete", completenessDetails: { textTranscriptComplete: true }, content: { messages: [{ role: "user", text: source }] } }),
    getResearchRecordSummary: () => ({ kind: "found", summary: null }),
  };
  const service = new ResearchSummaryAiDraftService(fakeResearch, {
    logger,
    provider: { name: "mock", model: "mock", generate: async () => ({ text: JSON.stringify(output) }) },
  });
  assert.equal((await service.generate("record-1", { sourceContentVersionId: "version-1" })).kind, "generated");
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /PRIVATE_SOURCE_TEXT_SHOULD_NOT_BE_LOGGED/);
  assert.doesNotMatch(serialized, /PRIVATE_MODEL_TEXT_SHOULD_NOT_BE_LOGGED/);
});

test("validator keeps optional unresolved empty when the source has no uncertainty", () => {
  const value = { ...VALID_OUTPUT, unresolved: "", core_content: "搬迁完成。", one_line_summary: "办公室搬迁已经完成。" };
  assert.ok(validateSummaryCandidate(value, "团队已经完成办公室搬迁，钥匙已经交还物业。").candidate);
});
