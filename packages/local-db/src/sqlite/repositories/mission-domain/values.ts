import  {
  normalizeDomainIdentifier,
  normalizeDomainRevision,
  normalizeDomainStringList,
  normalizeDomainText,
  normalizeDomainTimestamp,
  type ExperimentStatus,
  type MissionLifecycleStatus,
  type MissionPriority,
  type PolicyVersionRules,
} from '@amazon-ai-ops/shared-types';
import { MissionDomainRepositoryError } from './errors';
export function decodePolicyScopePart(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

export function decodePolicyScopeParts(value: string): string[] | undefined {
  const parts: string[] = [];
  for (const part of value.split('/')) {
    const decoded = decodePolicyScopePart(part);
    if (decoded === undefined && part !== '') return undefined;
    parts.push(decoded ?? '');
  }
  return parts;
}

export function scopeText(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

export function rulesOf(value: PolicyVersionRules): PolicyVersionRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Policy rules must be an object.');
  const allowedActionTypes = listOf(value.allowedActionTypes, 'allowedActionTypes', true) as PolicyVersionRules['allowedActionTypes'];
  if (allowedActionTypes.some((action) => action !== 'set_keyword_bid')) {
    throw invalid('V1 policy supports set_keyword_bid only.');
  }

  const allowedAdEntityIds = listOf(value.allowedAdEntityIds, 'allowedAdEntityIds', false)
    .map((id) => idOf(id, 'adEntityId'));
  const requiredEvidence = listOf(value.requiredEvidence, 'requiredEvidence', true) as PolicyVersionRules['requiredEvidence'];
  const supportedEvidence = [
    'before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value',
  ] as const;
  if (requiredEvidence.some((evidence) => !supportedEvidence.includes(evidence))) {
    throw invalid('Policy requiredEvidence contains an unsupported evidence type.');
  }
  if (supportedEvidence.some((evidence) => !requiredEvidence.includes(evidence))) {
    throw invalid('Policy requiredEvidence must retain every mandatory V1 readback proof.');
  }
  if (!Array.isArray(value.stopConditions) || value.stopConditions.length === 0) {
    throw invalid('Policy stopConditions cannot be empty.');
  }
  for (const condition of value.stopConditions) {
    if (!condition || typeof condition !== 'object') throw invalid('Policy stop condition is invalid.');
    idOf(condition.code, 'stopCondition.code');
    if (![
      'identity_drift', 'expected_before_mismatch', 'unknown_result',
      'data_stale', 'impact_budget_exhausted', 'kill_switch',
    ].includes(condition.code)) {
      throw invalid('Policy stopConditions contains an unsupported stop condition code.');
    }
    textOf(condition.detail, 'stopCondition.detail', 500);
  }
  const mandatoryStopCodes = [
    'identity_drift', 'expected_before_mismatch', 'unknown_result',
    'data_stale', 'impact_budget_exhausted', 'kill_switch',
  ] as const;
  const configuredStopCodes = value.stopConditions.map((condition) => condition.code);
  if (new Set(configuredStopCodes).size !== configuredStopCodes.length) {
    throw invalid('Policy stopConditions cannot contain duplicate codes.');
  }
  if (mandatoryStopCodes.some((code) => !configuredStopCodes.includes(code))) {
    throw invalid('Policy stopConditions must retain every mandatory V1 fail-closed condition.');
  }
  if (!Number.isFinite(value.maxChangePct) || value.maxChangePct <= 0 || value.maxChangePct > 10) {
    throw invalid('V1 关键词竞价单次变化必须大于 0% 且不超过 10%。');
  }
  if (!Number.isFinite(value.totalImpactBudget) || value.totalImpactBudget < 0) {
    throw invalid('Policy totalImpactBudget must be non-negative.');
  }
  if (!Number.isSafeInteger(value.maxDailyActionCount)
    || value.maxDailyActionCount <= 0
    || value.maxDailyActionCount > 10_000) {
    throw invalid('Policy maxDailyActionCount must be an integer from 1 to 10000.');
  }
  if (!Number.isSafeInteger(value.cooldownMinutes)
    || value.cooldownMinutes < 0
    || value.cooldownMinutes > 525_600) {
    throw invalid('Policy cooldownMinutes must be an integer from 0 to 525600.');
  }
  const executionWindow = value.executionWindow;
  if (!executionWindow || typeof executionWindow !== 'object' || Array.isArray(executionWindow)) {
    throw invalid('Policy executionWindow must be configured.');
  }
  const timeZone = textOf(executionWindow.timeZone, 'executionWindow.timeZone', 100);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw invalid('Policy executionWindow.timeZone must be a valid IANA timezone.');
  }
  if (!Array.isArray(executionWindow.daysOfWeek) || executionWindow.daysOfWeek.length === 0
    || executionWindow.daysOfWeek.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) {
    throw invalid('Policy executionWindow.daysOfWeek must contain weekday integers from 0 to 6.');
  }
  const daysOfWeek = [...new Set(executionWindow.daysOfWeek)].sort((left, right) => left - right);
  if (daysOfWeek.length !== executionWindow.daysOfWeek.length) {
    throw invalid('Policy executionWindow.daysOfWeek cannot contain duplicates.');
  }
  const start = executionWindowTime(executionWindow.start, 'executionWindow.start');
  const end = executionWindowTime(executionWindow.end, 'executionWindow.end');
  if (wallClockMinutes(start) >= wallClockMinutes(end)) {
    throw invalid('Policy executionWindow must end after it starts; V1 does not cross midnight.');
  }
  if (typeof value.killSwitch !== 'boolean') throw invalid('Policy killSwitch must be boolean.');
  return {
    ...value,
    allowedActionTypes,
    allowedAdEntityIds,
    maxChangePct: value.maxChangePct,
    totalImpactBudget: value.totalImpactBudget,
    maxDailyActionCount: value.maxDailyActionCount,
    cooldownMinutes: value.cooldownMinutes,
    executionWindow: { timeZone, daysOfWeek, start, end },
    requiredEvidence,
    stopConditions: value.stopConditions.map((condition) => ({
      code: condition.code,
      detail: textOf(condition.detail, 'stopCondition.detail', 500),
    })),
    killSwitch: value.killSwitch,
  };
}

export function executionWindowTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw invalid(`Policy ${label} must use HH:mm.`);
  }
  return value;
}

export function wallClockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
}

export function localPolicyClock(date: Date, timeZone: string): {
  businessDate: string;
  dayOfWeek: number;
  minuteOfDay: number;
} {
  if (!Number.isFinite(date.getTime())) throw new Error('Grant slot reservation time is invalid.');
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((item) => item.type === type)?.value ?? ''
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const hours = Number(part('hour'));
  const minutes = Number(part('minute'));
  if (weekday < 0 || !Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes)) {
    throw new Error('Policy execution-window clock could not be resolved.');
  }
  return {
    businessDate: `${part('year')}-${part('month')}-${part('day')}`,
    dayOfWeek: weekday,
    minuteOfDay: (hours * 60) + minutes,
  };
}

export function assertMissionTransition(from: MissionLifecycleStatus, to: MissionLifecycleStatus): void {
  if (from === to) return;
  const allowed: Record<MissionLifecycleStatus, readonly MissionLifecycleStatus[]> = {
    draft: ['active', 'blocked'],
    active: ['paused', 'blocked', 'completed'],
    paused: ['active', 'blocked', 'completed'],
    blocked: ['active', 'paused', 'completed'],
    completed: [],
    archived: [],
  };
  if (!allowed[from].includes(to)) throw stateConflict(`Mission cannot transition from ${from} to ${to}.`);
}

export function assertExperimentTransition(from: ExperimentStatus, to: ExperimentStatus): void {
  if (from === to) return;
  const allowed: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
    draft: ['running', 'paused'],
    running: ['paused', 'completed'],
    paused: ['running', 'completed'],
    completed: [],
    archived: [],
  };
  if (!allowed[from].includes(to)) throw stateConflict(`Experiment cannot transition from ${from} to ${to}.`);
}

export function assertTimeRange(start: string | null | undefined, end: string | null | undefined, label: string): void {
  if (start && end && Date.parse(start) >= Date.parse(end)) throw invalid(`${label} end must be after start.`);
}

export function idOf(value: unknown, label: string): string {
  try {
    return normalizeDomainIdentifier(value, label);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

export function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return idOf(value, label);
}

export function textOf(value: unknown, label: string, maxLength: number): string {
  try {
    return normalizeDomainText(value, label, maxLength);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

export function listOf(value: unknown, label: string, required: boolean): string[] {
  try {
    return normalizeDomainStringList(value, label, { required, maxItems: 100, maxLength: 500 });
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

export function revisionOf(value: unknown, label: string): number {
  try {
    return normalizeDomainRevision(value, label);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

export function timestampOf(value: unknown, label: string): string {
  try {
    return normalizeDomainTimestamp(value, label);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

export function optionalTimestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return timestampOf(value, label);
}

export function priorityOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    throw invalid('Policy priority must be an integer from 0 to 10000.');
  }
  return Number(value);
}

export function missionPriorityOf(value: unknown): MissionPriority {
  if (value !== 'P0' && value !== 'P1' && value !== 'P2' && value !== 'P3') {
    throw invalid('Mission priority must be P0, P1, P2, or P3.');
  }
  return value;
}

export function confidenceOf(value: unknown): number {
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 1) {
    throw invalid('Confidence must be a finite number from 0 to 1.');
  }
  return Number(value);
}

export function formatExperimentNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

export const SUPPORTED_EXPERIMENT_METRICS = new Set([
  'ACOS',
  'CVR',
  '广告订单',
  'ORDERS',
  '花费',
  'SPEND',
  'COST',
  '广告销售额',
  'SALES',
]);

export function assertSupportedExperimentMetric(metric: string): void {
  const normalized = metric.trim().toLocaleUpperCase('en-US');
  if (normalized === 'TACOS') {
    throw invalid('当前没有产品总销售额权威，不能创建 TACOS 经营实验；请改用 ACOS、CVR、广告订单、广告销售额或花费。');
  }
  if (!SUPPORTED_EXPERIMENT_METRICS.has(normalized)) {
    throw invalid(`暂不支持经营实验指标“${metric.trim()}”；请改用 ACOS、CVR、广告订单、广告销售额或花费。`);
  }
}

export function validateExperimentMeasurementContract(
  primaryMetric: string,
  guardrailMetrics: readonly string[],
  guardrailCriteria: readonly string[],
): void {
  assertSupportedExperimentMetric(primaryMetric);
  guardrailMetrics.forEach(assertSupportedExperimentMetric);
  if (guardrailMetrics.length !== guardrailCriteria.length) {
    throw invalid('每个经营实验守护指标必须且只能对应一个判断标准；请补齐或删除多余标准后重试。');
  }
  guardrailCriteria.forEach((criterion, index) => {
    const parsed = criterion.trim().match(/^(.*?)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*%$/);
    const threshold = Number(parsed?.[3]);
    if (!parsed || parsed[1].trim().toLocaleUpperCase('en-US') !== guardrailMetrics[index].trim().toLocaleUpperCase('en-US')
      || !Number.isFinite(threshold) || threshold < 0) {
      throw invalid(`守护标准“${criterion}”无法安全解析；请使用例如“${guardrailMetrics[index]} >= 95%”的基线比例格式。`);
    }
  });
}

export function businessDayEnd(date: string, timeZone: string): string {
  const nextMidnight = Date.parse(timestampOf(`${date}T00:00:00.000Z`, 'report business date')) + 86_400_000;
  let candidate = nextMidnight;
  
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = localPolicyClock(new Date(candidate), timeZone);
    const represented = Date.parse(`${local.businessDate}T00:00:00.000Z`) + local.minuteOfDay * 60_000;
    if (represented === nextMidnight) return new Date(candidate).toISOString();
    candidate += nextMidnight - represented;
  }
  throw referenceConflict('无法确定报表业务日边界；请检查店铺时区。');
}

export function compareExperimentGuardrail(actual: number, comparator: string, threshold: number): boolean {
  if (comparator === '>=') return actual >= threshold;
  if (comparator === '>') return actual > threshold;
  if (comparator === '<=') return actual <= threshold;
  if (comparator === '<') return actual < threshold;
  throw invalid('Experiment guardrail comparator is unsupported.');
}

export function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw invalid('Value must be JSON serializable.');
  return serialized;
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((value) => rightSet.has(value));
}

export function jsonNullable(value: unknown): string | null {
  return value === undefined ? null : json(value);
}

export function parseJson<T = unknown>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new MissionDomainRepositoryError('REFERENCE_CONFLICT', 'Persisted Mission JSON is unreadable.');
  }
}

export function parseNullableJson(value: string | null): unknown {
  return value === null ? undefined : parseJson(value);
}

export function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function nullable(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

export function optionalSha256(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw invalid('sha256 must be 64 lowercase hexadecimal characters.');
  return normalized;
}

export function nextTimestamp(previous: string, now: Date): string {
  const previousMillis = Date.parse(previous);
  const currentMillis = now.getTime();
  
  return new Date(Number.isFinite(previousMillis) ? Math.max(currentMillis, previousMillis) : currentMillis)
    .toISOString();
}

export function invalid(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('INVALID_INPUT', message);
}

export function notFound(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('NOT_FOUND', message);
}

export function stateConflict(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('STATE_CONFLICT', message);
}

export function referenceConflict(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('REFERENCE_CONFLICT', message);
}

export function isConstraint(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT'),
  );
}
