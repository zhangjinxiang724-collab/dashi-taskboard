import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createResearchCompletenessPresentation } from "../researchCompletenessPresentation";
import type { CaptureCompletenessDetails } from "../researchTypes";
import { ResearchCompletenessPanel } from "./ResearchCompletenessPanel";

describe("ResearchCompletenessPanel", () => {
  it("shows the plain conclusion first and keeps both detail levels closed", () => {
    const details = {
      textTranscriptComplete: true,
      richContentComplete: false,
      unsupportedContentCounts: { image: 2 },
      reasons: ["unsupported-content-present"],
    } as CaptureCompletenessDetails;
    const presentation = createResearchCompletenessPresentation({
      completeness: "partial",
      details,
      messageCount: 12,
      context: "reader",
      captureAdapter: "chatgpt-browser-v1",
    });

    const { container } = render(<ResearchCompletenessPanel presentation={presentation} />);

    expect(screen.getByText("文字问答已完整保存")).toBeTruthy();
    expect(screen.getByText("共保存 12 条文字消息")).toBeTruthy();
    expect(screen.getByText("还有 2 张图片没有完整保存")).toBeTruthy();
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect([...container.querySelectorAll("details")].every((item) => !item.open)).toBe(true);
    expect(screen.getByText("查看保存详情")).toBeTruthy();
    expect(screen.getByText("查看技术信息")).toBeTruthy();
  });
});
