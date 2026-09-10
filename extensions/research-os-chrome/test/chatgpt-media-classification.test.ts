// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { collectVisibleMessages } from "../src/adapters/chatgpt-browser-v1";

describe("ChatGPT unsupported content classification", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("classifies media by semantic type", () => {
    document.body.innerHTML = `<article data-message-author-role="assistant" data-message-id="m1">
      <div data-message-content><p>正文</p><img alt="图表"><video></video><audio></audio><canvas></canvas></div>
    </article>`;
    const result = collectVisibleMessages();
    expect(result.unsupportedContentCounts).toMatchObject({ image: 1, video: 1, audio: 1, canvas: 1 });
    expect(result.unsupportedContentCount).toBe(4);
  });

  it("does not count a nested attachment and its image twice", () => {
    document.body.innerHTML = `<article data-message-author-role="assistant" data-message-id="m1">
      <div data-message-content><div class="attachment-card" aria-label="研究附件"><img alt="预览图"></div></div>
    </article>`;
    const result = collectVisibleMessages();
    expect(result.unsupportedContentCount).toBe(1);
    expect(result.unsupportedContentCounts.file).toBe(1);
    expect(result.unsupportedContentCounts.image).toBe(0);
    expect(result.messages[0].parts.filter((part) => part.type === "media-placeholder")).toHaveLength(1);
  });

  it("excludes citation chips and visually hidden labels from comparison text without removing prose links or code", () => {
    document.body.innerHTML = `<article data-message-author-role="assistant" data-message-id="m1">
      <div data-message-content>
        <span class="sr-only">ChatGPT said:</span>
        <p>正文 <a href="https://example.test/body">正文链接</a> <code>alpha_beta()</code></p>
        <span data-testid="citation-chip"><a href="https://example.test/source">来源卡片</a></span>
      </div>
    </article>`;
    const result = collectVisibleMessages();
    expect(result.messages[0].comparisonText).toContain("正文");
    expect(result.messages[0].comparisonText).toContain("正文链接");
    expect(result.messages[0].comparisonText).toContain("alpha_beta()");
    expect(result.messages[0].comparisonText).not.toContain("ChatGPT said:");
    expect(result.messages[0].comparisonText).not.toContain("来源卡片");
  });
});
