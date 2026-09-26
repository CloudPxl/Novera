import { LoadingState } from "@/components/ui/primitives.tsx";

/** Shown inside the shell while any operator page's data streams in. */
export default function Loading() {
  return (
    <main className="w-full max-w-4xl text-ink">
      <LoadingState />
    </main>
  );
}
