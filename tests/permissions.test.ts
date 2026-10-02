import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { can, canManageMember, permissionsOf, refusalFor, PERMISSIONS, ROLES, type Capability, type Role } from "../src/lib/auth/permissions.ts";

// The matrix as the audit published it. A change to either side fails here.
const AUDIT: Array<[Capability, string]> = [
  ["workspace.view", "OAPRU"], ["agent.write", "OAP"], ["policy.write", "OAP"], ["run.start", "OAP"],
  ["diagnosis.request", "OAPR"], ["diagnosis.decide", "OAR"], ["finding.record", "OAR"], ["report.reissue", "OAR"],
  ["scenario.draft", "OAPR"], ["regression.record", "OAPR"], ["scenario.decide", "OAR"], ["scenario.promote", "OAR"],
  ["apikey.manage", "OA"], ["apikey.grant_responses", "OA"], ["webhook.manage", "OA"], ["judgekey.manage", "OA"],
  ["retention.change", "O"], ["report.withdraw", "OA"], ["report.export", "OAPRU"], ["member.invite", "OA"],
  ["member.manage", "OA"], ["audit.view", "OAU"], ["workspace.erase", "O"],
];
const LETTER: Record<Role, string> = { owner: "O", admin: "A", operator: "P", reviewer: "R", auditor: "U" };

test("the code's matrix is the audit's matrix", () => {
  for (const [cap, letters] of AUDIT) {
    for (const role of ROLES) {
      assert.equal(can(role, cap), letters.includes(LETTER[role]), `${role} / ${cap}`);
    }
  }
});

test("the owner holds every permission, and an auditor changes nothing", () => {
  assert.equal(permissionsOf("owner").length, Object.keys(PERMISSIONS).length);
  assert.deepEqual(permissionsOf("auditor").sort(), ["audit.view", "report.export", "workspace.view"]);
});

test("no role, or an unknown one, can do anything", () => {
  assert.equal(can(null, "workspace.view"), false);
  assert.equal(can("member" as Role, "run.start"), false);
});

test("approvals and building are held by different roles, so drafting is not approving", () => {
  assert.equal(can("operator", "scenario.draft") && !can("operator", "scenario.decide"), true);
  assert.equal(can("reviewer", "scenario.decide") && !can("reviewer", "run.start"), true);
});

test("an admin manages operators, reviewers and auditors, never admins or the owner", () => {
  assert.equal(canManageMember("admin", "operator", "reviewer"), true);
  assert.equal(canManageMember("admin", "admin"), false);
  assert.equal(canManageMember("admin", "operator", "admin"), false);
  assert.equal(canManageMember("owner", "admin", "operator"), true);
  assert.equal(canManageMember("owner", "owner"), false);
  assert.equal(canManageMember("operator", "auditor"), false);
});

test("a refusal names who may do it", () => {
  assert.match(refusalFor("retention.change"), /owner role/);
  assert.match(refusalFor("scenario.decide"), /owner, admin or reviewer/);
});

test("the RLS write policies in 0054 grant the same roles as the code", () => {
  const sql = readFileSync("supabase/migrations/0054_identity_profiles_roles_memory.sql", "utf8");
  const roles = (policy: string) => {
    const m = new RegExp(`create policy ${policy}[\\s\\S]*?array\\[([^\\]]+)\\]`).exec(sql);
    return m![1].replace(/'/g, "").split(",").map((s) => s.trim()).sort();
  };
  assert.deepEqual(roles("agents_insert"), [...PERMISSIONS["agent.write"]].sort());
  assert.deepEqual(roles("agents_update"), [...PERMISSIONS["agent.write"]].sort());
  assert.deepEqual(roles("scenario_drafts_insert"), [...PERMISSIONS["scenario.draft"]].sort());
  assert.deepEqual(roles("scenario_drafts_update"), [...PERMISSIONS["scenario.decide"]].sort());
  assert.deepEqual(roles("production_failures_insert"), [...PERMISSIONS["regression.record"]].sort());
  assert.deepEqual(roles("audit_events_select"), [...PERMISSIONS["audit.view"]].sort());
});
