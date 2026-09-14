import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { applyCognitionUpdate, reloadCognitionUpdate, updateCognitionUpdate } from "../researchApi";

vi.mock("../researchApi", () => ({
  applyCognitionUpdate: vi.fn(), reloadCognitionUpdate: vi.fn(),
  updateCognitionUpdate: vi.fn(), rejectCognitionUpdate: vi.fn(),
}));

import type { CognitionUpdate } from "../researchTypes";
import { CognitionUpdateEditor } from "./CognitionUpdateEditor";

const update: CognitionUpdate = {
  id: "update-1",
  topicId: "topic-1",
  recordId: "record-1",
  sourceContentVersionId: "content-version-1",
  sourceContentVersionNumber: 1,
  sourceRecordVersion: 2,
  sourceContext: { title: "研究资料", provider: "chatgpt", kind: "chat" },
  sourceRecordTitle: "研究资料",
  sourceDeleted: false,
  updateType: "add",
  newInformation: "",
  impact: "",
  baseCurrentView: "原来的观点",
  proposedCurrentView: "原来的观点",
  baseTopicVersion: 3,
  status: "draft",
  version: 1,
  createdAt: "2026-09-13T00:00:00.000Z",
  updatedAt: "2026-09-13T00:00:00.000Z",
  appliedAt: null,
  appliedTopicVersion: null,
  rejectedAt: null,
};

afterEach(cleanup);

describe("CognitionUpdateEditor", () => {
  it("reloads explicitly after conflict, preserves thinking and resets the proposal", async () => {
    vi.mocked(updateCognitionUpdate).mockImplementation(async (draft, changes) => ({ ...draft, ...changes, version: draft.version + 1 }));
    vi.mocked(applyCognitionUpdate).mockRejectedValue(new ApiError(409, { error: { code: "COGNITION_TOPIC_VERSION_CONFLICT", message: "conflict" } }));
    vi.mocked(reloadCognitionUpdate).mockImplementation(async (draft) => ({ ...draft, baseCurrentView: "最新观点", proposedCurrentView: "最新观点", baseTopicVersion: 4, version: draft.version + 1 }));
    render(<CognitionUpdateEditor initialUpdate={update} onClose={() => {}} onApplied={() => {}} />);
    fireEvent.change(screen.getByLabelText("新信息"), { target: { value: "我的新信息" } });
    fireEvent.change(screen.getByLabelText("判断变化"), { target: { value: "我的思考" } });
    fireEvent.change(screen.getByLabelText("新的观点"), { target: { value: "旧思路写的结果" } });
    fireEvent.click(screen.getByRole("button", { name: "更新观点" }));
    await screen.findByText("当前观点已经发生变化");
    expect((screen.getByRole("button", { name: "更新观点" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新载入最新观点" }));
    await screen.findByText("已载入最新观点，请重新确认“新的观点”。");
    expect((screen.getByLabelText("新信息") as HTMLTextAreaElement).value).toBe("我的新信息");
    expect((screen.getByLabelText("判断变化") as HTMLTextAreaElement).value).toBe("我的思考");
    expect((screen.getByLabelText("新的观点") as HTMLTextAreaElement).value).toBe("最新观点");
    await waitFor(() => expect((screen.getByRole("button", { name: "更新观点" }) as HTMLButtonElement).disabled).toBe(false));
    expect(vi.mocked(reloadCognitionUpdate).mock.calls[0][0].version).toBe(3);
  });
  it("uses plain-language prompts and keeps Current View unchanged for UNCERTAIN", () => {
    render(<CognitionUpdateEditor initialUpdate={update} onClose={() => {}} onApplied={() => {}} />);
    expect(screen.getByRole("heading", { name: "更新认知" })).toBeTruthy();
    expect(screen.getByLabelText("新信息")).toBeTruthy();
    expect(screen.getByLabelText("判断变化")).toBeTruthy();
    expect(screen.getByLabelText("新的观点")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "暂不调整" }));
    expect(screen.queryByLabelText("新的观点")).toBeNull();
    expect(screen.getByRole("button", { name: "记录影响" })).toBeTruthy();
  });
});
