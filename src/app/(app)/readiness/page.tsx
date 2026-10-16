import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth/staff.ts";
import { Badge, type BadgeTone } from "@/components/ui/primitives.tsx";
import { HealthLine, Metrics, PageHeader, Panel, Rows, Section, TabNav } from "@/components/ui/page.tsx";
import { buildStatus, countStates, deploymentEnvironment, STATE_LABEL, type ReadinessState, type StatusCheck } from "@/lib/readiness/status.ts";
import { buildGates, type Gate } from "@/lib/readiness/gates.ts";
import { AREA_LABEL, DECISIONS, type Decision, type DecisionArea } from "@/lib/readiness/decisions.ts";
import { diskLaunchFiles, runLaunchChecks, supabaseLaunchDb, type CheckStatus, type LaunchCheck } from "@/lib/readiness/launch-checks.ts";
import { parseLaunchLedger, prepareRepoDoc, readRepoDoc, READINESS_DOCS } from "@/lib/readiness/repo-docs.ts";
import { BRIEF_DATE, BRIEF_TRACKER, type TrackerRow, type TrackerStatus } from "@/lib/legal/framework.ts";
import { parseLegalBody } from "@/lib/legal/document.ts";
import { Contents, LegalBody } from "@/app/legal/legal-body.tsx";

export const metadata: Metadata = { title: "Launch readiness · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "status", label: "Status" },
  { key: "brief", label: "Brief tracker" },
  { key: "gates", label: "Launch gates" },
  { key: "decisions", label: "Decisions" },
  { key: "counsel", label: "Counsel" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const COUNSEL_DOCS = [
  { key: "questions", label: "Questions for counsel", file: "counsel" },
  { key: "inputs", label: "Legal inputs required", file: "inputs" },
] as const;

const STATE_TONE: Record<ReadinessState, BadgeTone> = { ready: "pass", david: "medium", counsel: "medium", accountant: "medium", blocked: "fail" };

function StateBadge({ state }: { state: ReadinessState }) {
  return <Badge tone={STATE_TONE[state]} className="whitespace-nowrap">{STATE_LABEL[state]}</Badge>;
}

function Paths({ label, paths }: { label: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-ink-faint">
      {label}:{" "}
      {paths.map((p, i) => (
        <span key={p}>{i > 0 && ", "}<code className="type-mono rounded bg-sunken px-1 py-0.5 text-ink-soft [overflow-wrap:anywhere]">{p}</code></span>
      ))}
    </p>
  );
}

/** One row: what it is, its state as a word, then the evidence. Tone is never colour alone. */
function Row({ badge, title, children }: { badge: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <h3 className="min-w-0 flex-1 basis-56 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{title}</h3>
        <span className="shrink-0">{badge}</span>
      </div>
      {children}
    </li>
  );
}

// ------------------------------------------------------------------ Status

const CHECK_TONE: Record<CheckStatus, BadgeTone> = { pass: "pass", fail: "fail", pending: "medium" };
const CHECK_WORD: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", pending: "Waiting" };

/** The automated checks, or one failing row saying they could not be computed: the page never crashes on them. */
async function loadLaunchChecks(): Promise<LaunchCheck[]> {
  try {
    return await runLaunchChecks({ db: await supabaseLaunchDb(), files: diskLaunchFiles() });
  } catch {
    return [{ id: "launch", title: "Automated checks", group: "platform", status: "fail", detail: "Could not be computed on this deployment.", remediation: "npm run verify:launch" }];
  }
}

function AutomatedChecks({ checks }: { checks: LaunchCheck[] }) {
  const platform = checks.filter((c) => c.group === "platform");
  const failing = platform.filter((c) => c.status === "fail").length;
  return (
    <Section title="Automated checks (live)" id="automated">
      <Panel>
        <HealthLine
          tone={failing ? "fail" : "pass"}
          title={failing ? `${failing} of ${platform.length} automated checks failing` : `${platform.length} of ${platform.length} automated checks pass`}
          detail="Computed on this request from the database, the repository files in this deployment and configuration (present or absent, never a value). The same list is printed by npm run verify:launch. Email and company details are under Founder sign-off."
        />
        <Rows label="Automated checks">
          {platform.map((c) => (
            <Row key={c.id} badge={<Badge tone={CHECK_TONE[c.status]} className="whitespace-nowrap">{CHECK_WORD[c.status]}</Badge>} title={c.title}>
              <p className="mt-1 text-sm text-ink-soft [overflow-wrap:anywhere]">{c.detail}</p>
              {c.remediation && (
                <p className="mt-1.5 text-xs text-ink-soft">To fix: <code className="type-mono rounded bg-sunken px-1 py-0.5 text-ink-soft [overflow-wrap:anywhere]">{c.remediation}</code></p>
              )}
            </Row>
          ))}
        </Rows>
      </Panel>
    </Section>
  );
}

function StatusTab({ checks, environment, launch }: { checks: StatusCheck[]; environment: string; launch: LaunchCheck[] }) {
  const counts = countStates(checks);
  const waiting = counts.david + counts.counsel + counts.accountant;
  return (
    <>
      <AutomatedChecks checks={launch} />
      <Section title="Founder sign-off" id="founder">
        <Panel>
        <HealthLine
          tone={counts.blocked ? "fail" : counts.ready === checks.length ? "pass" : "warning"}
          title={`${counts.ready} of ${checks.length} checks ready`}
          detail={`Computed on this request from the code and this ${environment} deployment's configuration. Settings appear as present or absent, never as values.`}
        />
        <div className="border-t border-line">
          <Metrics items={[
            { label: "Ready", value: counts.ready },
            { label: "Waiting", value: waiting, note: `David ${counts.david} · counsel ${counts.counsel} · accountant ${counts.accountant}` },
            { label: "Blocked", value: counts.blocked },
          ]} />
        </div>
      </Panel>
        <Panel className="mt-4">
          <Rows label="Founder sign-off checks">
            {checks.map((c) => (
              <Row key={c.id} badge={<StateBadge state={c.state} />} title={c.title}>
                <p className="mt-1 text-sm text-ink-soft">{c.summary}</p>
                {c.items && c.items.length > 0 && (
                  <dl className="mt-3 divide-y divide-line rounded-control border border-line text-sm">
                    {c.items.map((item, i) => (
                      <div key={`${item.label}-${i}`} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                        <dt className="text-ink-soft [overflow-wrap:anywhere]">{item.label}</dt>
                        <dd className="text-ink [overflow-wrap:anywhere]">
                          {item.value}
                          {item.state && item.state !== "ready" && <span className="ml-2 inline-block"><StateBadge state={item.state} /></span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <Paths label="Enforced in" paths={c.enforcedAt} />
              </Row>
            ))}
          </Rows>
        </Panel>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Brief tracker

const TRACKER_BADGE: Record<TrackerStatus, { tone: BadgeTone; word: string }> = {
  built: { tone: "pass", word: "Built" },
  draft: { tone: "neutral", word: "Draft" },
  decision: { tone: "live", word: "Decision recorded" },
  david: { tone: "medium", word: "Waiting on David" },
  accountant: { tone: "medium", word: "Waiting on accountant" },
};

function BriefTab({ rows }: { rows: readonly TrackerRow[] }) {
  return (
    <Section title={`Legal build brief of ${BRIEF_DATE}, section by section`} id="brief">
      <p className="mb-3 max-w-3xl text-sm text-ink-soft">
        What exists in the code for each section of the brief, and where. The same table is in{" "}
        <code className="type-mono">docs/LEGAL-FRAMEWORK.md</code>; a test fails if the two list different sections.
        §22 is the Decisions tab and §23 the Launch gates tab.
      </p>
      <Panel>
        <Rows label="Brief sections">
          {rows.map((r) => (
            <Row key={r.brief} badge={<Badge tone={TRACKER_BADGE[r.status].tone} className="whitespace-nowrap">{TRACKER_BADGE[r.status].word}</Badge>} title={r.brief}>
              <p className="mt-1 text-sm text-ink-soft">{r.exists}</p>
              <p className="mt-1.5 text-xs text-ink-soft">Status as recorded: {r.statusText}</p>
              {r.counsel.length > 0 && (
                <p className="mt-1 text-xs text-ink-soft">
                  Counsel question{r.counsel.length === 1 ? "" : "s"} {r.counsel.join(", ")}
                </p>
              )}
              <Paths label="Where" paths={r.where} />
            </Row>
          ))}
        </Rows>
      </Panel>
    </Section>
  );
}

// ------------------------------------------------------------------ Launch gates

const BASIS_WORDS: Record<Gate["basis"], string> = {
  code: "Computed from the code and this deployment",
  built: "Built into the code",
  stated: "Not verifiable from code",
};

function GateList({ gates, label }: { gates: Gate[]; label: string }) {
  return (
    <Panel>
      <Rows label={label}>
        {gates.map((g) => (
          <Row key={g.id} badge={<StateBadge state={g.state} />} title={g.title}>
            <p className="mt-1 text-xs font-medium text-ink-faint">
              {BASIS_WORDS[g.basis]}{g.basis === "stated" || g.owner !== "Code" ? ` · owner: ${g.owner}` : ""}
            </p>
            <p className="mt-1 text-sm text-ink-soft [overflow-wrap:anywhere]">{g.detail}</p>
            <Paths label={g.basis === "stated" ? "Recorded in" : "Enforced in"} paths={g.source} />
          </Row>
        ))}
      </Rows>
    </Panel>
  );
}

function GatesTab({ gates, ledgerRead }: { gates: Gate[]; ledgerRead: boolean }) {
  const pilot = gates.filter((g) => g.stage === "pilot");
  const paid = gates.filter((g) => g.stage === "paid");
  const ready = (list: Gate[]) => list.filter((g) => g.state === "ready").length;
  return (
    <>
      <Panel className="mt-6">
        <HealthLine
          tone={ready(pilot) === pilot.length && ready(paid) === paid.length ? "pass" : "warning"}
          title={`Pilot ${ready(pilot)} of ${pilot.length} · paid launch adds ${ready(paid)} of ${paid.length}`}
          detail={ledgerRead
            ? "A gate the code cannot check shows the status recorded in docs/LAUNCH-READINESS.md, read on this request, and is ready only where that row says PASS."
            : "docs/LAUNCH-READINESS.md could not be read on this deployment: gates the code cannot check wait on their owner."}
        />
      </Panel>
      <Section title="Controlled B2B pilot" id="pilot">
        <GateList gates={pilot} label="Pilot gates" />
      </Section>
      <Section title="Paid B2B launch adds" id="paid">
        <GateList gates={paid} label="Paid launch gates" />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Decisions

function DecisionsTab({ decisions }: { decisions: readonly Decision[] }) {
  const areas: DecisionArea[] = ["commercial", "legal", "operations"];
  const open = decisions.filter((d) => d.state === "open").length;
  return (
    <>
      <Panel className="mt-6">
        <HealthLine
          tone={open ? "warning" : "pass"}
          title={`${decisions.length - open} decided · ${open} open`}
          detail="Each row quotes the repository text that records it. Prices are shown because this page is for staff; they are not published until the legal entity exists."
        />
      </Panel>
      {areas.map((area) => (
        <Section key={area} title={AREA_LABEL[area]} id={`decisions-${area}`}>
          <Panel>
            <Rows label={`${AREA_LABEL[area]} decisions`}>
              {decisions.filter((d) => d.area === area).map((d) => (
                <Row key={d.id} badge={<Badge tone={d.state === "decided" ? "pass" : "medium"} className="whitespace-nowrap">{d.state === "decided" ? "Decided" : "Open"}</Badge>} title={d.title}>
                  <p className="mt-1 text-xs font-medium text-ink-faint">{d.state === "decided" ? "Decided by" : "Decides"}: {d.owner}</p>
                  <p className="mt-1 text-sm text-ink-soft">{d.detail}</p>
                  <figure className="mt-2 border-l-2 border-line-strong pl-3 text-xs text-ink-soft">
                    <blockquote className="[overflow-wrap:anywhere]">{d.source.quote}</blockquote>
                    <figcaption className="mt-0.5 text-ink-faint"><code className="type-mono">{d.source.file}</code></figcaption>
                  </figure>
                </Row>
              ))}
            </Rows>
          </Panel>
        </Section>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Counsel

async function CounselTab({ doc }: { doc: (typeof COUNSEL_DOCS)[number] }) {
  const text = await readRepoDoc(doc.file);
  const prepared = text === null ? null : prepareRepoDoc(text);
  const blocks = prepared ? parseLegalBody(prepared.body) : [];
  return (
    <div className="mt-6">
      <TabNav
        label="Counsel documents"
        current={doc.key}
        tabs={COUNSEL_DOCS.map((d) => ({ key: d.key, label: d.label, href: `/readiness?tab=counsel&doc=${d.key}` }))}
      />
      <article className="mt-6 max-w-3xl">
        <h2 className="type-h2">{prepared?.title ?? doc.label}</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Read on this request from <code className="type-mono">{READINESS_DOCS[doc.file]}</code>. Not legal advice.
        </p>
        {prepared === null ? (
          <p role="status" className="mt-6 rounded-panel border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-text">
            This file is not part of this deployment, so it cannot be shown here.
          </p>
        ) : (
          <>
            <Contents blocks={blocks} />
            <LegalBody blocks={blocks} />
          </>
        )}
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ the page

/**
 * Launch readiness, for staff: what stands between Novera and a B2B pilot and a paid launch.
 * Like the inbox, a signed-in person who is not staff is sent to the dashboard (requireStaff),
 * and nothing here is linked from anywhere public. Every status is computed from the code and
 * configuration or quoted from the repository's own documents.
 */
export default async function ReadinessPage({ searchParams }: { searchParams: Promise<{ tab?: string; doc?: string }> }) {
  await requireStaff();
  const params = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === params.tab) ? (params.tab as Tab) : "status";
  const counselDoc = COUNSEL_DOCS.find((d) => d.key === params.doc) ?? COUNSEL_DOCS[0];

  const environment = deploymentEnvironment();
  const checks = buildStatus();
  const launch = tab === "status" ? await loadLaunchChecks() : [];
  const ledgerText = await readRepoDoc("launch");
  const gates = buildGates({ ledger: ledgerText === null ? null : parseLaunchLedger(ledgerText) });
  const notReady = (list: Array<{ state: ReadinessState }>) => list.filter((x) => x.state !== "ready").length;

  const tabs = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    href: t.key === "status" ? "/readiness" : `/readiness?tab=${t.key}`,
    count: t.key === "status" ? notReady(checks)
      : t.key === "gates" ? notReady(gates)
      : t.key === "decisions" ? DECISIONS.filter((d) => d.state === "open").length
      : t.key === "brief" ? BRIEF_TRACKER.filter((r) => r.status !== "built").length
      : undefined,
  }));

  return (
    <main className="w-full pb-8 text-ink">
      <PageHeader
        eyebrow="Staff"
        title="Launch readiness"
        status={<Badge tone="neutral">{environment}</Badge>}
        description="What stands between Novera and a controlled B2B pilot, and a paid B2B launch: computed from the code and this deployment's configuration, or quoted from the repository's documents. Visible to staff only."
      />
      <TabNav label="Readiness sections" current={tab} tabs={tabs} />
      {tab === "status" && <StatusTab checks={checks} environment={environment} launch={launch} />}
      {tab === "brief" && <BriefTab rows={BRIEF_TRACKER} />}
      {tab === "gates" && <GatesTab gates={gates} ledgerRead={ledgerText !== null} />}
      {tab === "decisions" && <DecisionsTab decisions={DECISIONS} />}
      {tab === "counsel" && <CounselTab doc={counselDoc} />}
    </main>
  );
}
