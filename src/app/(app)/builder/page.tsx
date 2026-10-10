import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { PageHeader, Section, Disclosure, Rows, Panel } from "@/components/ui/page.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import { packCases, publishedPacks, qualityRecord, reviewMinutes, suggestedPack } from "@/lib/builder/packs.ts";
import { formatWhen } from "@/lib/format/when.ts";
import { StartForm, type PackOption } from "./forms.tsx";

export const metadata: Metadata = { title: "Suite Builder · Novera" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "live", approved: "medium", published: "pass", abandoned: "neutral" } as const;

/**
 * Start a suite from a measured baseline, then add your own sources and decide what
 * applies. The page states, for every pack, what it covers, what it does not, and what
 * its scenarios were measured against — before anyone picks one.
 */
export default async function BuilderPage() {
  const { user, workspace, role, context } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);
  const [{ data: builds }, { data: agents }, { data: counts }] = await Promise.all([
    admin.from("suite_builds").select("id, name, status, pack_key, pack_version, quick, prepared_for, created_at, published_suite_id, suites!suite_builds_published_suite_id_fkey(key, version)")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(30),
    admin.from("agents").select("id, name").eq("workspace_id", workspace.id).is("archived_at", null).order("created_at"),
    admin.from("scenario_drafts").select("build_id, status").eq("workspace_id", workspace.id).not("build_id", "is", null),
  ]);

  const packs = publishedPacks();
  const goal = context.profile.primary_goal;
  const suggestion = suggestedPack(goal);
  const options: PackOption[] = packs.map((p) => ({
    key: p.key, title: p.title, version: p.version, scenarios: p.cases.length, quick: p.quick.length,
    minutesQuick: reviewMinutes(packCases(p, true)), minutesFull: reviewMinutes(packCases(p)),
  }));
  const tally = new Map<string, { undecided: number; approved: number }>();
  for (const d of counts ?? []) {
    const t = tally.get(d.build_id as string) ?? { undecided: 0, approved: 0 };
    if (d.status === "draft" || d.status === "needs_review") t.undecided++;
    if (d.status === "approved" || d.status === "included") t.approved++;
    tally.set(d.build_id as string, t);
  }
  const list = (builds ?? []) as unknown as Array<{ id: string; name: string; status: keyof typeof STATUS_TONE; pack_key: string | null; quick: boolean; prepared_for: string | null; created_at: string; suites: { key: string; version: number } | null }>;
  const canDraft = can(role, "scenario.draft");

  return (
    <main className="w-full pb-10 text-ink">
      <PageHeader
        eyebrow="Library"
        title="Suite Builder"
        description="Start with a measured baseline, add your own documents, compare them with what your agent does, and approve what applies. Nothing a model drafts is tested until a person approves it."
        back={{ href: "/scenarios", label: "Scenarios" }}
      />

      {list.length > 0 && (
        <Section title="Your suites in progress and published">
          <Panel><Rows label="Builds">
            {list.map((b) => {
              const t = tally.get(b.id) ?? { undecided: 0, approved: 0 };
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/builder/${b.id}`} className="font-medium text-ink underline-offset-2 hover:underline">{b.name}</Link>
                    <p className="text-sm text-ink-soft">
                      {b.prepared_for ? `For ${b.prepared_for} · ` : ""}
                      {b.status === "published" && b.suites ? `Published as ${b.suites.key} v${b.suites.version}` : `${t.approved} approved · ${t.undecided} to decide`}
                      {" · "}{formatWhen(b.created_at, context.profile, { date: true })}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
                </li>
              );
            })}
          </Rows></Panel>
        </Section>
      )}

      {canDraft ? (
        <Section title="Start a suite">
          <div className="rounded-panel border border-line bg-surface p-4 sm:p-5">
            <p className="text-sm text-ink-soft">
              Suggested: <span className="font-medium text-ink">{suggestion.pack.title}</span>{suggestion.quick ? ", quick start" : ""}. {suggestion.reason}
            </p>
            <div className="mt-4">
              <StartForm
                packs={options}
                suggested={{ key: suggestion.pack.key, quick: suggestion.quick }}
                agents={(agents ?? []) as Array<{ id: string; name: string }>}
                goal={goal}
                agency={context.profile.account_mode !== "personal"}
              />
            </div>
          </div>
        </Section>
      ) : (
        <p className="mt-6 text-sm text-ink-soft">Your role reads suites here; starting one is for those who draft scenarios.</p>
      )}

      <Section title="What each pack is, and is not">
        <p className="max-w-3xl text-sm text-ink-soft">
          Every pack is a selection of eu-support v5 scenarios, unchanged, so each one carries a ground-truth label and the calibration
          recorded for it. A pack is a starting point you decide on scenario by scenario. It is not legal advice, and it does not establish
          that any duty applies to you.
        </p>
        <div className="mt-4 grid gap-2">
          {packs.map((p) => {
            const q = qualityRecord(p);
            return (
              <Disclosure key={p.key} summary={<>{p.title} <span className="font-normal text-ink-faint">v{p.version} · {p.cases.length} scenarios</span></>}>
                <div className="grid gap-3 text-sm">
                  <p className="text-ink">{p.summary}</p>
                  <p className="text-ink-soft"><span className="font-medium text-ink">Scope.</span> {p.scope}</p>
                  <div>
                    <p className="font-medium text-ink">Limitations</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-soft">{p.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    <div><dt className="inline text-ink-soft">Published </dt><dd className="inline text-ink">{p.published} by {p.maintainer}</dd></div>
                    <div><dt className="inline text-ink-soft">Source </dt><dd className="inline text-ink">{p.source.suite} v{p.source.version}, unchanged</dd></div>
                    <div><dt className="inline text-ink-soft">Labelled on the fixture </dt><dd className="inline text-ink">{q.expectedFail} planted failures, {q.expectedPass} held lines, {q.excluded} excluded as arguable</dd></div>
                    <div><dt className="inline text-ink-soft">Settled by rules where possible </dt><dd className="inline text-ink">{q.ruleChecked} of {q.scenarios}</dd></div>
                    <div><dt className="inline text-ink-soft">Fixtures </dt><dd className="inline text-ink">{q.fixtures} scripted fixture, with passing and failing replies</dd></div>
                    <div><dt className="inline text-ink-soft">Need a context slot or turns </dt><dd className="inline text-ink">{q.needsChannel}</dd></div>
                  </dl>
                  <div>
                    <p className="font-medium text-ink">Calibration</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-soft">{q.calibration.map((c) => <li key={c}>{c}</li>)}</ul>
                  </div>
                  {p.needs_customer_policy && (
                    <p className="text-ink-soft">{Object.keys(p.needs_customer_policy).length} scenario(s) assume something about your own terms; they arrive marked for review, saying what.</p>
                  )}
                </div>
              </Disclosure>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-ink-faint">E-commerce, SaaS/B2B and multilingual packs are held as drafts until their scenarios are written against a fixture and measured.</p>
      </Section>
    </main>
  );
}
