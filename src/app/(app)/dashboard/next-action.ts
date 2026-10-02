/**
 * The one thing to do next, for the personal dashboard — from stored state and from what this
 * person's role may do, never a guess about intent. Every step offered is one the person can
 * take: a reviewer is never told to "run the suite".
 *
 * The onboarding goal only breaks a tie at the start: someone who said they deliver agents to
 * clients is pointed at a client workspace before an agent, because that is where their agent
 * belongs.
 */
export interface NextInput {
  goal: "own_agent" | "client_delivery" | "governance" | null;
  accountMode: "personal" | "agency" | "enterprise";
  workspaces: number;
  hasAgent: boolean;
  firstAgentId: string | null;
  hasPolicy: boolean;
  hasRun: boolean;
  runInFlight: string | null;
  topFinding: { href: string; caseId: string; label: string } | null;
  noVerdict: number;
  readyRunId: string | null;
  blockedReason: string | null;
  may: { connect: boolean; run: boolean; review: boolean };
}

export interface NextAction {
  title: string;
  body: string;
  href: string;
  label: string;
}

export function nextAction(s: NextInput): NextAction {
  if (s.goal === "client_delivery" && s.workspaces === 1 && !s.hasAgent) {
    return { title: "Add your first client", body: "One workspace per client keeps their agents, keys and reports apart, and each report names that client.", href: "/workspaces", label: "Add a client workspace" };
  }
  if (!s.hasAgent) {
    return s.may.connect
      ? { title: "Connect your agent", body: "Its address and your confirmation that you may test it. Novera sends one harmless message first, so you see the reply before anything else.", href: "/agents/new", label: "Connect an agent" }
      : { title: "Nothing connected yet", body: "Someone with the operator, admin or owner role connects the agent. Once there is a run, its findings come to you.", href: "/guide", label: "Read how Novera works" };
  }
  if (s.runInFlight) {
    return { title: "A run is in progress", body: "Scenarios are being sent and graded. The result appears when every scenario is recorded — never before.", href: `/runs/${s.runInFlight}`, label: "Open the run in progress" };
  }
  if (!s.hasPolicy && s.may.connect) {
    return { title: "Write the policy your agent should keep", body: "Every verdict is judged against this text, and each saved version is kept.", href: `/agents/${s.firstAgentId}`, label: "Write the policy" };
  }
  if (!s.hasRun) {
    if (s.blockedReason) return { title: "Connect a model key to run", body: s.blockedReason, href: "/settings", label: "Open settings" };
    return s.may.run
      ? { title: "Run your first evaluation", body: "Forty-nine scenarios against your agent, graded against your policy, sealed into a dated report.", href: `/agents/${s.firstAgentId}`, label: "Run the suite" }
      : { title: "Waiting for the first run", body: "An operator, admin or owner starts runs. Its findings come to you for review.", href: "/review", label: "Open review" };
  }
  if (s.topFinding && s.may.review) {
    return { title: `Look at ${s.topFinding.caseId}`, body: s.topFinding.label, href: s.topFinding.href, label: `Review ${s.topFinding.caseId}` };
  }
  if (s.noVerdict > 0) {
    return { title: `${s.noVerdict} ${s.noVerdict === 1 ? "scenario has" : "scenarios have"} no verdict`, body: "Each says why and whether retrying is safe. None is counted as a pass, so the report stays withheld until they are settled.", href: "/review#repair", label: "See what has no verdict" };
  }
  if (s.readyRunId) {
    return { title: "Your report is ready to share", body: "Sealed, intact, every scenario with a verdict. Send the private link or export it.", href: `/runs/${s.readyRunId}#report`, label: "Open the report" };
  }
  return s.may.run
    ? { title: "Run it again after your next change", body: "A rerun compares scenario by scenario and says what newly broke, and why each verdict moved.", href: `/agents/${s.firstAgentId}`, label: "Run again" }
    : { title: "Nothing waiting for you", body: "New findings appear here when a run completes.", href: "/review", label: "Open review" };
}
