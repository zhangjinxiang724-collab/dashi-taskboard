const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["one_line_summary", "core_content", "key_evidence", "unresolved"],
  properties: {
    one_line_summary: { type: "string" },
    core_content: { type: "string" },
    key_evidence: { type: "string" },
    unresolved: { type: "string" },
  },
};

const SUMMARY_SYSTEM_INSTRUCTIONS = `你在为 Research OS 起草一份资料内容总结。只回答“这份资料讲了什么”，不要替用户更新观点。

严格输出四个字段：
- one_line_summary：用 1—3 个短句说明资料最核心讲了什么。
- core_content：保留最重要的 3—5 点；不机械凑数量。
- key_evidence：只放资料中明确出现的数字、时间、事件、案例或事实。没有明确证据时留空。
- unresolved：只放资料仍不能确认的事情。没有真正不确定内容时留空。

必须遵守：
- 只能使用给定资料中的信息，不得补充模型自己的背景知识、数字、年份、公司事实、因果或结论。
- 未知必须保持未知。“没有证据证明”不能改写成“没有发生”，“未确认”不能改写成“尚未发生”。
- 作者观点、用户猜测和事实必须明确区分；证据不足的猜测不能成为事实。
- 后文明确纠正前文时，以纠正后的信息为准。
- 不得出现投资建议、行动建议、认知更新、Current View 或“我现在认为、以后应该、需要调整判断、更看好、风险变大”等表达。
- 多主体资料仍要围绕当前 Research Record，不得切换主题。
- 可以压缩和去重，但不能改变原意或丢掉重要限定条件。
- 使用自然、简短、容易读懂的中文。Summary 不是研报。

不要输出思维过程，只输出指定结构。`;

const SUMMARY_REPAIR_INSTRUCTIONS = `上一次输出没有通过结构或确定性安全检查。请只根据原资料重新生成：不得新增数字或事实；未知继续保持未知；用户猜测不能升级成事实；不得出现认知更新或建议；四个字段必须都是字符串；资料有明确不确定内容时必须写入 unresolved。`;

const COGNITION_PATTERN = /我现在认为|以后应该|需要调整判断|更看好|风险变大|建议买|建议卖|买入|卖出|值得投资|投资者应|我们应该采取|行动建议|current\s*view/i;
const UNKNOWN_SOURCE_PATTERN = /尚未确认|未确认|不能确认|无法确认|不足以判断|证据不足|没有(?:给出|提供|说明|可靠资料)|未(?:给出|提供|说明)|不清楚|未知|仍未确定|尚未确定|是否/;
const UNKNOWN_OUTPUT_PATTERN = /尚未确认|未确认|不能确认|无法确认|不足以判断|证据不足|没有(?:给出|提供|说明|可靠资料)|未(?:给出|提供|说明)|不清楚|未知|仍未确定|尚未确定|是否|有待确认|还需确认|仍需确认|待确认/;
const UNSUPPORTED_POLARITY_PATTERN = /尚未发生|没有发生|并未发生|不存在|仍然疲弱|尚未恢复|没有恢复|还没恢复|已经发生|已发生|已经提高|已经改善|已经停产|确定停产|已经失败|未能成功/;
const CHINESE_DIGITS = new Map([
  ["零", 0], ["〇", 0], ["一", 1], ["二", 2], ["两", 2], ["三", 3],
  ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9],
]);
const CHINESE_UNITS = new Map([["十", 10], ["百", 100], ["千", 1_000], ["万", 10_000]]);

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

function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

function chineseNumber(value) {
  if (![...value].some((character) => CHINESE_UNITS.has(character))) {
    const digits = [...value].map((character) => CHINESE_DIGITS.get(character));
    return digits.every(Number.isInteger) ? Number(digits.join("")) : null;
  }
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of value) {
    if (CHINESE_DIGITS.has(character)) {
      digit = CHINESE_DIGITS.get(character);
      continue;
    }
    const unit = CHINESE_UNITS.get(character);
    if (!unit) return null;
    if (unit === 10_000) {
      section += digit;
      total += section * unit;
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * unit;
      digit = 0;
    }
  }
  return total + section + digit;
}

function normalizeNumericText(value) {
  return String(value)
    .replace(/％/g, "%")
    .replace(/(?<=\d)[，,](?=\d{3}(?:\D|$))/g, "")
    .replace(/[零〇一二两三四五六七八九十百千万]+/g, (match) => {
      const number = chineseNumber(match);
      return number === null ? match : String(number);
    });
}

function withoutListNumbers(value) {
  return String(value).replace(/^\s*\d+\s*[.、)]\s*/gm, "");
}

function numericTokens(value, { convertChinese = false } = {}) {
  const normalized = convertChinese
    ? normalizeNumericText(withoutListNumbers(value))
    : withoutListNumbers(value).replace(/％/g, "%").replace(/(?<=\d)[，,](?=\d{3}(?:\D|$))/g, "");
  return [...normalized.matchAll(/\d+(?:\.\d+)?%?/g)].map((match) => match[0]);
}

function hasNewNumericFact(source, output) {
  const sourceNumbers = new Set(numericTokens(source, { convertChinese: true }));
  return numericTokens(output).some((number) => !sourceNumbers.has(number));
}

function hasUnknownToFactViolation(source, output) {
  if (!UNKNOWN_SOURCE_PATTERN.test(source)) return false;
  const sourceAssertions = new Set(String(source).match(UNSUPPORTED_POLARITY_PATTERN) ?? []);
  return (String(output).match(new RegExp(UNSUPPORTED_POLARITY_PATTERN.source, "g")) ?? [])
    .some((assertion) => !sourceAssertions.has(assertion));
}

function guessedPhrases(source) {
  const phrases = [];
  for (const sentence of String(source).split(/[。！？\n]/)) {
    if (!/猜测|推测|怀疑/.test(sentence) || !/可能/.test(sentence)) continue;
    const match = sentence.match(/可能(?:已经|已)?([^，；]{2,20}?)(?:，|所以|导致|$)/);
    if (match?.[1]) phrases.push(match[1].trim());
  }
  return phrases;
}

function hasGuessUpgradedToFact(source, candidate) {
  const outputSentences = Object.values(candidate).join("\n").split(/[。！？\n]/);
  return guessedPhrases(source).some((phrase) => outputSentences.some((sentence) => (
    sentence.includes(phrase)
      && !/猜测|推测|怀疑|可能|无法确认|不能确认|不足以判断|未确认|是否|证据不足/.test(sentence)
  )));
}

export function validateSummaryCandidate(raw, source) {
  const value = parseJson(raw);
  if (!value) return { candidate: null, categories: ["invalid_json"] };
  const keys = Object.keys(value).sort();
  const expectedKeys = ["core_content", "key_evidence", "one_line_summary", "unresolved"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    return { candidate: null, categories: ["invalid_structure"] };
  }
  if (expectedKeys.some((key) => typeof value[key] !== "string")) {
    return { candidate: null, categories: ["invalid_structure"] };
  }
  const candidate = {
    oneLineSummary: value.one_line_summary.trim(),
    coreContent: value.core_content.trim(),
    keyEvidence: value.key_evidence.trim(),
    unresolved: value.unresolved.trim(),
  };
  const combined = Object.values(candidate).join("\n");
  const categories = [];
  if (!candidate.oneLineSummary || candidate.oneLineSummary.length > 1_000) categories.push("invalid_summary_length");
  if ([candidate.coreContent, candidate.keyEvidence, candidate.unresolved].some((field) => field.length > 20_000)) categories.push("invalid_field_length");
  if (COGNITION_PATTERN.test(combined)) categories.push("cognition_leakage");
  if (hasNewNumericFact(source, combined)) categories.push("new_numeric_fact");
  if (hasUnknownToFactViolation(source, combined)) categories.push("unknown_to_fact");
  if (hasGuessUpgradedToFact(source, candidate)) categories.push("guess_to_fact");
  if (UNKNOWN_SOURCE_PATTERN.test(source) && !candidate.unresolved) categories.push("missing_unresolved");
  return { candidate: categories.length ? null : candidate, categories };
}

function promptFor(record, content, transcript) {
  const completeness = content.completenessDetails?.textTranscriptComplete === true
    ? "文字内容已确认完整"
    : "文字内容可能不完整；总结必须保留这个限制";
  return `资料标题：${record.title}\n资料来源：${record.provider} / ${record.kind}\n资料时间：${record.occurredAt}\n资料完整性：${completeness}\n\n指定正文版本：V${content.versionNumber}\n\n资料正文：\n${transcript}`;
}

export class ResearchSummaryAiDraftService {
  constructor(research, { provider = null, maxSourceChars = 120_000, logger = console } = {}) {
    this.research = research;
    this.provider = provider;
    this.maxSourceChars = maxSourceChars;
    this.logger = logger;
  }

  async generate(recordId, { sourceContentVersionId, summaryVersion = null }) {
    const record = this.research.getResearchRecord(recordId);
    if (!record) return { kind: "record_not_found" };
    const versions = this.research.listResearchRecordContentVersions(recordId) ?? [];
    const version = versions.find((candidate) => candidate.id === sourceContentVersionId);
    if (!version) return { kind: "source_version_invalid" };
    const content = this.research.getResearchRecordContent(recordId, version.versionNumber);
    if (!content || content.versionId !== sourceContentVersionId) return { kind: "source_version_invalid" };
    const currentSummary = this.research.getResearchRecordSummary(recordId, sourceContentVersionId).summary;
    if (summaryVersion !== null && currentSummary?.version !== summaryVersion) {
      return { kind: "summary_conflict", currentVersion: currentSummary?.version ?? null };
    }
    const transcript = sourceTranscript(content);
    if (!transcript) return { kind: "source_unavailable" };
    const input = promptFor(record, content, transcript);
    if (input.length > this.maxSourceChars) return { kind: "source_too_long" };
    if (!this.provider) return { kind: "not_configured" };
    const source = `${record.title}\n${transcript}`;
    const startedAt = Date.now();
    let repairs = 0;
    try {
      let result = await this.provider.generate(input, {
        outputSchema: SUMMARY_OUTPUT_SCHEMA,
        systemInstructions: SUMMARY_SYSTEM_INSTRUCTIONS,
        schemaName: "research_summary_draft",
        repairInstructions: SUMMARY_REPAIR_INSTRUCTIONS,
      });
      let raw = typeof result === "object" && result !== null && "text" in result ? result.text : result;
      let validation = validateSummaryCandidate(raw, source);
      if (!validation.candidate) {
        repairs = 1;
        result = await this.provider.generate(input, {
          repair: true,
          previousOutput: typeof raw === "string" ? raw : JSON.stringify(raw),
          outputSchema: SUMMARY_OUTPUT_SCHEMA,
          systemInstructions: SUMMARY_SYSTEM_INSTRUCTIONS,
          schemaName: "research_summary_draft",
          repairInstructions: SUMMARY_REPAIR_INSTRUCTIONS,
        });
        raw = typeof result === "object" && result !== null && "text" in result ? result.text : result;
        validation = validateSummaryCandidate(raw, source);
      }
      if (!validation.candidate) {
        this.logger.warn?.("Research Summary AI draft rejected", {
          provider: this.provider.name,
          model: this.provider.model,
          latencyMs: Date.now() - startedAt,
          repairCount: repairs,
          validationCategories: validation.categories,
          status: "safe_fail",
        });
        return { kind: "invalid_output" };
      }
      this.logger.info?.("Research Summary AI draft completed", {
        provider: this.provider.name,
        model: this.provider.model,
        latencyMs: Date.now() - startedAt,
        repairCount: repairs,
        inputLength: input.length,
        outputLength: JSON.stringify(validation.candidate).length,
        status: "ok",
      });
      return {
        kind: "generated",
        candidate: validation.candidate,
        sourceContentVersionId,
        summaryVersion: currentSummary?.version ?? null,
        sourceTextComplete: content.completenessDetails?.textTranscriptComplete ?? content.completeness === "complete",
      };
    } catch (error) {
      this.logger.warn?.("Research Summary AI draft failed", {
        provider: this.provider.name,
        model: this.provider.model,
        latencyMs: Date.now() - startedAt,
        repairCount: repairs,
        status: error?.code === "timeout" ? "timeout" : "provider_error",
      });
      return { kind: error?.code === "timeout" ? "timeout" : "provider_error" };
    }
  }
}

export {
  SUMMARY_OUTPUT_SCHEMA,
  SUMMARY_REPAIR_INSTRUCTIONS,
  SUMMARY_SYSTEM_INSTRUCTIONS,
  hasNewNumericFact,
  hasUnknownToFactViolation,
};
