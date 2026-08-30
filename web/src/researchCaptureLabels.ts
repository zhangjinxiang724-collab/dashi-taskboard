const captureReasonLabels: Record<string, string> = {
  "complete-evidence-insufficient": "现有证据不足以确认对话完整",
  "unresolved-or-unknown-message-role": "存在无法可靠识别角色或分支的消息",
  "no-stable-message-sequence": "没有形成稳定、连续的消息序列",
  "legacy-content-not-browser-verified": "这份历史正文不是由浏览器完整性检查生成",
};

export function captureReasonLabel(reason: string) {
  return captureReasonLabels[reason] ?? reason;
}
