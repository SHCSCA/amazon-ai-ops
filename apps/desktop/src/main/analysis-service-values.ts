import { createHash, randomUUID } from 'crypto';
import { runtimeLogger } from './runtime-logger';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnalysisAuthorityRepository,
  AnalysisAuthorityRepositoryError,
  MissionDomainRepository,
  RecommendationRepository,
  type AnalysisCausalMemoryItem,
} from '@amazon-ai-ops/local-db';
import {
  type ActionRecommendation,
  type AnalysisAuthorizationBlocker,
  type AnalysisAuthorizationBlockerCode,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type AuthorizeAnalysisProposalBatchResult,
  type MissionGrantRecord,
  type MissionAnalysisRunProjection,
  type MissionAnalysisProjection,
  type PolicyVersionRules,
  type RunMissionAnalysisRequest,
  type RunMissionAnalysisResult,
  type StoreContextEnvelope,
  type VerifiedAdEntityAuthorityRecord,
  type WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import {
  analysisBlocker,
  analysisErrorCode,
  uniqueAnalysisBlockers,
} from './analysis-authority-blockers';
import {
  AnalysisGenerationTimeoutError,
} from './analysis-service-generation';
import {
  type RecommendationGenerationResultForAnalysis,
} from './analysis-service-contracts';

export const ANALYSIS_EVIDENCE_FRESHNESS_HOURS = 48;

export const ANALYSIS_ACTION_CONTRACT_VERSION = 'keyword-bid-cents/v16-1';

export const MAX_IDENTITY_PROOF_BYTES = 16 * 1024 * 1024;

export function blockedResult(
  mode: AuthorizeAnalysisProposalBatchResult['mode'],
  proposalIds: readonly string[],
  decisionIds: readonly string[],
  ...blockers: AnalysisAuthorizationBlocker[]
): AuthorizeAnalysisProposalBatchResult {
  runtimeLogger.warn('analysis.authorization_blocked', { mode, blockerCodes: blockers.map(blocker => blocker.code) });
  return {
    mode,
    proposalIds,
    decisionIds,
    authorized: false,
    blockers: uniqueAnalysisBlockers(blockers),
  };
}

export function normalizeAnalysisBlocker(blocker: AnalysisAuthorizationBlocker): AnalysisAuthorizationBlocker {
  return analysisBlocker(blocker.code, blocker.message);
}

export function policyUsageAuthorizationBlocker(error: unknown): AnalysisAuthorizationBlocker {
  const detail = error instanceof Error ? error.message : '';
  const code: AnalysisAuthorizationBlockerCode = /单日动作数将超限/.test(detail) ? 'DAILY_ACTION_LIMIT_EXCEEDED'
    : /冷却期/.test(detail) ? 'COOLDOWN_ACTIVE' : /当前不在策略执行窗口/.test(detail) ? 'OUTSIDE_EXECUTION_WINDOW'
    : /时区/.test(detail) ? 'POLICY_TIMEZONE_MISMATCH' : 'POLICY_RATE_LIMITS_INVALID';
  const messages = {
    DAILY_ACTION_LIMIT_EXCEEDED: '当前策略单日动作额度不足，请等待下一业务日或检查策略配置。',
    COOLDOWN_ACTIVE: '当前广告对象仍在策略冷却期，请等待冷却结束。',
    OUTSIDE_EXECUTION_WINDOW: '当前不在策略执行窗口，请在允许时段重试。',
    POLICY_TIMEZONE_MISMATCH: '策略时区与当前店铺不一致，请检查店铺策略配置。',
    POLICY_RATE_LIMITS_INVALID: '策略额度校验未完成，请检查当前策略配置后重试。',
  };
  return analysisBlocker(code, messages[code]);
}

export function proposalValidUntil(now: Date, evidenceFreshUntil: string, missionObservationEnd: string): string {
  const twentyFourHours = now.getTime() + 24 * 60 * 60 * 1000;
  const candidate = Math.min(twentyFourHours, Date.parse(evidenceFreshUntil), Date.parse(missionObservationEnd));
  if (!Number.isFinite(candidate) || candidate <= now.getTime()) {
    throw new Error('Mission analysis blocked: no future proposal validity window remains.');
  }
  return new Date(candidate).toISOString();
}

export function uniqueNonEmptyIds(value: readonly string[], field: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  const ids = value.map((id) => requiredId(id, field));
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length !== ids.length) {
    throw new TypeError(`${field} must be non-empty and contain unique ids.`);
  }
  return unique;
}

export function requiredId(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  if (normalized.length > 180) throw new TypeError(`${field} is too long.`);
  return normalized;
}

export function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}

export function sha256Text(value: unknown, field: string): string {
  const normalized = requiredText(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${field} must be SHA-256.`);
  return normalized;
}

export function compactId(prefix: string, payload: unknown): string {
  return `${prefix}:${createHash('sha256').update(stableJson(payload)).digest('hex').slice(0, 32)}`;
}

export function analysisCausalMemoryDigest(items: readonly AnalysisCausalMemoryItem[]): string {
  const normalized = items.map((item) => ({
    missionId: item.missionId,
    sessionGeneration: item.sessionGeneration,
    stage: item.stage,
    eventType: normalizedMemoryText(item.eventType),
    entityType: normalizedMemoryText(item.entityType),
    entityId: normalizedMemoryText(item.entityId),
    title: normalizedMemoryText(item.title),
    observedEffect: normalizedMemoryText(item.observedEffect),
    status: normalizedMemoryText(item.status).toLowerCase(),
    source: normalizedMemoryText(item.source),
    businessDate: normalizedMemoryText(item.businessDate),
    proofs: item.proofs.map((proof) => ({
      evidenceType: normalizedMemoryText(proof.evidenceType),
      evidenceRef: normalizedMemoryText(proof.evidenceRef),
      sha256: normalizedMemoryText(proof.sha256).toLowerCase(),
    })).sort(compareStableValues),
  })).sort(compareStableValues);
  return createHash('sha256').update(stableJson(normalized)).digest('hex');
}

export function effectiveModelRevision(
  baseModelRevision: string,
  memoryDigest: string,
  memoryCount: number,
): string {
  return memoryCount === 0
    ? baseModelRevision
    : `${baseModelRevision}|causal-memory:${memoryDigest}`;
}

export function normalizedMemoryText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function compareStableValues(left: unknown, right: unknown): number {
  const leftJson = stableJson(left);
  const rightJson = stableJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

export function analysisRunFailureOperatorReason(error: unknown): string {
  if (error instanceof AnalysisGenerationTimeoutError) {
    return 'AI 分析等待超时，已安全停止且未生成建议；请检查网络、AI Key 与模型设置后重新运行分析。';
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/\b(ai|provider|model|recommendation|generation|rule|policy)\b/i.test(message)) {
    return '分析服务或策略生成未完成；请检查 AI 与策略配置后重试。';
  }
  if (/batch|evidence|report|import|lingxing|metric/i.test(message)) {
    return '当前任务的数据证据不完整或已变化；请先完成 8 类报表采集与导入，再重新分析。';
  }
  if (/store|mission|context|session|scope|changed|店铺|任务|上下文|会话|已变化/i.test(message)) {
    return '分析期间店铺、任务或会话已变化；请刷新当前店铺并重新运行分析。';
  }
  return '分析未完成；请刷新当前店铺确认数据与策略状态后重试。';
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  const canonical = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  return canonical.replace(/\\/g, '/').toLowerCase();
}

export function isPathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizedOptionalText(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function safeAiAnalysisDetail(
  explanation: RecommendationGenerationResultForAnalysis['aiExplanation'],
): string {
  if (explanation.invoked && explanation.strategyDiagnosis?.source === 'ai') {
    return 'AI 已完成结构化诊断；建议仍受规则、批次授权与真实回读安全门约束。';
  }
  if (!explanation.configured) {
    return 'AI 未配置；本次仅保留规则降级结果，不能进入执行授权。';
  }
  return 'AI 本次未完成；仅保留规则降级结果，不能进入执行授权。';
}

export function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}
