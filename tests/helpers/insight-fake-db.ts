import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * An in-memory stand-in for the Supabase client over the insight tables and the three 0082
 * functions, for unit tests (tests/insight-events.test.ts) and the browser verifier
 * (scripts/verify-insight-browser.mts). It mirrors what the handlers rely on — one observation
 * per scenario, a lease token that must match, a finished scan that stays finished — and no
 * more: the database's own rules are proved by the migration tests and on a real database.
 */
type Row = Record<string, unknown>;

export function fakeInsightDb(seed: Record<string, Row[]>, opts: { token?: () => string; now?: () => Date } = {}) {
  const token = opts.token ?? (() => randomUUID());
  const now = opts.now ?? (() => new Date());
  const rows: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const rpcs: Array<{ name: string; args: Row }> = [];
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row = {};
    const apply = () => {
      const matching = (rows[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        if (table === "insight_observations" && rows[table].some((r) => r.scan_id === payload.scan_id && r.scenario_id === payload.scenario_id)) {
          return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        }
        const row = { id: `${table}-${rows[table].length + 1}`, created_at: now().toISOString(), ...payload };
        rows[table].push(row);
        return { data: [row], error: null };
      }
      if (op === "update") {
        for (const r of matching) Object.assign(r, payload);
        return { data: matching, error: null };
      }
      if (op === "upsert") {
        const existing = rows[table].find((r) => r.id === payload.id);
        if (existing) Object.assign(existing, payload); else rows[table].push({ ...payload });
        return { data: [payload], error: null };
      }
      return { data: matching, error: null };
    };
    const b = {
      select() { return b; },
      insert(p: Row) { op = "insert"; payload = p; return b; },
      update(p: Row) { op = "update"; payload = p; return b; },
      upsert(p: Row) { op = "upsert"; payload = p; return b; },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return b; },
      maybeSingle() { const out = apply(); return Promise.resolve({ data: out.data?.[0] ?? null, error: out.error }); },
      single() { const out = apply(); return Promise.resolve({ data: out.data?.[0] ?? null, error: out.error ?? (out.data?.[0] ? null : { message: "no row" }) }); },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(apply()).then(resolve, reject); },
    };
    return b;
  }
  const client = {
    from(table: string) { return builder(table); },
    rpc(name: string, args: Row) {
      rpcs.push({ name, args });
      const scan = (rows.insight_scans ?? []).find((r) => r.id === args.scan);
      const held = Boolean(scan && scan.lease_token === args.token && scan.status === "running");
      if (name === "touch_insight_lease") {
        if (held) scan!.lease_until = new Date(now().getTime() + Number(args.lease_ms)).toISOString();
        return Promise.resolve({ data: held, error: null });
      }
      if (name === "finish_insight_scan") {
        if (held) {
          Object.assign(scan!, {
            status: args.new_status,
            error_kind: args.new_status === "error" ? args.kind : null,
            error_detail: args.new_status === "error" ? args.detail : null,
            finished_at: now().toISOString(),
          });
        }
        return Promise.resolve({ data: held, error: null });
      }
      if (name === "claim_insight_scan") {
        const queued = (rows.insight_scans ?? []).find((r) => r.status === "queued");
        if (!queued) return Promise.resolve({ data: null, error: null });
        Object.assign(queued, {
          status: "running", claimed_by: args.worker, lease_token: token(),
          lease_until: new Date(now().getTime() + Number(args.lease_ms)).toISOString(),
        });
        return Promise.resolve({ data: { ...queued }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  } as unknown as SupabaseClient;
  return { client, rows, rpcs };
}
