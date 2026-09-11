import type { CaptureCompletenessDetails } from "./researchTypes";

export type ResearchCompletenessContext = "preview" | "reader" | "inbox";
export type ResearchCompletenessSeverity = "complete" | "warning" | "failed" | "unknown";

export interface ResearchCompletenessDetailRow {
  label: string;
  status: string;
  description: string;
  severity: ResearchCompletenessSeverity;
}

export interface ResearchCompletenessTechnicalRow {
  label: string;
  value: string;
}

export interface ResearchCompletenessPresentation {
  headline: string;
  messageSummary: string;
  mediaNotice: string | null;
  guidance: string | null;
  severity: ResearchCompletenessSeverity;
  compactLabel: string;
  detailRows: ResearchCompletenessDetailRow[];
  technicalRows: ResearchCompletenessTechnicalRow[];
}

export interface ResearchCompletenessPresentationInput {
  completeness: "complete" | "partial" | "failed" | null;
  details: CaptureCompletenessDetails | null | undefined;
  messageCount: number;
  context: ResearchCompletenessContext;
  captureAdapter?: string | null;
}

const mediaLabels: Record<string, { label: string; unit: string }> = {
  image: { label: "图片", unit: "张" },
  file: { label: "文件", unit: "个" },
  video: { label: "视频", unit: "个" },
  audio: { label: "音频", unit: "段" },
  canvas: { label: "其他页面内容", unit: "项" },
  "tool-ui": { label: "其他页面内容", unit: "项" },
  unknown: { label: "其他内容", unit: "项" },
};

const reasonGuidance: Record<string, string> = {
  "older-content-still-loading": "更早的聊天记录没有全部读取出来，建议重新尝试。",
  "earliest-boundary-unconfirmed": "更早的聊天记录没有全部读取出来，建议重新尝试。",
  "no-stable-message-sequence": "页面读取中断，部分历史可能没有保存，建议重新尝试。",
  "complete-evidence-insufficient": "这次无法确认所有问答都已保存，建议重新尝试。",
  "unresolved-or-unknown-message-role": "部分问答无法可靠识别，建议重新尝试。",
  "legacy-content-not-browser-verified": "这份历史记录没有经过当前浏览器完整性检查。",
  "latest-boundary-unconfirmed": "无法确认最新消息已经保存，建议重新尝试。",
  "conversation-id-not-stable": "读取过程中页面发生变化，建议停留在当前对话后重新尝试。",
  "unexpanded-content-remains": "页面中仍有内容没有展开，建议展开后重新尝试。",
};

function booleanValue(value: boolean | null | undefined) {
  return value === true ? "true" : value === false ? "false" : "unknown";
}

function numberValue(value: number | null | undefined) {
  return typeof value === "number" ? String(value) : "unknown";
}

function evidenceStatus(value: boolean | null | undefined, confirmedText: string): Pick<ResearchCompletenessDetailRow, "status" | "severity"> {
  if (value === true) return { status: `✓ ${confirmedText}`, severity: "complete" };
  if (value === false) return { status: "△ 未确认", severity: "warning" };
  return { status: "尚未确认", severity: "unknown" };
}

function mediaEntries(details: CaptureCompletenessDetails | null | undefined) {
  return Object.entries(details?.unsupportedContentCounts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([type, count]) => ({
      type,
      count: Number(count),
      ...(mediaLabels[type] ?? mediaLabels.unknown),
    }));
}

function groupedMediaEntries(entries: ReturnType<typeof mediaEntries>) {
  const grouped = new Map<string, { count: number; unit: string }>();
  for (const entry of entries) {
    const current = grouped.get(entry.label);
    grouped.set(entry.label, { count: (current?.count ?? 0) + entry.count, unit: entry.unit });
  }
  return [...grouped.entries()].map(([label, value]) => ({ label, ...value }));
}

function mediaNotice(entries: ReturnType<typeof groupedMediaEntries>, verb: "读取" | "保存") {
  if (!entries.length) return `还有部分图片和文件没有完整${verb}`;
  const summary = entries
    .map((entry) => `${entry.count} ${entry.unit}${entry.label}`)
    .join("、");
  return `还有 ${summary}没有完整${verb}`;
}

function detailRow(
  label: string,
  value: boolean | null | undefined,
  confirmedText: string,
  confirmedDescription: string,
  unconfirmedDescription: string,
): ResearchCompletenessDetailRow {
  const status = evidenceStatus(value, confirmedText);
  return {
    label,
    ...status,
    description: value === true ? confirmedDescription : unconfirmedDescription,
  };
}

export function createResearchCompletenessPresentation({
  completeness,
  details,
  messageCount,
  context,
  captureAdapter = null,
}: ResearchCompletenessPresentationInput): ResearchCompletenessPresentation {
  const action = context === "preview" ? "读取" : "保存";
  const textKnown = typeof details?.textTranscriptComplete === "boolean";
  const richKnown = typeof details?.richContentComplete === "boolean";
  const textComplete = details?.textTranscriptComplete ?? completeness === "complete";
  const richComplete = details?.richContentComplete ?? completeness === "complete";
  const failed = completeness === "failed";
  const entries = groupedMediaEntries(mediaEntries(details));

  let headline: string;
  let messageSummary: string;
  let notice: string | null = null;
  let guidance: string | null = null;
  let severity: ResearchCompletenessSeverity;
  let compactLabel: string;

  if (failed) {
    headline = context === "preview" ? "× 没有读取成功" : "× 没有保存成功";
    messageSummary = context === "preview" ? "这次没有成功读取当前对话。" : "这次没有成功保存当前对话。";
    guidance = context === "preview" ? "可以重新尝试。" : null;
    severity = "failed";
    compactLabel = "保存失败";
  } else if (textComplete && richComplete) {
    headline = context === "preview" ? "✓ 已完整读取" : "✓ 已完整保存";
    messageSummary = `共${action} ${messageCount} 条文字消息`;
    severity = "complete";
    compactLabel = "已完整保存";
  } else if (textComplete) {
    headline = context === "preview" ? "✓ 文字问答完整" : "✓ 文字问答已完整保存";
    messageSummary = context === "preview"
      ? `已读取 ${messageCount} 条文字消息`
      : `共保存 ${messageCount} 条文字消息`;
    notice = mediaNotice(entries, action);
    severity = "complete";
    compactLabel = "文字完整";
  } else {
    headline = context === "preview" ? "△ 文字问答可能有缺失" : "△ 文字问答可能有缺失";
    messageSummary = `已${action} ${messageCount} 条文字消息`;
    const reason = details?.reasons.find((item) => reasonGuidance[item]);
    guidance = reason
      ? reasonGuidance[reason]
      : context === "preview" ? "建议重新尝试。" : "建议重新读取并保存。";
    severity = "warning";
    compactLabel = "文字可能缺失";
  }

  const textStatus = textComplete
    ? { status: "✓ 完整", severity: "complete" as const }
    : textKnown
      ? { status: "△ 可能缺失", severity: "warning" as const }
      : { status: "尚未确认", severity: "unknown" as const };
  const detailRows: ResearchCompletenessDetailRow[] = [{
    label: "文字问答",
    ...textStatus,
    description: `${messageCount} 条消息已${action}`,
  }];

  if (richComplete) {
    detailRows.push({
      label: "图片和文件",
      status: `✓ 已完整${action}`,
      description: `没有发现未完整${action}的图片或文件`,
      severity: "complete",
    });
  } else if (entries.length) {
    detailRows.push(...entries.map((entry) => ({
      label: entry.label,
      status: "△ 部分未保存",
      description: `${entry.count} ${entry.unit}${entry.label}未完整${action}`,
      severity: "warning" as const,
    })));
  } else {
    detailRows.push({
      label: "图片和文件",
      status: richKnown ? "△ 部分未保存" : "尚未确认",
      description: richKnown ? `部分图片、文件或页面内容未完整${action}` : "没有可用的保存详情",
      severity: richKnown ? "warning" : "unknown",
    });
  }

  const activeBranch = details?.activeBranchUniquelyValidated;
  detailRows.push(detailRow(
    "当前查看的对话版本",
    activeBranch,
    "已确认",
    "只保留当前查看的回答版本",
    activeBranch === false ? "当前回答版本未确认" : "没有记录回答版本证据",
  ));

  const earliestEvidenceKnown = typeof details?.passiveHistoryExhausted === "boolean"
    || typeof details?.hasPreviousPageFinal === "boolean"
    || typeof details?.firstUserConfirmed === "boolean";
  const earliestConfirmed = earliestEvidenceKnown
    ? details?.passiveHistoryExhausted === true
      && details?.hasPreviousPageFinal === false
      && details?.firstUserConfirmed === true
    : undefined;
  detailRows.push(detailRow(
    "最早一条问答",
    earliestConfirmed,
    "已找到",
    "已确认从对话最早的问答开始",
    earliestConfirmed === false ? "尚未确认已经找到最早问答" : "没有记录最早问答证据",
  ));

  detailRows.push(detailRow(
    "最新一条消息",
    details?.latestBoundaryConfirmed,
    "已找到",
    "已找到对话最新消息",
    details?.latestBoundaryConfirmed === false ? "尚未确认已经包含最新消息" : "没有记录最新消息证据",
  ));

  const audit = details?.orderedHistoryAudit;
  const technicalRows: ResearchCompletenessTechnicalRow[] = [
    { label: "Overall", value: completeness?.toUpperCase() ?? "UNKNOWN" },
    { label: "TextTranscriptComplete", value: textKnown ? booleanValue(details?.textTranscriptComplete) : booleanValue(completeness === "complete" ? true : undefined) },
    { label: "RichContentComplete", value: richKnown ? booleanValue(details?.richContentComplete) : booleanValue(completeness === "complete" ? true : undefined) },
    { label: "PassiveHistoryExhausted", value: booleanValue(details?.passiveHistoryExhausted) },
    { label: "hasPreviousPage", value: booleanValue(details?.hasPreviousPageFinal) },
    { label: "Identity mismatch", value: numberValue(details?.domFingerprintMismatchCount ?? audit?.domFingerprintMismatchCount) },
    { label: "Ordering mismatch", value: numberValue(audit?.domOrderingMismatchCount) },
    { label: "Real text mismatch", value: numberValue(details?.domRealTextMismatchCount ?? audit?.domRealTextMismatchCount) },
    { label: "Adapter", value: captureAdapter ?? "unknown" },
  ];

  return {
    headline,
    messageSummary,
    mediaNotice: notice,
    guidance,
    severity,
    compactLabel,
    detailRows,
    technicalRows,
  };
}
