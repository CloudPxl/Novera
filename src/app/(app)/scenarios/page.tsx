import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import type { SuiteCase } from "@/lib/runner/types.ts";
import { describeCheck } from "@/lib/judge/checks.ts";
import { DraftForm, DecideForm, ImportForm, PromoteForm } from "./client.tsx";
import { SOURCE_LABELS, type ImportProvenance, type SourceTool } from "@/lib/imports/datasets.ts";
import { Library, type LibraryOrigin, type LibraryRun } from "./library.tsx";

export const metadata: Metadata = { title: "Scenarios · Novera" };
export const dynamic = "force-dynamic";

interface DraftRow {
  id: string;
  origin: "policy" | "import" | "production";
  production_failures: { occurred_on: string | null; created_at: string; agent_reply: string | null; redaction: { counts: Record<string, number>; original_hash: string } } | null;
  import_provenance: (ImportProvenance & { imported_at: string }) | null;
  source_quote: string | null;
  scenario: SuiteCase;
  duty_refs: string[];
  risk_level: string;
  destructive: boolean;
  fixture_only: boolean;
  status: string;
  model: string | null;
  rejection_reason: string | null;
  approved_at: string | null;
  created_at: string;
  policies: { version: number } | null;
  suites: { key: string; version: number } | null;
  api_keys: { name: string } | null;
}

// The tone set already names the severities; risk uses the same words on purpose.
const RISK_TONE = { high: "high", medium: "medium", low: "low" } as const;

export default async function ScenariosPage({ searchParams }: { searchParams: Promise<{ suite?: string }> }) {
  const { suite: suiteParam } = await searchParams;
  const { user, workspace } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);

  const [{ data: drafts }, { data: agents }, { data: suites }] = await Promise.all([
    admin
      .from("scenario_drafts")
      .select("id, origin, import_provenance, production_failures(occurred_on, created_at, agent_reply, redaction), source_quote, scenario, duty_refs, risk_level, destructive, fixture_only, status, model, rejection_reason, approved_at, created_at, api_keys(name), policies(version), suites!scenario_drafts_included_in_suite_id_fkey(key, version)")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }),
    admin.from("agents").select("id, name, is_production").eq("workspace_id", workspace.id).order("created_at"),
    admin
      .from("suites").select("id, key, version, name")
      .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`)
      .order("key").order("version", { ascending: false }),
  ]);

  const rows = (drafts ?? []) as unknown as DraftRow[];

  // The library: one suite version's scenarios and how each has done. Defaults to the suite
  // of the newest run, so it opens on what this workspace actually runs.
  const { data: newestRun } = await admin.from("runs").select("suite_id").eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const suiteList = (suites ?? []) as Array<{ id: string; key: string; version: number; name: string }>;
  const chosenId = suiteList.some((x) => x.id === suiteParam) ? suiteParam!
    : (newestRun?.suite_id as string | undefined) ?? suiteList.find((x) => x.key === "eu-support")?.id ?? suiteList[0]?.id;
  const [{ data: chosen }, { data: libRuns }, { data: promoted }] = chosenId
    ? await Promise.all([
      admin.from("suites").select("id, key, version, name, cases, workspace_id").eq("id", chosenId).maybeSingle(),
      admin.from("runs").select("id, created_at, agents(name)").eq("workspace_id", workspace.id).eq("suite_id", chosenId)
        .eq("status", "completed").order("created_at", { ascending: false }).limit(8),
      admin.from("scenario_drafts").select("scenario, origin, approved_at").eq("workspace_id", workspace.id)
        .eq("included_in_suite_id", chosenId),
    ])
    : [{ data: null }, { data: [] }, { data: [] }];
  const libRunIds = (libRuns ?? []).map((r) => r.id as string);
  const { data: libCases } = libRunIds.length
    ? await admin.from("run_cases").select("run_id, case_id, status").in("run_id", libRunIds)
    : { data: [] };
  const library: LibraryRun[] = (libRuns ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    agentName: (r.agents as unknown as { name: string } | null)?.name ?? "agent",
    statuses: new Map((libCases ?? []).filter((c) => c.run_id === r.id).map((c) => [c.case_id as string, c.status as "pass" | "fail" | "error"])),
  }));
  const origins = new Map<string, LibraryOrigin>((promoted ?? []).map((d) => [
    (d.scenario as SuiteCase).id, { origin: d.origin as LibraryOrigin["origin"], approvedAt: (d.approved_at as string | null) ?? null },
  ]));
  const pending = rows.filter((d) => d.status === "draft");
  const approved = rows.filter((d) => d.status === "approved");
  const settled = rows.filter((d) => d.status === "rejected" || d.status === "included");

  return (
    <main className="w-full py-8 text-ink">
      <Link href="/dashboard" className="text-sm text-ink-faint underline-offset-2 hover:underline">
        ← Dashboard
      </Link>

      <h1 className="mt-4 type-h1">Scenarios</h1>
      <p className="mt-2 max-w-2xl type-body text-ink-soft">
        A policy is a list of things you have promised to do. This drafts the scenarios that would
        show whether your agent actually does them — each one tied to the sentence of your own
        policy it tests, so you can always answer <em>why is this case in my report</em>.
      </p>
      <p className="mt-2 max-w-2xl type-body text-ink-soft">
        You can also bring test cases you already wrote for another tool. Either way, a draft cannot
        run: you approve it or you reject it, and only an approval lets it enter a suite version.
      </p>

      {chosen && (
        <section id="library" aria-labelledby="library-heading" className="mt-8 scroll-mt-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="library-heading" className="type-h2">In {chosen.name as string} · v{chosen.version as number}</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                {(chosen.cases as SuiteCase[]).length} scenarios that run, each with what it takes to settle it, where it came from,
                and its last {library.length || "few"} results in this workspace. A version never changes once published.
              </p>
            </div>
            <nav aria-label="Suite version" className="flex flex-wrap gap-1.5">
              {suiteList.slice(0, 8).map((x) => (
                <Link key={x.id} href={`/scenarios?suite=${x.id}#library`} aria-current={x.id === chosen.id ? "true" : undefined}
                  className={`novera-press rounded-full border px-3 py-1 text-xs font-medium ${x.id === chosen.id ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface text-ink-soft hover:text-ink"}`}>
                  {x.key} v{x.version}
                </Link>
              ))}
            </nav>
          </div>
          <Library
            suite={{ key: chosen.key as string, version: chosen.version as number, name: chosen.name as string }}
            cases={chosen.cases as SuiteCase[]}
            runs={library}
            origins={origins}
            builtIn={chosen.workspace_id === null}
          />
        </section>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
      <Reveal>
        <Card className="h-full p-5">
          <h2 className="type-h2">Draft from a policy version</h2>
          <DraftForm agents={(agents ?? []) as Array<{ id: string; name: string; is_production: boolean }>} />
        </Card>
      </Reveal>

      <Reveal>
        <Card className="h-full p-5">
          <h2 className="type-h2">Import from another tool</h2>
          <p className="mt-1 type-body text-ink-soft">
            Promptfoo, DeepEval, LangSmith or Langfuse. Each test case becomes a draft for you to
            review. Where Novera reads something differently from the original tool, the draft says so.
            Assertions with no equivalent are listed, never guessed at. Outputs and scores from
            earlier runs are ignored: Novera runs every scenario and grades it itself.
          </p>
          <ImportForm />
        </Card>
      </Reveal>
      </div>

      <Reveal className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-h2">Waiting on you</h2>
          <Badge tone={pending.length ? "high" : "neutral"}>{pending.length} to decide</Badge>
        </div>

        {pending.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Nothing to review">
              Draft or import scenarios above, and they will appear here for you to approve or reject.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 space-y-4">
            {pending.map((d) => (
              <li key={d.id}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-mono text-ink-soft">{d.scenario.id}</span>
                    <Badge tone={RISK_TONE[d.risk_level as keyof typeof RISK_TONE] ?? "neutral"}>
                      {d.risk_level} risk
                    </Badge>
                    <Badge tone="neutral">{d.scenario.obligation}</Badge>
                    {d.destructive && <Badge tone="critical">destructive</Badge>}
                    {d.fixture_only && <Badge tone="medium">test data only</Badge>}
                    {d.policies && <Badge tone="neutral">policy v{d.policies.version}</Badge>}
                    {d.origin === "production" && <Badge tone="high">from a production failure</Badge>}
                    {d.origin === "import" && d.import_provenance && (
                      <Badge tone="neutral">imported from {SOURCE_LABELS[d.import_provenance.source_tool as SourceTool] ?? d.import_provenance.source_tool}</Badge>
                    )}
                  </div>

                  {d.origin === "production" && d.production_failures ? (
                    <FromProduction failure={d.production_failures} />
                  ) : d.origin === "import" && d.import_provenance ? (
                    <ImportedFrom provenance={d.import_provenance} />
                  ) : (
                    <figure className="mt-4 border-l-2 border-line-strong pl-3">
                      <blockquote className="type-body text-ink-soft italic">{d.source_quote}</blockquote>
                      <figcaption className="mt-1 text-xs text-ink-faint">
                        the passage of your policy this tests
                      </figcaption>
                    </figure>
                  )}

                  <dl className="mt-4 space-y-3">
                    <div>
                      <dt className="type-pill text-ink-faint">What the customer sends</dt>
                      <dd className="mt-1 type-body whitespace-pre-wrap">{d.scenario.input}</dd>
                    </div>
                    <div>
                      <dt className="type-pill text-ink-faint">What the agent must do</dt>
                      <dd className="mt-1 type-body">{d.scenario.expected_behavior}</dd>
                    </div>
                    <div>
                      <dt className="type-pill text-ink-faint">What has to hold</dt>
                      <dd className="mt-1">
                        <ul className="space-y-1 type-body">
                          {d.scenario.assertions.map((a, i) => (
                            <li key={i} className="flex gap-2">
                              <span aria-hidden className="text-ink-ghost">•</span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                    {d.scenario.checks && d.scenario.checks.length > 0 && (
                      <div>
                        <dt className="type-pill text-ink-faint">Rules that fail it outright</dt>
                        <dd className="mt-1">
                          <ul className="space-y-1 type-body">
                            {d.scenario.checks.map((c, i) => (
                              <li key={i} className="flex gap-2">
                                <span aria-hidden className="text-ink-ghost">•</span>
                                <span>{describeCheck(c)}</span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-xs text-ink-faint">
                            A rule can fail this scenario but never pass it; the expectation above is still graded.
                          </p>
                        </dd>
                      </div>
                    )}
                    {d.scenario.effect && (
                      <div>
                        <dt className="type-pill text-ink-faint">What must actually change</dt>
                        <dd className="mt-1 type-body">
                          {d.scenario.effect.describe}{" "}
                          <span className="text-ink-faint">
                            (proved by{" "}
                            {d.scenario.effect.evidence === "state_confirmed"
                              ? "reading your own system"
                              : "recorded tool activity"}
                            )
                          </span>
                        </dd>
                      </div>
                    )}
                  </dl>

                  {(d.model || d.origin !== "policy") && (
                    <p className="mt-4 text-xs text-ink-faint">
                      {d.model ? `Drafted by ${d.model}${d.api_keys ? `, asked for by an assistant with the key “${d.api_keys.name}”` : ""}.` : d.origin === "production" ? (d.api_keys ? `Built from a failure sent with the API key “${d.api_keys.name}”, no model involved.` : "Built from what you recorded, no model involved.") : "Converted by Novera, no model involved."} Nothing
                      has been run and nothing will be until you approve it.
                    </p>
                  )}

                  <DecideForm draftId={d.id} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      <Reveal className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-h2">Approved, not yet in a suite</h2>
          <Badge tone={approved.length ? "pass" : "neutral"}>{approved.length} approved</Badge>
        </div>

        {approved.length === 0 ? (
          <p className="mt-3 type-body text-ink-soft">
            Approved scenarios collect here until you promote them into a suite version.
          </p>
        ) : (
          <Card className="mt-3 p-5">
            <ul className="space-y-2">
              {approved.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-2 type-body">
                  <span className="type-mono text-ink-soft">{d.scenario.id}</span>
                  <span>{d.scenario.expected_behavior}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-line pt-5">
              <PromoteForm
                suites={(suites ?? []) as Array<{ id: string; key: string; version: number; name: string }>}
                origins={{
                  policy: approved.filter((d) => d.origin === "policy").length,
                  imported: approved.filter((d) => d.origin === "import").length,
                  production: approved.filter((d) => d.origin === "production").length,
                }}
              />
            </div>
          </Card>
        )}
      </Reveal>

      {settled.length > 0 && (
        <Reveal className="mt-10">
          <h2 className="type-h2">Decided</h2>
          <Card className="mt-3 p-5">
            <ul className="space-y-3">
              {settled.map((d) => (
                <li key={d.id} className="type-body">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-mono text-ink-soft">{d.scenario.id}</span>
                    {d.status === "included" ? (
                      <Badge tone="pass">
                        in {d.suites ? `${d.suites.key} v${d.suites.version}` : "a suite version"}
                      </Badge>
                    ) : (
                      <Badge tone="fail">rejected</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-ink-soft">{d.scenario.expected_behavior}</p>
                  {d.rejection_reason && (
                    <p className="mt-1 text-ink-faint">Rejected because: {d.rejection_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      )}
    </main>
  );
}

/**
 * Where an imported draft came from, and every place Novera reads it differently.
 * Shown in full before the decision, because approving is agreeing to exactly this.
 */
function ImportedFrom({ provenance: p }: { provenance: ImportProvenance & { imported_at: string } }) {
  return (
    <div className="mt-4 rounded-control border border-line bg-ground p-3 text-sm">
      <p className="text-ink-soft">
        From <span className="font-medium text-ink">{p.source_filename}</span>, item{" "}
        <span className="type-mono">{p.source_id}</span>, imported{" "}
        {p.imported_at.slice(0, 16).replace("T", " ")} UTC.
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        File SHA-256 <span className="type-mono break-all">{p.original_hash}</span>
      </p>
      {p.adjustments.length > 0 && (
        <div className="mt-3">
          <p className="type-pill text-ink-faint">Read differently from the original</p>
          <ul className="mt-1 space-y-1 text-ink-soft">
            {p.adjustments.map((a, i) => (
              <li key={i} className="flex gap-2"><span aria-hidden className="text-ink-ghost">•</span><span>{a}</span></li>
            ))}
          </ul>
        </div>
      )}
      {p.dropped.length > 0 && (
        <p className="mt-3 text-warning-text">
          Not imported, no equivalent in Novera: {p.dropped.join(", ")}.
        </p>
      )}
      <p className="mt-3 text-xs text-ink-faint">Sanitisation: {p.sanitisation}.</p>
    </div>
  );
}

/** A regression draft: the incident it came from, as stored — redacted, original hashed. */
function FromProduction({ failure: f }: { failure: NonNullable<DraftRow["production_failures"]> }) {
  const removed = Object.entries(f.redaction.counts ?? {});
  return (
    <div className="mt-4 rounded-control border border-line bg-ground p-3 text-sm">
      <p className="text-ink-soft">
        Recorded from a production failure{f.occurred_on ? ` that happened ${f.occurred_on}` : ""}.{" "}
        <Link href="/regressions" className="underline underline-offset-2 hover:text-ink">See it with the others</Link>
      </p>
      {f.agent_reply && (
        <p className="mt-2 whitespace-pre-wrap text-ink-soft">
          <span className="type-pill text-ink-faint">The agent replied </span>{f.agent_reply}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-faint">
        Stored redacted{removed.length ? ` (removed: ${removed.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")})` : ""};
        the original text was not kept.
      </p>
    </div>
  );
}
