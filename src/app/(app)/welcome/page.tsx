import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session.ts";
import { completeOnboarding, skipOnboarding } from "@/lib/workflow/identity.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { inputClass } from "@/components/ui/primitives.tsx";

export const metadata: Metadata = { title: "Welcome · Novera" };
export const dynamic = "force-dynamic";

/**
 * Three questions, each with a destination (docs/audits/2026-10-02-identity-and-tenancy.md,
 * "Onboarding answer map"): who it is for sets the account mode and its screens; the first goal
 * sets the dashboard's primary action and where this page sends you; the channels decide which
 * honest note you see about what Novera can test. Nothing is asked for research. Skippable.
 */
const WHO = [
  { value: "solo", title: "Just me", body: "An engineer, founder or consultant testing an agent." },
  { value: "agency", title: "An agency or consultancy", body: "We build or run agents for clients." },
  { value: "company", title: "A company team", body: "We assure our own agents, with reviewers and audit." },
];
const GOALS = [
  { value: "own_agent", title: "Test my own agent", body: "Connect it and run the suite." },
  { value: "client_delivery", title: "Deliver agents to clients", body: "A workspace and a report per client; a release gate." },
  { value: "governance", title: "Internal assurance", body: "Evidence, readiness and an audit trail." },
];
const CHANNELS = [
  { value: "web", title: "Web chat or an API" },
  { value: "voice", title: "Voice or phone" },
  { value: "email", title: "Email" },
];

export default async function WelcomePage() {
  const ctx = await requireContext();
  const who = ctx.accountMode === "agency" ? "agency" : ctx.accountMode === "enterprise" ? "company" : "solo";
  const choice = "flex cursor-pointer gap-3 rounded-panel border border-line bg-surface p-4 text-sm transition-colors hover:border-line-strong has-[:checked]:border-ink has-[:checked]:shadow-card";

  return (
    <main className="mx-auto w-full max-w-3xl py-10 text-ink">
      <p className="type-eyebrow text-ink-faint">Welcome</p>
      <h1 className="mt-2 type-h1">Set Novera up for how you work</h1>
      <p className="mt-2 max-w-2xl type-body text-ink-soft">
        Three questions, about a minute. Each one changes what you see; none changes how anything is tested or
        graded. You can change every answer later in your profile.
      </p>

      <form action={completeOnboarding} className="mt-8 space-y-8">
        <label className="block max-w-sm">
          <span className="block text-sm font-medium">Your name <span className="font-normal text-ink-faint">(optional)</span></span>
          <span className="mt-0.5 block text-xs text-ink-faint">Shown to teammates beside what you did. Never in a report.</span>
          <input name="displayName" maxLength={80} defaultValue={ctx.profile.display_name ?? ""} className={`${inputClass} mt-1.5`} />
        </label>

        <fieldset>
          <legend className="text-base font-semibold">Who is Novera for?</legend>
          <p className="mt-0.5 text-xs text-ink-faint">Sets your screens: simple for one person; clients and members for an agency; governance first for a company.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {WHO.map((o) => (
              <label key={o.value} className={choice}>
                <input type="radio" name="who" value={o.value} defaultChecked={o.value === who} required className="mt-1 accent-current" />
                <span><span className="font-semibold">{o.title}</span><span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{o.body}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-base font-semibold">What do you want to do first?</legend>
          <p className="mt-0.5 text-xs text-ink-faint">Decides where this page takes you and the first action on your dashboard.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {GOALS.map((o) => (
              <label key={o.value} className={choice}>
                <input type="radio" name="goal" value={o.value} defaultChecked={o.value === (ctx.profile.primary_goal ?? "own_agent")} className="mt-1 accent-current" />
                <span><span className="font-semibold">{o.title}</span><span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{o.body}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-base font-semibold">Where does your agent talk to customers?</legend>
          <p className="mt-0.5 text-xs text-ink-faint">Novera tests an agent over HTTP. If yours is reached another way, your dashboard says how to test it — or that it cannot be, yet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHANNELS.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm has-[:checked]:border-ink">
                <input type="checkbox" name="channels" value={o.value} defaultChecked={ctx.profile.channels.includes(o.value)} className="accent-current" />
                {o.title}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <SubmitButton pendingLabel="Setting up…">Continue</SubmitButton>
          <span className="text-sm text-ink-faint">Same evidence rules, isolation and sealing in every mode.</span>
        </div>
      </form>
      <form action={skipOnboarding} className="mt-3">
        <button type="submit" className="text-sm text-ink-soft underline underline-offset-2 hover:text-ink">Skip — use the simple personal setup</button>
      </form>
    </main>
  );
}
