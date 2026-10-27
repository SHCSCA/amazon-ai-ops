import { readFileSync } from 'node:fs';

export function transactionPageSource(file: string): string {
  return readFileSync(new URL('./' + file, import.meta.url), 'utf8');
}
