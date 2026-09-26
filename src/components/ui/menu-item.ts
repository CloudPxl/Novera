/**
 * The look of one item in a `Menu`.
 *
 * Lives outside menu.tsx because that is a client module: a constant exported from it
 * reaches a server component as a client reference, not a string. Used directly as a
 * prop it happened to resolve; interpolated into a template literal it rendered the
 * reference's source text as the class, and "Connect an agent…" lost all its styling.
 */
export const menuItemClass =
  "block w-full rounded-control px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-sunken focus-visible:bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink";
