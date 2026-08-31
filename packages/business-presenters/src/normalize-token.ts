/**
 * Normalize an enum-like token into a snake_case lowercase key.
 * Example: "ExactMatch" → "exact_match"; "broad-match" → "broad_match".
 *
 * Internal helper used to match presenter lookup tables regardless of
 * whether the upstream domain sent camelCase, kebab-case, or PascalCase.
 */
export function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
