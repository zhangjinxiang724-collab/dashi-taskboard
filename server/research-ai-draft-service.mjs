const UPDATE_TYPES = new Map([
  ["ADD", "add"],
  ["REINFORCE", "reinforce"],
  ["REVISE", "revise"],
  ["UNCERTAIN", "uncertain"],
]);

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggested_update_type", "new_information", "impact", "proposed_current_view"],
  properties: {
    suggested_update_type: { type: "string", enum: [...UPDATE_TYPES.keys()] },
    new_information: { type: "string" },
    impact: { type: "string" },
    proposed_current_view: { type: "string" },
  },
};

const SYSTEM_INSTRUCTIONS = `你在为用户起草一份认知更新建议，不替用户做最终判断。
只使用提供的当前观点和研究资料，不得引入外部事实，也不得把资料的语气自动当成事实。

生成答案前，先在内部判断新资料与当前观点的关系，但不要输出这一步分析：
A. 明确冲突：资料明确否定或修正当前观点中已经存在的一项具体判断 → REVISE。
B. 支持已有判断：资料直接支持当前观点已经包含的核心判断 → REINFORCE。
C. 增加新维度但不冲突：资料提供当前观点原来没有覆盖的新观察角度，同时不否定原判断 → ADD。
D. 证据不足：资料不足以新增可靠判断、强化旧判断或修正旧判断 → UNCERTAIN。

严格遵守以下边界：
- “原来没有提到”不等于“原来判断错误”。只有新增观察角度时，优先选择 ADD。
- ADD 的新维度也必须有足够证据形成可靠观察。极小样本、单次访谈、缺少基线或关键验证数据时，即使资料提到了新维度，也应选择 UNCERTAIN。
- 只有能明确指出当前观点中的哪项具体判断被证据否定或修正，才能选择 REVISE。更多信息、不同角度或更详细解释都不能单独构成 REVISE。
- REINFORCE 不需要制造新观点，proposed_current_view 可以与当前观点完全相同。
- UNCERTAIN 的 proposed_current_view 必须与当前观点逐字相同。

证据强度不得升级：资料只说“观察、迹象、可能、阶段性结果”，就不能改写成“稳定、确定、长期、可规模化、已证明”。
“观察到增长”不能升级为“稳定增长”或“增长模式成立”；“多次获客”不能升级为“可规模化复制”；“数据显示改善”不能升级为“已经建立长期竞争优势”，除非资料本身明确支持。
“没有发现某种现象”不能升级为“排除了这种可能性”。强烈宣传语言不能代替样本、基线、对照或第三方验证。

使用最小修改原则：保留当前观点中所有未受新资料影响的内容。ADD 应尽量是旧观点加一个可靠的新维度；REVISE 只修改被直接证据影响的部分，但不能继续保留已经被资料直接否定的相关结论。REINFORCE 和 UNCERTAIN 允许完全不改写当前观点。禁止仅为润色或模型表达偏好而整段重写。

不要只摘要资料。使用简体中文；new_information 和 impact 各用 1–2 句话，proposed_current_view 尽量与当前观点长度接近，写成简洁的研究笔记，而不是研究报告。
不要输出思维过程，只输出要求的结构化结果。`;

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:9b";
const DEFAULT_OLLAMA_KEEP_ALIVE = "5m";
const DEFAULT_OLLAMA_MAX_OUTPUT_TOKENS = 320;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  return fallback;
}

function localBaseUrl(value) {
  try {
    const url = new URL(String(value || OLLAMA_BASE_URL));
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveResearchAiConfig(environment = process.env) {
  const provider = String(environment.RESEARCH_AI_PROVIDER ?? "").trim().toLowerCase();
  const configuredModel = String(environment.RESEARCH_AI_MODEL ?? "").trim();
  const apiKey = String(environment.OPENAI_API_KEY ?? "").trim();
  return {
    provider,
    model: configuredModel || (provider === "ollama" ? DEFAULT_OLLAMA_MODEL : ""),
    apiKey,
    baseUrl: localBaseUrl(environment.RESEARCH_AI_BASE_URL),
    timeoutMs: positiveInteger(environment.RESEARCH_AI_TIMEOUT_MS, provider === "ollama" ? 120_000 : 30_000),
    maxSourceChars: positiveInteger(environment.RESEARCH_AI_MAX_SOURCE_CHARS, 120_000),
    temperature: boundedNumber(environment.RESEARCH_AI_TEMPERATURE, 0, 0, 2),
    maxOutputTokens: positiveInteger(environment.RESEARCH_AI_MAX_OUTPUT_TOKENS, DEFAULT_OLLAMA_MAX_OUTPUT_TOKENS),
    keepAlive: String(environment.RESEARCH_AI_KEEP_ALIVE ?? DEFAULT_OLLAMA_KEEP_ALIVE).trim() || DEFAULT_OLLAMA_KEEP_ALIVE,
    think: booleanValue(environment.RESEARCH_AI_THINK, false),
  };
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

export function createResearchAiProvider({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = resolveResearchAiConfig(environment);
  if (config.provider === "ollama" && config.model && config.baseUrl) {
    return {
      name: "ollama",
      model: config.model,
      async generate(input, { repair = false } = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
          const response = await fetchImpl(`${config.baseUrl}/api/chat`, {
            method: "POST",
            signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: config.model,
              stream: false,
              think: config.think,
              keep_alive: config.keepAlive,
              format: OUTPUT_SCHEMA,
              options: {
                temperature: config.temperature,
                num_predict: config.maxOutputTokens,
              },
              messages: [
                { role: "system", content: SYSTEM_INSTRUCTIONS },
                {
                  role: "user",
                  content: `${input}\n\n${repair ? "上一次输出没有通过结构验证。" : ""}请只返回符合以下 JSON Schema 的 JSON：\n${JSON.stringify(OUTPUT_SCHEMA)}`,
                },
              ],
            }),
          });
          if (!response.ok) {
            const error = new Error("AI provider request failed");
            error.code = "provider_error";
            throw error;
          }
          const payload = await response.json();
          const inputTokens = Number.isFinite(payload?.prompt_eval_count) ? payload.prompt_eval_count : undefined;
          const outputTokens = Number.isFinite(payload?.eval_count) ? payload.eval_count : undefined;
          return {
            text: typeof payload?.message?.content === "string" ? payload.message.content : "",
            usage: inputTokens !== undefined || outputTokens !== undefined ? {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined,
            } : undefined,
            metrics: {
              totalDurationMs: Number.isFinite(payload?.total_duration) ? payload.total_duration / 1_000_000 : undefined,
              loadDurationMs: Number.isFinite(payload?.load_duration) ? payload.load_duration / 1_000_000 : undefined,
            },
          };
        } catch (error) {
          if (error?.name === "AbortError") {
            const timeoutError = new Error("AI provider request timed out");
            timeoutError.code = "timeout";
            throw timeoutError;
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
    };
  }
  if (config.provider !== "openai" || !config.model || !config.apiKey) return null;
  return {
    name: "openai",
    model: config.model,
    async generate(input, { repair = false } = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            store: false,
            max_output_tokens: 1_200,
            instructions: SYSTEM_INSTRUCTIONS,
            input: repair
              ? `${input}\n\n上一次输出没有通过结构验证。请严格按照指定 JSON Schema 重新输出一次。`
              : input,
            text: {
              format: {
                type: "json_schema",
                name: "research_cognition_update_draft",
                strict: true,
                schema: OUTPUT_SCHEMA,
              },
            },
          }),
        });
        if (!response.ok) {
          const error = new Error("AI provider request failed");
          error.code = "provider_error";
          throw error;
        }
        const payload = await response.json();
        return {
          text: outputText(payload),
          usage: payload?.usage && typeof payload.usage === "object" ? {
            inputTokens: Number.isFinite(payload.usage.input_tokens) ? payload.usage.input_tokens : undefined,
            outputTokens: Number.isFinite(payload.usage.output_tokens) ? payload.usage.output_tokens : undefined,
            totalTokens: Number.isFinite(payload.usage.total_tokens) ? payload.usage.total_tokens : undefined,
          } : undefined,
        };
      } catch (error) {
        if (error?.name === "AbortError") {
          const timeoutError = new Error("AI provider request timed out");
          timeoutError.code = "timeout";
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function messageText(message) {
  if (typeof message?.text === "string") return message.text.trim();
  return (message?.parts ?? []).map((part) => {
    if (part?.type === "text" || part?.type === "code") return String(part.text ?? "");
    if (part?.type === "link") return `${part.text ?? part.label ?? "链接"}: ${part.url ?? ""}`;
    if (part?.type === "media-placeholder") return `[${part.label ?? "未完整保存的图片或文件"}]`;
    return "";
  }).filter(Boolean).join("\n").trim();
}

function sourceTranscript(content) {
  return (content?.content?.messages ?? []).map((message, index) => {
    const role = message.role === "user" ? "用户" : message.role === "assistant" ? "AI" : String(message.role ?? "未知");
    return `${index + 1}. ${role}\n${messageText(message)}`;
  }).join("\n\n").trim();
}

const EVIDENCE_ESCALATION_PHRASES = [
  "稳定增长",
  "持续增长",
  "长期成立",
  "可规模化",
  "规模化复制",
  "已经证明",
  "已证明",
  "确定性",
  "排除了",
  "已经建立长期竞争优势",
];

function candidateFromRaw(raw, baseCurrentView, sourceText) {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const updateType = UPDATE_TYPES.get(value.suggested_update_type);
  const newInformation = typeof value.new_information === "string" ? value.new_information.trim() : "";
  const impact = typeof value.impact === "string" ? value.impact.trim() : "";
  const proposed = typeof value.proposed_current_view === "string" ? value.proposed_current_view.trim() : "";
  if (!updateType || !newInformation || !impact || !proposed) return null;
  if (newInformation.length > 4_000 || impact.length > 4_000 || proposed.length > 10_000) return null;
  if (updateType === "uncertain" && proposed !== baseCurrentView) return null;
  const evidence = `${baseCurrentView}\n${sourceText}`;
  const candidateText = `${newInformation}\n${impact}\n${proposed}`;
  if (EVIDENCE_ESCALATION_PHRASES.some((phrase) => candidateText.includes(phrase) && !evidence.includes(phrase))) return null;
  return { updateType, newInformation, impact, proposedCurrentView: proposed };
}

function promptFor({ topic, update, record, content, transcript }) {
  const completeness = (content.completenessDetails?.textTranscriptComplete ?? content.completeness === "complete")
    ? "文字问答已确认完整"
    : "文字问答可能缺失";
  return `主题名称：${topic.title}\n\n当前观点：\n${update.baseCurrentView || "（尚无明确观点）"}\n\n资料标题：${record.title}\n资料来源：${record.provider} / ${record.kind}\n资料摘要：${record.summary || "（无）"}\n资料备注：${record.note || "（无）"}\n资料完整性：${completeness}\n\n锁定版本的资料正文：\n${transcript}`;
}

export class ResearchAiDraftService {
  constructor(research, { provider = null, maxSourceChars = 120_000, logger = console } = {}) {
    this.research = research;
    this.provider = provider;
    this.maxSourceChars = maxSourceChars;
    this.logger = logger;
  }

  async generate(updateId, version) {
    const update = this.research.getCognitionUpdate(updateId);
    if (!update) return { kind: "not_found" };
    if (update.status !== "draft") return { kind: "not_draft", status: update.status };
    if (update.version !== version) return { kind: "conflict", currentVersion: update.version };
    const topic = this.research.getTopic(update.topicId);
    if (!topic) return { kind: "topic_not_found" };
    if (topic.version !== update.baseTopicVersion) return { kind: "topic_conflict", currentVersion: topic.version };
    const record = this.research.getResearchRecord(update.recordId);
    if (!record) return { kind: "source_unavailable" };
    if (record.topicId !== topic.id) return { kind: "record_topic_mismatch" };
    if (!update.sourceContentVersionId || !update.sourceContentVersionNumber) return { kind: "source_version_invalid" };
    const content = this.research.getResearchRecordContent(record.id, update.sourceContentVersionNumber);
    if (!content || content.versionId !== update.sourceContentVersionId) return { kind: "source_version_invalid" };
    const transcript = sourceTranscript(content);
    if (!transcript) return { kind: "source_unavailable" };
    const input = promptFor({ topic, update, record, content, transcript });
    if (input.length > this.maxSourceChars) return { kind: "source_too_long" };
    if (!this.provider) return { kind: "not_configured" };
    const startedAt = Date.now();
    try {
      let providerResult = await this.provider.generate(input);
      let raw = typeof providerResult === "object" && providerResult !== null && "text" in providerResult
        ? providerResult.text
        : providerResult;
      let usage = typeof providerResult === "object" && providerResult !== null && "usage" in providerResult
        ? providerResult.usage
        : undefined;
      let candidate = candidateFromRaw(raw, update.baseCurrentView, transcript);
      if (!candidate) {
        providerResult = await this.provider.generate(input, { repair: true });
        raw = typeof providerResult === "object" && providerResult !== null && "text" in providerResult
          ? providerResult.text
          : providerResult;
        usage = typeof providerResult === "object" && providerResult !== null && "usage" in providerResult
          ? providerResult.usage
          : undefined;
        candidate = candidateFromRaw(raw, update.baseCurrentView, transcript);
      }
      if (!candidate) return { kind: "invalid_output" };
      this.logger.info?.("Research AI draft completed", {
        provider: this.provider.name,
        model: this.provider.model,
        latencyMs: Date.now() - startedAt,
        inputLength: input.length,
        outputLength: JSON.stringify(candidate).length,
        ...(usage ? { usage } : {}),
        status: "ok",
      });
      return {
        kind: "generated",
        candidate,
        sourceTextComplete: content.completenessDetails?.textTranscriptComplete ?? content.completeness === "complete",
      };
    } catch (error) {
      this.logger.warn?.("Research AI draft failed", {
        provider: this.provider.name,
        model: this.provider.model,
        latencyMs: Date.now() - startedAt,
        inputLength: input.length,
        status: error?.code === "timeout" ? "timeout" : "provider_error",
      });
      return { kind: error?.code === "timeout" ? "timeout" : "provider_error" };
    }
  }
}

export { OUTPUT_SCHEMA, SYSTEM_INSTRUCTIONS };
