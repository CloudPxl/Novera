import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { ConnectAgentForm } from "./form.tsx";

export const metadata: Metadata = { title: "Connect an agent · Novera" };
export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  await requireWorkspace();

  return (
    <main className="w-full max-w-2xl py-8 text-ink">
      <Link href="/dashboard" className="text-sm text-ink-faint underline-offset-2 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Connect an agent</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
        Novera sends each scenario to your agent over HTTP and reads the reply. Nothing is sent
        until you have confirmed you may test it, and we make one harmless request first so you
        can see the answer before trusting a full run.
      </p>
      <ConnectAgentForm />
    </main>
  );
}
