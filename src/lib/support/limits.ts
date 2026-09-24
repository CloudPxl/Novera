/**
 * The size of a public submission, in one place.
 *
 * The server enforced these and the form did not state them, so the only way to learn
 * the message cap was to write past it and be told after a round trip. Shared so the
 * two cannot drift: a field that allows more than the action accepts is a rejection
 * waiting to happen, and one that allows less is a limit nobody agreed to.
 *
 * Its own module, with no imports, because `actions.ts` is a `"use server"` file — a
 * client component cannot import a constant from one.
 */
export const MESSAGE_MIN = 15;
export const MESSAGE_MAX = 4000;
export const EMAIL_MAX = 254;
export const ORGANISATION_MAX = 200;
