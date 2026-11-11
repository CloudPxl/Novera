import { scanCustomerLanguage } from "../report/language.ts";
import { BOT_TOKEN } from "./protocol.ts";
import type { InsightCard } from "./card.ts";

/**
 * Outreach drafts (0085): written from a versioned template and the computed card, never by a
 * model and never quoting a reply. Novera does not send them; a person copies the text, sends it
 * by hand, and records that they did. Every draft carries the disclosure line — who ran the test,
 * how, and that they are not affiliated with the vendor — and the opt-out line, and the database
 * refuses a draft that does not contain both, or any draft for a target marked do not contact.
 */
export const OUTREACH_TEMPLATE_VERSION = 1;

export type OutreachKind = "email" | "dm" | "follow_up" | "staging_offer";

export const OUTREACH_KIND_LABEL: Record<OutreachKind, string> = {
  email: "First email",
  dm: "Short direct message",
  follow_up: "Follow-up",
  staging_offer: "Staging evaluation offer",
};

export const SENT_CHANNELS = { email: "Email", linkedin: "LinkedIn", contact_form: "Contact form", other: "Other" } as const;
export const OUTCOMES = {
  replied: "They replied",
  meeting: "A meeting was booked",
  declined: "They declined",
  no_response: "No response",
  opted_out: "They asked not to be contacted",
} as const;

/** The longest run of a reply's characters a draft may share with it; longer is a quotation. */
export const QUOTE_LIMIT_CHARS = 40;

export function disclosureLine(sender: string, targetName: string): string {
  return `${sender} is not affiliated with ${targetName}. The test was run with Novera's browser worker, which identifies itself as ${BOT_TOKEN} and follows the site's robots.txt.`;
}

export const OPT_OUT_LINE = "If you would rather not hear from us about this, reply \"no thanks\" and we will not contact you about it again.";

const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function findings(card: InsightCard): string[] {
  const { counts } = card;
  const lines = [
    `${counts.passed} of ${plural(counts.recorded, "reply", "replies")} did what the message called for; ${counts.failed} did not${counts.noResult ? `; ${counts.noResult} produced no result` : ""}.`,
  ];
  if (card.strength?.headline) lines.push(`What held up: ${card.strength.headline}.`);
  if (card.concern?.headline) lines.push(`Worth a look: ${card.concern.headline}.`);
  return lines;
}

/**
 * A draft from the template. `card` is the computed card of a graded scan (every kind but a
 * staging offer); a staging offer speaks of no scan, because a Category B or C bot is never scanned.
 */
export function buildOutreachDraft(args: {
  kind: OutreachKind;
  sender: string;
  target: { name: string; url: string };
  card: InsightCard | null;
  /** For a follow-up: when the first note was sent, as recorded. */
  firstSentOn?: string | null;
}): { subject: string | null; body: string; disclosure: string; optOut: string } {
  const { kind, sender, target, card } = args;
  const disclosure = disclosureLine(sender, target.name);
  const site = host(target.url);
  const scope = "It looked at public replies only: nothing behind the widget was acted on, and it is neither a security test nor a certification.";

  if (kind === "staging_offer") {
    return {
      subject: `Testing ${target.name}'s assistant before customers do`,
      body: [
        "Hello,",
        `We test AI support assistants by sending them realistic customer conversations and grading the replies with AI models from different vendors. The assistant on ${site} can reach accounts, orders or payments, so we did not test it on the live site.`,
        "With your authorisation, we can run the same kind of evaluation against a staging copy: a dated report of each scenario, what was expected, what the assistant did and why it passed or failed, which you can check yourself.",
        "Would a short call to see whether that is useful be worth your time?",
        disclosure,
        OPT_OUT_LINE,
      ].join("\n\n"),
      disclosure,
      optOut: OPT_OUT_LINE,
    };
  }
  if (!card || card.status !== "graded" || !card.scanDate) throw new Error("A draft about a scan needs that scan graded.");
  const what = `${plural(card.counts.declared, "scripted message")}, each sent once in a fresh browser session, the replies graded by AI models from different vendors`;

  if (kind === "dm") {
    return {
      subject: null,
      body: [
        `Hi, ${sender} here. On ${card.scanDate} we ran a short automated test of the public assistant on ${site} (${what}). ${findings(card)[0]} Happy to share what we saw and a suggested change for each.`,
        disclosure,
        OPT_OUT_LINE,
      ].join("\n\n"),
      disclosure,
      optOut: OPT_OUT_LINE,
    };
  }
  if (kind === "follow_up") {
    return {
      subject: `Following up: ${target.name}'s public assistant`,
      body: [
        "Hello again,",
        `${args.firstSentOn ? `On ${args.firstSentOn} I` : "I"} wrote about a short automated test of the public assistant on ${site}, run on ${card.scanDate}. ${findings(card)[0]}`,
        "If it would help, we can walk through each scenario and the change we would try first, or set up a fuller evaluation against a staging copy with your authorisation.",
        disclosure,
        OPT_OUT_LINE,
      ].join("\n\n"),
      disclosure,
      optOut: OPT_OUT_LINE,
    };
  }
  return {
    subject: `A short test of ${target.name}'s public assistant`,
    body: [
      "Hello,",
      `On ${card.scanDate}, ${sender} ran a short automated test of the public chat assistant on ${site}: ${what}.`,
      findings(card).map((l) => `- ${l}`).join("\n"),
      scope,
      card.counts.failed > 0
        ? "We can share each scenario, the reason it fell short and a suggested change to try, and test the assistant again afterwards to show whether the replies moved."
        : "We can share each scenario and what the replies did, and suggest where a fuller evaluation against a staging copy would add to it.",
      disclosure,
      OPT_OUT_LINE,
    ].join("\n\n"),
    disclosure,
    optOut: OPT_OUT_LINE,
  };
}

/**
 * Why a draft may not be stored, as sentences; empty when it may. `replies` are the scan's stored
 * replies: a draft never quotes one, so no run of more than QUOTE_LIMIT_CHARS characters is shared.
 */
export function outreachProblems(draft: { subject: string | null; body: string; disclosure: string; optOut: string }, replies: Array<string | null>): string[] {
  const problems: string[] = [];
  const all = `${draft.subject ?? ""}\n${draft.body}`;
  if (!draft.body.includes(draft.disclosure)) problems.push("The draft is missing its disclosure line.");
  if (!draft.body.includes(draft.optOut)) problems.push("The draft is missing its opt-out line.");
  for (const f of scanCustomerLanguage(all)) problems.push(`"${f.matched}": ${f.why}`);
  const windows = new Set<string>();
  const n = QUOTE_LIMIT_CHARS + 1;
  for (let i = 0; i + n <= all.length; i++) windows.add(all.slice(i, i + n));
  for (const reply of replies) {
    if (!reply) continue;
    for (let i = 0; i + n <= reply.length; i++) {
      if (windows.has(reply.slice(i, i + n))) {
        problems.push(`The draft repeats more than ${QUOTE_LIMIT_CHARS} characters of a reply word for word; a draft describes, it never quotes.`);
        return problems;
      }
    }
  }
  return problems;
}
