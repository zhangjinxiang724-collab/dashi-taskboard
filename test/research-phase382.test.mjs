import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";
import { createResearchAiProvider, resolveResearchAiConfig } from "../server/research-ai-draft-service.mjs";
import { AI_DRAFT_FIXTURES } from "./fixtures/research-ai-draft-fixtures.mjs";

const fixtures = [];

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
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

async function setup({ outputs = [AI_DRAFT_FIXTURES.ADD], providerError = null, textComplete = true, maxSourceChars = "120000", configured = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-phase382-test-"));
  let calls = 0;
  const provider = {
    name: "mock",
    model: "mock-cognition",
    async generate() {
      calls += 1;
      if (providerError) throw providerError;
      return outputs[Math.min(calls - 1, outputs.length - 1)];
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
  const topic = (await request(baseUrl, "/api/research/topics", { method: "POST", body: { title: "虚构行业研究", status: "active", currentView: "原观点" } })).body.topic;
  const record = (await request(baseUrl, `/api/research/topics/${topic.id}/records`, {
    method: "POST",
    body: { title: "脱敏资料", provider: "chatgpt", kind: "chat", url: null, externalId: null, summary: "脱敏摘要", note: "", occurredAt: "2026-09-14T00:00:00.000Z" },
  })).body.record;
  const database = new DatabaseSync(path.join(directory, "taskboard.sqlite"));
  const versionId = randomUUID();
  const payload = Buffer.from(JSON.stringify({ messages: [{ role: "user", text: "虚构资料正文。" }, { role: "assistant", text: "只用于测试认知变化。" }] }), "utf8");
  const hash = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  database.prepare(`
    INSERT INTO research_record_content_versions (
      id, record_id, version_number, capture_adapter, completeness, completeness_details,
      relation_to_previous, content_encoding, content_blob, content_hash, source_fingerprint,
      message_count, omitted_message_count, source_created_at, source_updated_at,
      captured_at, is_current, created_at
    ) VALUES (?, ?, 1, 'chatgpt-browser-v1', ?, ?, 'initial', 'gzip-json-v1', ?, ?, ?, 2, 0, NULL, NULL, ?, 1, ?)
  `).run(versionId, record.id, textComplete ? "complete" : "partial", JSON.stringify({ textTranscriptComplete: textComplete }), gzipSync(payload), hash, `fixture-${record.id}`, new Date().toISOString(), new Date().toISOString());
  database.prepare("UPDATE research_records SET capture_adapter = 'chatgpt-browser-v1', capture_completeness = ? WHERE id = ?").run(textComplete ? "complete" : "partial", record.id);
  const draft = (await request(baseUrl, `/api/research/topics/${topic.id}/cognition-updates`, { method: "POST", body: { recordId: record.id, sourceContentVersionId: versionId } })).body.update;
  return { baseUrl, directory, database, topic, record, draft, versionId, calls: () => calls };
}

test("provider selection keeps OpenAI and adds local Ollama with a safe default model", async () => {
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "ollama" }).model, "qwen3.5:9b");
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "ollama", RESEARCH_AI_BASE_URL: "http://127.0.0.1:11434" }).baseUrl, "http://127.0.0.1:11434");
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "ollama" }).timeoutMs, 120_000);
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "ollama" }).temperature, 0);
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "ollama" }).maxOutputTokens, 320);
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "ollama" }).keepAlive, "5m");
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "ollama" }).think, false);
  assert.equal(resolveResearchAiConfig({ RESEARCH_AI_PROVIDER: "openai" }).timeoutMs, 30_000);
  assert.equal(createResearchAiProvider({ environment: { RESEARCH_AI_PROVIDER: "ollama", RESEARCH_AI_BASE_URL: "https://example.com" } }), null);

  let ollamaRequest;
  const ollama = createResearchAiProvider({
    environment: { RESEARCH_AI_PROVIDER: "ollama", RESEARCH_AI_MODEL: "qwen3.5:9b", RESEARCH_AI_BASE_URL: "http://127.0.0.1:11434" },
    fetchImpl: async (url, options) => {
      ollamaRequest = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        message: { role: "assistant", content: JSON.stringify(AI_DRAFT_FIXTURES.ADD) },
        prompt_eval_count: 120,
        eval_count: 40,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const ollamaResult = await ollama.generate("脱敏输入");
  assert.equal(ollama.name, "ollama");
  assert.equal(ollama.model, "qwen3.5:9b");
  assert.equal(ollamaRequest.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(ollamaRequest.body.stream, false);
  assert.equal(ollamaRequest.body.think, false);
  assert.equal(ollamaRequest.body.keep_alive, "5m");
  assert.equal(ollamaRequest.body.options.temperature, 0);
  assert.equal(ollamaRequest.body.options.num_predict, 320);
  assert.deepEqual(ollamaRequest.body.format.required, ["suggested_update_type", "new_information", "impact", "proposed_current_view"]);
  assert.deepEqual(ollamaResult.usage, { inputTokens: 120, outputTokens: 40, totalTokens: 160 });

  let openAiRequest;
  const openai = createResearchAiProvider({
    environment: { RESEARCH_AI_PROVIDER: "openai", RESEARCH_AI_MODEL: "gpt-test", OPENAI_API_KEY: "test-key" },
    fetchImpl: async (url, options) => {
      openAiRequest = { url, options };
      return new Response(JSON.stringify({ output_text: JSON.stringify(AI_DRAFT_FIXTURES.ADD) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await openai.generate("脱敏输入");
  assert.equal(openai.name, "openai");
  assert.equal(openAiRequest.url, "https://api.openai.com/v1/responses");
  assert.equal(openAiRequest.options.headers.authorization, "Bearer test-key");
});

test("ADD, REINFORCE, REVISE and UNCERTAIN fixtures produce editable candidates without database writes", async () => {
  for (const [name, output] of Object.entries(AI_DRAFT_FIXTURES)) {
    const context = await setup({ outputs: [output] });
    const before = context.database.prepare("SELECT * FROM cognition_updates WHERE id = ?").get(context.draft.id);
    const result = await request(context.baseUrl, `/api/research/cognition-updates/${context.draft.id}/ai-draft`, { method: "POST", body: { version: context.draft.version } });
    assert.equal(result.response.status, 200, name);
    assert.equal(result.body.candidate.updateType, name.toLowerCase());
    assert.deepEqual(context.database.prepare("SELECT * FROM cognition_updates WHERE id = ?").get(context.draft.id), before);
    context.database.close();
  }
});

test("AI candidate is only persisted by explicit PATCH and only applied by explicit apply", async () => {
  const context = await setup();
  const generated = (await request(context.baseUrl, `/api/research/cognition-updates/${context.draft.id}/ai-draft`, { method: "POST", body: { version: context.draft.version } })).body.candidate;
  assert.equal(context.database.prepare("SELECT new_information FROM cognition_updates WHERE id = ?").get(context.draft.id).new_information, "");
  const saved = (await request(context.baseUrl, `/api/research/cognition-updates/${context.draft.id}`, { method: "PATCH", body: { version: context.draft.version, ...generated } })).body.update;
  assert.equal(saved.status, "draft");
  assert.equal((await request(context.baseUrl, `/api/research/topics/${context.topic.id}`)).body.topic.currentView, "原观点");
  const applied = await request(context.baseUrl, `/api/research/cognition-updates/${saved.id}/apply`, { method: "POST", body: { version: saved.version } });
  assert.equal(applied.body.topic.currentView, generated.proposedCurrentView);
  context.database.close();
});

test("stale Topic and stale Draft are rejected before the provider is called", async () => {
  const staleDraft = await setup();
  const stale = await request(staleDraft.baseUrl, `/api/research/cognition-updates/${staleDraft.draft.id}/ai-draft`, { method: "POST", body: { version: staleDraft.draft.version + 1 } });
  assert.equal(stale.body.error.code, "COGNITION_UPDATE_VERSION_CONFLICT");
  assert.equal(staleDraft.calls(), 0);
  staleDraft.database.close();

  const staleTopic = await setup();
  await request(staleTopic.baseUrl, `/api/research/topics/${staleTopic.topic.id}`, { method: "PATCH", body: { version: staleTopic.topic.version, currentView: "别处的新观点" } });
  const conflict = await request(staleTopic.baseUrl, `/api/research/cognition-updates/${staleTopic.draft.id}/ai-draft`, { method: "POST", body: { version: staleTopic.draft.version } });
  assert.equal(conflict.body.error.code, "COGNITION_TOPIC_VERSION_CONFLICT");
  assert.equal(staleTopic.calls(), 0);
  staleTopic.database.close();
});

test("applied, rejected, deleted and mismatched sources cannot invoke AI", async () => {
  const appliedContext = await setup();
  const patch = await request(appliedContext.baseUrl, `/api/research/cognition-updates/${appliedContext.draft.id}`, { method: "PATCH", body: { version: appliedContext.draft.version, updateType: "add", newInformation: "信息", impact: "影响", proposedCurrentView: "新观点" } });
  const applied = await request(appliedContext.baseUrl, `/api/research/cognition-updates/${appliedContext.draft.id}/apply`, { method: "POST", body: { version: patch.body.update.version } });
  const afterApply = await request(appliedContext.baseUrl, `/api/research/cognition-updates/${appliedContext.draft.id}/ai-draft`, { method: "POST", body: { version: applied.body.update.version } });
  assert.equal(afterApply.body.error.code, "COGNITION_UPDATE_NOT_DRAFT");
  assert.equal(appliedContext.calls(), 0);
  appliedContext.database.close();

  const rejectedContext = await setup();
  const rejected = await request(rejectedContext.baseUrl, `/api/research/cognition-updates/${rejectedContext.draft.id}/reject`, { method: "POST", body: { version: rejectedContext.draft.version } });
  const afterReject = await request(rejectedContext.baseUrl, `/api/research/cognition-updates/${rejectedContext.draft.id}/ai-draft`, { method: "POST", body: { version: rejected.body.update.version } });
  assert.equal(afterReject.body.error.code, "COGNITION_UPDATE_NOT_DRAFT");
  assert.equal(rejectedContext.calls(), 0);
  rejectedContext.database.close();

  const deleted = await setup();
  deleted.database.prepare("UPDATE research_records SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), deleted.record.id);
  assert.equal((await request(deleted.baseUrl, `/api/research/cognition-updates/${deleted.draft.id}/ai-draft`, { method: "POST", body: { version: deleted.draft.version } })).body.error.code, "COGNITION_SOURCE_UNAVAILABLE");
  assert.equal(deleted.calls(), 0);
  deleted.database.close();

  const mismatch = await setup();
  mismatch.database.prepare("UPDATE research_records SET primary_topic_id = NULL WHERE id = ?").run(mismatch.record.id);
  assert.equal((await request(mismatch.baseUrl, `/api/research/cognition-updates/${mismatch.draft.id}/ai-draft`, { method: "POST", body: { version: mismatch.draft.version } })).body.error.code, "RESEARCH_RECORD_TOPIC_MISMATCH");
  assert.equal(mismatch.calls(), 0);
  mismatch.database.close();
});

test("missing server-side provider configuration fails without touching the draft", async () => {
  const context = await setup({ configured: false });
  const before = context.database.prepare("SELECT * FROM cognition_updates WHERE id = ?").get(context.draft.id);
  const response = await request(context.baseUrl, `/api/research/cognition-updates/${context.draft.id}/ai-draft`, { method: "POST", body: { version: context.draft.version } });
  assert.equal(response.body.error.code, "RESEARCH_AI_NOT_CONFIGURED");
  assert.deepEqual(context.database.prepare("SELECT * FROM cognition_updates WHERE id = ?").get(context.draft.id), before);
  context.database.close();
});

test("invalid structured output gets one repair attempt and then fails closed", async () => {
  const repaired = await setup({ outputs: ["not json", AI_DRAFT_FIXTURES.ADD] });
  assert.equal((await request(repaired.baseUrl, `/api/research/cognition-updates/${repaired.draft.id}/ai-draft`, { method: "POST", body: { version: repaired.draft.version } })).response.status, 200);
  assert.equal(repaired.calls(), 2);
  repaired.database.close();

  const invalid = await setup({ outputs: ["not json"] });
  const failed = await request(invalid.baseUrl, `/api/research/cognition-updates/${invalid.draft.id}/ai-draft`, { method: "POST", body: { version: invalid.draft.version } });
  assert.equal(failed.response.status, 502);
  assert.equal(failed.body.error.code, "RESEARCH_AI_DRAFT_FAILED");
  assert.equal(invalid.calls(), 2);
  invalid.database.close();
});

test("provider timeout, provider failure, partial source and long source have explicit behavior", async () => {
  const timeoutError = new Error("timeout"); timeoutError.code = "timeout";
  const timeout = await setup({ providerError: timeoutError });
  assert.equal((await request(timeout.baseUrl, `/api/research/cognition-updates/${timeout.draft.id}/ai-draft`, { method: "POST", body: { version: timeout.draft.version } })).body.error.code, "RESEARCH_AI_TIMEOUT");
  timeout.database.close();

  const providerError = new Error("failed"); providerError.code = "provider_error";
  const failed = await setup({ providerError });
  assert.equal((await request(failed.baseUrl, `/api/research/cognition-updates/${failed.draft.id}/ai-draft`, { method: "POST", body: { version: failed.draft.version } })).body.error.code, "RESEARCH_AI_DRAFT_FAILED");
  failed.database.close();

  const partial = await setup({ textComplete: false });
  assert.equal((await request(partial.baseUrl, `/api/research/cognition-updates/${partial.draft.id}/ai-draft`, { method: "POST", body: { version: partial.draft.version } })).body.sourceTextComplete, false);
  partial.database.close();

  const long = await setup({ maxSourceChars: "10" });
  const tooLong = await request(long.baseUrl, `/api/research/cognition-updates/${long.draft.id}/ai-draft`, { method: "POST", body: { version: long.draft.version } });
  assert.equal(tooLong.response.status, 413);
  assert.equal(tooLong.body.error.code, "RESEARCH_AI_SOURCE_TOO_LONG");
  assert.equal(long.calls(), 0);
  long.database.close();
});
