import { readFileSync } from 'node:fs';

// 源契约只读取实际职责模块，不重建或执行实现。
export function executionCompositionSource(): string {
  return ['execution-workspace.tsx', 'execution-workspace-model.tsx', 'execution-workspace-selection.tsx',
    'execution-workspace-evidence.tsx', 'execution-workspace-contracts.ts', 'execution-workspace-preview.tsx']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
}
