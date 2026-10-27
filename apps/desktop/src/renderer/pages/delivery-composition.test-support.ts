import { readFileSync } from 'node:fs';

// 仅让源契约断言读取实际职责模块，不拼装或执行生产实现。
export function deliveryCompositionSource(): string {
  return ['delivery-page.tsx', 'delivery-controller.tsx', 'delivery-view.tsx', 'delivery-contracts.ts',
    'delivery-actions.ts', 'delivery-evidence.ts', 'delivery-presentation.tsx', 'delivery-readback.ts', 'delivery-export-policy.ts', 'delivery-export-control.tsx', 'delivery-state-load.ts']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
}
