import { readFileSync } from 'node:fs';

// 按生产入口的职责模块读取现有断言文本，不重建或执行实现。
export function recommendationCompositionSource(): string {
  return [
    'recommendations-page.tsx', 'recommendation-controller.ts', 'recommendation-view.tsx',
    'recommendation-decision-evidence.tsx', 'recommendation-selection.ts',
    'recommendation-labels.ts', 'recommendation-evidence.ts', 'recommendation-ai-status.ts',
  ].map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
}
