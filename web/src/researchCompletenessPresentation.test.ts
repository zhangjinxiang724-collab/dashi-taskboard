import { describe, expect, it } from "vitest";

import { createResearchCompletenessPresentation } from "./researchCompletenessPresentation";
import type { CaptureCompletenessDetails } from "./researchTypes";

function details(overrides: Partial<CaptureCompletenessDetails> = {}) {
  return {
    topBoundaryConfirmed: true,
    stablePasses: 2,
    loadingAbsent: true,
    conversationIdStable: true,
    unresolvedBranches: false,
    unsupportedContentCount: 0,
    reasons: [],
    textTranscriptComplete: true,
    richContentComplete: true,
    activeBranchUniquelyValidated: true,
    passiveHistoryExhausted: true,
    hasPreviousPageFinal: false,
    firstUserConfirmed: true,
    latestBoundaryConfirmed: true,
    ...overrides,
  } satisfies CaptureCompletenessDetails;
}

function present(
  completeness: "complete" | "partial" | "failed",
  completenessDetails: CaptureCompletenessDetails,
  context: "preview" | "reader" | "inbox" = "reader",
) {
  return createResearchCompletenessPresentation({
    completeness,
    details: completenessDetails,
    messageCount: 283,
    context,
    captureAdapter: "chatgpt-browser-v1",
  });
}

describe("Research completeness presentation", () => {
  it("keeps a fully complete record deliberately brief", () => {
    const result = present("complete", details());

    expect(result.headline).toBe("✓ 已完整保存");
    expect(result.messageSummary).toBe("共保存 283 条文字消息");
    expect(result.mediaNotice).toBeNull();
  });

  it("states that text is complete when only images and files are incomplete", () => {
    const result = present("partial", details({
      richContentComplete: false,
      unsupportedContentCount: 37,
      unsupportedContentCounts: { image: 31, file: 6 },
      reasons: ["unsupported-content-present"],
    }));

    expect(result.headline).toBe("✓ 文字问答已完整保存");
    expect(result.mediaNotice).toBe("还有 31 张图片、6 个文件没有完整保存");
  });

  it("makes incomplete text the primary warning and gives a human reason", () => {
    const result = present("partial", details({
      textTranscriptComplete: false,
      richContentComplete: false,
      reasons: ["older-content-still-loading"],
    }));

    expect(result.headline).toBe("△ 文字问答可能有缺失");
    expect(result.guidance).toBe("更早的聊天记录没有全部读取出来，建议重新尝试。");
  });

  it("uses a plain failed state", () => {
    const result = present("failed", details({ textTranscriptComplete: false, richContentComplete: false }));

    expect(result.headline).toBe("× 没有保存成功");
    expect(result.messageSummary).toBe("这次没有成功保存当前对话。");
  });

  it("does not show zero-value media rows", () => {
    const result = present("partial", details({
      richContentComplete: false,
      unsupportedContentCounts: { image: 0, file: 0 },
    }));

    expect(result.detailRows.filter((row) => row.label === "图片" || row.label === "文件")).toHaveLength(0);
    expect(result.mediaNotice).toBe("还有部分图片和文件没有完整保存");
  });

  it("mentions only images when only images are missing", () => {
    const result = present("partial", details({
      richContentComplete: false,
      unsupportedContentCounts: { image: 2 },
    }));

    expect(result.mediaNotice).toBe("还有 2 张图片没有完整保存");
    expect(result.mediaNotice).not.toContain("文件");
  });

  it("mentions only files when only files are missing", () => {
    const result = present("partial", details({
      richContentComplete: false,
      unsupportedContentCounts: { file: 3 },
    }));

    expect(result.mediaNotice).toBe("还有 3 个文件没有完整保存");
    expect(result.mediaNotice).not.toContain("图片");
  });

  it("uses read wording in Preview and saved wording in Reader", () => {
    const preview = present("partial", details({ richContentComplete: false }), "preview");
    const reader = present("partial", details({ richContentComplete: false }), "reader");

    expect(preview.headline).toBe("✓ 文字问答完整");
    expect(reader.headline).toBe("✓ 文字问答已完整保存");
    expect(preview.compactLabel).toBe(reader.compactLabel);
  });

  it("uses the short Preview failure wording", () => {
    const result = present("failed", details({ textTranscriptComplete: false, richContentComplete: false }), "preview");

    expect(result.headline).toBe("× 没有读取成功");
    expect(result.messageSummary).toBe("这次没有成功读取当前对话。");
    expect(result.guidance).toBe("可以重新尝试。");
  });

  it("keeps Inbox labels compact while using the same underlying facts", () => {
    expect(present("complete", details(), "inbox").compactLabel).toBe("已完整保存");
    expect(present("partial", details({ richContentComplete: false }), "inbox").compactLabel).toBe("文字完整");
    expect(present("partial", details({ textTranscriptComplete: false, richContentComplete: false }), "inbox").compactLabel).toBe("文字可能缺失");
  });

  it("reports positive evidence only when every underlying fact is true", () => {
    const result = present("partial", details({
      richContentComplete: false,
      firstUserConfirmed: true,
      passiveHistoryExhausted: false,
      hasPreviousPageFinal: false,
      latestBoundaryConfirmed: undefined,
    }));

    expect(result.detailRows.find((row) => row.label === "最早一条问答")?.status).toBe("△ 未确认");
    expect(result.detailRows.find((row) => row.label === "最新一条消息")?.status).toBe("尚未确认");
  });
});
