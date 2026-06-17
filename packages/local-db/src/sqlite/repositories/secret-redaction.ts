export function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'bearer [redacted]')
    .replace(
      /"([^"]*(?:api[_-]?key|apikey|authorization|token|secret)[^"]*)"\s*:\s*"[^"]*"/gi,
      '"$1":"[redacted]"',
    )
    .replace(
      /\b(deepseek[_-]?api[_-]?key|api[_-]?key|apikey|authorization|token|secret)\s*[:=]\s*["']?[^"',;\s<>]+/gi,
      '$1=[redacted]',
    );
}
