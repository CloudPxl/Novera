/**
 * The standing notice every Novera report carries: testing evidence, not certification
 * (legal build brief §7, 2026-10-13; DRAFT — COUNSEL REVIEW REQUIRED).
 *
 * One text, read by the report page, every export (CSV, Markdown, JSON, JUnit), the share
 * controls and the AI Testing Scope notice. It sits beside a report, never inside the sealed
 * payload: it is Novera's statement about every report, true for those already sealed, so it
 * changes no hash and needs no absence branch. A report's own `limitations` (sealed) says
 * what that run covered.
 *
 * Pure, so the browser and the exports can both use it.
 */
export const REPORT_NOTICE_TITLE = "Testing evidence, not certification";

/** One line for a report's cover, a CSV header, a JUnit property. */
export const REPORT_NOTICE_SHORT =
  "Testing evidence, not certification: this report records Novera's testing of the declared agent, scenarios and configuration at the time shown. It is not a legal opinion, a conformity assessment, a certification or an assurance that any law is met, and Novera is not a notified body.";

export const REPORT_NOTICE_PARAGRAPHS: readonly string[] = [
  "This report records the results of Novera's testing of the declared target, declared scenarios, declared policy or source material, run configuration, observed responses, available evidence and grading configuration at the time shown in this report.",
  "This report is not a legal opinion, regulatory determination, statutory conformity assessment, CE-marking assessment, certification, accreditation, approval by a notified body, assurance that Regulation (EU) 2024/1689 or any other law is met, or a guarantee of future behaviour, safety, accuracy, robustness, security or regulatory outcome.",
  "Novera is not a notified body, conformity assessment body, legal adviser, insurer or public authority. The report may identify evidence relevant to the customer's internal governance or an external assessment process, but it does not replace the customer's own legal, technical, risk, cybersecurity, data-protection, quality-management or regulatory review.",
  "The customer remains solely responsible for determining whether, when and how its AI system may be developed, placed on the market, put into service, deployed, monitored, modified, documented, risk-assessed, governed or represented as meeting any law.",
];

export const REPORT_NOTICE = REPORT_NOTICE_PARAGRAPHS.join("\n\n");

/** The version of the notice, so an export says which wording it carried. */
export const REPORT_NOTICE_VERSION = "2026-10-13";
