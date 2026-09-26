/**
 * Proves, against the live database, the rules a production failure is kept under
 * (0031): stored append-only, readable only by its own workspace, reaching a suite only
 * as a draft that names it, and erased with its workspace.
 *
 * Run: npm run verify:regressions   (free: no model is called)
 */
import { createClient } from "@supabase/supabase-js";
import { redactForStorage } from "../src/lib/redact/store.ts";
import { regressionScenario } from "../src/lib/regressions/draft.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const password = crypto.randomUUID();
const make = async (tag: string) => (await db.auth.admin.createUser({
  email: `verify-regr-${tag}+${Date.now()}@novera.invalid`, password, email_confirm: true,
})).data.user!;
const owner = await make("a");
const stranger = await make("b");

try {
  const { data: ws } = await db.from("workspaces").insert({ name: "__novera_verify__", owner_id: owner.id }).select("id").single();
  await db.from("workspace_members").insert({ workspace_id: ws!.id, user_id: owner.id, role: "owner" });
  const { data: otherWs } = await db.from("workspaces").insert({ name: "__novera_verify_other__", owner_id: stranger.id }).select("id").single();
  await db.from("workspace_members").insert({ workspace_id: otherWs!.id, user_id: stranger.id, role: "owner" });

  const { fields, record } = redactForStorage({
    customer_message: "I'm jane@example.com — refund order 5521 to 4111 1111 1111 1111",
    agent_reply: "Done, refunded.",
    expected_behavior: "Refuses until identity is verified",
    what_went_wrong: "Refunded without verification",
  });
  report(!fields.customer_message.includes("jane@example.com") && !fields.customer_message.includes("4111"),
    "the stored text is redacted", fields.customer_message);

  const { data: failure, error: insertErr } = await db.from("production_failures").insert({
    workspace_id: ws!.id, customer_message: fields.customer_message, agent_reply: fields.agent_reply,
    expected_behavior: fields.expected_behavior, what_went_wrong: fields.what_went_wrong, redaction: record, created_by: owner.id,
  }).select("id").single();
  report(!insertErr && !!failure, "a failure is recorded", insertErr?.message ?? "");

  const { error: noHashErr } = await db.from("production_failures").insert({
    workspace_id: ws!.id, customer_message: "x", expected_behavior: "y", redaction: { policy_version: 1 },
  });
  report(!!noHashErr, "a failure without its redaction record is refused", noHashErr?.message.slice(0, 70) ?? "SUCCEEDED");

  const { error: editErr } = await db.from("production_failures").update({ expected_behavior: "anything goes" }).eq("id", failure!.id);
  report(!!editErr, "a recorded failure cannot be edited, even by the service role", editErr?.message.slice(0, 70) ?? "SUCCEEDED");
  const { error: delErr } = await db.from("production_failures").delete().eq("id", failure!.id);
  report(!!delErr, "a recorded failure cannot be deleted outside erasure", delErr?.message.slice(0, 70) ?? "SUCCEEDED");

  const built = regressionScenario({
    customerMessage: fields.customer_message, expectedBehavior: fields.expected_behavior,
    whatWentWrong: fields.what_went_wrong, obligation: "transaction_safety", severity: "critical",
  }, []);
  if (!built.ok) throw new Error(built.errors.join(" "));
  const base = { workspace_id: ws!.id, scenario: built.scenario, created_by: owner.id };

  const { data: draft, error: draftErr } = await db.from("scenario_drafts")
    .insert({ ...base, origin: "production", production_failure_id: failure!.id }).select("id").single();
  report(!draftErr && !!draft, "its regression draft names the failure", draftErr?.message ?? "");

  const { error: orphanErr } = await db.from("scenario_drafts").insert({ ...base, origin: "production" });
  report(!!orphanErr, "a regression draft without its failure is refused", orphanErr?.message.slice(0, 70) ?? "SUCCEEDED");

  const { error: mixedErr } = await db.from("scenario_drafts").insert({
    ...base, origin: "production", production_failure_id: failure!.id,
    import_provenance: { source_tool: "promptfoo", original_hash: "x", item_hash: "y" },
  });
  report(!!mixedErr, "a regression draft cannot also claim an import", mixedErr?.message.slice(0, 70) ?? "SUCCEEDED");

  const { error: relinkErr } = await db.from("scenario_drafts").update({ production_failure_id: null }).eq("id", draft!.id);
  report(!!relinkErr, "which failure a draft came from cannot be changed", relinkErr?.message.slice(0, 70) ?? "SUCCEEDED");

  // Row-level security, through a real session rather than the service role.
  const signIn = async (email: string) => {
    const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email, password });
    return client;
  };
  const asOwner = await signIn(owner.email!);
  const asStranger = await signIn(stranger.email!);
  const { data: own } = await asOwner.from("production_failures").select("id").eq("id", failure!.id);
  report((own ?? []).length === 1, "the owning workspace can read its failure");
  const { data: theirs } = await asStranger.from("production_failures").select("id, customer_message").eq("id", failure!.id);
  report((theirs ?? []).length === 0, "another workspace cannot read it", `${(theirs ?? []).length} row(s) visible`);
  const { error: plantErr } = await asStranger.from("production_failures").insert({
    workspace_id: ws!.id, customer_message: "planted", expected_behavior: "planted", redaction: record,
  });
  report(!!plantErr, "another workspace cannot record a failure into it", plantErr?.message.slice(0, 70) ?? "SUCCEEDED");

  const { error: eraseErr } = await db.rpc("erase_workspace", { target: ws!.id });
  const { count: leftFailures } = await db.from("production_failures").select("*", { count: "exact", head: true }).eq("workspace_id", ws!.id);
  const { count: leftDrafts } = await db.from("scenario_drafts").select("*", { count: "exact", head: true }).eq("workspace_id", ws!.id);
  report(!eraseErr && leftFailures === 0 && leftDrafts === 0, "erasure removes failures and their drafts",
    eraseErr?.message ?? `${leftFailures} failures, ${leftDrafts} drafts left`);
  await db.rpc("erase_workspace", { target: otherWs!.id });
} finally {
  await db.auth.admin.deleteUser(owner.id);
  await db.auth.admin.deleteUser(stranger.id);
  console.log("  removed the verification users");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
