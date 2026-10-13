import { serializeJsonLd, type JsonLdObject } from "@/lib/seo/json-ld.ts";

/**
 * Structured data for crawlers. A `application/ld+json` block is data, not script: the browser
 * never executes it, so the nonce Content-Security-Policy neither blocks it nor needs to be
 * told about it (no nonce is attached on purpose).
 */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((item, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }} />
      ))}
    </>
  );
}
