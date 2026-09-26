"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { askAssistant, type AssistantResult } from "@/lib/assistant/actions.ts";
import type { AssistantAction, AssistantTurn } from "@/lib/assistant/core.ts";
import { MESSAGE_MAX, SECRET_REFUSAL, looksLikeSecret } from "@/lib/assistant/core.ts";
import { createRun } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";

interface Entry {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  actions?: AssistantAction[];
  fundedBy?: string;
  error?: boolean;
}

const SUGGESTIONS = [
  "What should I do next?",
  "Why did scenarios in my latest run fail?",
  "What does “no result” mean?",
];

/**
 * "Ask Novera" — on every signed-in page.
 *
 * Replies are rendered as plain text, never as HTML: they come from a model. A proposed
 * action is a button the person presses; nothing happens because the model said so.
 */
export function Assistant() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    // Stopped here too, so a pasted key never even reaches our own server; the server
    // checks again regardless. The question is not added to the history.
    if (looksLikeSecret(text)) {
      setDraft("");
      setEntries((prev) => [...prev, { role: "assistant", content: SECRET_REFUSAL, error: true }]);
      return;
    }
    const history: AssistantTurn[] = entries
      .filter((e) => !e.error)
      .map((e) => ({ role: e.role, content: e.content }));
    setEntries((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    startTransition(async () => {
      let result: AssistantResult;
      try {
        result = await askAssistant(history, text);
      } catch {
        result = { error: "The assistant could not be reached. Check your connection and try again." };
      }
      setEntries((prev) => [
        ...prev,
        result.error
          ? { role: "assistant", content: result.error, error: true, fundedBy: result.fundedBy }
          : {
              role: "assistant",
              content: result.reply ?? "",
              citations: result.citations,
              actions: result.actions,
              fundedBy: result.fundedBy,
            },
      ]);
    });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-on-ink shadow-modal transition-[background-color,transform] duration-150 ease-out hover:bg-ink-hover active:scale-[0.98]"
      >
        <span aria-hidden="true" className="text-base leading-none">?</span>
        {open ? "Close" : "Ask Novera"}
      </button>

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          className="fixed bottom-20 right-4 z-40 flex h-[min(34rem,calc(100dvh-7rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-panel border border-line bg-surface/95 shadow-modal backdrop-blur"
        >
          <div className="border-b border-line px-4 py-3">
            <h2 id={titleId} className="font-semibold text-ink">Ask Novera</h2>
            <p className="text-xs leading-relaxed text-ink-soft">
              Knows your workspace and the documentation. It can take you anywhere and offer to start a
              run — you press the button. It cannot change settings, keys, policies or verdicts.
            </p>
          </div>

          <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {entries.length === 0 && (
              <div className="space-y-2">
                <p className="text-ink-soft">Stuck? Ask anything — or start with one of these:</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="block w-full rounded-control border border-line bg-ground px-3 py-2 text-left text-ink hover:border-line-strong hover:bg-sunken"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {entries.map((e, i) => (
              <div key={i} className={e.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    e.role === "user"
                      ? "max-w-[85%] rounded-panel bg-ink px-3 py-2 text-on-ink"
                      : e.error
                        ? "rounded-panel border border-warning-border bg-warning-surface px-3 py-2 text-warning-text"
                        : "rounded-panel border border-line bg-ground px-3 py-2 text-ink"
                  }
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{e.content}</p>

                  {e.citations && e.citations.length > 0 && (
                    <p className="mt-2 text-xs text-ink-soft">
                      Sources:{" "}
                      {e.citations.map((slug, j) => (
                        <span key={slug}>
                          {j > 0 && ", "}
                          <Link href={`/docs/${slug}`} className="underline underline-offset-2 hover:text-ink">
                            {slug}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}

                  {e.actions && e.actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {e.actions.map((a) =>
                        a.type === "navigate" ? (
                          <Link
                            key={a.href}
                            href={a.href}
                            onClick={() => setOpen(false)}
                            className="rounded-control border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-sunken"
                          >
                            {a.label} →
                          </Link>
                        ) : (
                          <form key={a.agentId} action={createRun} className="w-full">
                            <input type="hidden" name="agentId" value={a.agentId} />
                            <SubmitButton size="sm" pendingLabel="Starting…">{a.label}</SubmitButton>
                            <span className="mt-1 block text-xs text-ink-soft">
                              {e.fundedBy === "your own key"
                                ? "Starts a run graded on your own key."
                                : "Uses one of your trial runs."}
                            </span>
                          </form>
                        ),
                      )}
                    </div>
                  )}

                  {e.role === "assistant" && e.fundedBy && (
                    <p className="mt-2 text-[11px] text-ink-faint">Answered on {e.fundedBy}.</p>
                  )}
                </div>
              </div>
            ))}

            {pending && (
              <p role="status" className="text-ink-soft motion-safe:animate-pulse">
                Thinking…
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
            className="border-t border-line p-3"
          >
            <label htmlFor={`${titleId}-q`} className="sr-only">Your question</label>
            <div className="flex items-end gap-2">
              <textarea
                id={`${titleId}-q`}
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(draft);
                  }
                }}
                rows={2}
                maxLength={MESSAGE_MAX}
                placeholder="Ask about your runs, a result, or what to do next…"
                className="min-h-[2.75rem] flex-1 resize-none rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                className="rounded-control bg-ink px-3 py-2 text-sm font-medium text-on-ink hover:bg-ink-hover disabled:bg-ink-ghost"
              >
                Send
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
              Questions go to the same model providers as grading. Your keys and policy text are never sent.
            </p>
          </form>
        </section>
      )}
    </>
  );
}
