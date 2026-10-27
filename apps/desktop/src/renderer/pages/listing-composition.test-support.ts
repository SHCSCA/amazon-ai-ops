import { readFileSync } from 'node:fs';

// 仅供源契约检查读取真实模块，不拼装或执行生产实现。
export function listingCompositionSource(): string {
  return ["listing-optimization-page.tsx","listing-contracts.ts","listing-task-model.ts","listing-actions.ts","listing-presentation.ts","listing-heatmap.ts","listing-text-diff.ts","listing-content.ts","listing-controller.tsx","listing-view.tsx"]
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
}
