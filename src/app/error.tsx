"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui/primitives.tsx";

/**
 * A public page that threw — the documentation, the forms, a client's report. The
 * reader may never have heard of Novera, so this says what to do next in plain words.
 */
export default function PublicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-surface px-6 text-ink">
      <ErrorState
        level={1}
        title="Something went wrong on our side"
        reference={error.digest}
        action={
          <>
            <button
              type="button"
              onClick={() => retry()}
              className="rounded-control bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Try again
            </button>
            <Link href="/support" className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-sunken">
              Contact support
            </Link>
          </>
        }
      >
        The page did not load. Trying again usually works; if it does not, contact support and
        quote the reference below.
      </ErrorState>
    </main>
  );
}
