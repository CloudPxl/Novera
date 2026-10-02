"use client";

import { useCallback, useEffect, useRef, type FormEvent } from "react";

/**
 * A refused form keeps what the person typed.
 *
 * React 19 resets an uncontrolled form once its action finishes — success or not. On a
 * refusal that meant the connect form came back empty after "could not be resolved",
 * request body and all (measured 2026-10-02): the person is told what was wrong and has
 * to type everything again to fix one field.
 *
 * The form's fields are copied as it is submitted and put back if the action's state
 * comes back with an `error`. Passwords and secrets typed as passwords are never copied
 * or restored — a refused credential is typed again — and neither are files.
 */
type Saved = Array<{ name: string; index: number; value?: string; checked?: boolean }>;
const SKIP = new Set(["password", "file", "hidden", "submit", "button", "reset", "image"]);
type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function useKeepValuesOnError(state: { error?: string | null } | null | undefined) {
  // Set in the submit handler, read after the action settles; never during render.
  const saved = useRef<{ form: HTMLFormElement; snap: Saved } | null>(null);

  const capture = useCallback((event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const seen = new Map<string, number>();
    const snap: Saved = [];
    for (const el of Array.from(form.elements) as Control[]) {
      if (!("name" in el) || !el.name || !("value" in el)) continue;
      const type = el instanceof HTMLInputElement ? el.type : "";
      const index = seen.get(el.name) ?? 0;
      seen.set(el.name, index + 1);
      if (SKIP.has(type)) continue;
      snap.push(type === "checkbox" || type === "radio"
        ? { name: el.name, index, checked: (el as HTMLInputElement).checked }
        : { name: el.name, index, value: el.value });
    }
    saved.current = { form, snap };
  }, []);

  useEffect(() => {
    const s = saved.current;
    if (!state?.error || !s) return;
    for (const item of s.snap) {
      const el = s.form.querySelectorAll<Control>(`[name="${CSS.escape(item.name)}"]`)[item.index];
      if (!el) continue;
      if (item.checked !== undefined && el instanceof HTMLInputElement) el.checked = item.checked;
      else if (item.value !== undefined) el.value = item.value;
    }
  }, [state]);

  return capture;
}
