/**
 * Client-side masking for list views. The user list endpoint returns raw emails, so the console masks
 * them the same way the API masks profile views (first letter + domain). Unmasked data is only shown
 * on the profile page, on explicit request, by roles holding admin.pii.unmask — and that view is logged.
 */
export function maskEmail(email?: string | null) {
  if (!email) return "—";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
