import { describe, expect, it } from "vitest";

import { captureCompletenessPresentation } from "./researchCaptureLabels";
import type { CaptureCompletenessDetails } from "./researchTypes";

function details(textTranscriptComplete: boolean, richContentComplete: boolean) {
  return { textTranscriptComplete, richContentComplete } as CaptureCompletenessDetails;
}

describe("capture completeness presentation", () => {
  it("keeps the overall status partial while confirming complete text", () => {
    const result = captureCompletenessPresentation("partial", details(true, false));

    expect(result.overallLabel).toBe("△ 部分完整");
    expect(result.textLabel).toBe("✓ 完整");
    expect(result.richLabel).toBe("△ 部分保存");
    expect(result.partialHeading).toBe("文字问答完整，富媒体未完整归档");
  });

  it("does not claim the text is complete when the proof is missing", () => {
    const result = captureCompletenessPresentation("partial", details(false, false));

    expect(result.textLabel).toBe("△ 未确认完整");
    expect(result.partialHeading).toBe("为什么文字问答仍未确认完整");
  });

  it("shows overall complete only when the saved status is complete", () => {
    const result = captureCompletenessPresentation("complete", details(true, true));

    expect(result.overallLabel).toBe("✓ 完整");
    expect(result.textLabel).toBe("✓ 完整");
    expect(result.richLabel).toBe("✓ 完整归档");
  });
});
