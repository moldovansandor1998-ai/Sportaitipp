/** Internal operations are preserved for administrators, never exposed by hiding UI alone. */
export function isInternalPath(path: string): boolean {
  return ["/admin", "/model-studio", "/x-comments", "/api/admin", "/api/model-studio", "/api/x", "/api/trends/import"].some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/** Call only with identity from Supabase getUser/getClaims, never request body or editable metadata. */
export function isInternalOwner(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === "moldovansandor1998@gmail.com";
}
