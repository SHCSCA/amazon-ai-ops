import { readFileSync } from 'node:fs';

// 源契约仅检查真实职责模块，不拼装或执行生产实现。
export function collectionCompositionSource(): string {
  return ['data-collection-page.tsx', 'collection-controller.tsx', 'collection-view.tsx',
    'collection-contracts.ts', 'collection-capture.ts', 'collection-presentation.ts',
    'collection-jobs.ts', 'collection-progress.ts', 'collection-monitor.tsx',
    'collection-download.ts', 'collection-results.ts', 'collection-queue.tsx',
    'collection-artifact-controls.tsx', 'collection-authority-capture.ts',
    'collection-selector-dialog.tsx', 'collection-file-dialog.tsx', 'collection-operation.ts', 'collection-response-feedback.ts']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
}
