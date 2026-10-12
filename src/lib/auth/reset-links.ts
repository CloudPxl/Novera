/**
 * Addresses a password-reset email could point at besides Novera's own. A template pasted from
 * Supabase's guides, a link copied from another starter kit, or an older Novera template sends a
 * person to `/update-password`, `/auth/update-password`, `/auth/reset-password` and the like,
 * which answered 404: the person had a valid reset link and no page to set the password on.
 *
 * Each forwards what the link carries to the handler that spends it, so nothing about the reset
 * rules changes: a PKCE `code` to `/auth/callback?flow=recovery` (a session GoTrue marked
 * `recovery` only), a `token_hash` to `/auth/confirm` (verified without cookies), and a bare
 * visit to `/reset-password`, which refuses without a recovery context. Pure, so it is tested.
 */
export const RESET_ALIASES = ["/update-password", "/auth/update-password", "/auth/reset-password", "/password-reset", "/forgot-password"] as const;

const TOKEN = /^[A-Za-z0-9_-]{8,256}$/;

export function resetLinkTarget(url: URL): string {
  const q = url.searchParams;
  // Someone looking for the "forgot password" form, not spending a link.
  if (url.pathname === "/forgot-password" && !q.has("code") && !q.has("token_hash")) return "/sign-in?mode=reset";
  if (q.has("code") || q.has("error")) {
    const out = new URLSearchParams({ flow: "recovery" });
    for (const key of ["code", "error", "error_code", "error_description"]) {
      const value = q.get(key);
      if (value) out.set(key, value);
    }
    return `/auth/callback?${out}`;
  }
  const tokenHash = q.get("token_hash");
  if (tokenHash && TOKEN.test(tokenHash)) {
    const type = q.get("type");
    return `/auth/confirm?${new URLSearchParams({ token_hash: tokenHash, type: type && /^[a-z_]{1,20}$/.test(type) ? type : "recovery" })}`;
  }
  return "/reset-password";
}
