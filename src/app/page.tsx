import { LogoMark } from "@/components/ui/logo.tsx";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { JsonLd } from "@/components/seo/json-ld.tsx";
import { softwareApplicationLd } from "@/lib/seo/json-ld.ts";
import { DEFAULT_TITLE, pageMetadata } from "@/lib/seo/site.ts";
import { SampleReport } from "./sample-report.tsx";
import { SiteHeader } from "./_home/site-header.tsx";
import { Instruments } from "./_home/instruments.tsx";
import { Workflow } from "./_home/workflow.tsx";

export const metadata: Metadata = {
  ...pageMetadata({
    title: DEFAULT_TITLE,
    description:
      "Run a versioned scenario suite against an AI support agent you operate and produce a dated, hash-sealed report you can hand to a client.",
    path: "/",
    cardTitle: "Evidence your AI agent behaves as your policies require",
  }),
  // The layout's template would append the site name to a title that already carries it.
  title: { absolute: DEFAULT_TITLE },
};

/**
 * The public front door.
 *
 * Deliberately claims nothing the product does not already do. Every number and
 * behaviour named here is one the running code produces — the suite size, the
 * append-only storage, the two-vendor verdict, the read-back, the sealed hash. Every
 * product picture is labelled illustrative. There is no pricing, no customer logo and no
 * testimonial on this page: none has been decided or earned, and inventing one to fill a
 * section would be the first dishonest thing on the site.
 *
 * Composition (2026-10-02 redesign, docs/DESIGN.md): a 1440 frame with text held to a
 * reading measure, numbered sections, the product in the first screen, and full-width
 * paper bands for the sections that show a process.
 */
export default async function Home() {
  const signedIn = Boolean(await currentUser());
  const start = signedIn ? "/dashboard" : "/sign-in";

  return (
    <div className="bg-surface text-ink">
      <JsonLd data={softwareApplicationLd()} />
      <SiteHeader signedIn={signedIn} />

      <main id="main">
        {/* ------------------------------------------------------------- hero */}
        <section id="evidence" className="relative overflow-hidden border-b border-line">
          <div aria-hidden className="bg-blueprint pointer-events-none absolute inset-0" />
          <div className="wrap-wide relative grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,7fr)] lg:items-center lg:gap-14 lg:py-24">
            <Reveal>
              <p className="type-eyebrow text-ink-faint">For agencies and teams who ship AI support agents to clients</p>
              <h1 className="mt-5 type-display">
                When your client asks how the agent behaves, send them{" "}
                <span className="text-ink-soft">the document.</span>
              </h1>
              <p className="mt-6 measure type-lede text-ink-soft">
                Novera runs a versioned scenario suite against an agent you operate, checks what it
                claimed against what actually happened, and seals a dated report that says what was
                tested, what was judged, what was verified — and what remains unknown.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink href={start} className="px-5 py-3 text-[15px]">
                  {signedIn ? "Open your dashboard" : "Start with three free runs"}
                </ButtonLink>
                <ButtonLink href="#how-it-works" variant="secondary" className="px-5 py-3 text-[15px]">
                  See how it works
                </ButtonLink>
              </div>
              <p className="mt-4 text-sm text-ink-faint">No card. About ten minutes to a first report. Three free runs, then a plan for recurring testing.</p>

              <dl className="mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-6">
                {[
                  ["49", "scenarios in every run, fixed per suite version"],
                  ["2 vendors", "grade each verdict on our key"],
                  ["SHA-256", "seals every report to its evidence"],
                  ["Frankfurt", "where the database runs"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-mono text-sm font-semibold text-ink tnum">{k}</dt>
                    <dd className="mt-0.5 text-xs leading-relaxed text-ink-faint">{v}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
            <Reveal delay={120}>
              <SampleReport />
              <p className="mt-3 text-center text-xs text-ink-faint">Open the finding for its evidence chain, or compare it with the last run.</p>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- the trace */}
        <section aria-labelledby="trace-heading" className="border-b border-line">
          <div className="wrap-wide py-20 sm:py-24">
            <SectionHead index="01" id="trace-heading" title="What one scenario goes through">
              Six stages, in order, for every scenario. Each is stored, so a report shows which one
              decided the verdict.
            </SectionHead>
            <Reveal className="mt-12">
              <ol className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-6 lg:gap-4">
                <span aria-hidden className="novera-line-x absolute left-0 right-0 top-[1.0625rem] hidden h-px bg-line-strong lg:block" />
                {TRACE.map((s, i) => (
                  <li key={s.name} className="relative">
                    <span className="relative z-10 grid size-[2.125rem] place-items-center rounded-full border border-line-strong bg-surface font-mono text-xs font-semibold text-ink novera-pop" style={{ ["--delay" as string]: `${200 + i * 110}ms` }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-4 text-base font-semibold">{s.name}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.body}</p>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* ----------------------------------------------------- before/after */}
        <section aria-labelledby="problem-heading" className="border-b border-line bg-paper">
          <div className="wrap-wide py-20 sm:py-24">
            <SectionHead index="02" id="problem-heading" title="Manual spot-checking covers a fraction of what your agent does">
              A prompt changed on Tuesday and the client noticed first. &ldquo;We think so&rdquo; is
              not an answer to &ldquo;is it still behaving?&rdquo;
            </SectionHead>
            <div className="mt-12 grid gap-4 lg:grid-cols-[minmax(0,5fr)_auto_minmax(0,7fr)] lg:items-stretch">
              <Reveal className="flex flex-col rounded-shell border border-dashed border-line-strong bg-surface/60 p-6">
                <p className="type-eyebrow text-ink-faint">What teams usually have</p>
                <ul className="novera-stagger mt-5 flex flex-wrap gap-2.5">
                  {BEFORE.map((b, i) => (
                    <li key={b} style={{ ["--i" as string]: i, rotate: `${[-1.5, 1, -0.5, 1.5, -1, 0.5][i % 6]}deg` }} className="rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink-soft shadow-card">
                      {b}
                    </li>
                  ))}
                </ul>
                <p className="mt-auto pt-6 text-sm leading-relaxed text-ink-faint">Nothing here can be handed to a client, compared with last month, or shown to an auditor.</p>
              </Reveal>
              <div aria-hidden className="hidden items-center justify-center px-2 lg:flex">
                <span className="grid size-10 place-items-center rounded-full border border-line-strong bg-surface text-ink-soft">→</span>
              </div>
              <Reveal delay={120} className="rounded-shell border border-line-strong bg-surface p-6 shadow-card">
                <p className="type-eyebrow text-ink-faint">What Novera produces</p>
                <ul className="novera-stagger mt-5 divide-y divide-line">
                  {AFTER.map((a, i) => (
                    <li key={a.title} style={{ ["--i" as string]: i + 2 }} className="flex gap-4 py-3.5 first:pt-0 last:pb-0">
                      <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ink text-[11px] text-on-ink">✓</span>
                      <div>
                        <p className="text-[15px] font-semibold">{a.title}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{a.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ instruments */}
        <section aria-labelledby="instruments-heading" className="border-b border-line">
          <div className="wrap-wide py-20 sm:py-24">
            <SectionHead index="03" id="instruments-heading" title="A report is only worth sending if it cannot be quietly improved">
              Enforced in the database, not promised in a brochure. Try each one: the data is
              illustrative, the behaviour is the product&apos;s.
            </SectionHead>
            <div className="mt-12">
              <Instruments />
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- workflow */}
        <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-16 border-b border-line bg-paper">
          <div className="wrap-wide py-20 sm:py-24">
            <SectionHead index="04" id="how-heading" title="Four steps, about ten minutes">
              An HTTP endpoint you operate, the rules it should keep, and a run. Choose a step to see
              its screen.
            </SectionHead>
            <div className="mt-12">
              <Workflow />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- after failure */}
        <section aria-labelledby="after-heading" className="border-b border-line">
          <div className="wrap-wide py-20 sm:py-24">
            <SectionHead index="05" id="after-heading" title="What happens after a scenario fails">
              A failure has a path, and every step that changes something waits for a person.
            </SectionHead>
            <Reveal className="mt-12">
              <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
                {AFTER_FAILURE.map((s, i) => (
                  <li key={s.title} className="relative flex flex-col rounded-panel border border-line bg-surface p-4 shadow-card">
                    <span className="font-mono text-[11px] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                    <p className="mt-2 text-sm font-semibold">{s.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-soft">{s.body}</p>
                    {s.person && <span className="mt-auto flex items-center gap-1.5 pt-3 text-[11px] font-medium text-ink"><span aria-hidden className="size-1.5 rounded-full bg-ink" />Waits for a person</span>}
                    {i < AFTER_FAILURE.length - 1 && <span aria-hidden className="absolute -right-2.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-[10px] text-ink-faint lg:grid">→</span>}
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------------ ship */}
        <section aria-labelledby="ship-heading" className="border-b border-line bg-paper">
          <div className="wrap-wide grid grid-cols-1 gap-12 py-20 sm:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center [&>*]:min-w-0">
            <div>
              <SectionHead stacked index="06" id="ship-heading" title="Fits the way you already ship">
                Gate a release, rerun on a schedule, or start a run from n8n. A missing verdict
                fails the gate like a failed one.
              </SectionHead>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  ["Release gate", "A REST call starts a run; five exit codes tell a pass from a failure from missing evidence.", "/docs/cli-and-ci"],
                  ["Schedules", "A pinned suite at a fixed UTC time; a schedule that cannot start pauses and says why.", "/docs/scheduled-runs"],
                  ["n8n and webhooks", "Signed webhooks and four importable n8n workflows, each run in n8n before it shipped.", "/docs/api"],
                  ["Production failures", "Send a real failure in; it comes back as a draft scenario a person approves.", "/docs/regressions-from-production"],
                ].map(([t, b, href]) => (
                  <li key={t} className="flex gap-3">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
                    <p><Link href={href} className="font-semibold underline-offset-2 hover:underline">{t}</Link> <span className="text-ink-soft">— {b}</span></p>
                  </li>
                ))}
              </ul>
            </div>
            <Reveal delay={80}>
              <div className="overflow-hidden rounded-shell border border-ink/90 bg-ink text-on-ink shadow-[0_30px_70px_-40px_rgb(28_25_23/0.6)]">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                  <span aria-hidden className="size-2.5 rounded-full bg-white/20" />
                  <span aria-hidden className="size-2.5 rounded-full bg-white/20" />
                  <span aria-hidden className="size-2.5 rounded-full bg-white/20" />
                  <span className="ml-2 font-mono text-[11px] text-white/60">release-gate.sh · a sketch; the full script is in the docs</span>
                </div>
                <pre tabIndex={0} aria-label="Release gate script" className="overflow-x-auto p-5 outline-offset-[-4px] focus-visible:outline-white font-mono text-[12.5px] leading-relaxed text-white/85"><code>{GATE}</code></pre>
                <dl className="grid grid-cols-5 border-t border-white/10 text-center font-mono text-[11px]">
                  {[["0", "pass"], ["1", "fail"], ["2", "incomplete"], ["3", "config"], ["4", "infra"]].map(([c, m]) => (
                    <div key={c} className="border-r border-white/10 px-1 py-2.5 last:border-r-0">
                      <dt className="text-sm font-semibold text-white">{c}</dt>
                      <dd className="text-white/60">{m}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------------ trust */}
        {/* One three-column grid for everything below the heading — the flow, the ledger and
            the closing note share column lines, so nothing spans a width of its own. */}
        <section id="trust" aria-labelledby="trust-heading" className="scroll-mt-16 border-b border-line">
          <div className="wrap-wide py-20 sm:py-24">
            <SectionHead index="07" id="trust-heading" title="Where your data goes, and what a report does not say">
              The limits, before you find them. Each is also in every report&apos;s limitations block.
            </SectionHead>

            <Reveal className="mt-12">
              <ol className="grid gap-10 md:grid-cols-3 md:items-stretch">
                <FlowNode title="Your agent" where="Your infrastructure" arrow="scenarios out, replies back">
                  <li>An endpoint you own or are authorised to test</li>
                  <li>That authorisation is recorded with every run</li>
                </FlowNode>
                <FlowNode title="Novera" where="Database in Frankfurt (EU)" arrow="replies out to be graded" strong>
                  <li>Stores verdicts, evidence, policy versions and reports</li>
                  <li>Model keys encrypted, decrypted only on the server</li>
                  <li>Raw replies emptied after your retention period; the verdict and a fingerprint stay</li>
                </FlowNode>
                <FlowNode title="Grading providers" where="May be outside the EU">
                  <li>Receive the agent&apos;s replies to grade them</li>
                  <li>Each gets only the data its published terms allow; personal data becomes placeholders where needed</li>
                  <li>Every report names the models that graded it</li>
                </FlowNode>
              </ol>
              <p className="mt-4 text-sm text-ink-faint">
                Database residency and model processing are two different questions.{" "}
                <Link href="/docs/data-and-privacy" className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">What goes where, exactly.</Link>
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 md:grid-cols-3 md:gap-10">
              {LEDGER.map((col, i) => (
                <Reveal key={col.title} delay={i * 80} className={`flex h-full flex-col rounded-shell border p-6 ${col.tone}`}>
                  <p className="type-eyebrow">{col.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">{col.sub}</p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {col.items.map((t) => (
                      <li key={t} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-current opacity-60" /><span className="text-ink">{t}</span></li>
                    ))}
                  </ul>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-12">
              <div className="grid gap-6 border-t border-line-strong pt-10 md:grid-cols-3 md:gap-10">
                <div>
                  <h3 className="type-section text-[1.75rem]">What Novera is not</h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">A document that overstates itself is worth less — especially to the person you hand it to.</p>
                </div>
                <ul className="grid gap-3 text-sm leading-relaxed text-ink-soft sm:grid-cols-2 md:col-span-2 md:gap-x-10">
                  {NOT_CLAIMED.map(([t, b]) => (
                    <li key={t} className="flex gap-3">
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
                      <p><span className="font-semibold text-ink">{t}</span> {b}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        {/* -------------------------------------------------------------- CTA */}
        <section aria-labelledby="cta-heading" className="relative overflow-hidden">
          <div aria-hidden className="bg-blueprint pointer-events-none absolute inset-0" />
          <div className="wrap relative py-24 text-center sm:py-28">
            <Reveal>
              <h2 id="cta-heading" className="type-section">Run it against your own agent</h2>
              <p className="mx-auto mt-5 measure type-lede text-ink-soft">
                Three free runs, on our key or yours. Then a plan: Team BYOK grades on your own model
                key; Agency Pro adds runs graded on ours.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <ButtonLink href={start} className="px-6 py-3 text-[15px]">
                  {signedIn ? "Open your dashboard" : "Start with three free runs"}
                </ButtonLink>
                <ButtonLink href="/apply" variant="secondary" className="px-6 py-3 text-[15px]">Talk to us first</ButtonLink>
              </div>
              <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-faint">
                <li>No card</li>
                <li>Email, Google or GitHub</li>
                <li>About ten minutes to a first report</li>
              </ul>
              <p className="mt-6 text-sm text-ink-faint">An agency, or several clients&apos; agents? &ldquo;Talk to us first&rdquo; reaches a person.</p>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="wrap-wide grid gap-8 py-12 text-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <p className="flex items-center gap-1 font-semibold"><LogoMark className="size-7" />Novera</p>
            <p className="mt-3 max-w-xs leading-relaxed text-ink-faint">Evidence that an AI support agent behaves as its written policy requires. Database in Frankfurt (EU).</p>
          </div>
          <FooterCol title="Product" links={[["How it works", "/#how-it-works"], ["Step-by-step guide", "/guide"], ["Solutions", "/solutions"], ["Verify a report", "/verify"], ["Sign in", "/sign-in"]]} />
          <FooterCol title="Documentation" links={[["All documentation", "/docs"], ["Data and privacy", "/docs/data-and-privacy"], ["Limitations", "/docs/limitations"], ["CLI and CI", "/docs/cli-and-ci"]]} />
          <FooterCol title="People" links={[["Support", "/support"], ["Talk to us first", "/apply"]]} />
        </div>
      </footer>
    </div>
  );
}

const TRACE = [
  { name: "Scenario sent", body: "A fixed input from a versioned suite — ordinary, tricky or an attack — over its declared channel." },
  { name: "Reply recorded", body: "The answer and reported tool calls, stored as received, with a SHA-256 fingerprint." },
  { name: "Rules checked", body: "Deterministic checks first. They can fail a scenario, never pass one." },
  { name: "Effect read back", body: "A claimed action is confirmed or contradicted by a read-only call to your system." },
  { name: "Graders vote", body: "What is left goes to models: on our key, two from different vendors, a third to settle a split." },
  { name: "Evidence sealed", body: "Verdict, evidence and unknowns go into a dated report; its digest covers all of it." },
];

const BEFORE = [
  "A screenshot from Tuesday",
  "“Seems fine” in a chat thread",
  "Ten prompts tried by hand",
  "The policy in one person's head",
  "No record of what failed last month",
  "“The agent said it refunded it”",
];

const AFTER = [
  { title: "Forty-nine scenarios, every time", body: "Identity, erasure, refund limits, escalation, jailbreaks, injected instructions. A suite version never changes, so reports compare." },
  { title: "Stored evidence for every verdict", body: "Reply, tool calls, read-back and every vote — append-only, so a failure cannot be deleted to flatter a score." },
  { title: "Unknowns named, not hidden", body: "No reply, an unreadable grader or an unchecked action is its own state — listed, never counted as a pass." },
  { title: "A sealed report with a revocable link", body: "Hashed to its run and your policy version; the link expires and can be revoked. No policy text, keys or raw transcript." },
];

const AFTER_FAILURE = [
  { title: "Failed scenario", body: "Its evidence chain shows which stage decided it.", person: false },
  { title: "Review queue", body: "Grouped with everything else that needs a person.", person: false },
  { title: "Ask why", body: "A proposed policy change, quoting the passage it would replace.", person: false },
  { title: "Approve", body: "Becomes a new policy version. Nothing changes on its own.", person: true },
  { title: "Retest", body: "The one scenario again, against the new version.", person: false },
  { title: "Rerun and compare", body: "Fixed, still failing, newly broken — and why each moved.", person: false },
  { title: "Reissue", body: "A new sealed report that names the old one by hash.", person: true },
];

const LEDGER = [
  { title: "Recorded", sub: "Observed by Novera during the run", tone: "border-line bg-surface text-ink", items: ["Each reply and the tool calls the agent reported", "Read-back results: confirmed, contradicted, unavailable", "Every grader's vote and how it was settled", "Timings, timeouts and errors"] },
  { title: "Declared", sub: "Stated by you, and labelled as yours", tone: "border-line bg-surface text-ink", items: ["The policy text, frozen per version", "That you are authorised to test the agent", "A release or knowledge-base revision, if you give one", "Whether the agent is production"] },
  { title: "Not verified", sub: "Outside what a run can show", tone: "border-dashed border-warning-text/50 bg-warning-surface/50 text-warning-text", items: ["Any action no read-back covered", "Behaviour on conversations outside the suite", "Which legal obligations apply to you", "Anything after the report's date"] },
];

const NOT_CLAIMED: Array<[string, string]> = [
  ["Not a certification.", "Novera is evidence of testing."],
  ["Not legal advice.", "It does not say which obligations apply to your organisation."],
  ["One dated run.", "One suite version against one policy version."],
  ["Only the suite.", "Not your agent's behaviour on every conversation, nor anything outside it."],
];

const GATE = `auth="Authorization: Bearer $NOVERA_KEY"
run=$(curl -fsS -X POST "$api/runs" -H "$auth" \\
  -H "Idempotency-Key: $GITHUB_SHA" -H 'content-type: application/json' \\
  -d '{"agent_id":"…","suite_id":"…"}' | jq -r .run.id)

# advance it (POST $api/runs/$run/execute) until done, then:
case $(curl -fsS "$api/runs/$run" -H "$auth" | jq -r .run.outcome) in
  pass) exit 0 ;;
  fail) exit 1 ;;   # a scenario failed
  *)    exit 2 ;;   # missing evidence stops the release too
esac`;

function SectionHead({ index, id, title, children, stacked = false }: { index: string; id: string; title: string; children: ReactNode; stacked?: boolean }) {
  return (
    <Reveal className={stacked ? "" : "grid gap-x-12 gap-y-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end"}>
      <div>
        <div className="flex items-center gap-3">
          <span className="type-eyebrow text-ink-faint">{index}</span>
          <span aria-hidden className="h-px w-10 bg-line-strong" />
        </div>
        <h2 id={id} className="mt-4 max-w-3xl type-section">{title}</h2>
      </div>
      <p className={`measure type-lede text-ink-soft ${stacked ? "mt-4" : "lg:pb-1.5"}`}>{children}</p>
    </Reveal>
  );
}

/**
 * One stop in the data flow. Every card in the row stretches to the tallest, and the
 * arrow to the next card sits in the grid gap, centred on the card's middle — beside it
 * on wide screens, below it (turned a quarter) when the cards stack.
 */
function FlowNode({ title, where, strong = false, arrow, children }: { title: string; where: string; strong?: boolean; arrow?: string; children: ReactNode }) {
  return (
    <li className={`relative flex h-full flex-col rounded-shell border p-5 ${strong ? "border-ink bg-surface shadow-card" : "border-line bg-surface"}`}>
      <p className="text-base font-semibold">{title}</p>
      <p className="type-eyebrow mt-1 text-ink-faint">{where}</p>
      <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-ink-soft [&>li]:relative [&>li]:pl-3.5 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[0.6em] [&>li]:before:size-1 [&>li]:before:rounded-full [&>li]:before:bg-ink-ghost">
        {children}
      </ul>
      {arrow && (
        <span
          aria-hidden
          className="absolute left-1/2 top-full flex h-10 -translate-x-1/2 items-center gap-2 whitespace-nowrap text-ink-faint md:left-full md:top-1/2 md:h-auto md:w-10 md:translate-x-0 md:-translate-y-1/2 md:justify-center"
        >
          <span className="grid size-7 rotate-90 place-items-center rounded-full border border-line bg-surface text-sm md:rotate-0">⇄</span>
          <span className="text-[11px] md:hidden">{arrow}</span>
        </span>
      )}
    </li>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <nav aria-label={title}>
      <p className="type-eyebrow text-ink-faint">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}><Link href={href} className="text-ink-soft underline-offset-2 hover:text-ink hover:underline">{label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
