export function normalizeKeyword(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, '');
}

export function dedupeKeywords<T extends { normalizedKeyword: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.normalizedKeyword)) continue;
    seen.add(item.normalizedKeyword);
    result.push(item);
  }

  return result;
}
