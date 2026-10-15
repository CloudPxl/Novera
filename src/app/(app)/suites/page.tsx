import { redirect } from "next/navigation";

/**
 * `/suites` is the suite catalog, a tab of Scenarios. The address stays short and stable if the
 * catalog ever moves; a filter in the query (`?tier=`, `?severity=`) rides along unchanged.
 */
export default async function SuitesAlias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "tab" || key === "view") continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  query.set("tab", "catalog");
  redirect(`/scenarios?${query.toString()}`);
}
