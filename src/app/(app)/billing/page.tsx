import { redirect } from "next/navigation";

/**
 * `/billing` is Settings → Billing. Every "Choose a plan" in the product links here, so the
 * address stays short and stable if the page ever moves; the query (Checkout's return) rides
 * along unchanged.
 */
export default async function BillingAlias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const qs = query.toString();
  redirect(`/settings/billing${qs ? `?${qs}` : ""}`);
}
