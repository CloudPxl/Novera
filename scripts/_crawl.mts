import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const base = process.argv[2] ?? "https://www.nover.space";
const { data: docs } = await db.from("docs").select("slug").eq("published", true);
const { data: reports } = await db.from("reports").select("token, revoked_at");
type Probe = { label: string; path: string; init?: RequestInit; expect: number[] };
const probes: Probe[] = [];
const page = (p: string, expect = [200]) => probes.push({ label: `GET ${p}`, path: p, expect });
for (const p of ["/", "/docs", "/support", "/apply", "/sign-in", "/guide"]) page(p);
// Without a recovery session there is nothing to reset: it sends the visitor to sign in.
page("/reset-password", [200, 307]);
page("/sign-in?problem=%3Cscript%3Ealert(1)%3C/script%3E");
page("/this-page-does-not-exist", [404]);
page("/docs/no-such-doc", [404]);
for (const d of docs ?? []) page(`/docs/${d.slug}`);
page("/dashboard", [200, 307]); page("/settings", [200, 307]); page("/runs/not-a-uuid", [200, 307, 404]);
page("/report/not-a-real-token", [200, 404, 410]);
for (const r of reports ?? []) {
  page(`/report/${r.token}`, r.revoked_at ? [200, 410] : [200]);
  for (const f of ["md", "csv", "json", "junit"]) page(`/api/reports/${r.token}/export?format=${f}`, r.revoked_at ? [404, 410] : [200]);
}
page(`/api/reports/${reports![0].token}/export?format=exe`, [400]);
page(`/api/reports/${reports![0].token}/export`, [200, 400]);
const bad = (label: string, path: string, init: RequestInit, expect: number[]) => probes.push({ label, path, init, expect });
bad("POST /api/v1/runs no key", "/api/v1/runs", { method: "POST" }, [401]);
bad("POST /api/v1/runs junk key", "/api/v1/runs", { method: "POST", headers: { authorization: "Bearer nvk_" + "A".repeat(43) } }, [401]);
// A malformed percent-encoding is refused by the platform (400) before any route runs.
bad("GET /api/v1/runs/garbage", "/api/v1/runs/%00%ff", { headers: { authorization: "Bearer x" } }, [400, 401, 404]);
bad("DELETE /api/v1/runs", "/api/v1/runs", { method: "DELETE" }, [405]);
bad("POST /api/mcp no origin/key", "/api/mcp", { method: "POST", body: "{", headers: { "content-type": "application/json" } }, [400, 401, 403]);
bad("GET /api/mcp", "/api/mcp", {}, [401, 405]);
bad("POST /api/support-agent no token", "/api/support-agent", { method: "POST", body: "not json" }, [401, 503]);
bad("POST /api/runs/x/execute anon", "/api/runs/abc/execute", { method: "POST" }, [401]);
bad("GET /api/runs/x/execute", "/api/runs/abc/execute", {}, [405]);
bad("POST /api/cron/tick bad", "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer " + "x".repeat(5000) } }, [401]);
bad("GET /auth/confirm no params", "/auth/confirm", { redirect: "manual" }, [302, 303, 307]);
bad("GET /auth/confirm junk", "/auth/confirm?token_hash=abc&type=nonsense", { redirect: "manual" }, [302, 303, 307]);
bad("POST /api/test-agent prod", "/api/test-agent", { method: "POST", body: "{}" }, [403, 200]);

const results = await Promise.all(probes.map(async (p) => {
  try {
    const r = await fetch(base + p.path, { redirect: "manual", ...p.init });
    return { ...p, status: r.status };
  } catch (e) { return { ...p, status: -1, err: (e as Error).message }; }
}));
const wrong = results.filter((r) => !r.expect.includes(r.status));
console.log(`${results.length} requests; ${results.filter((r) => r.status >= 500).length} server errors; ${wrong.length} unexpected`);
for (const w of wrong) console.log("  UNEXPECTED", w.status, w.label.slice(0, 90), "expected", w.expect.join("/"));
