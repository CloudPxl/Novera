import type { LegalSource } from "./types.ts";

/**
 * Every source the legal drafts were checked against, with the date it was read.
 *
 * EUR-Lex answered every request from this machine with an empty 202 (a bot challenge)
 * on 2026-10-09, so the EU acts were read from the Publications Office's own copy of the
 * same Official Journal text (the Cellar, `publications.europa.eu/resource/celex/…`),
 * and the EUR-Lex address is the one listed for a reader. Both are official.
 *
 * Reading a law is not applying it. Nothing here is cited as proof that Novera meets
 * an obligation; each source is where an obligation, a definition or a date came from.
 */
export const SOURCES: readonly LegalSource[] = [
  {
    id: "gdpr",
    title: "Regulation (EU) 2016/679 (General Data Protection Regulation), OJ L 119, 4.5.2016",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Read via the Publications Office Cellar (CELEX 32016R0679). Articles read in the text for these drafts: 13 (information duties), 28 (processor contract and sub-processors), 33 (breach notification, including the processor's duty to the controller) and 37 (when a DPO is required). Other articles named in the drafts (6, 9, 15–22, 32, 44–49, 77) are cited by number for counsel to apply, not analysed. The original text was read, not a consolidated version.",
  },
  {
    id: "ai-act",
    title: "Regulation (EU) 2024/1689 (Artificial Intelligence Act), OJ L, 12.7.2024",
    url: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Read via the Cellar (CELEX 32024R1689), original text. Article 3(3) and (4) (provider, deployer), Article 4 (AI literacy), Article 50 (transparency) and Article 113 (application dates: Article 50 from 2 August 2026).",
  },
  {
    id: "ai-omnibus",
    title: "Regulation (EU) 2026/1744 (Digital Omnibus on AI), amending Regulation (EU) 2024/1689, OJ L, 24.7.2026",
    url: "https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Read via the Cellar (CELEX 32026R1744) for the amendments to Article 4 (AI literacy now a duty to take measures) and the four-month transition for Article 50(2) marking (2 December 2026 for systems placed on the market before 2 August 2026). Not read in full; counsel to confirm its other effects.",
  },
  {
    id: "ai-art50-faq",
    title: "European Commission, Transparency obligations under Article 50 of the AI Act (FAQ)",
    url: "https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act",
    kind: "official-guidance",
    fetched: "2026-10-09",
    note: "Application from 2 August 2026; disclosure at the first interaction; the human review or editorial control exception for published text.",
  },
  {
    id: "data-act",
    title: "Regulation (EU) 2023/2854 (Data Act), OJ L, 22.12.2023",
    url: "https://eur-lex.europa.eu/eli/reg/2023/2854/oj",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Read via the Cellar (CELEX 32023R2854). Applies from 12 September 2025; Chapter VI (switching between data processing services, Article 25 contractual terms) identified as a question for counsel, not analysed.",
  },
  {
    id: "eprivacy",
    title: "Directive 2002/58/EC (ePrivacy Directive), OJ L 201, 31.7.2002",
    url: "https://eur-lex.europa.eu/eli/dir/2002/58/oj",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Read via the Cellar (CELEX 32002L0058). The text served was the original 2002 version; Article 5(3) as amended by Directive 2009/136/EC was not read in consolidated form.",
  },
  {
    id: "odr-repeal",
    title: "Regulation (EU) 2024/3228 discontinuing the European Online Dispute Resolution platform, OJ L, 30.12.2024",
    url: "https://eur-lex.europa.eu/eli/reg/2024/3228/oj",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Read via the Cellar (CELEX 32024R3228). The ODR platform and the duty to link to it ended in 2025; no ODR link is drafted.",
  },
  {
    id: "edpb-07-2020",
    title: "EDPB Guidelines 07/2020 on the concepts of controller and processor in the GDPR, version 2.0 (adopted 7 July 2021)",
    url: "https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en",
    kind: "official-guidance",
    fetched: "2026-10-09",
    note: "Controller decides purposes and essential means; the Article 28 contract should do more than restate the law; general authorisation of sub-processors with a right to object.",
  },
  {
    id: "edpb-opinion-22-2024",
    title: "EDPB Opinion 22/2024 on obligations following from reliance on processors and sub-processors (adopted 9 October 2024)",
    url: "https://www.edpb.europa.eu/news/news/2024/edpb-adopts-opinion-processors-guidelines-legitimate-interest-statement-draft_en",
    kind: "official-guidance",
    fetched: "2026-10-09",
    note: "Read from the EDPB announcement; the PDF did not extract. The controller should have the identity, address and contact of every sub-processor readily available.",
  },
  {
    id: "edpb-dpia",
    title: "Article 29 Working Party Guidelines on Data Protection Impact Assessment, WP248 rev.01 (endorsed by the EDPB on 25 May 2018)",
    url: "https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/data-protection-impact-assessments-high-risk-processing_en",
    kind: "official-guidance",
    fetched: "2026-10-09",
    note: "Read the EDPB landing page only; the criteria for when a DPIA is likely required are a question for counsel.",
  },
  {
    id: "ro-365-2002",
    title: "Legea nr. 365/2002 privind comerțul electronic (republicată), Portal Legislativ",
    url: "https://legislatie.just.ro/Public/DetaliiDocument/37075",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Consolidated form shown on the portal. Article 5(1)(a)–(f): name, seat, contact details, register number, tax registration code, competent authority; Article 5(2): displayed clearly, visibly and permanently on the site. Article 6: commercial email needs prior express consent.",
  },
  {
    id: "ro-506-2004",
    title: "Legea nr. 506/2004 privind prelucrarea datelor cu caracter personal și protecția vieții private în sectorul comunicațiilor electronice, Portal Legislativ",
    url: "https://legislatie.just.ro/Public/DetaliiDocument/56973",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Article 4(5) consent and prior information for storing or reading information on a terminal; Article 4(6)(b) exemption for what is strictly necessary for a service the user expressly requested. The portal showed a 2012 modification date; counsel to confirm the current form.",
  },
  {
    id: "ro-oug-34-2014",
    title: "OUG nr. 34/2014 privind drepturile consumatorilor în cadrul contractelor încheiate cu profesioniștii, Portal Legislativ",
    url: "https://legislatie.just.ro/Public/DetaliiDocument/158913",
    kind: "primary",
    fetched: "2026-10-09",
    note: "Consolidated form dated 27.03.2026. Article 2 (consumer: a natural person), Article 9 (14-day withdrawal from a distance contract), Article 16 (exception after full performance with prior express consent). Applies only if consumers are served.",
  },
  {
    id: "anspdcp",
    title: "Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), contact page",
    url: "https://www.dataprotection.ro/?page=contact&lang=ro",
    kind: "authority",
    fetched: "2026-10-09",
    note: "B-dul G-ral. Gheorghe Magheru 28-30, Sector 1, cod poștal 010336, București; anspdcp[at]dataprotection.ro. The complaints procedure is linked from the home page (Plângeri RGPD).",
  },
  {
    id: "anpc",
    title: "Autoritatea Națională pentru Protecția Consumatorilor (ANPC)",
    url: "https://anpc.ro/",
    kind: "authority",
    fetched: "2026-10-09",
    note: "Online complaints and alternative dispute resolution (SAL). Relevant only if consumers are served.",
  },
];

export function sourceById(id: string): LegalSource {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`Unknown legal source: ${id}`);
  return source;
}
