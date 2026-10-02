import { switchWorkspace } from "@/lib/workflow/identity.ts";
import { SubmitButton } from "@/components/ui/button.tsx";

/**
 * A link to something in another of the person's workspaces — a run announced by a webhook, an
 * agent from a teammate's message. Rendering it under the active workspace would mix the two
 * (its actions would run against this one), so the person is told where it lives and switches.
 * Shown only for a workspace they belong to; anything else is a 404, as before.
 */
export function OtherWorkspace({ thing, workspace, workspaceId, next }: { thing: string; workspace: string; workspaceId: string; next: string }) {
  return (
    <main className="mx-auto w-full max-w-xl py-16 text-ink">
      <p className="type-eyebrow text-ink-faint">Another workspace</p>
      <h1 className="mt-2 type-h1">This {thing} is in {workspace}</h1>
      <p className="mt-3 type-body text-ink-soft">You belong to that workspace too. Switch to it to open the {thing}; everything you see and do will then be in {workspace}.</p>
      <form action={switchWorkspace} className="mt-6">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="next" value={next} />
        <SubmitButton pendingLabel="Switching…">Switch to {workspace}</SubmitButton>
      </form>
    </main>
  );
}
