import { BodyTooLarge, readTextLimited } from "../net/read-body.ts";
import { apiJson } from "./respond.ts";

/**
 * Reading a request body on the public API: never more than a route's limit, however much is
 * sent, so a key holder cannot make a function parse twenty megabytes of JSON. Every write
 * route's fields are short; the limit is far above any honest request.
 */
export const API_BODY_LIMIT = 64 * 1024;

/** The parsed body. Throws `BodyTooLarge` past the limit and `SyntaxError` for anything but JSON. */
export async function readJsonBody(request: Request, limit = API_BODY_LIMIT): Promise<unknown> {
  return JSON.parse(await readTextLimited(request as unknown as Response, limit));
}

/** The refusal for a body past its limit, in the API's shape. */
export function bodyTooLarge(limit = API_BODY_LIMIT): Response {
  return apiJson({ error: `The request body is larger than ${Math.round(limit / 1024)} KB, so it was not read.`, code: "payload_too_large" }, 413);
}

export { BodyTooLarge };
