/**
 * Storage path containment checks.
 *
 * Storage paths recorded on Firestore documents (assets, chat attachments)
 * are client-written at creation. Security rules constrain them, but every
 * server-side byte access through the Admin SDK — which bypasses rules —
 * re-checks containment here before touching the file. This is the same
 * guard `creativeDownloadImage` has always applied, shared so no reader of
 * client-recorded paths can forget it.
 *
 * The check is a literal prefix comparison, never a regex: a business
 * document id may legally contain regex metacharacters (`.*` is a valid
 * Firestore id), so building a pattern from it would let a forged id match
 * another business's path.
 */
export function isPathWithinBusiness(
  storagePath: unknown,
  businessId: unknown,
): storagePath is string {
  return (
    typeof storagePath === 'string' &&
    typeof businessId === 'string' &&
    businessId.length > 0 &&
    // A document id can never contain '/', but the field feeding this check
    // is client-written data, not a document id — reject it outright.
    !businessId.includes('/') &&
    storagePath.startsWith(`businesses/${businessId}/`)
  )
}
