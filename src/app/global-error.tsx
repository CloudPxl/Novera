"use client";

import "./globals.css";
import Link from "next/link";
import { ErrorState } from "@/components/ui/primitives.tsx";

/**
 * The root layout itself threw, so nothing of the page survived — not the shell, not the
 * stylesheet. This renders its own document and imports the stylesheet itself, which is
 * what Next 16 requires of it.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-surface text-ink">
        <title>Something went wrong · Novera</title>
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
          <ErrorState
            level={1}
            title="Something went wrong on our side"
            reference={error.digest}
            action={
              <>
                <button
                  type="button"
                  onClick={() => retry()}
                  className="rounded-control bg-ink px-4 py-2 text-sm font-medium text-on-ink hover:bg-ink-hover"
                >
                  Try again
                </button>
                <Link href="/" className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-sunken">
                  Home page
                </Link>
              </>
            }
          >
            Novera could not load. Trying again usually works; if it does not, email{" "}
            <a href="mailto:support@nover.space" className="font-medium underline underline-offset-2">support@nover.space</a>{" "}
            and quote the reference below.
          </ErrorState>
        </main>
      </body>
    </html>
  );
}
