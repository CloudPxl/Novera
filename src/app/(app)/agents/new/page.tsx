import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page.tsx";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { ConnectAgentForm } from "./form.tsx";

export const metadata: Metadata = { title: "Connect an agent · Novera" };
export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  await requireWorkspace();

  return (
    <main className="w-full max-w-2xl pb-10 text-ink">
      <PageHeader
        back={{ href: "/agents", label: "Agents" }}
        eyebrow="About two minutes"
        title="Connect an agent"
        description="Novera sends each scenario to your agent over HTTP and reads the reply. Nothing is sent until you confirm you may test it, and one harmless request goes first so you see the answer."
      />
      <ConnectAgentForm />
    </main>
  );
}
