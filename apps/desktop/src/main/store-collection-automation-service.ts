import { isDeepStrictEqual } from 'node:util';
import {
  DEFAULT_US_BUSINESS_TIMEZONE, normalizeStoreId,
  readStoreCollectionAutomation, storeCollectionAutomationSettingKey,
  StoreCollectionAutomationError,
  type SetStoreCollectionAutomationInput, type StoreCollectionAutomationProjection,
  type StoreContextEnvelope, type StoreId, type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';
import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';

export interface StoreCollectionAutomationSettingsPort {
  get(key: string): string | null | undefined;
  set(key: string, value: string): unknown;
  transaction<T>(work: () => T): T;
}
export interface StoreCollectionAutomationServiceOptions {
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getStore'>;
  settings: StoreCollectionAutomationSettingsPort;
  now?: () => string;
  logger?: Pick<RuntimeLogPort, 'error'>;
}

export class StoreCollectionAutomationService {
  private readonly now: () => string;
  private readonly logger: Pick<RuntimeLogPort, 'error'>;

  constructor(private readonly options: StoreCollectionAutomationServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.logger = options.logger ?? runtimeLogger;
  }

  get(contextInput: StoreContextEnvelope): StoreCollectionAutomationProjection {
    return this.guard('get', () => this.read(this.authorize(contextInput)));
  }

  getForStoreRecord(storeInput: StoreRecord): StoreCollectionAutomationProjection {
    return this.guard('getForStoreRecord', () => this.read(this.authorizeStoreRecord(storeInput)));
  }

  set(contextInput: StoreContextEnvelope, input: SetStoreCollectionAutomationInput): StoreCollectionAutomationProjection {
    return this.guard('set', () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).length !== 2
        || !Object.prototype.hasOwnProperty.call(input, 'expectedRevision')
        || !Object.prototype.hasOwnProperty.call(input, 'automaticCollectionEnabled')
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || typeof input.automaticCollectionEnabled !== 'boolean') {
        throw new StoreCollectionAutomationError('INVALID_INPUT', '自动采集设置必须包含精确版本和布尔开关。');
      }
      return this.options.settings.transaction(() => {
        const store = this.authorize(contextInput), current = this.read(store);
        if (current.revision !== input.expectedRevision) {
          throw new StoreCollectionAutomationError('REVISION_CONFLICT', '自动采集设置版本已变化，请刷新后重试。');
        }
        const serialized = JSON.stringify({ schemaVersion: 1, storeId: store.storeId,
          browserProfileId: store.browserProfileId, revision: current.revision + 1,
          automaticCollectionEnabled: input.automaticCollectionEnabled, updatedAt: this.now() });
        const expected = readStoreCollectionAutomation(serialized, store);
        this.options.settings.set(storeCollectionAutomationSettingKey(store.storeId), serialized);
        const readback = this.read(store);
        if (!isDeepStrictEqual(readback, expected)) {
          throw new StoreCollectionAutomationError('CORRUPT_STORAGE', '自动采集设置持久化回读不一致。');
        }
        return readback;
      });
    });
  }

  private read(store: StoreRecord): StoreCollectionAutomationProjection {
    return readStoreCollectionAutomation(
      this.options.settings.get(storeCollectionAutomationSettingKey(store.storeId)), store,
    );
  }

  private authorize(context: StoreContextEnvelope): StoreRecord {
    const current = this.options.storeCoordinator.assertActiveStoreContext(context);
    const store = this.options.storeCoordinator.getStore(current.storeId);
    if (current.browserProfileId !== store.browserProfileId
      || current.marketplace !== 'US' || current.currency !== 'USD'
      || current.businessTimezone !== DEFAULT_US_BUSINESS_TIMEZONE) {
      throw new StoreCollectionAutomationError('STORE_IDENTITY_MISMATCH', '自动采集设置需要当前精确 Store/Profile/US/USD/LA 上下文。');
    }
    return this.authorizeStoreRecord(store);
  }

  private authorizeStoreRecord(input: StoreRecord): StoreRecord {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new StoreCollectionAutomationError('STORE_IDENTITY_MISMATCH', '自动采集读取需要真实店铺记录。');
    }
    const storeId: StoreId = normalizeStoreId(input.storeId);
    const store = this.options.storeCoordinator.getStore(storeId);
    if (input.storeId !== store.storeId || input.browserProfileId !== store.browserProfileId
      || input.marketplace !== 'US' || input.currency !== 'USD'
      || input.businessTimezone !== DEFAULT_US_BUSINESS_TIMEZONE
      || store.marketplace !== 'US' || store.currency !== 'USD'
      || store.businessTimezone !== DEFAULT_US_BUSINESS_TIMEZONE) {
      throw new StoreCollectionAutomationError('STORE_IDENTITY_MISMATCH', '自动采集覆盖记录的店铺权限已变化。');
    }
    return store;
  }

  private guard<T>(operation: string, work: () => T): T {
    try { return work(); }
    catch (error) {
      try { this.logger.error('store.collection_automation_failed', { operation, error }); }
      catch (loggingError) { throw new AggregateError([error, loggingError], '自动采集错误日志写入失败。'); }
      throw error;
    }
  }
}
