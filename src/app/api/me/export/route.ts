import { currentWorkspace } from "@/lib/auth/session.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { recordAudit } from "@/lib/audit/record.ts";

/**
 * A person's own data: profile, memberships, memory, conversations and their own audit events.
 * Workspace evidence is not here — it belongs to the workspace and leaves through its reports.
 * Answers in JSON with a status, never a redirect (CLAUDE.md, "a refusal has to be in the shape
 * its caller reads").
 */
export async function GET(): Promise<Response> {
  const session = await currentWorkspace();
  if (!session) return Response.json({ error: "Sign in to export your data." }, { status: 401, headers: { "cache-control": "no-store" } });
  const { user } = session;
  const db = serviceClient();
  const [profile, memberships, memory, threads, events] = await Promise.all([
    db.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    db.from("workspace_members").select("role, created_at, workspaces(id, name)").eq("user_id", user.id),
    db.from("assistant_memory").select("key, value, source, workspace_id, created_at, expires_at").eq("user_id", user.id),
    db.from("assistant_threads").select("id, workspace_id, title, created_at, last_message_at, assistant_messages(role, content, citations, funded_by, created_at)").eq("user_id", user.id),
    db.from("audit_events").select("action, detail, created_at").is("workspace_id", null).eq("actor_id", user.id).order("created_at"),
  ]);
  await recordAudit(db, { workspaceId: null, actorId: user.id, action: "account.exported", detail: {} });
  const body = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    profile: profile.data,
    memberships: memberships.data,
    assistant_memory: memory.data,
    assistant_conversations: threads.data,
    your_events: events.data,
    not_included: "Workspace evidence (agents, policies, runs, verdicts, reports) belongs to each workspace and is exported through its reports.",
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="novera-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
