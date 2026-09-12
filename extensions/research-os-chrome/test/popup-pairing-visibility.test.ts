import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const popupHtml = readFileSync(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const popupCss = readFileSync(new URL("../src/popup/popup.css", import.meta.url), "utf8");

describe("Research OS popup pairing visibility", () => {
  it("keeps the pairing section hidden after a persisted connection hydrates", () => {
    const dom = new JSDOM(popupHtml, { pretendToBeVisual: true });
    const style = dom.window.document.createElement("style");
    style.textContent = popupCss;
    dom.window.document.head.append(style);

    const pairing = dom.window.document.querySelector<HTMLElement>("#pairing")!;
    const capture = dom.window.document.querySelector<HTMLElement>("#capture")!;

    // Mirrors popup.refresh() when get-extension-state returns paired: true.
    pairing.hidden = true;
    capture.hidden = false;

    expect(dom.window.getComputedStyle(pairing).display).toBe("none");
    expect(dom.window.getComputedStyle(capture).display).toBe("grid");
  });
});
