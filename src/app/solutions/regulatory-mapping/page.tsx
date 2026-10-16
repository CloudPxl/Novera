import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session.ts";
import { Badge } from "@/components/ui/primitives.tsx";
import { JsonLd } from "@/components/seo/json-ld.tsx";
import { SITE_ORIGIN } from "@/lib/seo/site.ts";
import { ExplainTrigger } from "@/components/ui/explain-trigger.tsx";
import { AI_ACT_FRAMING_SUMMARY, aiActFramingFor } from "@/lib/legal/ai-act-framing.ts";
import { solution, solutionMetadata } from "../_components/content.ts";
import { Cards, ClosingCta, Hero, MappingNotice, NotCertification, Section, SolutionFrame } from "../_components/solution-ui.tsx";
import {
  FRAMEWORKS, LAYERS, SUITE, applyFilters, buildMatrix, filterHref, matrixTotals, readFilters, unplacedRefs,
  type FilteredRow, type Filters, type Layer, type MatrixRow,
} from "./matrix.ts";

export const metadata: Metadata = solutionMetadata("regulatory-mapping");

/**
 * The regulatory mapping: every EU AI Act and GDPR reference the suite a new run uses carries, the
 * scenarios filed under it, and how each is checked — all of it computed from the suite file by
 * `./matrix.ts`, and re-counted from the JSON by tests/regulatory-mapping.test.ts.
 *
 * Filters are the address (`?framework=&article=&layer=`), plain links that work without
 * JavaScript; an unknown value is ignored, never printed. The page maps evidence to references a
 * reader may already carry. It never says a duty applies or is met, and AI Act Article 12 — which
 * no scenario carries — gets no row: what Novera records about its own tests is described apart,
 * as exactly that.
 */
export default async function RegulatoryMappingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const signedIn = Boolean(await currentUser());
  const page = solution("regulatory-mapping");
  const rows = buildMatrix();
  const totals = matrixTotals(rows);
  const filters = readFilters(await searchParams, rows);
  const shown = applyFilters(rows, filters);
  const shownScenarios = new Set(shown.flatMap((r) => r.shown.map((s) => s.id))).size;
  const filtered = Boolean(filters.framework || filters.article || filters.layer);
  const art12 = rows.filter((r) => r.framework === "ai-act" && r.articleNumber === "12");
  const unplaced = unplacedRefs();

  return (
    <SolutionFrame signedIn={signedIn} current="regulatory-mapping">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: `Regulatory mapping of ${SUITE.name}`,
          description: page.description,
          url: `${SITE_ORIGIN}${page.path}`,
          inLanguage: "en",
          isAccessibleForFree: true,
          keywords: ["EU AI Act", "GDPR", "AI agent testing", "test scenarios"],
          variableMeasured: ["Duty reference", "Scenario", "Severity", "How the scenario is checked"],
        }}
      />
      <Hero
        crumb={page.name}
        eyebrow="Reference · EU AI Act and GDPR"
        title={<>Which scenarios bear on which references, <span className="text-ink-soft">counted from the suite itself.</span></>}
        lead={
          <>
            The scenarios in {SUITE.name} name the AI Act and GDPR references their evidence bears on.
            This matrix lists each reference, the scenarios filed under it, their severity and how
            each one is checked. Nothing on it is typed by hand: it is read from the suite a new run uses.
          </>
        }
        signedIn={signedIn}
        primary={{ href: "/sign-in?mode=signup", label: "Start with three free runs" }}
        secondary={{ href: "/solutions/eu-ai-act", label: "EU AI Act evidence" }}
        facts={[
          [String(totals.refs), `references carried by ${SUITE.name}`],
          [`${totals.aiActRefs} · ${totals.gdprRefs}`, "AI Act · GDPR references"],
          [`${totals.mapped} of ${totals.scenarios}`, "scenarios filed under at least one"],
          [`${totals.byLayer.rules} of ${totals.scenarios}`, "carry rules that can fail them outright"],
        ]}
      />

      <MappingNotice>
        <p className="font-medium">
          This matrix maps technical testing evidence to duties you may already have. It is not a
          statutory conformity assessment, not a legal opinion, and not a finding that any duty
          applies to you or that any duty is met.
        </p>
        <p className="text-ink-soft">
          A reference says which duty a scenario&apos;s evidence may help you document. Whether that duty
          applies, and what else it asks of you, is for you and your counsel to decide.
        </p>
      </MappingNotice>

      <Section
        index="01"
        id="matrix"
        title="The matrix"
        lede={<>Filter by framework, article or how a scenario is checked. Each filter is a link, so a view can be shared or bookmarked.</>}
      >
        <div className="mb-8 max-w-4xl rounded-panel border border-line bg-paper p-5 text-sm leading-relaxed">
          <div className="flex flex-wrap items-baseline">
            <p className="type-eyebrow text-ink-faint">Reading the AI Act references</p>
            <ExplainTrigger id="ai_act_references" />
          </div>
          <p className="mt-2 text-ink">{AI_ACT_FRAMING_SUMMARY.transparency}</p>
          <p className="mt-2 text-ink-soft">
            {AI_ACT_FRAMING_SUMMARY.highRisk} {AI_ACT_FRAMING_SUMMARY.benchmark} {AI_ACT_FRAMING_SUMMARY.determination}
          </p>
        </div>

        <MatrixFilters rows={rows} filters={filters} />

        <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
          <p className="text-sm text-ink-soft">
            <span className="font-semibold text-ink tnum">{shown.length}</span> of <span className="tnum">{rows.length}</span> references
            {" · "}
            <span className="font-semibold text-ink tnum">{shownScenarios}</span> of <span className="tnum">{totals.scenarios}</span> scenarios
            {filters.layer && <> checked by {layerName(filters.layer).toLowerCase()}</>}
          </p>
          {filtered && (
            <Link href={filterHref({})} className="text-sm font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
              Clear filters
            </Link>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="mt-6 rounded-panel border border-line bg-paper p-5 text-sm text-ink-soft">
            No scenario in this view is checked that way. <Link href={filterHref({ ...filters, layer: null })} className="font-medium text-ink underline underline-offset-2">Show every scenario in it.</Link>
          </p>
        ) : (
          FRAMEWORKS.map((f) => {
            const group = shown.filter((r) => r.framework === f.id);
            if (group.length === 0) return null;
            const n = new Set(group.flatMap((r) => r.shown.map((s) => s.id))).size;
            return (
              <section key={f.id} aria-labelledby={`group-${f.id}`} className="mt-8">
                <h3 id={`group-${f.id}`} className="flex flex-wrap items-baseline gap-x-3 text-lg font-semibold">
                  {f.name}
                  <span className="font-mono text-xs font-normal text-ink-faint tnum">
                    {group.length} reference{group.length === 1 ? "" : "s"} · {n} scenario{n === 1 ? "" : "s"}
                  </span>
                </h3>
                <ul className="mt-4 gap-4 lg:columns-2">
                  {group.map((row) => <MatrixCard key={row.ref} row={row} layer={filters.layer} />)}
                </ul>
              </section>
            );
          })
        )}

        {unplaced.length > 0 && (
          <p className="mt-6 text-sm text-ink-faint">
            Also carried by the suite, outside both frameworks: {unplaced.join(", ")}.
          </p>
        )}
        <p className="mt-6 max-w-4xl text-sm leading-relaxed text-ink-faint">
          A scenario can carry several references, so it appears under each. The matrix lists only the
          references {SUITE.name} carries: an article that is not here has no scenario in this suite,
          and the matrix says nothing about it.
        </p>
      </Section>

      <Section
        paper
        index="02"
        id="layers-heading"
        title="How each scenario is checked"
        lede="Read off what each scenario declares, in the order a run applies them. A layer a scenario does not declare is not claimed for it."
      >
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {LAYERS.map((l, i) => (
            <li key={l.id} className="flex flex-col rounded-panel border border-line bg-surface p-5 shadow-card">
              <span className="grid size-[2.125rem] place-items-center rounded-full border border-line-strong font-mono text-xs font-semibold text-ink">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-base font-semibold">{l.name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{l.body}</p>
              <p className="mt-auto border-t border-line pt-3 font-mono text-xs text-ink-faint tnum">
                <Link href={filterHref({ layer: l.id })} className="underline-offset-2 hover:text-ink hover:underline">
                  {totals.byLayer[l.id]} of {totals.scenarios} scenarios
                </Link>
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        index="03"
        id="records-heading"
        title="What Novera records about each test"
        lede="Records of the test Novera ran, kept by Novera. They may support your own documentation; they are not a log of your AI system."
      >
        <Cards
          columns={3}
          items={[
            { title: "Inputs declared before the run", body: "Suite version and scenario order, policy version, agent host, grading plan, pass mark, runner version and rubric digest are frozen before the first scenario is sent." },
            { title: "Append-only evidence", body: "Each declared scenario is recorded once. A verdict cannot be edited, or deleted short of erasing the whole workspace — by you or by Novera." },
            { title: "Sealed and chained", body: "Each report carries a SHA-256 digest of its content and the hash of the previous report for the same agent, so anyone holding a copy can re-check it." },
            { title: "Who graded", body: "Every model consulted is recorded with its vote, including one that was overruled, and the report says how each verdict was corroborated. A scenario settled by a rule or the read-back names no model." },
            { title: "Authorisation on record", body: "The confirmation that you own the agent or are authorised to test it is stored with the run and sealed into its report." },
            { title: "Retention", body: "The agent's raw replies are kept for your workspace's retention period, 30 to 365 days (180 by default), then emptied, leaving the verdict and a SHA-256 of each reply." },
          ]}
        />
        <div className="mt-8 max-w-4xl rounded-panel border border-line-strong bg-paper p-5 text-sm leading-relaxed">
          <p className="type-eyebrow text-ink-faint">About AI Act Article 12</p>
          <p className="mt-2 text-ink">
            These are Novera&apos;s records of a test it ran. They are not the record-keeping Article 12
            of the AI Act asks a high-risk AI system itself to provide: Novera does not log your
            agent&apos;s operation, only what happened in the scenarios it sent.
          </p>
          <p className="mt-2 text-ink-soft">
            {art12.length === 0
              ? <>No scenario in {SUITE.name} is filed under AI Act Article 12, so the matrix has no row for it.</>
              : <>{SUITE.name} files scenarios under AI Act Article 12; the matrix lists them as the suite does.</>}{" "}
            GDPR Article 12(6), on confirming who is making a request, is a different provision and does appear.
          </p>
        </div>
      </Section>

      <NotCertification
        items={[
          ["Not a conformity assessment.", "Novera is not a notified body, and this matrix is not an approval by one."],
          ["Not legal advice.", "It does not say which obligations apply to your organisation."],
          ["Only this suite.", `The references ${SUITE.name} carries — not every duty the AI Act or the GDPR contains.`],
          ["Evidence, not outcome.", "A scenario under a reference says what was tested, not whether your agent passed it."],
        ]}
      />

      <ClosingCta
        signedIn={signedIn}
        title="Run these scenarios against your own agent"
        lede="Connect an HTTP endpoint, write the policy it should keep, and get a sealed report with every verdict filed under these references."
        secondary={{ href: "/docs/what-the-report-contains", label: "What a report contains" }}
      />
    </SolutionFrame>
  );
}

function layerName(id: Layer): string {
  return LAYERS.find((l) => l.id === id)?.name ?? id;
}

const CHIP = "inline-flex min-h-8 items-center rounded-full border px-3 text-sm transition-colors duration-150";
const CHIP_ON = "border-ink bg-ink font-medium text-on-ink";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <li>
      <Link href={href} aria-current={active ? "true" : undefined} className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}>
        {children}
      </Link>
    </li>
  );
}

/** Three rows of links. Each keeps the other filters and lands back on the matrix. */
function MatrixFilters({ rows, filters }: { rows: MatrixRow[]; filters: Filters }) {
  const articlesOf = (fw: (typeof FRAMEWORKS)[number]["id"]) =>
    [...new Set(rows.filter((r) => r.framework === fw).map((r) => r.articleNumber))];
  const frameworks = filters.framework ? FRAMEWORKS.filter((f) => f.id === filters.framework) : FRAMEWORKS;

  return (
    <div className="grid gap-5">
      <FilterGroup id="filter-framework" label="Framework">
        <Chip href={filterHref({ layer: filters.layer })} active={!filters.framework}>Both</Chip>
        {FRAMEWORKS.map((f) => (
          <Chip key={f.id} href={filterHref({ framework: f.id, layer: filters.layer })} active={filters.framework === f.id}>{f.name}</Chip>
        ))}
      </FilterGroup>

      <FilterGroup id="filter-article" label="Article">
        <Chip href={filterHref({ framework: filters.framework, layer: filters.layer })} active={!filters.article}>All</Chip>
        {frameworks.map((f) =>
          articlesOf(f.id).map((n) => (
            <Chip
              key={`${f.id}-${n}`}
              href={filterHref({ framework: f.id, article: n, layer: filters.layer })}
              active={filters.article === n && (!filters.framework || filters.framework === f.id)}
            >
              {filters.framework ? `Art. ${n}` : `${f.id === "ai-act" ? "AI Act" : "GDPR"} ${n}`}
            </Chip>
          )),
        )}
      </FilterGroup>

      <FilterGroup id="filter-layer" label="Checked by">
        <Chip href={filterHref({ framework: filters.framework, article: filters.article })} active={!filters.layer}>Any</Chip>
        {LAYERS.map((l) => (
          <Chip key={l.id} href={filterHref({ framework: filters.framework, article: filters.article, layer: l.id })} active={filters.layer === l.id}>{l.name}</Chip>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-baseline">
      <p id={id} className="type-eyebrow text-ink-faint">{label}</p>
      <ul aria-labelledby={id} className="flex flex-wrap gap-2">{children}</ul>
    </div>
  );
}

/** One reference: its scenarios, stacked at every width, so nothing scrolls sideways at 390. */
function MatrixCard({ row, layer }: { row: FilteredRow; layer: Layer | null }) {
  const framework = FRAMEWORKS.find((f) => f.id === row.framework)!;
  const total = row.scenarios.length;
  const framing = row.framework === "ai-act" ? aiActFramingFor(row.ref) : null;
  return (
    <li id={row.anchor} className="mb-4 break-inside-avoid scroll-mt-24 rounded-panel border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-line p-5">
        <div className="min-w-0">
          <h4 className="text-lg font-semibold"><span className="sr-only">{framework.name} </span>Art. {row.article}</h4>
          {row.heading && <p className="mt-0.5 text-sm text-ink-soft">{row.heading}</p>}
        </div>
        <p className="font-mono text-xs text-ink-faint tnum">
          {layer ? `${row.shown.length} of ${total}` : total} scenario{total === 1 ? "" : "s"}
        </p>
      </div>
      {framing && <p className="border-b border-line px-5 py-3 text-xs leading-relaxed text-ink-soft">{framing.sentence}</p>}
      <ul className="divide-y divide-line">
        {row.shown.map((s) => (
          <li key={s.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-5 py-3 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:items-baseline">
            <span className="font-mono text-xs font-semibold text-ink tnum">{s.id}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{s.label}</p>
              {s.detail && <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{s.detail}</p>}
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-3 sm:justify-end">
              <Badge tone={s.severity}>{s.severity}</Badge>
              <span className="sr-only">Checked by:</span>
              {s.layers.map((l) => (
                <span key={l} className={`rounded-control border px-1.5 py-0.5 font-mono text-[11px] ${l === layer ? "border-ink text-ink" : "border-line text-ink-faint"}`}>
                  {layerName(l)}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}
