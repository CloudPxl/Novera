/**
 * Proves tenant isolation against the live database.
 *
 * Creates two real users with real passwords, signs each in with the anon key — the
 * same key the browser uses — and checks that neither can see the other's rows.
 * Inspecting the policies would not prove this; only a second session does.
 *
 * Run: npm run verify:tenancy
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? " ok " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const stamp = Date.now();
const people = [
  { email: `tenancy-a+${stamp}@novera.invalid`, password: crypto.randomUUID() },
  { email: `tenancy-b+${stamp}@novera.invalid`, password: crypto.randomUUID() },
];
const created: string[] = [];

try {
  console.log("\nTenant isolation");

  const sessions = [];
  for (const person of people) {
    const { data, error } = await admin.auth.admin.createUser({
      email: person.email,
      password: person.password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`Could not create ${person.email}: ${error?.message}`);
    created.push(data.user.id);

    const client = createClient(url, anon, { auth: { persistSession: false } });
    const { error: signInErr } = await client.auth.signInWithPassword(person);
    if (signInErr) throw new Error(`Could not sign in ${person.email}: ${signInErr.message}`);
    sessions.push({ userId: data.user.id, client });
  }

  const [alice, bob] = sessions;

  // Alice creates a workspace through her own session, exactly as the app does.
  const { data: aliceWs, error: wsErr } = await alice.client
    .from("workspaces")
    .insert({ name: `Alice ${stamp}`, owner_id: alice.userId })
    .select("id")
    .single();
  check(!wsErr && !!aliceWs, "a signed-in user can create their own workspace", wsErr?.message);
  if (!aliceWs) throw new Error("cannot continue without a workspace");

  const { data: membership } = await alice.client
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", aliceWs.id);
  check(
    membership?.length === 1 && membership[0].user_id === alice.userId,
    "the owner is added as a member automatically",
    `saw ${membership?.length ?? 0} member(s)`,
  );

  // Evidence is written server-side, so seed it with the service role.
  const { data: agent } = await admin
    .from("agents")
    .insert({ workspace_id: aliceWs.id, name: "Alice agent", kind: "http", config: {} })
    .select("id")
    .single();
  const { data: policy } = await admin
    .from("policies")
    .insert({ workspace_id: aliceWs.id, agent_id: agent!.id, version: 1, body: "alice policy" })
    .select("id")
    .single();
  const { data: suite } = await admin
    .from("suites").select("id").is("workspace_id", null).eq("key", "eu-support").eq("version", 1).single();
  const { data: run } = await admin
    .from("runs")
    .insert({
      workspace_id: aliceWs.id, agent_id: agent!.id, policy_id: policy!.id,
      suite_id: suite!.id, status: "completed",
    })
    .select("id").single();
  await admin.from("run_cases").insert({
    workspace_id: aliceWs.id, run_id: run!.id, case_id: "T01", category: "policy",
    obligation: "policy_accuracy", severity: "low", input: "i", expected: "e",
    assertions: [], status: "fail", judge_model: null, judge_attempts: [],
  });

  check((await alice.client.from("runs").select("id").eq("id", run!.id)).data?.length === 1,
    "the owner can read her own run");

  const bobSees = async (table: string) =>
    ((await bob.client.from(table).select("id").eq("workspace_id", aliceWs.id)).data ?? []).length;

  check((await bobSees("runs")) === 0, "a second account cannot read the first's runs");
  check((await bobSees("run_cases")) === 0, "a second account cannot read the first's case evidence");
  check((await bobSees("agents")) === 0, "a second account cannot read the first's agents");
  check((await bobSees("policies")) === 0, "a second account cannot read the first's policies");
  check(
    ((await bob.client.from("workspaces").select("id").eq("id", aliceWs.id)).data ?? []).length === 0,
    "a second account cannot read the first's workspace",
  );

  const { data: secrets } = await bob.client.from("secrets").select("id");
  check((secrets ?? []).length === 0, "no signed-in user can read the secrets table at all");

  const { error: stealErr } = await bob.client
    .from("workspace_members")
    .insert({ workspace_id: aliceWs.id, user_id: bob.userId, role: "member" });
  check(!!stealErr, "a second account cannot add itself to another workspace", stealErr?.message.slice(0, 60));

  const { data: builtIn } = await bob.client.from("suites").select("id").is("workspace_id", null);
  check((builtIn ?? []).length > 0, "built-in suites remain readable by any signed-in user");

  await admin.from("workspaces").delete().eq("id", aliceWs.id);
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log("  cleaned up the test accounts");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
