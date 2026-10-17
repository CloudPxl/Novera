/**
 * The retention schedule, as the code enforces it today (legal build brief §20.7, 2026-10-13).
 * Read by the Privacy Notice; tests/legal.test.ts checks each period against the code or
 * migration that enforces it, so the notice cannot promise a period the system does not keep.
 *
 * Nothing here is invented: where the code sets no period, the row says so ("until the
 * workspace is erased") and where a period is a decision someone still has to take, it is a
 * visible placeholder for counsel or the accountant.
 */
import { DEFAULT_RETENTION_DAYS, RETENTION_CHOICES } from "../../src/lib/privacy/retention.ts";

export interface RetentionRow {
  data: string;
  keptFor: string;
  /** What deletes or empties it, in the repository. */
  enforcedBy: string;
}

export const RETENTION_SCHEDULE: readonly RetentionRow[] = [
  { data: "Agent replies, conversations and tool activity", keptFor: `The workspace's retention period: ${RETENTION_CHOICES.join(", ")} days, default ${DEFAULT_RETENTION_DAYS}. Then emptied by a daily pass, leaving the verdict and a SHA-256 of the reply`, enforcedBy: "0037 expire_raw_evidence()" },
  { data: "Verdicts, reasons, scenarios, reply fingerprints, reports", keptFor: "Until the workspace is erased", enforcedBy: "erase_workspace()" },
  { data: "Report links", keptFor: "Until the report is withdrawn or its link's expiry date passes; a withdrawn link stays withdrawn", enforcedBy: "0053" },
  { data: "Suite Builder source text", keptFor: "180 days, then emptied; quoted passages and hashes stay with the suite", enforcedBy: "0056 daily pass" },
  { data: "Support messages and trial applications, with their drafts", keptFor: "Erased 90 days after the conversation last changed; a record without content remains that an erasure happened", enforcedBy: "0038 expire_inbound_and_probes()" },
  { data: "Connection check receipts", keptFor: "The agent's reply emptied after 90 days", enforcedBy: "0038" },
  { data: "Ask Novera conversations", keptFor: "Deleted after 180 days without a new message, or when the person deletes them", enforcedBy: "0054 daily pass" },
  { data: "Assistant memory", keptFor: "Until the person deletes it or turns memory off; an item with an expiry goes when it expires", enforcedBy: "0054" },
  { data: "Invitations", keptFor: "Usable for 7 days; the record, with the invited address, is kept until the workspace is erased. If the invited person deletes their Novera account, the address is replaced with a pseudonym. [COUNSEL TO CONFIRM THIS PERIOD FOR ADDRESSES OF PEOPLE WHO NEVER ACCEPTED]", enforcedBy: "0054, 0058" },
  { data: "Workspace exports", keptFor: "The file is never stored; its download link works once, for 15 minutes. The receipt (who, when, SHA-256) is kept until the workspace is erased", enforcedBy: "0061" },
  { data: "Contract acceptances (who accepted which terms, for which organisation, with the business details given)", keptFor: "Until the workspace is erased. A person who accepted for someone else's workspace and then deletes their account stays named in it. [COUNSEL TO CONFIRM: THE DRAFT POSITION IS THAT ACCEPTANCE RECORDS OUTLIVE THE WORKSPACE AS EVIDENCE OF THE CONTRACT, FOR THE CIVIL LIMITATION OR ACCOUNTING PERIOD; THE CODE DOES NOT DO THAT YET]", enforcedBy: "0068, erase_workspace()" },
  { data: "Billing records held by Novera (subscription state, history, billing audit trail)", keptFor: "Until the workspace is erased; erasure is refused while Stripe could still charge. [ACCOUNTANT TO CONFIRM WHICH BILLING RECORDS NOVERA MUST KEEP, AND FOR HOW LONG: THE DRAFT POSITION IS 5 TO 10 YEARS UNDER LAW 82/1991, OVERRIDING ERASURE; THE CODE DOES NOT DO THAT YET]", enforcedBy: "0060, erase_workspace()" },
  { data: "Invoices, receipts and payment records", keptFor: "Held by Stripe under its own obligations, not by Novera; erasing a workspace does not delete them. [ACCOUNTANT TO CONFIRM]", enforcedBy: "Stripe" },
  { data: "Password-reset context", keptFor: "15 minutes, used once", enforcedBy: "src/lib/auth/recovery.ts" },
  { data: "Product events", keptFor: "13 months", enforcedBy: "0062 daily pass" },
  { data: "Rate-limit counters", keptFor: "About one day", enforcedBy: "0024" },
  { data: "Scheduled-job history", keptFor: "30 days", enforcedBy: "0064 prune_cron_history()" },
  { data: "Audit trail", keptFor: "Until the workspace is erased; a person's own events until their account is deleted", enforcedBy: "erase_workspace(), erase_account()" },
  { data: "Account and profile", keptFor: "Until the account is deleted", enforcedBy: "erase_account()" },
  { data: "Backups held by the database provider", keptFor: "[TO VERIFY WITH SUPABASE: BACKUP AND POINT-IN-TIME RECOVERY RETENTION FOR THE PROJECT'S PLAN]", enforcedBy: "Supabase" },
];

export function retentionTable(): string {
  const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");
  return ["| Data | Kept for |", "| --- | --- |", ...RETENTION_SCHEDULE.map((r) => `| ${cell(r.data)} | ${cell(r.keptFor)} |`)].join("\n");
}
