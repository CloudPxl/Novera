import { LoadingState } from "@/components/ui/primitives.tsx";

/**
 * Shown inside the shell while any operator page's data streams in. Marked so that, with
 * JavaScript off, it is hidden and the streamed page shown instead (globals.css) — otherwise a
 * signed-in page without scripts stayed on "Loading…" forever.
 */
export default function Loading() {
  return (
    <main className="novera-loading w-full max-w-4xl text-ink">
      <LoadingState />
    </main>
  );
}
