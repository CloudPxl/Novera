/**
 * David's decisions from the legal build brief (§22), commercial, legal and operational: each
 * either decided — with the place in the repository that records it — or open, with what the code
 * does until then. Shown on the staff page /readiness ("Decisions").
 *
 * Every row quotes its source, and tests/launch-readiness.test.ts checks that the quote is in that
 * file word for word: a row cannot claim a decision the repository does not record. Prices appear
 * here because this page is staff-only; they are not published until the legal entity exists.
 */

export type DecisionArea = "commercial" | "legal" | "operations";

export interface Decision {
  id: string;
  area: DecisionArea;
  title: string;
  state: "decided" | "open";
  /** Who decides, or who acts once decided. */
  owner: string;
  /** What was decided, or what the code does until it is. */
  detail: string;
  /** The repository text that records it, quoted exactly. */
  source: { file: string; quote: string };
}

export const AREA_LABEL: Record<DecisionArea, string> = {
  commercial: "Commercial",
  legal: "Legal",
  operations: "Operations",
};

export const DECISIONS: readonly Decision[] = [
  // ------------------------------------------------------------------ commercial
  {
    id: "prices", area: "commercial", title: "Plan prices, currency and interval (D1)", state: "decided", owner: "David",
    detail: "Team BYOK €99 a month, Agency Pro €299 a month, EUR, monthly only; trial 3 runs. Internal until the legal entity exists: not published on the site.",
    source: { file: "docs/DECISIONS.md", quote: "2026-10-12 — Prices approved: Team BYOK €99, Agency Pro €299 a month (0066)" },
  },
  {
    id: "vat-display", area: "commercial", title: "Prices shown with or without VAT (D1)", state: "open", owner: "David + accountant",
    detail: "The billing page shows the list price and says VAT is confirmed before billing opens.",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "**Open:** VAT-inclusive or exclusive display (accountant)" },
  },
  {
    id: "d2", area: "commercial", title: "A paid plan graded on Novera's keys (D2)", state: "decided", owner: "David",
    detail: "Agency Pro, 100 managed runs a period, counted under a lock (0067).",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "decided 2026-10-12: yes, Agency Pro, 100 a period." },
  },
  {
    id: "d3", area: "commercial", title: "Runs after the trial need a plan, own key or not (D3)", state: "decided", owner: "David",
    detail: "The trial (3 runs per owner) is the whole free tier; after it every run needs a subscription or a grant. Fair use on every plan: 3 in progress, 1,000 per 30 days.",
    source: { file: "docs/DECISIONS.md", quote: "2026-10-12 — D3 decided: billing gates runs; plan-funded grading; fair use (0067)" },
  },
  {
    id: "d4", area: "commercial", title: "Run allowances (D4)", state: "decided", owner: "David",
    detail: "Unlimited on your own key on both plans; managed runs 0 / 100 a period; no rollover.",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "unlimited on your own key on both plans; managed runs 0 / 100 a period; no rollover" },
  },
  {
    id: "d5", area: "commercial", title: "Grace period after a failed payment (D5)", state: "open", owner: "David",
    detail: "Until decided: 7 days (BILLING_GRACE_DAYS).",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "| D5 | Grace period length after a failed payment | 7 days |" },
  },
  {
    id: "d6", area: "commercial", title: "Stripe's “after all retries fail” setting (D6)", state: "open", owner: "David",
    detail: "Until decided: the code handles cancel, unpaid and past due alike.",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "| D6 | Stripe \"after all retries fail\" setting: cancel, mark unpaid, or leave past_due | code handles all three |" },
  },
  {
    id: "d7", area: "commercial", title: "A free trial on a paid plan (D7)", state: "open", owner: "David",
    detail: "Until decided: only the 3-run trial.",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "| D7 | Free trial on a paid plan (Stripe `trialing`) or only the 3-run trial | 3-run trial only |" },
  },
  {
    id: "d8", area: "commercial", title: "Proration on upgrades and downgrades (D8)", state: "open", owner: "David",
    detail: "Until decided: Stripe portal defaults.",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "| D8 | Upgrades/downgrades: proration on or off; downgrades at period end | Stripe portal defaults |" },
  },
  {
    id: "d10", area: "commercial", title: "Features gated by plan (D10)", state: "open", owner: "David",
    detail: "Until decided: nothing gated; every plan lists every feature.",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "| D10 | Whether to gate features (API, MCP, schedules, webhooks) by plan | nothing gated; all plans list all features |" },
  },
  {
    id: "grading-budget", area: "commercial", title: "A funded grading budget for Agency Pro's managed runs", state: "open", owner: "David",
    detail: "Managed runs can be spent today on free-tier keys; selling Agency Pro live needs a funded budget.",
    source: { file: "docs/BILLING-DECISIONS.md", quote: "Before live: a funded grading budget for Agency Pro's managed runs." },
  },

  // ------------------------------------------------------------------ legal
  {
    id: "b2b", area: "legal", title: "Business customers only (D9)", state: "decided", owner: "David; counsel to confirm",
    detail: "No consumer checkout and no 14-day withdrawal copy. The checkout gate asks for a business's details and a business-purpose declaration.",
    source: { file: "docs/LEGAL-FRAMEWORK.md", quote: "Not offered: B2B only. No consumer checkout and no 14-day copy" },
  },
  {
    id: "wait-for-entity", area: "legal", title: "Steps that need a company wait for it", state: "decided", owner: "David",
    detail: "Company details, counsel's approval, VAT, live Stripe and published prices wait for the PFA or SRL. The code refuses to go live without them.",
    source: { file: "docs/DECISIONS.md", quote: "the steps that need a real company (PFA or SRL) wait for it" },
  },
  {
    id: "legal-form", area: "legal", title: "Legal form: PFA, SRL or another", state: "open", owner: "David + accountant",
    detail: "Counsel question 1. The founder's memo (2026-10-16) proposes an SRL on the micro-enterprise regime; not incorporated, and the accountant has not confirmed. Until then every field of data/legal/entity.ts is null (see Status).",
    source: { file: "docs/legal-inputs-required.md", quote: "`[LEGAL FORM]` (for example SRL, PFA, or another country's form)" },
  },
  {
    id: "law-forum", area: "legal", title: "Governing law and forum", state: "open", owner: "David + counsel",
    detail: "Terms 0.2 proposes Romanian law and the Bucharest courts, as a proposal for counsel.",
    source: { file: "docs/LEGAL-COUNSEL-QUESTIONS.md", quote: "Every one of them is a proposal for counsel, not a decision." },
  },
  {
    id: "service-level", area: "legal", title: "Service level, support hours and response targets", state: "open", owner: "David",
    detail: "Or a statement that there are none. Support hours in data/legal/entity.ts are empty.",
    source: { file: "docs/legal-inputs-required.md", quote: "Service level, support hours and response targets, or a statement that there are none. David." },
  },
  {
    id: "notice", area: "legal", title: "How and how early changes to the terms and sub-processors are announced", state: "open", owner: "David + counsel",
    detail: "Placeholders in the Privacy Notice, Terms, DPA and Sub-processors drafts.",
    source: { file: "docs/legal-inputs-required.md", quote: "`[NOTICE METHOD]`, `[NOTICE PERIOD]` for changes to terms, notices and sub-processors" },
  },
  {
    id: "effective-date", area: "legal", title: "Effective date of the legal texts", state: "open", owner: "David, after counsel signs off",
    detail: "Set when a document is approved and archived.",
    source: { file: "docs/legal-inputs-required.md", quote: "| `[EFFECTIVE DATE]` | David, after counsel signs off |" },
  },
  {
    id: "attestation", area: "legal", title: "Whether an attestation names a person, a role or an id", state: "open", owner: "David + counsel",
    detail: "Since 2026-10-16 a new attestation names the member's role and user id, not the email, as the founder's memo proposes. Agents connected earlier keep their frozen text, which names an email. Awaiting counsel (question 35).",
    source: { file: "docs/legal-inputs-required.md", quote: "Future attestations name a role and an id, pending counsel's confirmation (question 35)." },
  },

  // ------------------------------------------------------------------ operations
  {
    id: "stripe-production", area: "operations", title: "Remove the Stripe variables from Production", state: "open", owner: "David",
    detail: "Production refuses a test key already; the variables belong in Preview only.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "Delete the Stripe variables from Production" },
  },
  {
    id: "backups", area: "operations", title: "Production backups and recovery targets", state: "open", owner: "David",
    detail: "A runbook and a local drill exist; no production dump schedule, RTO or RPO.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "Plan with daily backups/PITR, or a scheduled off-site `pg_dump`; RTO/RPO" },
  },
  {
    id: "alerting", area: "operations", title: "Uptime check and an error destination", state: "open", owner: "David",
    detail: "Errors reach Vercel logs only.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "Uptime check on `/api/health`; Sentry EU DSN or `NOVERA_ERROR_WEBHOOK_URL`" },
  },
  {
    id: "mailboxes", area: "operations", title: "Mailboxes for support@ and dmarc@", state: "open", owner: "David",
    detail: "No MX on the apex: mail to the support address shown in the app bounces.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "Namecheap email forwarding (adds MX), forward both addresses" },
  },
  {
    id: "hosting", area: "operations", title: "Hosting tier that allows a paid product", state: "open", owner: "David",
    detail: "Vercel Hobby is for non-commercial use.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "Vercel Pro before charging" },
  },
  {
    id: "third-vendor", area: "operations", title: "A third, independent grading vendor", state: "open", owner: "David",
    detail: "Independence is groq + mistral today.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "A funded key; a data-class decision" },
  },
  {
    id: "events-salt", area: "operations", title: "Product-event salt and the consent question", state: "open", owner: "David; counsel on consent",
    detail: "First-party product events are recorded; the salt is unset.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "`NOVERA_EVENTS_SALT` in Vercel; consent question for counsel" },
  },
  {
    id: "audit-account", area: "operations", title: "Delete the 2026-10-08 audit account", state: "open", owner: "David",
    detail: "Claude will not do it without David's word.",
    source: { file: "docs/LAUNCH-READINESS.md", quote: "decide whether to delete the 2026-10-08 audit account" },
  },
];
