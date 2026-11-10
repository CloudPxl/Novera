import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const M = readFileSync("supabase/migrations/0082_insight_scans.sql", "utf8");

test("0082: three tenant tables, each cascading from the workspace, readable by members, written by nobody but the server", () => {
  for (const table of ["insight_targets", "insight_scans", "insight_observations"]) {
    const at = M.indexOf(`create table if not exists ${table} (`);
    assert.ok(at >= 0, table);
    const body = M.slice(at, M.indexOf(");", at));
    assert.match(body, /workspace_id\s+uuid not null references workspaces \(id\) on delete cascade/);
    assert.match(M, new RegExp(`alter table ${table} enable row level security;`));
    assert.match(M, new RegExp(`create policy ${table}_select on ${table} for select\\s+using \\(is_workspace_member\\(workspace_id\\)\\);`));
    assert.match(M, new RegExp(`revoke insert, update, delete, truncate on table ${table} from public, anon, authenticated;`));
  }
  assert.match(M, /alter table insight_workers enable row level security;\s+revoke all on table insight_workers from public, anon, authenticated;/);
});

test("0082: never a run, never a report", () => {
  // The header and the table comments say so in words; the statements must not say otherwise.
  const statements = M.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").replace(/comment on [^;]*;/g, "");
  assert.doesNotMatch(statements, /\brun_id\b/);
  assert.doesNotMatch(statements, /\breport_id\b/);
  assert.doesNotMatch(statements, /references runs\b/);
  assert.doesNotMatch(statements, /references reports\b/);
  assert.match(M, /authorisation_basis\s+text not null check \(authorisation_basis = 'published_public_demo'\)/);
});

test("0082: a scan is declared once, moves forward only, and is graded only when every scenario has an observation", () => {
  assert.match(M, /status\s+text not null default 'queued'\s+check \(status in \('queued', 'running', 'graded', 'aborted', 'error'\)\)/);
  assert.match(M, /create unique index if not exists insight_scans_one_active_per_target\s+on insight_scans \(target_id\) where status in \('queued', 'running'\);/);
  const fn = M.slice(M.indexOf("create or replace function insight_scans_forward_only()"), M.indexOf("$$;", M.indexOf("create or replace function insight_scans_forward_only()")));
  assert.match(fn, /old\.status in \('graded', 'aborted', 'error'\)/);
  assert.match(fn, /new\.scenario_ids <> old\.scenario_ids/);
  assert.match(fn, /old\.status = 'running' and new\.status = 'queued'/);
  assert.match(fn, /where not exists \(select 1 from insight_observations o where o\.scan_id = old\.id and o\.scenario_id = s\.id\)/);
  assert.match(M, /create trigger insight_scans_forward_only before update or delete on insight_scans\s+for each row execute function insight_scans_forward_only\(\);/);
  assert.match(M, /execute function refuse_cross_workspace\('target_id', 'insight_targets'\);/);
  assert.match(M, /check \(\(status = 'error'\) = \(error_kind is not null\)\)/);
  assert.match(M, /check \(\(status = 'aborted'\) = \(aborted_reason is not null\)\)/);
});

test("0082: an observation is append-only, recorded only while its scan runs and only for a declared scenario, and a missing or partial reply is never a verdict", () => {
  assert.match(M, /create trigger insight_observations_append_only before update or delete on insight_observations\s+for each row execute function refuse_mutation\(\);/);
  assert.match(M, /create trigger insight_observations_scan_running before insert on insight_observations/);
  assert.match(M, /if not found or s\.status <> 'running' then/);
  assert.match(M, /if not \(new\.scenario_id = any \(s\.scenario_ids\)\) then/);
  assert.match(M, /execute function refuse_cross_workspace\('scan_id', 'insight_scans'\);/);
  assert.match(M, /unique \(scan_id, scenario_id\)/);
  assert.match(M, /check \(settled_by is distinct from 'deterministic' or \(judge_model is null and judge_votes = '\[\]'::jsonb\)\)/);
  assert.match(M, /check \(response_text is not null or \(status = 'error' and settled_by is null and judge_model is null\)\)/);
  assert.match(M, /check \(\(capture ->> 'partial'\) is distinct from 'true' or status = 'error'\)/);
});

test("0082: a target's identity and basis are frozen and do-not-contact is never withdrawn", () => {
  const fn = M.slice(M.indexOf("create or replace function insight_targets_frozen()"), M.indexOf("$$;", M.indexOf("create or replace function insight_targets_frozen()")));
  assert.match(fn, /new\.demo_url <> old\.demo_url/);
  assert.match(fn, /new\.authorisation_basis <> old\.authorisation_basis/);
  assert.match(fn, /if old\.do_not_contact and not new\.do_not_contact then/);
  assert.match(fn, /if erasing_workspace\(\) then return old; end if;/);
  assert.match(M, /unique \(workspace_id, demo_url\)/);
});

test("0082: claim, lease and finish are service-role functions; stale leases and unscannable targets end as errors, never verdicts", () => {
  for (const sig of ["claim_insight_scan(text, integer)", "touch_insight_lease(uuid, uuid, integer)", "finish_insight_scan(uuid, uuid, text, text, text)"]) {
    const escaped = sig.replace(/[()]/g, "\\$&");
    assert.match(M, new RegExp(`revoke all on function ${escaped} from public, anon, authenticated;`));
    assert.match(M, new RegExp(`grant execute on function ${escaped} to service_role;`));
  }
  const claim = M.slice(M.indexOf("create or replace function claim_insight_scan("), M.indexOf("$$;", M.indexOf("create or replace function claim_insight_scan(")));
  assert.match(claim, /security definer\s+set search_path = public/);
  assert.match(claim, /error_kind = 'lease_expired'/);
  assert.match(claim, /error_kind = 'target_refused'/);
  assert.match(claim, /t\.category = 'A' and not t\.do_not_contact/);
  assert.match(claim, /for update of sc skip locked/);
  const finish = M.slice(M.indexOf("create or replace function finish_insight_scan("), M.indexOf("$$;", M.indexOf("create or replace function finish_insight_scan(")));
  assert.match(finish, /where id = scan and lease_token = token and status = 'running'/);
  assert.match(finish, /if new_status not in \('graded', 'error'\) then/);
});

test("0082: grading a reply is model work; erasure and retention are stated", () => {
  assert.match(M, /check \(operation in \('diagnose', 'draft', 'extract', 'assistant', 'insight_grade'\)\)/);
  assert.match(M, /on delete cascade; erase_workspace\(\) deletes the/);
  assert.doesNotMatch(M, /create or replace function erase_workspace/);
  assert.match(M, /Retention: not in the 0037 pass/);
});

test("0082: file name and ordering", () => {
  assert.match("0082_insight_scans.sql", /^(\d{4})_[a-z0-9_]+\.sql$/);
});
