"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui/primitives.tsx";

/**
 * An operator page that threw. The shell above it keeps working, so the way back is
 * one click; "Try again" re-fetches the page rather than only re-rendering what failed.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="w-full max-w-4xl py-8 text-ink">
      <ErrorState
        level={1}
        title="This page could not be loaded"
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
            <Link href="/dashboard" className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-sunken">
              Back to the dashboard
            </Link>
          </>
        }
      >
        Nothing you entered was lost: anything you saved before this happened is stored. If it keeps
        happening, send us the reference below through the support page.
      </ErrorState>
    </main>
  );
}
