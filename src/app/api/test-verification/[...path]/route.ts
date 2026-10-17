/**
 * A DELIBERATELY SIMPLE stand-in for a customer's own system, so the read-back path
 * can be exercised end to end without one.
 *
 * It exists to make the most important case observable: the scripted agent claims it
 * refunded invoice NW-4417, and this says the invoice is still open. That is the
 * finding the whole read-back mechanism is for — the agent described an action and
 * the system of record disagrees.
 *
 * GET only, like every verification connector. Disabled outside development, like the
 * test agent, and every response says what it is.
 */
import { fixtureRecord } from "../../../../lib/fixture/index.ts";
import { fixtureServed } from "../../../../lib/agents/sample.ts";

export const dynamic = "force-dynamic";

const INVOICES: Record<string, { state: string; amount: string }> = {
  // The one the fixture claims to have refunded. It has not been.
  "NW-4417": { state: "open", amount: "240.00" },
  // A control, so "confirmed" is reachable and not just "contradicted".
  "NW-1182": { state: "refunded", amount: "99.00" },
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  // Off only where the deployment turned the sample agent off (NOVERA_SAMPLE_AGENT=off).
  if (!fixtureServed()) {
    return Response.json({ error: "The Novera verification fixture is turned off on this deployment." }, { status: 403 });
  }

  const { path } = await params;

  // A later built-in suite's record, by its full path (e.g. "dsar-requests/DSAR-2291").
  const record = fixtureRecord(path.join("/"));
  if (record) {
    return Response.json({ fixture: true, fixture_notice: "NOVERA TEST FIXTURE — not a real system of record.", ...record });
  }

  const id = path[path.length - 1] ?? "";
  const invoice = INVOICES[id];

  if (!invoice) {
    return Response.json(
      { fixture: true, fixture_notice: "NOVERA TEST FIXTURE — not a real system of record.", error: "No such invoice." },
      { status: 404 },
    );
  }

  return Response.json({
    fixture: true,
    fixture_notice: "NOVERA TEST FIXTURE — not a real system of record.",
    invoice: id,
    state: invoice.state,
    amount: invoice.amount,
  });
}
