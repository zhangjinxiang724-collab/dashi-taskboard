import { describe, expect, it } from "vitest";
import {
  parseChatGptConversationPath,
  parseChatGptConversationUrl,
} from "../src/model/chatgpt-conversation-url";

describe("ChatGPT conversation URL parser", () => {
  it("accepts a standard conversation", () => {
    expect(parseChatGptConversationPath("/c/conversation-id")).toEqual({
      conversationId: "conversation-id",
      kind: "standard",
      projectId: null,
    });
  });

  it("accepts a Project conversation and keeps the two ids separate", () => {
    expect(parseChatGptConversationPath("/g/g-p-project-id/c/conversation-id")).toEqual({
      conversationId: "conversation-id",
      kind: "project",
      projectId: "g-p-project-id",
    });
  });

  it.each([
    "/g/g-p-project-id",
    "/library",
    "/settings",
    "/",
  ])("rejects a non-conversation page: %s", (pathname) => {
    expect(parseChatGptConversationPath(pathname)).toBeNull();
  });

  it("rejects unrelated hosts and extra path segments", () => {
    expect(parseChatGptConversationUrl("https://example.com/c/conversation-id")).toBeNull();
    expect(parseChatGptConversationUrl("https://chatgpt.com/g/g-p-project-id/c/conversation-id/extra")).toBeNull();
  });
});
