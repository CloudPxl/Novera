"use client";

import { useActionState, useState, type ReactNode } from "react";
import {
  changeRole, clearMemory, createWorkspace, deleteAccount, eraseWorkspace, forgetMemory, inviteMember, leaveWorkspace,
  rememberPreference, removeMember, renameWorkspace, resetPersonalization, revokeInvitation, saveProfile, setAccountMode,
  type IdentityState,
} from "@/lib/workflow/identity.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import { ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/auth/permissions.ts";
import { MEMORY_LABEL, MEMORY_KEYS, type MemoryKey } from "@/lib/assistant/memory.ts";
import type { AccountMode, UserProfile } from "@/lib/auth/session.ts";

const selectClass = `${inputClass} pr-8`;

function Result({ state }: { state: IdentityState }) {
  if (state.error) return <p role="alert" className="rounded-control border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">{state.error}</p>;
  if (state.notice) return <p role="status" className="rounded-control border border-pass-border bg-pass-surface px-3 py-2 text-sm text-pass-text">{state.notice}</p>;
  return null;
}

function useForm(action: (s: IdentityState, f: FormData) => Promise<IdentityState>) {
  const [state, submit] = useActionState<IdentityState, FormData>(action, {});
  const keepValues = useKeepValuesOnError(state);
  return { state, submit, keepValues };
}

// ================================================================ workspace

export function RenameWorkspaceForm({ name }: { name: string }) {
  const { state, submit, keepValues } = useForm(renameWorkspace);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <Field label="Workspace name" htmlFor="ws-name" hint="Sealed reports name their client from this. Reports already sealed keep the name they had.">
        <input id="ws-name" name="name" defaultValue={name} required maxLength={120} className={inputClass} />
      </Field>
      <Result state={state} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Rename</SubmitButton>
    </form>
  );
}

export function NewWorkspaceForm({ agency }: { agency: boolean }) {
  const { state, submit, keepValues } = useForm(createWorkspace);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <Field label={agency ? "Client name" : "Workspace name"} htmlFor="new-ws" hint={agency ? "One workspace per client keeps their agents, keys, retention and reports apart, and each report names that client." : "A separate workspace has its own agents, keys, retention and reports."}>
        <input id="new-ws" name="name" required maxLength={120} placeholder={agency ? "Acme Retail" : "Staging"} className={inputClass} />
      </Field>
      <Result state={state} />
      <SubmitButton size="sm" pendingLabel="Creating…">{agency ? "Add the client workspace" : "Create the workspace"}</SubmitButton>
    </form>
  );
}

export function EraseWorkspaceForm({ name, members }: { name: string; members: number }) {
  const { state, submit, keepValues } = useForm(eraseWorkspace);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-soft">
        Removes every agent, policy, run, verdict, report and report link in <span className="font-medium text-ink">{name}</span>
        {members > 1 ? `, for all ${members} members` : ""}. Links you sent stop working. This cannot be undone; a record
        that an erasure happened, with no content, is all that remains. If you need a copy, use Export this workspace above first.
      </p>
      <Field label={`Type ${name} to confirm`} htmlFor="erase-confirm">
        <input id="erase-confirm" name="confirmName" required autoComplete="off" className={inputClass} />
      </Field>
      <Result state={state} />
      <SubmitButton variant="danger" size="sm" pendingLabel="Erasing…">Erase this workspace</SubmitButton>
    </form>
  );
}

export function LeaveWorkspaceForm({ name }: { name: string }) {
  const { state, submit, keepValues } = useForm(leaveWorkspace);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-current" />
        <span>Leave {name}. API keys I created here are revoked. Everything I did here stays, attributed to me.</span>
      </label>
      <Result state={state} />
      <SubmitButton variant="danger" size="sm" pendingLabel="Leaving…">Leave this workspace</SubmitButton>
    </form>
  );
}

// ================================================================== members

export function InviteForm({ grantable }: { grantable: Role[] }) {
  const { state, submit, keepValues } = useForm(inviteMember);
  const [role, setRole] = useState<Role>(grantable.includes("operator") ? "operator" : grantable[0]);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Email address" htmlFor="invite-email" hint="The address they will sign in with. The link works only for it.">
          <input id="invite-email" name="email" type="email" required maxLength={320} className={inputClass} placeholder="colleague@agency.example" />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <select id="invite-role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectClass}>
            {grantable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-xs text-ink-faint">{ROLE_DESCRIPTION[role]}</p>
      <Result state={state} />
      {state.link && (
        <div className="rounded-control border border-line bg-ground p-3">
          <p className="text-xs text-ink-soft">Invitation link — shown once, expires in seven days:</p>
          <p className="mt-1 break-all font-mono text-xs text-ink">{state.link}</p>
        </div>
      )}
      <SubmitButton size="sm" pendingLabel="Inviting…">Send invitation</SubmitButton>
    </form>
  );
}

export function RevokeInvitationButton({ id }: { id: string }) {
  const { state, submit } = useForm(revokeInvitation);
  return (
    <form action={submit} className="flex items-center gap-2">
      <input type="hidden" name="invitationId" value={id} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Revoking…">Revoke</SubmitButton>
      {state.error && <span role="alert" className="text-xs text-fail-text">{state.error}</span>}
    </form>
  );
}

export function MemberControls({ userId, role, options, name }: { userId: string; role: Role; options: Role[]; name: string }) {
  const roleForm = useForm(changeRole);
  const removeForm = useForm(removeMember);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={roleForm.submit} className="flex items-center gap-1.5">
        <input type="hidden" name="userId" value={userId} />
        <label htmlFor={`role-${userId}`} className="sr-only">Role for {name}</label>
        <select id={`role-${userId}`} name="role" defaultValue={role} className={`${selectClass} py-1 text-xs`}>
          {options.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <SubmitButton size="sm" variant="secondary" pendingLabel="…">Change</SubmitButton>
      </form>
      <form action={removeForm.submit}>
        <input type="hidden" name="userId" value={userId} />
        <SubmitButton size="sm" variant="danger" pendingLabel="Removing…">Remove</SubmitButton>
      </form>
      {(roleForm.state.error || removeForm.state.error) && <p role="alert" className="w-full text-xs text-fail-text">{roleForm.state.error ?? removeForm.state.error}</p>}
      {(roleForm.state.notice || removeForm.state.notice) && <p role="status" className="w-full text-xs text-pass-text">{roleForm.state.notice ?? removeForm.state.notice}</p>}
    </div>
  );
}

// ================================================================== profile

const TIMEZONES = ["UTC", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Madrid", "Europe/Rome", "Europe/Warsaw", "Europe/Bucharest", "Europe/Athens", "Europe/Helsinki", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];

export function ProfileForm({ profile, workspaces, agents, suites }: {
  profile: UserProfile;
  workspaces: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string; workspace: string }>;
  suites: string[];
}) {
  const { state, submit, keepValues } = useForm(saveProfile);
  const tzs = TIMEZONES.includes(profile.timezone) ? TIMEZONES : [profile.timezone, ...TIMEZONES];
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-6">
      <Group title="You" note="Shown to teammates beside what you did. Never in a report.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="p-name"><input id="p-name" name="displayName" defaultValue={profile.display_name ?? ""} maxLength={80} className={inputClass} /></Field>
          <Field label="Role or title" htmlFor="p-title"><input id="p-title" name="jobTitle" defaultValue={profile.job_title ?? ""} maxLength={80} className={inputClass} /></Field>
          <Field label="Company" htmlFor="p-company"><input id="p-company" name="companyName" defaultValue={profile.company_name ?? ""} maxLength={120} className={inputClass} /></Field>
        </div>
      </Group>

      <Group title="Display" note="How times and motion appear to you. Reports and stored evidence are always in UTC and never change.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Timezone" htmlFor="p-tz" hint="Times on your dashboard and in Ask Novera.">
            <select id="p-tz" name="timezone" defaultValue={profile.timezone} className={selectClass}>{tzs.map((t) => <option key={t}>{t}</option>)}</select>
          </Field>
          <Field label="Date format" htmlFor="p-locale" hint="Novera's words are in English.">
            <select id="p-locale" name="locale" defaultValue={profile.locale} className={selectClass}>
              <option value="en-GB">2 October 2026</option><option value="en-US">October 2, 2026</option>
              <option value="de-DE">2. Oktober 2026</option><option value="fr-FR">2 octobre 2026</option><option value="ro-RO">2 octombrie 2026</option>
            </select>
          </Field>
          <Field label="Motion" htmlFor="p-motion" hint="Reduce stops every animation in the app, whatever your system says.">
            <select id="p-motion" name="reducedMotion" defaultValue={profile.reduced_motion} className={selectClass}>
              <option value="system">Follow my system</option><option value="reduce">Reduce motion</option>
            </select>
          </Field>
        </div>
      </Group>

      <Group title="Defaults" note="What is preselected for you. Choosing a default never runs anything.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace to open" htmlFor="p-ws">
            <select id="p-ws" name="defaultWorkspaceId" defaultValue={profile.default_workspace_id ?? ""} className={selectClass}>
              <option value="">The one I used last</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="Agent to run" htmlFor="p-agent" hint="Preselected in Run evaluation.">
            <select id="p-agent" name="defaultAgentId" defaultValue={profile.default_agent_id ?? ""} className={selectClass}>
              <option value="">None</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.workspace}</option>)}
            </select>
          </Field>
          <Field label="Suite" htmlFor="p-suite" hint="Preselected in Run evaluation; the newest version of it.">
            <select id="p-suite" name="preferredSuiteKey" defaultValue={profile.preferred_suite_key ?? ""} className={selectClass}>
              <option value="">The newest built-in suite</option>{suites.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Report format to offer first" htmlFor="p-format" hint="Listed first beside a finished run.">
            <select id="p-format" name="reportFormat" defaultValue={profile.report_format} className={selectClass}>
              <option value="link">Private link</option><option value="pdf">PDF</option><option value="markdown">Markdown</option>
              <option value="csv">CSV</option><option value="json">JSON</option><option value="junit">JUnit</option>
            </select>
          </Field>
        </div>
      </Group>

      <Group title="Ask Novera" note="Off by default. When on, Ask Novera may suggest remembering a preference you state — you decide each one.">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="assistantMemory" defaultChecked={profile.assistant_memory} className="mt-0.5 size-4 accent-current" />
          <span>Let Ask Novera use what I choose to have it remember. It never remembers customer conversations, keys, policy text or anything it was not told to.</span>
        </label>
      </Group>

      <Result state={state} />
      <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
    </form>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{title}</legend>
      <p className="text-xs leading-relaxed text-ink-faint">{note}</p>
      {children}
    </fieldset>
  );
}

const MODE_COPY: Record<AccountMode, { title: string; body: string }> = {
  personal: { title: "Personal", body: "Just you and your agents. The simplest screens: My agent, My runs, My findings." },
  agency: { title: "Agency or team", body: "Clients as workspaces, a switcher, members and roles, a portfolio of what needs review." },
  enterprise: { title: "Company", body: "Agency views plus governance first: roles, the audit log, retention and evidence reads." },
};

export function AccountModeForm({ mode }: { mode: AccountMode }) {
  const { state, submit } = useForm(setAccountMode);
  return (
    <form action={submit} className="space-y-3">
      <fieldset>
        <legend className="sr-only">Account mode</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(MODE_COPY) as AccountMode[]).map((m) => (
            <label key={m} className="flex cursor-pointer gap-2 rounded-panel border border-line p-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-surface">
              <input type="radio" name="mode" value={m} defaultChecked={m === mode} className="mt-1 accent-current" />
              <span><span className="font-semibold">{MODE_COPY[m].title}</span><span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{MODE_COPY[m].body}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-ink-faint">Changes what you see, never what exists: no workspace, run, report or permission is moved, copied or deleted, and you can switch back.</p>
      <Result state={state} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Use this mode</SubmitButton>
    </form>
  );
}

// =================================================================== memory

export function RememberForm({ canShare }: { canShare: boolean }) {
  const { state, submit, keepValues } = useForm(rememberPreference);
  const [key, setKey] = useState<MemoryKey>("explanation_length");
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field label="What" htmlFor="m-key">
          <select id="m-key" name="key" value={key} onChange={(e) => setKey(e.target.value as MemoryKey)} className={selectClass}>
            {MEMORY_KEYS.map((k) => <option key={k} value={k}>{MEMORY_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Value" htmlFor="m-value" hint="Up to 280 characters. Keys, links and instructions are refused.">
          <input id="m-value" name="value" required maxLength={280} className={inputClass} placeholder={key === "explanation_length" ? "concise" : key === "terminology" ? "We call the refund flow 'Penny'" : ""} />
        </Field>
      </div>
      {canShare && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="scope" value="workspace" className="size-4 accent-current" />
          Share with everyone in this workspace (for team terms)
        </label>
      )}
      <Result state={state} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Remember this</SubmitButton>
    </form>
  );
}

export function ForgetButton({ id, label }: { id: string; label: string }) {
  const { state, submit } = useForm(forgetMemory);
  return (
    <form action={submit}>
      <input type="hidden" name="memoryId" value={id} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="…">Forget<span className="sr-only"> {label}</span></SubmitButton>
      {state.error && <span role="alert" className="ml-2 text-xs text-fail-text">{state.error}</span>}
    </form>
  );
}

export function ClearMemoryForm() {
  const { state, submit } = useForm(clearMemory);
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-4 accent-current" />Clear all my personal memory</label>
      <SubmitButton size="sm" variant="danger" pendingLabel="Clearing…">Clear</SubmitButton>
      <Result state={state} />
    </form>
  );
}

// ================================================================ your data

export function ResetForm() {
  const { state, submit } = useForm(resetPersonalization);
  return (
    <form action={submit} className="space-y-3">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-current" /><span>Reset my preferences and personal memory to defaults. Workspaces, runs and reports are not touched.</span></label>
      <Result state={state} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Resetting…">Reset personalization</SubmitButton>
    </form>
  );
}

export function DeleteAccountForm({ owned }: { owned: string[] }) {
  const { state, submit, keepValues } = useForm(deleteAccount);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-soft">
        {owned.length
          ? <>These workspaces you own are erased completely, for everyone in them: <span className="font-medium text-ink">{owned.join(", ")}</span>. </>
          : null}
        Your memberships elsewhere end and the API keys you created there are revoked. Your profile, conversations and
        memory are deleted. What you did in other people&apos;s workspaces stays, attributed to an id with no name or email.
      </p>
      <Field label="Type “delete my account” to confirm" htmlFor="delete-confirm">
        <input id="delete-confirm" name="confirm" required autoComplete="off" className={inputClass} />
      </Field>
      <Result state={state} />
      <SubmitButton variant="danger" size="sm" pendingLabel="Deleting…">Delete my account</SubmitButton>
    </form>
  );
}
