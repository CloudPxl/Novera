/**
 * The active workspace: the cookie's choice only when this person is a member of it, else their
 * default, else their first. A cookie left by someone else who used this browser names a
 * workspace this person is not in, and is ignored.
 */
export function pickActiveWorkspace<M extends { workspace: { id: string } }>(memberships: readonly M[], chosen: string | undefined, defaultId: string | null | undefined): M {
  return memberships.find((m) => m.workspace.id === chosen) ?? memberships.find((m) => m.workspace.id === defaultId) ?? memberships[0];
}
