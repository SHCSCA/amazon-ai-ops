import type { Database } from 'better-sqlite3';
import {
  RESERVED_LOGIN_CREDENTIAL_KEYS,
  SettingsRepository,
} from '@amazon-ai-ops/local-db/src/sqlite/repositories/settings-repo';
import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';
import { isPersistedAiApiKeyField } from './ai-key-persistence';

export interface ConfigurationChange {
  key: string;
  operation: 'set' | 'delete';
  revision: number;
  changedAt: string;
}

export type ConfigurationSubscriber = (change: Readonly<ConfigurationChange>) => void | Promise<void>;
export type ConfigurationSubscriberErrorHandler = (
  error: unknown,
  change: Omit<ConfigurationChange, 'revision' | 'changedAt'>,
) => void;

export class ConfigurationBus {
  private readonly repository: SettingsRepository;
  private readonly subscribers = new Set<ConfigurationSubscriber>();
  private readonly transactionFrames: Array<Array<Omit<ConfigurationChange, 'revision' | 'changedAt'>>> = [];
  private revision = 0;
  private readonly pendingChanges: Array<Omit<ConfigurationChange, 'revision' | 'changedAt'>> = [];
  private publishing = false;

  constructor(
    database: Database,
    private readonly logger: RuntimeLogPort = runtimeLogger,
    private readonly onSubscriberError?: ConfigurationSubscriberErrorHandler,
  ) {
    this.repository = new SettingsRepository(database);
  }

  get(key: string): string | null {
    return this.repository.get(key);
  }

  set(key: string, value: string): void {
    this.repository.set(key, value);
    this.recordChange({ key, operation: 'set' });
  }

  delete(key: string): void {
    this.repository.delete(key);
    this.recordChange({ key, operation: 'delete' });
  }

  getAll(): Record<string, string> {
    return this.repository.getAll();
  }

  save(settings: Record<string, string>): void {
    this.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        if (!this.isCredentialKey(key)) this.set(key, value);
      }
    });
  }

  getRuleConfig(): Record<string, unknown> | null {
    const raw = this.repository.get('rule_config');
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('规则配置必须是 JSON 对象。');
      }
      return value as Record<string, unknown>;
    } catch (error) {
      this.logger.error('configuration.parse_failed', { key: 'rule_config', error });
      return null;
    }
  }

  saveRuleConfig(config: unknown): void {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('规则配置必须是 JSON 对象。');
    }
    const serialized = JSON.stringify(config);
    if (serialized === undefined) {
      throw new TypeError('规则配置必须可以序列化为 JSON。');
    }
    this.set('rule_config', serialized);
  }

  transaction<Result>(work: () => Result): Result {
    const changes: Array<Omit<ConfigurationChange, 'revision' | 'changedAt'>> = [];
    const result = this.repository.transaction(() => {
      this.transactionFrames.push(changes);
      try {
        return work();
      } finally {
        this.transactionFrames.pop();
      }
    });

    const parent = this.transactionFrames[this.transactionFrames.length - 1];
    if (parent) parent.push(...changes);
    else this.publish(changes);
    return result;
  }

  subscribe(subscriber: ConfigurationSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private recordChange(change: Omit<ConfigurationChange, 'revision' | 'changedAt'>): void {
    if (this.isCredentialKey(change.key)) return;
    const frame = this.transactionFrames[this.transactionFrames.length - 1];
    if (frame) frame.push(change);
    else this.publish([change]);
  }

  private isCredentialKey(key: string): boolean {
    return RESERVED_LOGIN_CREDENTIAL_KEYS.has(key)
      || key.startsWith('store_login_credentials:v1:')
      || isPersistedAiApiKeyField(key);
  }

  private publish(
    changes: readonly Omit<ConfigurationChange, 'revision' | 'changedAt'>[],
  ): void {
    this.pendingChanges.push(...changes);
    if (this.publishing) return;
    this.publishing = true;
    try {
      let change: Omit<ConfigurationChange, 'revision' | 'changedAt'> | undefined;
      while ((change = this.pendingChanges.shift())) this.notify(change);
    } finally {
      this.publishing = false;
    }
  }

  private notify(change: Omit<ConfigurationChange, 'revision' | 'changedAt'>): void {
    const notification = Object.freeze({
      ...change, revision: ++this.revision, changedAt: new Date().toISOString(),
    });
    for (const subscriber of [...this.subscribers]) {
      try {
        const result = subscriber(notification);
        if (result) void Promise.resolve(result).catch((error) => this.reportSubscriberError(error, change));
      } catch (error) {
        this.reportSubscriberError(error, change);
      }
    }
  }

  private reportSubscriberError(
    error: unknown,
    change: Omit<ConfigurationChange, 'revision' | 'changedAt'>,
  ): void {
    try {
      if (this.onSubscriberError) this.onSubscriberError(error, change);
      else this.logger.error('configuration.subscriber_failed', { key: change.key, error });
    } catch (reportingError) {
      this.logger.error('configuration.subscriber_error_reporting_failed', {
        key: change.key, error: reportingError,
      });
    }
  }
}
