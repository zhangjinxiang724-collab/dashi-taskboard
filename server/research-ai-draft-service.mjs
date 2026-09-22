const UPDATE_TYPES = new Map([
  ["ADD", "add"],
  ["REINFORCE", "reinforce"],
  ["REVISE", "revise"],
  ["UNCERTAIN", "uncertain"],
]);

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggested_update_type", "new_information", "impact", "claim_changes"],
  properties: {
    suggested_update_type: { type: "string", enum: [...UPDATE_TYPES.keys()], description: "新资料与旧观点的关系；只要旧观点中的一句话必须改写、加限定或降低确定性，就优先用 REVISE；只有不修改任何旧判断的全新维度才用 ADD" },
    new_information: { type: "string", description: "这条资料让我真正新知道了什么；先说意义，只保留必要数据" },
    impact: { type: "string", description: "我原来怎么想，现在怎么看，真正需要调整什么" },
    claim_changes: {
      type: "array",
      description: "只列出需要修改或新增的判断；未列出的旧判断由系统原样保留",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "claim_id", "replacement", "text"],
        properties: {
          action: { type: "string", enum: ["MODIFY", "ADD"] },
          claim_id: { type: ["string", "null"] },
          replacement: { type: ["string", "null"] },
          text: { type: ["string", "null"] },
        },
      },
    },
  },
};

const SYSTEM_INSTRUCTIONS = `你在为用户起草一份认知更新建议，不替用户做最终判断。
只使用提供的当前观点和研究资料，不得引入外部事实，也不得把资料的语气自动当成事实。

生成答案前，先在内部问一个分类问题，但不要输出分析过程：把这条资料加入以后，当前观点中是否有一句话必须被改写、加限定或降低确定性？如果答案是“是”，优先选择 REVISE。
然后按以下优先级判断新资料与当前观点的关系：
A. REVISE：资料使当前观点中已经存在的一项具体判断需要被否定、缩小范围、增加限定、降低确定性或改变成立条件。即使资料同时增加了新观察维度，主类型仍是 REVISE。
B. REINFORCE：资料支持一个已经存在的判断，且不要求修改这个判断。
C. ADD：当前观点原本没有这个判断维度，资料第一次提供了可靠的新维度，而且不要求修改任何已有判断。
D. UNCERTAIN：资料不足以可靠地新增、强化或修正判断，保持观点不变。

严格遵守以下边界：
- “原来没有提到”不等于“原来判断错误”。只有新增观察角度时，优先选择 ADD。
- ADD 的新维度也必须有足够证据形成可靠观察。极小样本、单次访谈、缺少基线或关键验证数据时，即使资料提到了新维度，也应选择 UNCERTAIN。
- ADD 表示旧观点无需修改。因此只返回 ADD change，不得修改旧 claim；impact 必须忠实引用当前观点中实际存在的判断，不能虚构“我原来认为”的内容。
- 跨公司资料如果可靠证明竞争者已经形成一种值得观察的替代路线，但没有证明主题公司的旧优势受损，应选择 ADD：新增“以后观察这条路线是否影响主题公司”的判断，不能改写成对竞争者本身的投资结论，也不能断定主题公司已经受损。
- 只有能明确指出当前观点中的哪项具体判断被证据否定或修正，才能选择 REVISE。更多信息、不同角度或更详细解释都不能单独构成 REVISE。
- 当前观点使用“全面、完全、只有、所有”等绝对判断，而资料给出明确反例时，这个具体判断已经需要修正，应选择 REVISE，而不是把反例当成普通新增维度。
- 类型判断按修正优先：只要当前观点中的一句话需要改写、加限定或降低确定性，即使同时带来新信息，也应选择 REVISE，不能选择 ADD。
- REINFORCE 不需要制造新观点，claim_changes 必须为空。
- UNCERTAIN 的 claim_changes 必须为空，完整观点由系统逐字保留。

证据强度不得升级：资料只说“观察、迹象、可能、阶段性结果”，就不能改写成“稳定、确定、长期、可规模化、已证明”。
“观察到增长”不能升级为“稳定增长”或“增长模式成立”；“多次获客”不能升级为“可规模化复制”；“数据显示改善”不能升级为“已经建立长期竞争优势”，除非资料本身明确支持。
“没有发现某种现象”不能升级为“排除了这种可能性”。强烈宣传语言不能代替样本、基线、对照或第三方验证。

未知必须保持未知。这是最高级事实规则：
- “没有证据证明 X”不能写成“X 没有发生”。
- “未确认 X”不能写成“X 尚未发生”。
- “资料没有说明 X 改善”不能写成“X 没有改善”或“X 仍然疲弱”。
- “资料没有说明 X 是否同步恢复”不能写成“没有 X 的支撑”或“缺乏 X 支撑”，只能写“X 是否同步恢复还不确定”。
- “没有观察到 X”不能写成“X 不存在”。
- “样本不足以确认 X”不能写成“X 是错误的”。
- 正方向也一样：资料没有说明 X 存在，不能自动写成 X 存在。
遇到未知信息，只能写“是否……还不确定”“现有资料没有说明”或“目前还不足以判断”。

使用最小修改原则：保留当前观点中所有未受新资料影响的内容。ADD 应尽量是旧观点加一个可靠的新维度；REVISE 只修改被直接证据影响的部分，但不能继续保留已经被资料直接否定的相关结论。REINFORCE 和 UNCERTAIN 允许完全不改写当前观点。禁止仅为润色或模型表达偏好而整段重写。
当前观点已经被系统拆成若干带编号的独立判断。没有明确证据影响的判断一律不要写进 claim_changes，由系统保留。“资料没有提到”不等于“旧判断可以消失”。REVISE 只 MODIFY 受影响的判断；ADD 只新增判断；REINFORCE 和 UNCERTAIN 不返回改动。

认知内容不是研究报告，是写给未来的自己看的。严格遵守以下表达规则：
- 默认读者聪明、有判断力，但没有当前领域的专业训练。目标是让用户半年后重新打开时，马上看懂：我原来怎么想、这次新知道了什么、哪个判断变了、以后应该怎么判断。
- 使用自然、日常的简体中文和短句。专业深度不能降低，但理解门槛要尽量低。
- 专业术语第一次出现时，如果有更容易理解的说法，先写人话，必要时再在括号里补充术语或缩写。例如写“消费价格上涨速度（CPI）”，不要只写“CPI”。
- 不连续堆积缩写、宏观术语或抽象名词。能用简单中文准确表达时，不使用“揭示了、结构性矛盾、恶性循环、长期共存格局、估值逻辑、传导机制、需求端修复、供给侧压力”等研报腔。
- 数据是证据，不是正文主体。先说“这说明什么”，再补充真正必要的数据。
- new_information 只回答“这条资料让我真正新知道了什么？”。只保留会影响认知的内容，不要把 Research Record 重新摘要一遍。
- impact 回答“它补充、强化或修正了我原来的哪一个想法？”。优先使用“我原来……”“现在看……”“真正需要修正的是……”等直接表达，让旧判断到新理解一眼可见。
- claim_changes 中的 replacement 或 text 回答“所以以后我应该怎么理解和判断受影响的这部分？”。在资料支持范围内写清以后重点看什么，不写成券商研报结论。
- impact 中的“我原来……”必须忠实复述当前观点，不能换成含义不同的近似说法。尽量沿用当前观点的原词，先找出其中的具体判断，再说明资料支持、补充或修正了哪一部分。
- 资料只说某件事“还不确定、尚未验证、没有说明”时，输出也必须保留未知状态，不能改写成“还没发生、没有改善、一定不会发生”。
- 对未知状态，禁止写成“还没、没有、未恢复、没跟上”等已经断定结果的说法。只能写“是否……还不确定、还需要观察、现有资料没有说明”。
- ADD 和 REVISE 的 claim_changes 必须体现对应的新增维度或修正。REINFORCE 和 UNCERTAIN 的 claim_changes 必须为空。
- replacement 或新增 text 不能只写“补充几点”。必须写成以后遇到同类问题时可以重复使用的判断方法。
- 因果关系使用短链条：先写发生了什么，再写影响；需要继续推断时，用“如果持续下去，可能……”保留条件。不要把多层因果挤进一个长句。
- 每个字段优先写 2–4 个短句。不要为了显得专业而拉长句子，也不要为了讲人话而删除重要条件或把“可能、短期、部分”改成“确定、长期、全部”。

四种更新类型的表达目标：
- ADD：写清“我以前没注意到这个维度，现在需要把它加进判断框架”，不能把新增维度写成原判断错误。
- REINFORCE：写清“原来的判断没变，但现在多了一条更有力的证据”，不能为了制造变化而改写 Current View。
- REVISE：写清“我原来哪一部分不够准确，现在应该怎么改”，不能推翻未受证据影响的部分。
- UNCERTAIN：写清“这条信息值得记住，但还不足以改变判断”，并保持 Current View 逐字不变。

输出前在内部检查：如果删除主题名称和当前观点后，三个字段仍像一篇可以独立发布的新闻摘要、研究报告或考试答案，说明生成失败，应重新聚焦“这条资料相对我的旧观点意味着什么”。不要输出这一步检查。
再检查一次：impact 是否准确写出了旧判断，所有不确定信息是否仍是不确定的，以及每项改动是否真正回答了“以后我应该怎么看、重点看什么”。

优先套用这个简短表达骨架，但不要机械照抄：
- new_information：“我新知道的是……。这意味着……，但……还不确定。”
- impact：“我原来……。现在看……。真正需要调整的是……。”
- replacement / ADD text：“以后判断……，不能只看……，还要一起看……。目前只能说……。”

最终结构改为 Delta：不要输出完整 proposed_current_view。只输出 claim_changes。
- MODIFY：只修改被资料直接影响的现有判断，填写 claim_id 和 replacement，text 为 null。
- ADD：只新增可靠的新判断，claim_id 和 replacement 为 null，填写 text。
- 不允许 REMOVE。未列出的判断由服务端原样保留。
- REVISE 至少包含一项 MODIFY；ADD 至少包含一项 ADD，且不得无依据 MODIFY；REINFORCE 和 UNCERTAIN 的 claim_changes 必须为空。
不要只摘要资料。服务端会把旧观点与这些改动合成为简洁、自然的完整个人研究笔记。
不要输出思维过程，只输出要求的结构化结果。`;

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:9b";
const DEFAULT_OLLAMA_KEEP_ALIVE = "5m";
const DEFAULT_OLLAMA_MAX_OUTPUT_TOKENS = 320;
const DEFAULT_SCHEMA_NAME = "research_cognition_update_draft";
const DEFAULT_REPAIR_INSTRUCTIONS = "上一次输出没有通过结构、类型、事实边界或改动清单验证。请重新检查：REVISE 至少一项 MODIFY；ADD 至少一项 ADD 且不得无依据 MODIFY；REINFORCE 和 UNCERTAIN 不得有改动；MODIFY 只能引用给出的 claim_id；未知必须保持未知；不得增强证据；不得跑离主题；V1 不允许 REMOVE。";

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
      async generate(input, {
        repair = false,
        previousOutput = "",
        outputSchema = OUTPUT_SCHEMA,
        systemInstructions = SYSTEM_INSTRUCTIONS,
        schemaName = DEFAULT_SCHEMA_NAME,
        repairInstructions = DEFAULT_REPAIR_INSTRUCTIONS,
      } = {}) {
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
              format: outputSchema,
              options: {
                temperature: config.temperature,
                num_predict: config.maxOutputTokens,
              },
              messages: [
                { role: "system", content: systemInstructions },
                {
                  role: "user",
                  content: `${input}\n\n${repair ? `${repairInstructions}\n上一次输出：\n${previousOutput}\n\n` : ""}请只返回符合以下 JSON Schema 的 JSON：\n${JSON.stringify(outputSchema)}`,
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
    async generate(input, {
      repair = false,
      previousOutput = "",
      outputSchema = OUTPUT_SCHEMA,
      systemInstructions = SYSTEM_INSTRUCTIONS,
      schemaName = DEFAULT_SCHEMA_NAME,
      repairInstructions = DEFAULT_REPAIR_INSTRUCTIONS,
    } = {}) {
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
            instructions: systemInstructions,
            input: repair
              ? `${input}\n\n${repairInstructions}\n上一次输出：\n${previousOutput}\n\n请严格按照指定 JSON Schema 重新输出一次。`
              : input,
            text: {
              format: {
                type: "json_schema",
                name: schemaName,
                strict: true,
                schema: outputSchema,
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

function splitBaseClaims(value) {
  const text = String(value ?? "");
  const quotedClaims = text.match(/[‘“"]([^’”"]+)[’”"]/u)?.[1];
  return String(quotedClaims ?? text)
    .split(/[。！？；;、\n]+/u)
    .map((claim) => claim.replace(/[“”‘’"']/g, "").trim())
    .filter((claim) => claim.length >= 2);
}

function numberedClaims(baseCurrentView) {
  return splitBaseClaims(baseCurrentView).map((originalText, index) => ({ claimId: `C${index + 1}`, originalText }));
}

function rebuildCurrentView(baseCurrentView, changes) {
  if (changes.length === 0) return baseCurrentView;
  const modifications = changes.filter((item) => item.action === "MODIFY");
  const additions = changes.filter((item) => item.action === "ADD").map((item) => item.text);
  if (modifications.length === 0) {
    const suffix = additions.map((item) => /[。！？]$/u.test(item) ? item : `${item}。`).join("");
    return `${baseCurrentView}${suffix}`;
  }
  const claims = numberedClaims(baseCurrentView);
  const replacements = new Map(modifications.map((item) => [item.claimId, item.replacement]));
  const result = claims.map((claim) => replacements.get(claim.claimId) ?? claim.originalText);
  result.push(...additions);
  return result.map((item) => /[。！？]$/u.test(item) ? item : `${item}。`).join("");
}

const CLAIM_TOKEN_STOPLIST = new Set(["我原", "原来", "认为", "目前", "现在", "仍然", "需要", "判断", "观点", "这个", "已经", "以及", "同时", "长期"]);

function claimTokens(value) {
  const tokens = new Set(String(value).match(/[A-Za-z][A-Za-z0-9+.-]{1,}/g) ?? []);
  for (const sequence of String(value).match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const token = sequence.slice(index, index + 2);
      if (!CLAIM_TOKEN_STOPLIST.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function missingClaimScopes(baseCurrentView, proposedCurrentView) {
  const proposed = String(proposedCurrentView ?? "");
  const proposedTokens = claimTokens(proposed);
  return splitBaseClaims(baseCurrentView).filter((claim) => {
    if (proposed.includes(claim)) return false;
    const tokens = [...claimTokens(claim)];
    if (tokens.length === 0) return !proposed.includes(claim);
    const matched = tokens.filter((token) => proposedTokens.has(token)).length;
    return matched / tokens.length < 0.1;
  });
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
  "高企",
];

const UNKNOWN_SOURCE_PATTERN = /是否.{0,20}(?:不确定|尚不确定|未知)|没有说明|未说明|尚未确认|未确认|没有确认|没有证据|证据不足|不足以判断|无法判断|未提及|没有提及|not established|not confirmed|insufficient evidence|not mentioned/i;
const FALSE_CERTAINTY_PATTERN = /还没跟上|没跟上|未同步修复|仍然疲弱|仍未恢复|还没有恢复|没有改善|尚未发生|没有发生|并不存在|不存在|已经失败|失败了|(?:没有|缺乏).{0,16}(?:支撑|支持|恢复|改善|发生|存在|跟上)/g;

function hasEpistemicPolarityViolation(candidateText, baseCurrentView, sourceText) {
  if (!UNKNOWN_SOURCE_PATTERN.test(sourceText)) return false;
  for (const match of candidateText.matchAll(FALSE_CERTAINTY_PATTERN)) {
    const phrase = match[0];
    if (!baseCurrentView.includes(phrase) && !sourceText.includes(phrase)) return true;
  }
  return false;
}

function candidateFromRaw(raw, baseCurrentView, sourceText) {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const updateType = UPDATE_TYPES.get(value.suggested_update_type);
  const newInformation = typeof value.new_information === "string" ? value.new_information.trim() : "";
  const impact = typeof value.impact === "string" ? value.impact.trim() : "";
  if (!updateType || !newInformation || !impact || !Array.isArray(value.claim_changes)) return null;
  if (newInformation.length > 4_000 || impact.length > 4_000 || value.claim_changes.length > 20) return null;
  const knownIds = new Set(numberedClaims(baseCurrentView).map((claim) => claim.claimId));
  const changes = [];
  for (const change of value.claim_changes) {
    if (!change || typeof change !== "object") return null;
    if (change.action === "MODIFY") {
      const claimId = typeof change.claim_id === "string" ? change.claim_id : "";
      const replacement = typeof change.replacement === "string" ? change.replacement.trim() : "";
      if (!knownIds.has(claimId) || !replacement || change.text !== null) return null;
      changes.push({ action: "MODIFY", claimId, replacement });
    } else if (change.action === "ADD") {
      const text = typeof change.text === "string" ? change.text.trim() : "";
      if (change.claim_id !== null || change.replacement !== null || !text) return null;
      changes.push({ action: "ADD", text });
    } else return null;
  }
  const modifyCount = changes.filter((item) => item.action === "MODIFY").length;
  const addCount = changes.filter((item) => item.action === "ADD").length;
  if (updateType === "revise" && modifyCount === 0) return null;
  if (updateType === "add" && (addCount === 0 || modifyCount > 0)) return null;
  if (["reinforce", "uncertain"].includes(updateType) && changes.length > 0) return null;
  const proposed = rebuildCurrentView(baseCurrentView, changes);
  if (proposed.length > 10_000) return null;
  const evidence = `${baseCurrentView}\n${sourceText}`;
  const candidateText = `${newInformation}\n${impact}\n${proposed}`;
  if (EVIDENCE_ESCALATION_PHRASES.some((phrase) => candidateText.includes(phrase) && !evidence.includes(phrase))) return null;
  if (hasEpistemicPolarityViolation(candidateText, baseCurrentView, sourceText)) return null;
  const modifiedIds = new Set(changes.filter((item) => item.action === "MODIFY").map((item) => item.claimId));
  if (numberedClaims(baseCurrentView).some((claim) => !modifiedIds.has(claim.claimId) && !proposed.includes(claim.originalText))) return null;
  return { updateType, newInformation, impact, proposedCurrentView: proposed };
}

function promptFor({ topic, update, record, content, transcript }) {
  const completeness = (content.completenessDetails?.textTranscriptComplete ?? content.completeness === "complete")
    ? "文字问答已确认完整"
    : "文字问答可能缺失";
  const baseClaims = numberedClaims(update.baseCurrentView).map((claim) => `${claim.claimId}: ${claim.originalText}`).join("\n");
  return `主题名称：${topic.title}\n\n当前观点：\n${update.baseCurrentView || "（尚无明确观点）"}\n\n当前观点的判断清单（只可按 claim_id 修改；未列入 claim_changes 的内容由系统原样保留）：\n${baseClaims || "（无）"}\n\n资料标题：${record.title}\n资料来源：${record.provider} / ${record.kind}\n资料摘要：${record.summary || "（无）"}\n资料备注：${record.note || "（无）"}\n资料完整性：${completeness}\n\n锁定版本的资料正文：\n${transcript}`;
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
        providerResult = await this.provider.generate(input, {
          repair: true,
          previousOutput: typeof raw === "string" ? raw : JSON.stringify(raw),
        });
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

export { OUTPUT_SCHEMA, SYSTEM_INSTRUCTIONS, candidateFromRaw, hasEpistemicPolarityViolation, missingClaimScopes, numberedClaims, rebuildCurrentView, splitBaseClaims };
