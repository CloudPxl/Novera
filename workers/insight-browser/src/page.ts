import type { Frame, Locator, Page } from "playwright";
import { pickConsent, pickInput, pickLauncher, pickSend, type ButtonDescriptor, type InputDescriptor } from "./score.ts";
import type { PageFacts, ScopeFacts } from "./guards.ts";

/**
 * The browser half: gathers facts from every frame (open shadow roots included) and performs
 * the few actions the worker takes — one consent click, one launcher click, typing a prompt and
 * sending it. Every decision is made by the pure modules from what this reports.
 *
 * Elements are marked with `data-novera-*` attributes so a locator can find them again; nothing
 * else on the page is changed.
 */

/** Runs inside the page: every candidate input and button in this document, through open shadow roots. */
function collectInFrame(frameIndex: number) {
  const inputs: Array<Omit<InputDescriptor, "frameIndex">> = [];
  const buttons: Array<Omit<ButtonDescriptor, "frameIndex">> = [];
  let inputCount = 0;
  let buttonCount = 0;
  const vh = window.innerHeight;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const labelOf = (el: Element) => {
    const aria = el.getAttribute("aria-label") ?? "";
    const title = el.getAttribute("title") ?? "";
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled ? labelled.split(/\s+/).map((id) => (el.getRootNode() as Document | ShadowRoot).getElementById?.(id)?.textContent ?? "").join(" ") : "";
    return `${aria} ${title} ${byId}`.trim().slice(0, 200);
  };
  const walk = (root: Document | ShadowRoot, inShadow: boolean) => {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) walk(el.shadowRoot, true);
      const tag = el.tagName.toLowerCase();
      const editable = (el as HTMLElement).isContentEditable && el.getAttribute("contenteditable") !== null;
      if (tag === "textarea" || tag === "input" || editable) {
        const i = inputCount++;
        el.setAttribute("data-novera-input", `${frameIndex}-${i}`);
        const r = el.getBoundingClientRect();
        const field = el as HTMLInputElement;
        inputs.push({
          index: i, inShadow,
          tag: tag === "textarea" ? "textarea" : tag === "input" ? "input" : "contenteditable",
          type: tag === "input" ? (el.getAttribute("type") ?? "") : null,
          placeholder: (el.getAttribute("placeholder") ?? el.getAttribute("data-placeholder") ?? "").slice(0, 200),
          label: labelOf(el), name: (el.getAttribute("name") ?? "").slice(0, 100), id: (el.id ?? "").slice(0, 100),
          visible: visible(el), disabled: Boolean(field.disabled), readOnly: Boolean(field.readOnly),
          width: r.width, height: r.height, top: r.top, viewportHeight: vh,
        });
      }
      if (tag === "button" || el.getAttribute("role") === "button" || (tag === "input" && ["submit", "button"].includes(el.getAttribute("type") ?? "")) || (tag === "a" && el.getAttribute("href") === "#")) {
        const i = buttonCount++;
        el.setAttribute("data-novera-button", `${frameIndex}-${i}`);
        buttons.push({ index: i, text: ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100), label: labelOf(el), visible: visible(el) });
      }
    }
  };
  walk(document, false);
  return { inputs, buttons };
}

/** Runs inside the page: the visible text under a root, through open shadow roots, block by block. */
function deepTextInFrame(selector: string | null) {
  const SKIP = new Set(["script", "style", "noscript", "template", "textarea", "input", "select", "option", "svg"]);
  const BLOCK = /^(div|p|li|ul|ol|section|article|header|footer|h[1-6]|br|tr|td|blockquote|pre|form|main|aside)$/;
  const find = (root: Document | ShadowRoot, sel: string): Element | null => {
    const hit = root.querySelector(sel);
    if (hit) return hit;
    for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) { const inner = find(el.shadowRoot, sel); if (inner) return inner; }
    return null;
  };
  const start: Node | null = selector ? find(document, selector) : document.body;
  if (!start) return "";
  const parts: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { parts.push(node.textContent ?? ""); return; }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const el = node as Element;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) return;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return;
      if ((el as HTMLElement).hidden) return;
    }
    if ((el as Element).shadowRoot) visit((el as Element).shadowRoot as ShadowRoot);
    for (const child of Array.from(node.childNodes)) visit(child);
    if (node.nodeType === Node.ELEMENT_NODE && BLOCK.test((el as Element).tagName.toLowerCase())) parts.push("\n");
  };
  visit(start);
  return parts.join("").replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 200_000);
}

/** Runs inside the page: marks the widget's scope — the input's shadow host, or its smallest container that is not the whole page. */
function markScopeInFrame(inputMarker: string) {
  const find = (root: Document | ShadowRoot): Element | null => {
    const hit = root.querySelector(`[data-novera-input="${inputMarker}"]`);
    if (hit) return hit;
    for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) { const inner = find(el.shadowRoot); if (inner) return inner; }
    return null;
  };
  const input = find(document);
  if (!input) return null;
  for (const el of Array.from(document.querySelectorAll("[data-novera-scope]"))) el.removeAttribute("data-novera-scope");
  const root = input.getRootNode();
  let scope: Element;
  if (root instanceof ShadowRoot) {
    scope = root.host;
  } else {
    const area = window.innerWidth * window.innerHeight;
    scope = document.body;
    let el: Element | null = input.parentElement;
    for (let depth = 0; el && el !== document.body && depth < 8; depth++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > area * 0.6) break;
      if ((el.textContent ?? "").trim().length > 0) scope = el;
    }
  }
  scope.setAttribute("data-novera-scope", "1");
  return { tag: scope.tagName.toLowerCase(), id: scope.id || null, inShadow: root instanceof ShadowRoot };
}

/** Runs inside the page: login and payment fields and the text inside the widget's scope. */
function scopeFactsInFrame() {
  const find = (root: Document | ShadowRoot): Element | null => {
    const hit = root.querySelector("[data-novera-scope]");
    if (hit) return hit;
    for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) { const inner = find(el.shadowRoot); if (inner) return inner; }
    return null;
  };
  const scope = find(document) ?? document.body;
  const all: Element[] = [];
  const gather = (root: Element | ShadowRoot) => {
    for (const el of Array.from(root.querySelectorAll("*"))) { all.push(el); if (el.shadowRoot) gather(el.shadowRoot); }
  };
  gather(scope);
  if (scope.shadowRoot) gather(scope.shadowRoot);
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let passwordInputs = 0, cardInputs = 0, paymentFrames = 0;
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input" && shown(el)) {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      const auto = (el.getAttribute("autocomplete") ?? "").toLowerCase();
      const named = `${el.getAttribute("name") ?? ""} ${el.id ?? ""}`.toLowerCase();
      if (type === "password" || auto === "current-password" || auto === "new-password") passwordInputs++;
      else if (auto.startsWith("cc-") || /card.?num|cardnumber|cc-?num|\bcvc\b|\bcvv\b/.test(named)) cardInputs++;
    }
    if (tag === "iframe" && shown(el) && /stripe|adyen|braintree|checkout|paypal|klarna|mollie/i.test(el.getAttribute("src") ?? "")) paymentFrames++;
  }
  const text = ((scope as HTMLElement).innerText ?? scope.textContent ?? "").slice(0, 5000);
  return { passwordInputs, cardInputs, paymentFrames, text };
}

/** Runs inside the page: what a challenge page looks like. */
function pageFactsInFrame() {
  return {
    title: document.title ?? "",
    text: (document.body?.innerText ?? "").slice(0, 4000),
    hasChallengeForm: Boolean(document.querySelector("#challenge-form, #challenge-stage, #cf-challenge-running, form#challenge-form")),
    iframeSrcs: Array.from(document.querySelectorAll("iframe")).map((f) => f.getAttribute("src") ?? "").slice(0, 50),
  };
}

export interface Widget {
  frame: Frame;
  frameIndex: number;
  input: Locator;
  descriptor: InputDescriptor;
  marker: string;
  selectorPath: string;
  frameOrigin: string | null;
  vendor: string | null;
}

const VENDORS: Array<[RegExp, string]> = [
  [/intercom/i, "intercom"], [/drift/i, "drift"], [/zendesk|zdassets/i, "zendesk"], [/crisp/i, "crisp"], [/tidio/i, "tidio"],
  [/hubspot|hs-scripts|hsforms/i, "hubspot"], [/livechat/i, "livechat"], [/freshchat|freshworks/i, "freshchat"], [/botpress/i, "botpress"],
  [/voiceflow/i, "voiceflow"], [/chatbase/i, "chatbase"], [/dialogflow|df-messenger/i, "dialogflow"], [/rasa/i, "rasa"],
  [/botframework|copilot|powervirtualagents/i, "copilot-studio"],
];

function vendorOf(frameUrl: string, descriptor: InputDescriptor): string | null {
  const hay = `${frameUrl} ${descriptor.id} ${descriptor.name}`;
  return VENDORS.find(([re]) => re.test(hay))?.[1] ?? null;
}

async function collect(page: Page) {
  const frames = page.frames();
  const inputs: InputDescriptor[] = [];
  const buttons: ButtonDescriptor[] = [];
  for (const [frameIndex, frame] of frames.entries()) {
    try {
      const found = await frame.evaluate(collectInFrame, frameIndex);
      for (const i of found.inputs) inputs.push({ ...i, frameIndex });
      for (const b of found.buttons) buttons.push({ ...b, frameIndex });
    } catch { /* a frame that went away, or one we cannot read: skipped */ }
  }
  return { frames, inputs, buttons };
}

async function clickButton(frames: Frame[], b: ButtonDescriptor): Promise<boolean> {
  try {
    await frames[b.frameIndex].locator(`[data-novera-button="${b.frameIndex}-${b.index}"]`).first().click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function pageFacts(page: Page): Promise<PageFacts> {
  try {
    return await page.mainFrame().evaluate(pageFactsInFrame);
  } catch {
    return { title: "", text: "", hasChallengeForm: false, iframeSrcs: [] };
  }
}

/** One acceptance click on a cookie banner in the top frame, if there is one. */
export async function acceptConsentOnce(page: Page): Promise<boolean> {
  const { frames, buttons } = await collect(page);
  const consent = pickConsent(buttons);
  if (!consent) return false;
  const clicked = await clickButton(frames, consent);
  if (clicked) await page.waitForTimeout(500);
  return clicked;
}

/** Finds the chat input; if none, presses one launcher and looks again for a few seconds. */
export async function discoverWidget(page: Page, waitMs = 6000): Promise<Widget | null> {
  const attempt = async () => {
    const { frames, inputs, buttons } = await collect(page);
    const picked = pickInput(inputs);
    return { frames, picked, buttons };
  };
  const first = await attempt();
  let { frames, picked } = first;
  if (!picked) {
    const launcher = pickLauncher(first.buttons);
    if (launcher) {
      await clickButton(frames, launcher);
      const until = Date.now() + waitMs;
      while (!picked && Date.now() < until) {
        await page.waitForTimeout(500);
        ({ frames, picked } = await attempt());
      }
    }
  }
  if (!picked) return null;
  const { descriptor } = picked;
  const frame = frames[descriptor.frameIndex];
  const marker = `${descriptor.frameIndex}-${descriptor.index}`;
  await frame.evaluate(markScopeInFrame, marker).catch(() => null);
  const frameUrl = frame.url();
  let frameOrigin: string | null = null;
  try { frameOrigin = descriptor.frameIndex > 0 ? new URL(frameUrl).origin : null; } catch { frameOrigin = null; }
  const what = descriptor.tag === "input" ? `input[type=${descriptor.type || "text"}]` : descriptor.tag;
  const hint = descriptor.placeholder ? `[placeholder="${descriptor.placeholder.slice(0, 40)}"]` : descriptor.label ? `[aria-label="${descriptor.label.slice(0, 40)}"]` : "";
  const selectorPath = `${descriptor.frameIndex > 0 ? `frame#${descriptor.frameIndex} > ` : ""}${descriptor.inShadow ? "shadow > " : ""}${what}${hint}`;
  return {
    frame, frameIndex: descriptor.frameIndex, descriptor, marker, selectorPath, frameOrigin,
    input: frame.locator(`[data-novera-input="${marker}"]`).first(),
    vendor: vendorOf(frameUrl, descriptor),
  };
}

export async function scopeFacts(widget: Widget): Promise<ScopeFacts> {
  try {
    return await widget.frame.evaluate(scopeFactsInFrame);
  } catch {
    return { passwordInputs: 0, cardInputs: 0, paymentFrames: 0, text: "" };
  }
}

export async function widgetText(widget: Widget): Promise<string> {
  try {
    return await widget.frame.evaluate(deepTextInFrame, "[data-novera-scope]");
  } catch {
    return "";
  }
}

async function inputValue(widget: Widget): Promise<string> {
  try {
    return widget.descriptor.tag === "contenteditable" ? await widget.input.innerText() : await widget.input.inputValue();
  } catch {
    return "";
  }
}

/** Types the prompt exactly and sends it: Enter first, the send button if the text is still in the box. */
export async function sendPrompt(page: Page, widget: Widget, prompt: string): Promise<void> {
  await widget.input.click({ timeout: 5000 });
  if (widget.descriptor.tag === "contenteditable") {
    await page.keyboard.insertText(prompt);
  } else {
    await widget.input.fill(prompt, { timeout: 5000 });
  }
  await widget.input.press("Enter");
  await page.waitForTimeout(800);
  const left = (await inputValue(widget)).trim();
  if (left && left === prompt.trim()) {
    const { frames, buttons } = await collect(page);
    const send = pickSend(buttons.filter((b) => b.frameIndex === widget.frameIndex));
    if (!send || !(await clickButton(frames, send))) throw new Error("The prompt could not be sent: Enter did nothing and no send button was found.");
  }
}
