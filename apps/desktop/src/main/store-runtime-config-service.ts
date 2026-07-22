import type {
  ArchiveStoreRuntimeConfigInput,
  CreateStoreRuntimeConfigInput,
  RestoreStoreRuntimeConfigInput,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
  StoreRuntimeConfigProjection,
  StoreRuntimeConfigRecord,
  StoreRuntimeConfigValues,
  StoreRuntimeConfigVersion,
  StoreRuntimeConfigVersionAction,
  UpdateStoreRuntimeConfigInput,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';

export type StoreRuntimeConfigErrorCode =
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'ARCHIVED'
  | 'REVISION_CONFLICT'
  | 'INVALID_INPUT'
  | 'CORRUPT_STORAGE'
  | 'STORE_IDENTITY_MISMATCH';

export class StoreRuntimeConfigError extends Error {
  constructor(
    readonly code: StoreRuntimeConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreRuntimeConfigError';
  }
}
export interface StoreRuntimeConfigSettingsPort {
  get(key: string): string | null | undefined;
  set(key: string, value: string): unknown;
  transaction<T>(work: () => T): T;
}

export interface StoreRuntimeConfigServiceOptions {
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getStore'>;
  settings: StoreRuntimeConfigSettingsPort;
  now?: () => string;
}

interface StoredStoreRuntimeConfigEnvelope {
  schemaVersion: 1;
  current: StoreRuntimeConfigRecord;
  versions: StoreRuntimeConfigVersion[];
}

const CONFIG_VALUE_KEYS = [
  'aiRecommendationsEnabled',
  'collectionScheduleLocalTime',
  'collectionLookbackDays',
  'analysisWindowDays',
  'defaultTargetAcosPercent',
  'minimumRecommendationConfidencePercent',
  'evidenceRetentionDays',
] as const satisfies readonly (keyof StoreRuntimeConfigValues)[];

const CONFIG_VALUE_KEY_SET = new Set<string>(CONFIG_VALUE_KEYS);
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function storeRuntimeConfigSettingKey(storeId: StoreId): string {
  return `store_runtime_config:v1:${storeId}`;
}

export class StoreRuntimeConfigService {
  private readonly now: () => string;

  constructor(private readonly options: StoreRuntimeConfigServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get(contextInput: StoreContextEnvelope): StoreRuntimeConfigProjection {
    const store = this.authorize(contextInput);
    const envelope = this.readEnvelope(store);
    if (!envelope) return { current: null, versions: [] };
    return this.project(envelope, store);
  }

  create(
    contextInput: StoreContextEnvelope,
    input: CreateStoreRuntimeConfigInput,
  ): StoreRuntimeConfigProjection {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'store config create input');
    rejectUnknownKeys(value, new Set(['values']), 'store config create input');
    const values = normalizeValues(value.values, false) as StoreRuntimeConfigValues;

    return this.options.settings.transaction(() => {
      if (this.readEnvelope(store)) {
        throw new StoreRuntimeConfigError(
          'ALREADY_EXISTS',
          '当前店铺已存在配置；已归档配置必须显式恢复，不能覆盖创建。',
        );
      }
      const occurredAt = this.now();
      const current = buildRecord(store, values, 1, 'active', occurredAt, occurredAt);
      const envelope = appendVersion({ schemaVersion: 1, current, versions: [] }, 'create', occurredAt);
      this.writeEnvelope(store, envelope);
      return this.project(envelope, store);
    });
  }

  update(
    contextInput: StoreContextEnvelope,
    input: UpdateStoreRuntimeConfigInput,
  ): StoreRuntimeConfigProjection {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'store config update input');
    rejectUnknownKeys(value, new Set(['expectedRevision', 'patch']), 'store config update input');
    const expectedRevision = positiveInteger(value.expectedRevision, 'expectedRevision');
    const patch = normalizeValues(value.patch, true);
    if (Object.keys(patch).length === 0) {
      throw new StoreRuntimeConfigError('INVALID_INPUT', '店铺配置变更不能为空。');
    }

    return this.options.settings.transaction(() => {
      const envelope = this.requireEnvelope(store);
      this.assertRevision(envelope.current, expectedRevision);
      if (envelope.current.status === 'archived') {
        throw new StoreRuntimeConfigError('ARCHIVED', '店铺配置已归档，必须先恢复。');
      }
      const occurredAt = this.now();
      const current: StoreRuntimeConfigRecord = {
        ...envelope.current,
        businessTimezone: store.businessTimezone,
        revision: envelope.current.revision + 1,
        values: { ...envelope.current.values, ...patch },
        updatedAt: occurredAt,
      };
      const updated = appendVersion({ ...envelope, current }, 'update', occurredAt);
      this.writeEnvelope(store, updated);
      return this.project(updated, store);
    });
  }

  archive(
    contextInput: StoreContextEnvelope,
    input: ArchiveStoreRuntimeConfigInput,
  ): StoreRuntimeConfigProjection {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'store config archive input');
    rejectUnknownKeys(value, new Set(['expectedRevision', 'reason']), 'store config archive input');
    const expectedRevision = positiveInteger(value.expectedRevision, 'expectedRevision');
    const reason = optionalText(value.reason, 'reason', 300);

    return this.options.settings.transaction(() => {
      const envelope = this.requireEnvelope(store);
      this.assertRevision(envelope.current, expectedRevision);
      if (envelope.current.status === 'archived') return this.project(envelope, store);
      const occurredAt = this.now();
      const current: StoreRuntimeConfigRecord = {
        ...envelope.current,
        businessTimezone: store.businessTimezone,
        status: 'archived',
        revision: envelope.current.revision + 1,
        updatedAt: occurredAt,
        archivedAt: occurredAt,
      };
      const updated = appendVersion({ ...envelope, current }, 'archive', occurredAt, reason);
      this.writeEnvelope(store, updated);
      return this.project(updated, store);
    });
  }

  restore(
    contextInput: StoreContextEnvelope,
    input: RestoreStoreRuntimeConfigInput,
  ): StoreRuntimeConfigProjection {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'store config restore input');
    rejectUnknownKeys(value, new Set(['expectedRevision']), 'store config restore input');
    const expectedRevision = positiveInteger(value.expectedRevision, 'expectedRevision');

    return this.options.settings.transaction(() => {
      const envelope = this.requireEnvelope(store);
      this.assertRevision(envelope.current, expectedRevision);
      if (envelope.current.status === 'active') return this.project(envelope, store);
      const occurredAt = this.now();
      const { archivedAt: _archivedAt, ...rest } = envelope.current;
      const current: StoreRuntimeConfigRecord = {
        ...rest,
        businessTimezone: store.businessTimezone,
        status: 'active',
        revision: envelope.current.revision + 1,
        updatedAt: occurredAt,
      };
      const updated = appendVersion({ ...envelope, current }, 'restore', occurredAt);
      this.writeEnvelope(store, updated);
      return this.project(updated, store);
    });
  }

  private authorize(contextInput: StoreContextEnvelope): StoreRecord {
    const context = this.options.storeCoordinator.assertActiveStoreContext(contextInput);
    const store = this.options.storeCoordinator.getStore(context.storeId);
    if (context.marketplace !== 'US' || store.marketplace !== 'US') {
      throw new StoreRuntimeConfigError('STORE_IDENTITY_MISMATCH', '第一版只支持 Amazon 美国站。');
    }
    if (context.currency !== 'USD' || store.currency !== 'USD') {
      throw new StoreRuntimeConfigError('STORE_IDENTITY_MISMATCH', '第一版只支持 USD。');
    }
    return store;
  }

  private requireEnvelope(store: StoreRecord): StoredStoreRuntimeConfigEnvelope {
    const envelope = this.readEnvelope(store);
    if (!envelope) throw new StoreRuntimeConfigError('NOT_FOUND', '当前店铺还没有运行配置。');
    return envelope;
  }

  private readEnvelope(store: StoreRecord): StoredStoreRuntimeConfigEnvelope | null {
    const raw = this.options.settings.get(storeRuntimeConfigSettingKey(store.storeId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredStoreRuntimeConfigEnvelope;
      assertStoredEnvelope(parsed, store);
      return parsed;
    } catch (error) {
      if (error instanceof StoreRuntimeConfigError) throw error;
      throw new StoreRuntimeConfigError('CORRUPT_STORAGE', '店铺运行配置损坏，已失败关闭。');
    }
  }

  private writeEnvelope(store: StoreRecord, envelope: StoredStoreRuntimeConfigEnvelope): void {
    this.options.settings.set(
      storeRuntimeConfigSettingKey(store.storeId),
      JSON.stringify(envelope),
    );
  }

  private assertRevision(record: StoreRuntimeConfigRecord, expectedRevision: number): void {
    if (record.revision !== expectedRevision) {
      throw new StoreRuntimeConfigError(
        'REVISION_CONFLICT',
        `店铺配置版本已变化：期望 ${expectedRevision}，当前 ${record.revision}。`,
      );
    }
  }

  private project(
    envelope: StoredStoreRuntimeConfigEnvelope,
    store: StoreRecord,
  ): StoreRuntimeConfigProjection {
    return structuredCloneSafe({
      current: { ...envelope.current, businessTimezone: store.businessTimezone },
      versions: envelope.versions,
    });
  }
}

function buildRecord(
  store: StoreRecord,
  values: StoreRuntimeConfigValues,
  revision: number,
  status: 'active' | 'archived',
  createdAt: string,
  updatedAt: string,
): StoreRuntimeConfigRecord {
  return {
    configId: `store-config-${store.storeId}`,
    storeId: store.storeId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: store.businessTimezone,
    status,
    revision,
    values,
    createdAt,
    updatedAt,
  };
}

function appendVersion(
  envelope: StoredStoreRuntimeConfigEnvelope,
  action: StoreRuntimeConfigVersionAction,
  occurredAt: string,
  reason?: string,
): StoredStoreRuntimeConfigEnvelope {
  return {
    ...envelope,
    versions: [
      ...envelope.versions,
      {
        revision: envelope.current.revision,
        action,
        occurredAt,
        ...(reason ? { reason } : {}),
        snapshot: structuredCloneSafe(envelope.current),
      },
    ],
  };
}

function assertStoredEnvelope(value: unknown, store: StoreRecord): asserts value is StoredStoreRuntimeConfigEnvelope {
  const envelope = requireObject(value, 'stored store config');
  if (envelope.schemaVersion !== 1) {
    throw new StoreRuntimeConfigError('CORRUPT_STORAGE', '店铺运行配置 Schema 版本不受支持。');
  }
  const current = requireObject(envelope.current, 'stored current config') as unknown as StoreRuntimeConfigRecord;
  if (current.storeId !== store.storeId || current.marketplace !== 'US' || current.currency !== 'USD') {
    throw new StoreRuntimeConfigError('CORRUPT_STORAGE', '店铺运行配置身份与当前数据域不一致。');
  }
  if (current.status !== 'active' && current.status !== 'archived') {
    throw new StoreRuntimeConfigError('CORRUPT_STORAGE', '店铺运行配置状态无效。');
  }
  positiveInteger(current.revision, 'stored revision');
  normalizeValues(current.values, false);
  if (!Array.isArray(envelope.versions)) {
    throw new StoreRuntimeConfigError('CORRUPT_STORAGE', '店铺运行配置版本历史无效。');
  }
}

function normalizeValues(value: unknown, partial: boolean): Partial<StoreRuntimeConfigValues> {
  const input = requireObject(value, partial ? 'store config patch' : 'store config values');
  rejectUnknownKeys(input, CONFIG_VALUE_KEY_SET, partial ? 'store config patch' : 'store config values');
  if (!partial) {
    for (const key of CONFIG_VALUE_KEYS) {
      if (!(key in input)) {
        throw new StoreRuntimeConfigError('INVALID_INPUT', `店铺配置缺少字段 ${key}。`);
      }
    }
  }
  const output: Partial<StoreRuntimeConfigValues> = {};
  if ('aiRecommendationsEnabled' in input) {
    if (typeof input.aiRecommendationsEnabled !== 'boolean') invalid('AI 建议开关必须是布尔值。');
    output.aiRecommendationsEnabled = input.aiRecommendationsEnabled as boolean;
  }
  if ('collectionScheduleLocalTime' in input) {
    if (typeof input.collectionScheduleLocalTime !== 'string' || !CLOCK_TIME_PATTERN.test(input.collectionScheduleLocalTime)) {
      invalid('采集时间必须使用 HH:mm。');
    }
    output.collectionScheduleLocalTime = input.collectionScheduleLocalTime as string;
  }
  if ('collectionLookbackDays' in input) {
    output.collectionLookbackDays = boundedInteger(input.collectionLookbackDays, '采集回看天数', 1, 90);
  }
  if ('analysisWindowDays' in input) {
    output.analysisWindowDays = boundedInteger(input.analysisWindowDays, '分析窗口天数', 7, 90);
  }
  if ('defaultTargetAcosPercent' in input) {
    output.defaultTargetAcosPercent = boundedNumber(input.defaultTargetAcosPercent, '默认目标 ACOS', 1, 100);
  }
  if ('minimumRecommendationConfidencePercent' in input) {
    output.minimumRecommendationConfidencePercent = boundedNumber(
      input.minimumRecommendationConfidencePercent,
      '最低建议置信度',
      50,
      99,
    );
  }
  if ('evidenceRetentionDays' in input) {
    output.evidenceRetentionDays = boundedInteger(input.evidenceRetentionDays, '证据保留天数', 30, 3650);
  }
  return output;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoreRuntimeConfigError('INVALID_INPUT', `${label} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) invalid(`${label} 包含不支持字段：${unknown.join('、')}。`);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) invalid(`${label} 必须是正整数。`);
  return Number(value);
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalid(`${label}必须是 ${minimum}–${maximum} 的整数。`);
  }
  return Number(value);
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${label}必须在 ${minimum}–${maximum} 之间。`);
  }
  return Math.round(value * 100) / 100;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') invalid(`${label} 必须是字符串。`);
  const normalized = (value as string).trim();
  if (normalized.length > maximum) invalid(`${label} 不能超过 ${maximum} 个字符。`);
  return normalized || undefined;
}

function invalid(message: string): never {
  throw new StoreRuntimeConfigError('INVALID_INPUT', message);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
