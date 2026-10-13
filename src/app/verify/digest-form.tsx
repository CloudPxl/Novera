import { inputClass } from "@/components/ui/primitives.tsx";
import { buttonClass } from "@/components/ui/button-link.tsx";

/**
 * A plain GET form to `/verify?hash=…`, which redirects to `/verify/<hash>`. No JavaScript:
 * the browser submits it, the server answers.
 */
export function DigestForm({ id = "hash" }: { id?: string }) {
  return (
    <form action="/verify" method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          Report SHA-256
        </label>
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-ink-soft">
          The 64-character digest printed on the report, beside its seal.
        </p>
        <input
          id={id}
          name="hash"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          maxLength={200}
          aria-describedby={`${id}-hint`}
          placeholder="e.g. 20c0a378…"
          className={`${inputClass} mt-2 font-mono`}
        />
      </div>
      <button type="submit" className={buttonClass("primary", "md", "shrink-0")}>
        Check this digest
      </button>
    </form>
  );
}
