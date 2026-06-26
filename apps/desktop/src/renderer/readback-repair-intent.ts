import { firstIncompleteReadbackStep, type ReadbackWizardStepId } from './readback-wizard';

export const READBACK_REPAIR_INTENT_EVENT = 'amazon-ai-ops:readback-repair-intent';
export const READBACK_REPAIR_INTENT_STORAGE_KEY = 'amazon-ai-ops:readback-repair-intent';

export interface ReadbackRepairIntent {
  source: 'delivery';
  step?: ReadbackWizardStepId;
  candidatePath?: string;
  missingFields?: string[];
  summary?: string;
  createdAt?: string;
}

export function isReadbackWizardStepId(value: unknown): value is ReadbackWizardStepId {
  return value === 'target-source' || value === 'approval' || value === 'evidence' || value === 'verify-export';
}

export function parseReadbackRepairIntent(raw: string | null | undefined): ReadbackRepairIntent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReadbackRepairIntent>;
    if (parsed?.source !== 'delivery') return null;
    return {
      source: 'delivery',
      step: isReadbackWizardStepId(parsed.step) ? parsed.step : undefined,
      candidatePath: typeof parsed.candidatePath === 'string' ? parsed.candidatePath : undefined,
      missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields.filter((item): item is string => typeof item === 'string') : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
    };
  } catch {
    return null;
  }
}

export function readbackRepairIntentStep(intent: ReadbackRepairIntent | null | undefined): ReadbackWizardStepId {
  if (isReadbackWizardStepId(intent?.step)) return intent.step;
  if (intent?.missingFields?.length) return firstIncompleteReadbackStep(intent.missingFields);
  return 'evidence';
}

export function readbackRepairIntentMessage(intent: ReadbackRepairIntent | null | undefined): string {
  const summary = intent?.summary?.trim();
  const candidate = intent?.candidatePath?.trim();
  const candidateSuffix = candidate ? ` 候选证据：${candidate}` : '';
  return `从交付验收直达修复：${summary || '请补齐执行前、执行后和回读证据。'}${candidateSuffix}`;
}

export function readbackRepairPanelClass(active: boolean, pulsing: boolean): string {
  return [
    'readback-repair-target',
    active ? 'readback-repair-target-active' : '',
    active && pulsing ? 'readback-repair-target-pulse' : '',
  ].filter(Boolean).join(' ');
}
