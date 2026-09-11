import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskboardLanguageProvider } from "../i18n";
import type { BrowserCapturePreview, ResearchInboxItem, ResearchRecordContent, Topic } from "../researchTypes";
import { ResearchCapturePreview } from "./ResearchCapturePreview";
import { ResearchImporter } from "./ResearchImporter";
import { ResearchInbox } from "./ResearchInbox";

const api = vi.hoisted(() => ({
  assignResearchRecordsToTopic: vi.fn(),
  confirmBrowserCapturePreview: vi.fn(),
  createChatGptImportPreview: vi.fn(),
  createTopicAndAssignResearchRecords: vi.fn(),
  deleteResearchRecord: vi.fn(),
  getBrowserCapturePreview: vi.fn(),
  getImportPreview: vi.fn(),
  getResearchInboxSummary: vi.fn(),
  getResearchRecordContent: vi.fn(),
  getSelectableImportPreviewKeys: vi.fn(),
  listResearchImportSessions: vi.fn(),
  listResearchInbox: vi.fn(),
  listResearchRecordContentVersions: vi.fn(),
  listTopics: vi.fn(),
  undoResearchImportSession: vi.fn(),
  confirmResearchImport: vi.fn(),
}));

vi.mock("../researchApi", () => api);

const topic: Topic = {
  id: "topic-bsx",
  title: "BSX 长期投资研究",
  status: "active",
  coreQuestion: "",
  currentView: "",
  confidenceLevel: "medium",
  nextAction: "",
  reviewTrigger: "",
  labels: [],
  lastResearchedAt: null,
  openQuestionCount: 0,
  version: 1,
  createdAt: "2026-08-29T08:00:00.000Z",
  updatedAt: "2026-08-29T08:00:00.000Z",
};

const record: ResearchInboxItem = {
  id: "record-browser",
  topicId: null,
  title: "伯克希尔深度研究",
  provider: "chatgpt",
  kind: "deep_research",
  url: "https://chatgpt.com/c/example",
  externalId: "example",
  summary: "",
  note: "",
  occurredAt: "2026-08-29T08:00:00.000Z",
  captureAdapter: "chatgpt-browser-v1",
  captureCompleteness: "partial",
  lastCapturedAt: "2026-08-29T08:00:00.000Z",
  version: 1,
  deletedAt: null,
  createdAt: "2026-08-29T08:00:00.000Z",
  updatedAt: "2026-08-29T08:00:00.000Z",
  preview: "这是一条可能不完整、但仍可阅读和整理的研究记录。",
  contentAvailable: true,
  messageCount: 2,
  completenessDetails: {
    topBoundaryConfirmed: true,
    stablePasses: 2,
    loadingAbsent: true,
    conversationIdStable: true,
    unresolvedBranches: false,
    unsupportedContentCount: 1,
    unsupportedContentCounts: { image: 1 },
    reasons: ["unsupported-content-present"],
    textTranscriptComplete: true,
    richContentComplete: false,
  },
};

const content: ResearchRecordContent = {
  recordId: record.id,
  content: {
    version: "1",
    externalId: record.externalId,
    title: record.title,
    messages: [
      { id: "m1", role: "user", parts: [{ type: "text", text: "研究伯克希尔。" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "先看资本配置。" }] },
    ],
  },
  contentHash: "hash",
  messageCount: 2,
  omittedMessageCount: 0,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  versionId: "version-1",
  versionNumber: 1,
  captureAdapter: "chatgpt-browser-v1",
  completeness: "partial",
  completenessDetails: {
    topBoundaryConfirmed: false,
    stablePasses: 2,
    loadingAbsent: true,
    conversationIdStable: true,
    unresolvedBranches: false,
    unsupportedContentCount: 0,
    reasons: ["top-boundary-unconfirmed"],
  },
  relationToPrevious: "initial",
  capturedAt: "2026-08-29T08:00:00.000Z",
};

function renderChinese(element: React.ReactNode) {
  return render(<TaskboardLanguageProvider language="zh">{element}</TaskboardLanguageProvider>);
}

describe("Research Inbox entry paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getResearchInboxSummary.mockResolvedValue(1);
    api.listResearchInbox.mockResolvedValue({ total: 1, page: 1, pageSize: 50, records: [record] });
    api.getResearchRecordContent.mockResolvedValue(content);
    api.listResearchRecordContentVersions.mockResolvedValue([]);
    api.assignResearchRecordsToTopic.mockResolvedValue(1);
  });

  afterEach(() => cleanup());

  it("shows source, PARTIAL state, shared Reader, and existing Topic assignment", async () => {
    renderChinese(<ResearchInbox topics={[topic]} onCountChange={() => {}} onTopicCreated={() => {}} />);

    expect(await screen.findByText("伯克希尔深度研究")).toBeTruthy();
    expect(screen.getByText("文字完整")).toBeTruthy();
    expect(screen.getByText(/ChatGPT · 深度研究 · 浏览器读取/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看正文" }));
    expect(await screen.findByRole("button", { name: /返回待整理记录/ })).toBeTruthy();
    expect(await screen.findByText("研究伯克希尔。")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("dialog", { name: "研究记录正文" })).getByRole("button", { name: "归入主题" }));
    fireEvent.click(await screen.findByRole("button", { name: /BSX 长期投资研究/ }));
    await waitFor(() => expect(api.assignResearchRecordsToTopic).toHaveBeenCalledWith([record.id], topic.id));
  });

  it("distinguishes text-complete and text-incomplete Inbox records", async () => {
    api.listResearchInbox.mockResolvedValue({
      total: 2,
      page: 1,
      pageSize: 50,
      records: [record, {
        ...record,
        id: "record-incomplete",
        title: "文字缺失记录",
        completenessDetails: {
          ...record.completenessDetails!,
          textTranscriptComplete: false,
          richContentComplete: false,
        },
      }],
    });

    renderChinese(<ResearchInbox topics={[topic]} onCountChange={() => {}} onTopicCreated={() => {}} />);

    expect(await screen.findByText("文字完整")).toBeTruthy();
    expect(screen.getByText("文字可能缺失")).toBeTruthy();
    expect(screen.queryByText("可能不完整")).toBeNull();
  });

  it("lets the ChatGPT importer leave its local flow for the global Inbox", () => {
    const onOpenInbox = vi.fn();
    renderChinese(<ResearchImporter topics={[topic]} onClose={() => {}} onOpenInbox={onOpenInbox} />);
    fireEvent.click(screen.getByRole("button", { name: "待整理记录" }));
    expect(onOpenInbox).toHaveBeenCalledTimes(1);
  });

  it("links an unclassified Browser Capture result to the global Inbox", async () => {
    const preview: BrowserCapturePreview = {
      id: "preview-1",
      status: "ready",
      title: "浏览器捕获研究",
      sourceUrl: "https://chatgpt.com/c/example",
      capturedAt: "2026-08-29T08:00:00.000Z",
      messageCount: 2,
      completeness: "complete",
      completenessDetails: null,
      relation: "new",
      existingRecord: null,
      sourceFingerprint: "fingerprint",
      messages: [
        { order: 0, role: "user", sourceMessageId: "m1", occurredAt: null, parts: [{ type: "text", text: "研究问题" }], fingerprint: "m1" },
      ],
    };
    api.getBrowserCapturePreview.mockResolvedValue(preview);
    api.listTopics.mockResolvedValue([topic]);
    api.confirmBrowserCapturePreview.mockResolvedValue({ kind: "created", record, contentVersion: 1 });

    renderChinese(<ResearchCapturePreview previewId={preview.id} />);
    expect(await screen.findByText("对话内容 · 1 条")).toBeTruthy();
    expect(screen.queryByText(/判断：?新对话/)).toBeNull();
    expect(screen.queryByText(/捕获正文/)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    expect(await screen.findByText(/已保存到待整理记录/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "前往研究收件箱" }).getAttribute("href")).toBe("/?researchView=inbox");
  });

  it("shows meaningful append and conflict notices without a generic judgment field", async () => {
    const basePreview: BrowserCapturePreview = {
      id: "preview-existing",
      status: "ready",
      title: "已有对话",
      sourceUrl: "https://chatgpt.com/c/example",
      capturedAt: "2026-08-29T08:00:00.000Z",
      messageCount: 6,
      completeness: "complete",
      completenessDetails: null,
      relation: "append",
      existingRecord: record,
      sourceFingerprint: "fingerprint",
      coverage: {
        existingMessageCount: 4,
        incomingMessageCount: 6,
        mergedMessageCount: 6,
        newCoverageMessageCount: 2,
        earliestBoundaryConfirmed: true,
        latestBoundaryConfirmed: true,
      },
    };
    api.getBrowserCapturePreview.mockResolvedValue(basePreview);
    api.listTopics.mockResolvedValue([topic]);

    const rendered = renderChinese(<ResearchCapturePreview previewId={basePreview.id} />);
    expect(await screen.findByText("发现之前保存过这条对话。这次会补充 2 条新消息。")).toBeTruthy();
    expect(screen.queryByText("判断")).toBeNull();

    rendered.unmount();
    api.getBrowserCapturePreview.mockResolvedValue({ ...basePreview, id: "preview-conflict", relation: "conflict" });
    renderChinese(<ResearchCapturePreview previewId="preview-conflict" />);
    expect(await screen.findByText("发现之前保存的内容发生变化，需要确认。")).toBeTruthy();
  });
});
