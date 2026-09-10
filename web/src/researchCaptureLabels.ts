import type { CaptureCompletenessDetails } from "./researchTypes";

const captureReasonLabels: Record<string, string> = {
  "complete-evidence-insufficient": "现有证据不足以确认对话完整",
  "unresolved-or-unknown-message-role": "存在无法可靠识别角色或分支的消息",
  "no-stable-message-sequence": "没有形成稳定、连续的消息序列",
  "legacy-content-not-browser-verified": "这份历史正文不是由浏览器完整性检查生成",
  "earliest-boundary-unconfirmed": "无法确认已经覆盖到对话最早一条消息",
  "latest-boundary-unconfirmed": "无法确认已经覆盖到对话最新一条消息",
  "older-content-still-loading": "页面仍在加载更早内容",
  "conversation-id-not-stable": "捕获期间无法持续确认同一条 Conversation",
  "unexpanded-content-remains": "页面中仍有未展开内容",
  "unsupported-content-present": "存在只保存了占位说明的媒体或复杂组件",
};

export function captureReasonLabel(reason: string) {
  return captureReasonLabels[reason] ?? reason;
}

export const unsupportedContentLabels: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件",
  canvas: "画布",
  "tool-ui": "工具界面",
  unknown: "其他内容",
};

export function captureCompletenessPresentation(
  completeness: "complete" | "partial" | "failed" | null,
  details: CaptureCompletenessDetails | null | undefined,
) {
  const textKnown = typeof details?.textTranscriptComplete === "boolean";
  const richKnown = typeof details?.richContentComplete === "boolean";
  const textComplete = details?.textTranscriptComplete === true;
  const richComplete = details?.richContentComplete === true;

  return {
    overallLabel: completeness === "complete"
      ? "✓ 完整"
      : completeness === "partial"
        ? "△ 部分完整"
        : completeness === "failed"
          ? "✕ 捕获失败"
          : "正在判断",
    textLabel: textKnown ? (textComplete ? "✓ 完整" : "△ 未确认完整") : "未记录",
    richLabel: richKnown ? (richComplete ? "✓ 完整归档" : "△ 部分保存") : "未记录",
    partialHeading: textComplete && !richComplete
      ? "文字问答完整，富媒体未完整归档"
      : "为什么文字问答仍未确认完整",
  };
}
