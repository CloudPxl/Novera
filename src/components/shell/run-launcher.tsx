"use client";

import { useState } from "react";
import { Menu } from "@/components/ui/menu.tsx";
import { SubmitButton } from "@/components/ui/button.tsx";
import { inputClass } from "@/components/ui/primitives.tsx";

export interface LaunchAgent {
  id: string;
  name: string;
  host: string;
}
export interface LaunchSuite {
  id: string;
  name: string;
  key: string;
  version: number;
  caseCount: number;
}

/**
 * Starting a run, with both choices stated out loud.
 *
 * This deliberately is not a one-click button. A suite is written for a kind of
 * agent: pointing `eu-support` at a documentation bot produces a confident,
 * meaningless score, which has already happened once here — the select carried a
 * default nobody read. So the launcher names the agent and the suite in a
 * sentence before it will submit, and the submit is disabled until both are set.
 */
export function RunLauncher({
  agents,
  suites,
  action,
  defaultAgentId,
  defaultSuiteKey,
}: {
  agents: LaunchAgent[];
  suites: LaunchSuite[];
  action: (formData: FormData) => void | Promise<void>;
  defaultAgentId?: string;
  /** The suite the person chose in their profile — their decision, so it may be preselected. */
  defaultSuiteKey?: string | null;
}) {
  const [agentId, setAgentId] = useState(defaultAgentId && agents.some((a) => a.id === defaultAgentId) ? defaultAgentId : "");
  const [suiteId, setSuiteId] = useState(() => suites.find((s) => s.key === defaultSuiteKey)?.id ?? "");

  const agent = agents.find((a) => a.id === agentId);
  const suite = suites.find((s) => s.id === suiteId);

  return (
    <Menu
      label="Run evaluation"
      triggerClassName="bg-ink px-3.5 py-2 text-on-ink hover:bg-ink-hover active:scale-[0.98]"
      panelClassName="w-80 p-3"
    >
      {agents.length === 0 ? (
        <p className="px-1 py-2 text-sm leading-relaxed text-ink-soft">
          No agent is connected yet. Connect one first — a run needs a live endpoint to
          send scenarios to.
        </p>
      ) : (
        <form action={action} className="space-y-3">
          <div>
            <label htmlFor="launch-agent" className="type-pill text-ink-faint">
              Agent
            </label>
            <select
              id="launch-agent"
              name="agentId"
              required
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className={`${inputClass} mt-1`}
            >
              <option value="">Choose an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.host}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="launch-suite" className="type-pill text-ink-faint">
              Suite
            </label>
            <select
              id="launch-suite"
              name="suiteId"
              required
              value={suiteId}
              onChange={(e) => setSuiteId(e.target.value)}
              className={`${inputClass} mt-1`}
            >
              <option value="">Choose a suite…</option>
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} v{s.version} — {s.caseCount} scenarios
                </option>
              ))}
            </select>
          </div>

          <p className="rounded-control bg-sunken px-2.5 py-2 text-xs leading-relaxed text-ink-soft">
            {agent && suite ? (
              <>
                Sending <strong className="font-semibold text-ink">{suite.caseCount} scenarios</strong> from{" "}
                <strong className="font-semibold text-ink">{suite.name} v{suite.version}</strong> to{" "}
                <strong className="font-semibold text-ink">{agent.name}</strong> at {agent.host}.
              </>
            ) : (
              "Pick an agent and a suite. A suite written for another kind of agent will score it confidently and mean nothing."
            )}
          </p>

          <SubmitButton size="sm" pendingLabel="Starting…" disabled={!agent || !suite} className="w-full">
            Start the run
          </SubmitButton>
        </form>
      )}
    </Menu>
  );
}
