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
  /**
   * Where the block is resolved (src/lib/billing/remedy.ts). Absent: this person cannot resolve
   * it (a payment block, for someone who is not owner or admin), so they are told who can.
   */
  blockedRemedy?: { href: string; label: string } | null;
  may: { connect: boolean; run: boolean; review: boolean };
}

export interface NextAction {
  title: string;
  body: string;
  href: string;
  label: string;
}

export function nextAction(s: NextInput): NextAction {
  if (needsClientWorkspace(s)) {
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
    return { title: "Write the policy your agent should keep", body: "Every verdict is judged against this text, and each saved version is kept.", href: `/agents/${s.firstAgentId}?tab=policy`, label: "Write the policy" };
  }
  if (!s.hasRun) {
    if (s.blockedReason) {
      const remedy = s.blockedRemedy;
      // Not "connect a model key": since D3 a key does not fund a run after the trial, and an
      // operator cannot connect one anyway. Whoever can resolve a payment block is named instead.
      if (!remedy) return { title: "Runs cannot start yet", body: `${s.blockedReason} An owner or admin of this workspace can resolve it.`, href: "/settings/members", label: "See who can" };
      if (remedy.href === "/settings") return { title: "Connect a model key to run", body: s.blockedReason, href: "/settings", label: "Open settings" };
      return { title: remedy.href === "/billing" ? "Choose a plan to keep testing" : "Runs cannot start yet", body: s.blockedReason, href: remedy.href, label: remedy.label };
    }
    return s.may.run
      ? { title: "Run your first evaluation", body: "Every scenario of the newest built-in suite against your agent, graded against your policy, sealed into a dated report.", href: `/agents/${s.firstAgentId}`, label: "Run the suite" }
      : { title: "Waiting for the first run", body: "An operator, admin or owner starts runs. Its findings come to you for review.", href: "/review", label: "Open review" };
  }
  if (s.topFinding && s.may.review) {
    return { title: `Look at ${s.topFinding.caseId}`, body: s.topFinding.label, href: s.topFinding.href, label: `Review ${s.topFinding.caseId}` };
  }
  if (s.noVerdict > 0) {
    return { title: `${s.noVerdict} ${s.noVerdict === 1 ? "scenario has" : "scenarios have"} no verdict`, body: "Each says why and whether retrying is safe. None is counted as a pass, so the report stays withheld until they are settled.", href: "/review?view=incomplete", label: "See what has no verdict" };
  }
  if (s.readyRunId) {
    return { title: "Your report is ready to share", body: "Sealed, intact, every scenario with a verdict. Send the private link or export it.", href: `/runs/${s.readyRunId}`, label: "Open the report" };
  }
  // Blocked after earlier runs: "run again" would be a step the person cannot take.
  if (s.blockedReason && s.may.run && s.blockedRemedy) {
    return { title: s.blockedRemedy.href === "/billing" ? "Choose a plan to keep testing" : "Runs cannot start yet", body: s.blockedReason, href: s.blockedRemedy.href, label: s.blockedRemedy.label };
  }
  return s.may.run
    ? { title: "Run it again after your next change", body: "A rerun compares scenario by scenario and says what newly broke, and why each verdict moved.", href: `/agents/${s.firstAgentId}`, label: "Run again" }
    : { title: "Nothing waiting for you", body: "New findings appear here when a run completes.", href: "/review", label: "Open review" };
}

export type RailState = "done" | "current" | "pending";

export interface RailStep {
  key: "client" | "connect" | "policy" | "run";
  label: string;
  state: RailState;
  /** Where the step is done. Null while it is pending, or when this person's role cannot do it. */
  href: string | null;
  /** One quiet sentence under the step: what it is, or who can do it. */
  note: string;
}

/**
 * Whether someone delivering to clients has yet to add the first client workspace: the one case
 * where the first step is not connecting an agent. The header (`nextAction`) and the rail
 * (`onboardingRail`) both read this, so they cannot name different first steps.
 */
function needsClientWorkspace(s: Pick<NextInput, "goal" | "workspaces" | "hasAgent">): boolean {
  return s.goal === "client_delivery" && s.workspaces === 1 && !s.hasAgent;
}

/**
 * The steps before a workspace has a run, from the same stored facts `nextAction` reads.
 * The current step is the first that is not done, and its link is the header's link: both
 * apply the same order (a client workspace for someone delivering to clients, then agent, then
 * policy, then run), and a step this person's role cannot take says who can instead of linking
 * to a page that would refuse them.
 */
export function onboardingRail(
  s: Pick<NextInput, "hasAgent" | "firstAgentId" | "hasPolicy" | "hasRun" | "may"> & Partial<Pick<NextInput, "goal" | "workspaces">>,
): RailStep[] {
  const client = needsClientWorkspace({ goal: s.goal ?? null, workspaces: s.workspaces ?? 0, hasAgent: s.hasAgent });
  const agent = s.firstAgentId;
  const steps: Array<Omit<RailStep, "state" | "href"> & { done: boolean; to: string | null; allowed: boolean }> = [
    ...(client ? [{
      key: "client" as const, label: "Add a client workspace", done: false, to: "/workspaces", allowed: true,
      note: "One workspace per client keeps their agents, keys and reports apart.",
    }] : []),
    {
      key: "connect", label: "Connect your agent", done: s.hasAgent, to: "/agents/new", allowed: s.may.connect,
      note: s.hasAgent ? "Connected." : s.may.connect ? "Its address, and your confirmation that you may test it." : "An operator, admin or owner connects the agent.",
    },
    {
      key: "policy", label: "Write the policy", done: s.hasPolicy, to: agent ? `/agents/${agent}?tab=policy` : null, allowed: s.may.connect,
      note: s.hasPolicy ? "Saved. Each version is kept." : !s.hasAgent ? "Available once an agent is connected." : s.may.connect ? "Every verdict is judged against this text." : "An operator, admin or owner writes the policy.",
    },
    {
      key: "run", label: "Run the first evaluation", done: s.hasRun, to: agent ? `/agents/${agent}` : null, allowed: s.may.run,
      note: s.hasRun ? "Started." : !s.hasPolicy ? "Available once the policy is saved." : s.may.run ? "Graded against your policy and sealed into a dated report." : "An operator, admin or owner starts runs.",
    },
  ];
  const current = steps.findIndex((x) => !x.done);
  return steps.map((x, i): RailStep => {
    const state: RailState = x.done ? "done" : i === current ? "current" : "pending";
    return {
      key: x.key, label: x.label, state, note: x.note,
      href: state === "pending" || !x.allowed || !x.to ? null : x.to,
    };
  });
}
