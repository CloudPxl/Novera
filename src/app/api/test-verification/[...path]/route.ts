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
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "The Novera verification fixture is disabled outside development." }, { status: 403 });
  }

  const { path } = await params;
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
