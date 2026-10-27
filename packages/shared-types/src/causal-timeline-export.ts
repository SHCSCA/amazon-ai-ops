import { normalizeBusinessDate, normalizeStoreContextEnvelope, type StoreContextEnvelope } from './store';
import {
  CAUSAL_LEDGER_STAGES, normalizeDomainIdentifier, normalizeDomainTimestamp, normalizeOpaqueEvidenceRef,
  type CausalEventRecord, type CausalEvidenceRefRecord,
} from './mission-domain';

export interface CausalTimelineExport {
  formatVersion: 'amazon-ai-ops-causal-memory-v2';
  scope: StoreContextEnvelope;
  recordCount: number;
  evidenceCount: number;
  records: CausalEventRecord[];
  evidenceRefs: CausalEvidenceRefRecord[];
  searchTermsByRecord: Record<string, string>;
}

export function sanitizeCausalExportText(value: string): string {
  return value
    .replace(/(?:password|passwd|secret(?:[_-]?key)?|token|authorization|cookie|session(?:id)?|api[-_\s]?key|密码|密钥|令牌)(?:["']?\s*[:=：]\s*)[^\r\n;,，；]*/gi, '[已脱敏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[已脱敏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[已脱敏]')
    .replace(/(?:https?|file):\/\/[^\s<>"']+/gi, '[链接已隐藏]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n<>"|]*/g, '[路径已隐藏]')
    .replace(/\\\\[^\s<>"']+/g, '[路径已隐藏]')
    .replace(/(^|[\s(=])\/[^\s<>"']+/g, '$1[路径已隐藏]')
    .replace(/\/(?:[A-Za-z0-9_.-]+\/)+[^\s<>"']*/g, '[路径已隐藏]');
}

function logicalId(value: string): string {
  const normalized = normalizeDomainIdentifier(value, 'exportIdentifier');
  if (sanitizeCausalExportText(normalized) !== normalized) throw new TypeError('导出标识含敏感内容，已阻断。');
  return normalized;
}

function exportBusinessDate(value: unknown): string {
  try { return normalizeBusinessDate(value); }
  catch { throw new TypeError('因果记录业务日期无效。'); }
}

function safeEvent(event: CausalEventRecord, scope: StoreContextEnvelope): CausalEventRecord {
  if (event.storeId !== scope.storeId) throw new TypeError('因果时间线包含跨店铺记录。');
  if (!CAUSAL_LEDGER_STAGES.includes(event.stage) || !Number.isSafeInteger(event.sequence) || event.sequence < 1
    || !Number.isSafeInteger(event.sessionGeneration) || event.sessionGeneration < 0) throw new TypeError('因果记录顺序或阶段无效。');
  if (event.confidence !== undefined && (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1)) throw new TypeError('因果记录置信度无效。');
  const result: CausalEventRecord = {
    id: logicalId(event.id), storeId: scope.storeId, stage: event.stage,
    eventType: sanitizeCausalExportText(event.eventType), entityType: sanitizeCausalExportText(event.entityType),
    entityId: logicalId(event.entityId), title: sanitizeCausalExportText(event.title),
    status: sanitizeCausalExportText(event.status), source: sanitizeCausalExportText(event.source),
    actorId: logicalId(event.actorId), businessDate: exportBusinessDate(event.businessDate),
    sessionGeneration: event.sessionGeneration, sequence: event.sequence,
    createdAt: normalizeDomainTimestamp(event.createdAt, 'createdAt'),
  };
  for (const field of ['signal', 'intervention', 'expectedEffect', 'observedEffect'] as const) {
    if (event[field] !== undefined) result[field] = sanitizeCausalExportText(event[field]);
  }
  if (event.missionId !== undefined) result.missionId = logicalId(event.missionId);
  if (event.correctsEventId !== undefined) result.correctsEventId = logicalId(event.correctsEventId);
  if (event.confidence !== undefined) result.confidence = event.confidence;
  return result;
}

export function createCausalTimelineExport(
  context: StoreContextEnvelope, events: readonly CausalEventRecord[], evidence: readonly CausalEvidenceRefRecord[],
): CausalTimelineExport {
  const scope = normalizeStoreContextEnvelope(context);
  const records = events.map(event => safeEvent(event, scope)).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  const recordIds = new Set(records.map(event => event.id));
  if (recordIds.size !== records.length) throw new TypeError('因果导出包含重复记录。');
  const evidenceRefs = evidence.map(proof => {
    if (proof.storeId !== scope.storeId || !recordIds.has(proof.eventId)) throw new TypeError('证据引用不属于当前导出记录。');
    if (proof.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(proof.sha256)) throw new TypeError('证据摘要无效。');
    return {
      id: logicalId(proof.id), storeId: scope.storeId, eventId: logicalId(proof.eventId),
      evidenceType: sanitizeCausalExportText(proof.evidenceType), evidenceRef: normalizeOpaqueEvidenceRef(logicalId(proof.evidenceRef)),
      ...(proof.sha256 ? { sha256: proof.sha256.toLowerCase() } : {}),
      createdAt: normalizeDomainTimestamp(proof.createdAt, 'createdAt'),
    };
  }).sort((a, b) => a.eventId.localeCompare(b.eventId) || a.id.localeCompare(b.id));
  if (new Set(evidenceRefs.map(proof => proof.id)).size !== evidenceRefs.length) throw new TypeError('因果导出包含重复证据引用。');
  const searchTermsByRecord = Object.fromEntries(records.map(event => [event.id, [
    event.id, event.title, event.eventType, event.entityType, event.entityId, event.missionId,
    event.signal, event.intervention, event.expectedEffect, event.observedEffect, event.status,
  ].filter(Boolean).join('\n').toLowerCase()]));
  return { formatVersion: 'amazon-ai-ops-causal-memory-v2', scope, recordCount: records.length, evidenceCount: evidenceRefs.length, records, evidenceRefs, searchTermsByRecord };
}
