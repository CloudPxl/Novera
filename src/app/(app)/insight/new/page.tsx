import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { PageHeader, Panel } from "@/components/ui/page.tsx";
import { TargetForm } from "../forms.tsx";

export const metadata: Metadata = { title: "Add a public demo bot · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewInsightTargetPage() {
  const { role } = await requireWorkspace();
  // Recording a target is acting; a reviewer or auditor reads the list instead.
  if (!can(role, "insight.manage")) redirect("/insight");
  return (
    <main className="w-full py-8 text-ink">
      <PageHeader
        eyebrow="Insight scans"
        title="Add a public demo bot"
        description="Record the page and what the bot can reach. Novera derives the category; only category A is ever scanned without the owner."
        back={{ href: "/insight", label: "Insight scans" }}
      />
      <Panel className="mt-6 max-w-2xl p-5">
        <TargetForm />
      </Panel>
    </main>
  );
}
