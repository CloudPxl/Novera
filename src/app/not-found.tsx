import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Not found · Novera" };

/**
 * Every unknown path, and every run or agent a signed-in person cannot see.
 *
 * The second case is why this says "or you do not have access": row-level security
 * returns nothing for another workspace's run, and a page that only said "does not
 * exist" would be asserting something it cannot know. Next's built-in page had no
 * `<main>` landmark, so it was the one page in the product axe failed.
 *
 * Rendered per request, like every other page: prerendered, it carried no CSP nonce, and the
 * policy refused all of its scripts — thirteen console errors on every unknown address in
 * production (audit, 2026-10-08).
 */
export default async function NotFound() {
  await connection();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-surface px-6 text-ink">
      <p className="type-pill text-ink-faint"><Link href="/" className="rounded-control hover:text-ink">Novera</Link></p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        This page does not exist, or it belongs to a workspace you are not a member of.
      </p>
      <p className="mt-6 flex gap-4 text-sm">
        <Link href="/dashboard" className="font-medium underline underline-offset-2">Dashboard</Link>
        <Link href="/" className="text-ink-soft underline underline-offset-2 hover:text-ink">Home</Link>
      </p>
    </main>
  );
}
