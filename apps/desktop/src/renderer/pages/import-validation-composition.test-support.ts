import { readFileSync } from 'node:fs';

// 仅供源契约检查读取真实模块，不拼装或执行生产实现。
export function importValidationCompositionSource(): string {
  return ["data-import-validation-page.tsx","import-validation-contracts.ts","import-validation-sorting.ts","import-validation-presentation.ts","import-validation-actions.ts","import-validation-workspace.tsx"]
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
}
