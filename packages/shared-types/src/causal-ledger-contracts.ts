import type { StoreId } from './store';
import { normalizeLogicalDomainIdentifier as normalizeIdentifier } from './domain-identifiers';

export const CAUSAL_LEDGER_STAGES = [
  'FACT',
  'ANALYSIS',
  'DECISION',
  'ACTION',
  'READBACK',
  'EFFECT',
] as const;

export type CausalLedgerStage = (typeof CAUSAL_LEDGER_STAGES)[number];

export interface CausalEventRecord {
  id: string;
  storeId: StoreId;
  stage: CausalLedgerStage;
  eventType: string;
  entityType: string;
  entityId: string;
  missionId?: string;
  title: string;
  signal?: string;
  intervention?: string;
  expectedEffect?: string;
  observedEffect?: string;
  confidence?: number;
  status: string;
  source: string;
  actorId: string;
  businessDate: string;
  sessionGeneration: number;
  correctsEventId?: string;
  sequence: number;
  createdAt: string;
}

export interface AppendCausalEventInput {
  id: string;
  stage: CausalLedgerStage;
  eventType: string;
  entityType: string;
  entityId: string;
  missionId?: string;
  title: string;
  signal?: string;
  intervention?: string;
  expectedEffect?: string;
  observedEffect?: string;
  confidence?: number;
  status: string;
  source: string;
  actorId: string;
  correctsEventId?: string;
}

export interface CausalLinkRecord {
  id: string;
  storeId: StoreId;
  sourceEventId: string;
  targetType: string;
  targetId: string;
  relation: string;
  createdAt: string;
}

export interface CausalEvidenceRefRecord {
  id: string;
  storeId: StoreId;
  eventId: string;
  evidenceType: string;
  evidenceRef: string;
  sha256?: string;
  createdAt: string;
}

export function normalizeOpaqueEvidenceRef(value: unknown): string {
  let normalized: string;
  try {
    normalized = normalizeIdentifier(value, 'evidenceRef');
  } catch {
    throw new TypeError('evidenceRef must be an opaque logical id, not a filesystem path or file URI');
  }
  if (/^[a-zA-Z]:/.test(normalized)
    || normalized.startsWith('\\\\')
    || /[\\/]/.test(normalized)
    || /^file:/i.test(normalized)) {
    throw new TypeError('evidenceRef must be an opaque logical id, not a filesystem path or file URI');
  }
  return normalized;
}
