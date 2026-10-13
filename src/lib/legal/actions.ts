"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { billingConfig, storedLivemode } from "@/lib/billing/config.ts";
import { contractSet, livePublicationProblems, readAcceptanceForm } from "./contract.ts";
import { recordAcceptance } from "./acceptance-store.ts";

export interface AcceptanceFormState {
  error?: string;
  field?: string;
  notice?: string;
}

/**
 * Records the business details and the acceptance of the terms (legal build brief §20.1–20.2).
 * Owner or admin only, for the active workspace; written with the service role after that check
 * (0068 gives clients no write). Live mode refuses while any document is a draft or a company
 * detail is missing: a customer is never asked to accept a draft as if it were final.
 */
export async function acceptContractTerms(_prev: AcceptanceFormState, form: FormData): Promise<AcceptanceFormState> {
  const { user, workspace } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "billing.manage");
  if ("error" in gated) return { error: gated.error };

  const config = billingConfig();
  const set = contractSet();
  if (config.mode === "live") {
    const problems = livePublicationProblems(set);
    if (problems.length) return { error: `Terms cannot be accepted for live billing yet. ${problems.join(" ")}` };
  }

  const read = readAcceptanceForm(form, set.setSha256);
  if (!read.ok) return { error: read.error, field: read.field };

  const h = await headers();
  try {
    const row = await recordAcceptance(gated.admin, {
      workspaceId: workspace.id, userId: user.id, livemode: storedLivemode(config), input: read.value, set,
      userAgent: h.get("user-agent"), locale: h.get("accept-language")?.split(",")[0] ?? null,
    });
    await recordAudit(gated.admin, {
      workspaceId: workspace.id, actorId: user.id, action: "contract.accepted",
      detail: { acceptance: row.id, terms_version: row.terms_version, documents_status: row.documents_status },
    });
  } catch (e) {
    console.error("[legal] acceptance not recorded:", e instanceof Error ? e.message : e);
    return { error: "The acceptance could not be recorded, so nothing changed. Try again, or contact support." };
  }
  revalidatePath("/settings/billing");
  return { notice: "Recorded. You can download the record below, and choose a plan." };
}
