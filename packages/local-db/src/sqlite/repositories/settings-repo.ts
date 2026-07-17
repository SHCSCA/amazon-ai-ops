import type { Database } from 'better-sqlite3';

const RESERVED_LOGIN_CREDENTIAL_KEYS = new Set([
  'login_username',
  'login_remember_password',
  'login_password_encrypted',
  'login_password',
]);

export class SettingsRepository {
  constructor(private db: Database) {}

  get(key: string): string | null {
    const row = this.db.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value);
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }

  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  getAll(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  getAiModel(): string {
    return this.get('ai_model') ?? 'gpt-4o-mini';
  }

  setAiModel(model: string): void {
    this.set('ai_model', model);
  }

  getScheduleTime(): string {
    return this.get('schedule_time') ?? '08:00';
  }

  setScheduleTime(time: string): void {
    this.set('schedule_time', time);
  }

  save(settings: Record<string, string>): void {
    for (const [key, value] of Object.entries(settings)) {
      if (RESERVED_LOGIN_CREDENTIAL_KEYS.has(key)) continue;
      this.set(key, value);
    }
  }

  saveRuleConfig(config: any): void {
    this.set('rule_config', JSON.stringify(config));
  }

  getRuleConfig(): Record<string, unknown> | null {
    const raw = this.get('rule_config');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
}
