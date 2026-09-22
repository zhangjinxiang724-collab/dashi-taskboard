import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import { TaskboardLanguageProvider } from "../i18n";
import type { ResearchRecordSummary } from "../researchTypes";
import { ResearchSummaryPanel } from "./ResearchSummaryPanel";

const api = vi.hoisted(() => ({
  createResearchRecordSummary: vi.fn(),
  generateResearchSummaryAiDraft: vi.fn(),
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

function renderPanel(sourceContentVersionId = "content-version-1") {
  return render(<TaskboardLanguageProvider language="zh">
    <ResearchSummaryPanel recordId="record-1" sourceContentVersionId={sourceContentVersionId} />
  </TaskboardLanguageProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

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

  it("fills the existing editor with an AI draft but does not save automatically", async () => {
    api.getResearchRecordSummary.mockResolvedValue(null);
    api.generateResearchSummaryAiDraft.mockResolvedValue({
      oneLineSummary: "AI 起草的一句话。",
      coreContent: "AI 核心内容",
      keyEvidence: "AI 证据",
      unresolved: "AI 尚未确认",
      sourceContentVersionId: "content-version-1",
      summaryVersion: null,
      sourceTextComplete: true,
    });
    renderPanel();

    expect(await screen.findByText("还没有内容总结")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    expect(await screen.findByDisplayValue("AI 起草的一句话。")).toBeTruthy();
    expect(screen.getByText("AI 草稿已填入，请检查后再保存。")).toBeTruthy();
    expect(api.createResearchRecordSummary).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("一句话总结"), { target: { value: "人工检查后的总结。" } });
    api.createResearchRecordSummary.mockResolvedValue({ ...savedSummary, oneLineSummary: "人工检查后的总结。" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.createResearchRecordSummary).toHaveBeenCalledWith(
      "record-1",
      "content-version-1",
      expect.objectContaining({ oneLineSummary: "人工检查后的总结。" }),
    ));
  });

  it("does not replace an existing Summary unless the user confirms", async () => {
    api.getResearchRecordSummary.mockResolvedValue(savedSummary);
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPanel();

    expect(await screen.findByText(savedSummary.oneLineSummary)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    expect(window.confirm).toHaveBeenCalledWith("这会用新的 AI 草稿替换当前编辑内容，已保存的总结不会立即改变。");
    expect(api.generateResearchSummaryAiDraft).not.toHaveBeenCalled();
  });

  it("protects unsaved manual edits before replacing them", async () => {
    api.getResearchRecordSummary.mockResolvedValue(null);
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPanel();

    expect(await screen.findByText("还没有内容总结")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加总结" }));
    fireEvent.change(screen.getByLabelText("一句话总结"), { target: { value: "还没保存的人工内容" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    expect(window.confirm).toHaveBeenCalledWith("当前有未保存的修改，继续会替换这些内容。");
    expect(api.generateResearchSummaryAiDraft).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("还没保存的人工内容")).toBeTruthy();
  });

  it("keeps manual edits when AI drafting fails and shows a simple error", async () => {
    api.getResearchRecordSummary.mockResolvedValue(null);
    api.generateResearchSummaryAiDraft.mockRejectedValue(new ApiError(502, {
      error: { code: "RESEARCH_AI_DRAFT_FAILED", message: "internal validator details" },
    }));
    renderPanel();

    expect(await screen.findByText("还没有内容总结")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加总结" }));
    fireEvent.change(screen.getByLabelText("一句话总结"), { target: { value: "人工内容继续保留" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    expect(await screen.findByText("这次 AI 起草没有成功，可以重试或手动填写。")).toBeTruthy();
    expect(screen.getByDisplayValue("人工内容继续保留")).toBeTruthy();
    expect(screen.queryByText("internal validator details")).toBeNull();
  });

  it("discards a V1 AI result after the Reader switches to V2", async () => {
    let resolveDraft!: (value: unknown) => void;
    api.getResearchRecordSummary.mockResolvedValue(null);
    api.generateResearchSummaryAiDraft.mockReturnValue(new Promise((resolve) => { resolveDraft = resolve; }));
    const view = renderPanel("content-version-1");

    expect(await screen.findByText("还没有内容总结")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    view.rerender(<TaskboardLanguageProvider language="zh">
      <ResearchSummaryPanel recordId="record-1" sourceContentVersionId="content-version-2" />
    </TaskboardLanguageProvider>);
    resolveDraft({
      oneLineSummary: "只属于 V1 的草稿",
      coreContent: "",
      keyEvidence: "",
      unresolved: "",
      sourceContentVersionId: "content-version-1",
      summaryVersion: null,
      sourceTextComplete: true,
    });
    await waitFor(() => expect(api.getResearchRecordSummary).toHaveBeenCalledWith("record-1", "content-version-2"));
    expect(screen.queryByDisplayValue("只属于 V1 的草稿")).toBeNull();
  });

  it("keeps the incompleteness warning beside an AI draft", async () => {
    api.getResearchRecordSummary.mockResolvedValue(null);
    api.generateResearchSummaryAiDraft.mockResolvedValue({
      oneLineSummary: "可能不完整的 AI 草稿",
      coreContent: "",
      keyEvidence: "",
      unresolved: "正文可能遗漏。",
      sourceContentVersionId: "content-version-1",
      summaryVersion: null,
      sourceTextComplete: false,
    });
    renderPanel();

    expect(await screen.findByText("还没有内容总结")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    expect(await screen.findByText("这条资料的文字可能不完整，AI 草稿可能遗漏信息。")).toBeTruthy();
  });

  it("passes the saved Summary version to AI drafting and still saves with optimistic concurrency", async () => {
    api.getResearchRecordSummary.mockResolvedValue(savedSummary);
    api.generateResearchSummaryAiDraft.mockResolvedValue({
      oneLineSummary: "新的 AI 草稿",
      coreContent: "",
      keyEvidence: "",
      unresolved: "",
      sourceContentVersionId: savedSummary.sourceContentVersionId,
      summaryVersion: savedSummary.version,
      sourceTextComplete: true,
    });
    api.updateResearchRecordSummary.mockResolvedValue({ ...savedSummary, oneLineSummary: "新的 AI 草稿", version: 2 });
    renderPanel();

    expect(await screen.findByText(savedSummary.oneLineSummary)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    expect(await screen.findByDisplayValue("新的 AI 草稿")).toBeTruthy();
    expect(api.generateResearchSummaryAiDraft).toHaveBeenCalledWith("record-1", "content-version-1", 1);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.updateResearchRecordSummary).toHaveBeenCalledWith(
      savedSummary,
      expect.objectContaining({ oneLineSummary: "新的 AI 草稿" }),
    ));
  });
});
