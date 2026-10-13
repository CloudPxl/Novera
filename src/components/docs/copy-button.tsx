"use client";

import { useRef, useState } from "react";
import styles from "./code-block.module.css";

/**
 * Copies the text of the code block it is given. The text is a prop (the same string the
 * block renders), so what lands on the clipboard is what is on the page, byte for byte.
 * Without `navigator.clipboard` — an insecure origin, an old browser — it selects the
 * block's text instead, so the reader can press the copy shortcut themselves.
 */
export function CopyButton({ text, targetId }: { text: string; targetId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    let next: "copied" | "selected" = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.getElementById(targetId);
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      next = "selected";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <>
      <button type="button" className={styles.copy} onClick={copy} aria-label="Copy code">
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      {/* A live region, so the result is announced; the button's own name does not change. */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? "Copied" : state === "selected" ? "Copying is not available here; the code is selected, press the copy shortcut" : ""}
      </span>
    </>
  );
}
