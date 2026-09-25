import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskboardLanguageProvider } from "../i18n";
import type { CognitionUpdate, Topic, TopicDraft } from "../researchTypes";
import { CognitionUpdateHistory } from "./CognitionUpdateHistory";
import { TopicEditor, visibleResearchStatus } from "./TopicEditor";

const api = vi.hoisted(() => ({
  deleteCognitionDraft: vi.fn(),
  listCognitionUpdates: vi.fn(),
}));
vi.mock("../researchApi", () => api);

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function update(status: CognitionUpdate["status"], id: string): CognitionUpdate {
  return {
    id, status, topicId: "topic-1", recordId: "record-1",
    sourceContentVersionId: "version-1", sourceContentVersionNumber: 1, sourceRecordVersion: 1,
    sourceContext: {}, sourceRecordTitle: "隔离资料", sourceDeleted: false,
    updateType: "revise", newInformation: "发现新资料", impact: "需要修正旧判断",
    baseCurrentView: "旧观点", proposedCurrentView: "新观点",
    baseTopicVersion: 1, version: 1, createdAt: "2026-09-25T00:00:00Z",
    updatedAt: "2026-09-25T00:00:00Z", appliedAt: status === "applied" ? "2026-09-25T00:00:00Z" : null,
    appliedTopicVersion: status === "applied" ? 2 : null,
    rejectedAt: status === "rejected" ? "2026-09-25T00:00:00Z" : null,
  };
}

describe("Research first-use feedback", () => {
  it("shows four everyday statuses and keeps the full draft shape", () => {
    expect(visibleResearchStatus("inbox")).toBe("active");
    expect(visibleResearchStatus("thesis_formed")).toBe("tracking");
    const onSave = vi.fn<(draft: TopicDraft) => void>();
    render(<TaskboardLanguageProvider language="zh"><TopicEditor topic={null} saving={false} error={null} onCancel={() => {}} onSave={onSave} /></TaskboardLanguageProvider>);
    expect(screen.getByLabelText("研究状态").querySelectorAll("option")).toHaveLength(4);
    expect(screen.queryByText("置信度")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("例如：BSX 长期投资研究"), { target: { value: "隔离主题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: "active", confidenceLevel: null }));
  });

  it("does not erase an old status, confidence or current view when editing unrelated fields", () => {
    const oldTopic: Topic = {
      id: "topic-old", title: "旧主题", status: "thesis_formed",
      coreQuestion: "核心问题", currentView: "已经形成的观点", confidenceLevel: "medium",
      nextAction: "", reviewTrigger: "", labels: [], lastResearchedAt: null,
      openQuestionCount: 0, version: 2,
      createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z",
    };
    const onSave = vi.fn<(draft: TopicDraft) => void>();
    render(<TaskboardLanguageProvider language="zh"><TopicEditor topic={oldTopic} saving={false} error={null} onCancel={() => {}} onSave={onSave} /></TaskboardLanguageProvider>);
    expect((screen.getByLabelText("研究状态") as HTMLSelectElement).value).toBe("tracking");
    fireEvent.change(screen.getByDisplayValue("旧主题"), { target: { value: "改名后的主题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "改名后的主题", status: "thesis_formed", confidenceLevel: "medium", currentView: "已经形成的观点",
    }));
  });

  it("separates drafts, shows three recent applied updates, and deletes only a confirmed draft", async () => {
    const draft = update("draft", "draft-1");
    api.listCognitionUpdates.mockResolvedValue([
      draft, ...[1, 2, 3, 4].map((index) => update("applied", `applied-${index}`)),
      update("rejected", "rejected-1"),
    ]);
    api.deleteCognitionDraft.mockResolvedValue(undefined);
    render(<CognitionUpdateHistory topicId="topic-1" currentView="目前观点" onEditDraft={() => {}} />);
    expect(await screen.findByText("待处理认知草稿")).toBeTruthy();
    expect(screen.getAllByText("查看变化详情")).toHaveLength(3);
    expect(screen.getByText("未采用的认知 · 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看全部认知历史（4）" }));
    expect(screen.getAllByText("查看变化详情")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "删除草稿" }));
    expect(api.deleteCognitionDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除草稿" }));
    await waitFor(() => expect(api.deleteCognitionDraft).toHaveBeenCalledWith(draft));
    expect(screen.getByText("认知变化").parentElement?.textContent).toContain("4");
  });
});
