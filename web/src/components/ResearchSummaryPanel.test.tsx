import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import { TaskboardLanguageProvider } from "../i18n";
import type { ResearchRecordSummary } from "../researchTypes";
import { ResearchSummaryPanel } from "./ResearchSummaryPanel";

const api = vi.hoisted(() => ({
  createResearchRecordSummary: vi.fn(),
  getResearchRecordSummary: vi.fn(),
  updateResearchRecordSummary: vi.fn(),
}));

vi.mock("../researchApi", () => api);

const savedSummary: ResearchRecordSummary = {
  id: "summary-1",
  recordId: "record-1",
  sourceContentVersionId: "content-version-1",
  oneLineSummary: "这份资料解释了长期变化的主要原因。",
  coreContent: "重点一\n重点二",
  keyEvidence: "脱敏证据",
  unresolved: "长期影响仍需确认",
  version: 1,
  createdAt: "2026-09-21T01:00:00.000Z",
  updatedAt: "2026-09-21T01:00:00.000Z",
};

function renderPanel() {
  return render(<TaskboardLanguageProvider language="zh">
    <ResearchSummaryPanel recordId="record-1" sourceContentVersionId="content-version-1" />
  </TaskboardLanguageProvider>);
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("ResearchSummaryPanel", () => {
  it("shows a quiet empty state, saves four fields and displays them", async () => {
    api.getResearchRecordSummary.mockResolvedValue(null);
    api.createResearchRecordSummary.mockResolvedValue(savedSummary);
    renderPanel();

    expect(await screen.findByText("还没有内容总结")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加总结" }));
    fireEvent.change(screen.getByLabelText("一句话总结"), { target: { value: savedSummary.oneLineSummary } });
    fireEvent.change(screen.getByLabelText("核心内容"), { target: { value: savedSummary.coreContent } });
    fireEvent.change(screen.getByLabelText("关键证据"), { target: { value: savedSummary.keyEvidence } });
    fireEvent.change(screen.getByLabelText("尚未确认"), { target: { value: savedSummary.unresolved } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText(savedSummary.oneLineSummary);
    expect(screen.getByText((_text, element) => element?.textContent === savedSummary.coreContent)).toBeTruthy();
    expect(screen.getByText(savedSummary.keyEvidence)).toBeTruthy();
    expect(screen.getByText(savedSummary.unresolved)).toBeTruthy();
    expect(api.createResearchRecordSummary).toHaveBeenCalledWith(
      "record-1",
      "content-version-1",
      expect.objectContaining({ oneLineSummary: savedSummary.oneLineSummary }),
    );
  });

  it("edits an existing Summary with its current version", async () => {
    api.getResearchRecordSummary.mockResolvedValue(savedSummary);
    api.updateResearchRecordSummary.mockResolvedValue({
      ...savedSummary, oneLineSummary: "修改后的总结。", version: 2,
    });
    renderPanel();

    expect(await screen.findByText(savedSummary.oneLineSummary)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("一句话总结"), { target: { value: "修改后的总结。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("修改后的总结。")).toBeTruthy();
    expect(api.updateResearchRecordSummary).toHaveBeenCalledWith(
      savedSummary,
      expect.objectContaining({ oneLineSummary: "修改后的总结。" }),
    );
  });

  it("keeps the editor open and explains a stale edit in plain language", async () => {
    api.getResearchRecordSummary.mockResolvedValue(savedSummary);
    api.updateResearchRecordSummary.mockRejectedValue(new ApiError(409, {
      error: { code: "RESEARCH_SUMMARY_VERSION_CONFLICT", message: "conflict" },
    }));
    renderPanel();

    await screen.findByText(savedSummary.oneLineSummary);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("内容已经发生变化，请重新载入后再编辑。")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
  });
});
