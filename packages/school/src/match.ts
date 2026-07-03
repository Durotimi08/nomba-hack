/**
 * Metadata predicate — a Rule targets students by metadata. A rule's `match` is a
 * set of key/value pairs; a student matches when their metadata contains every
 * pair (subset match). `{}` matches everyone in the cohort. This is the single
 * mechanism behind both "group" and "single-student" rules: breadth is just how
 * many students carry the tag.
 */
export function matchesMetadata(
  match: Record<string, unknown>,
  metadata: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(match)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
