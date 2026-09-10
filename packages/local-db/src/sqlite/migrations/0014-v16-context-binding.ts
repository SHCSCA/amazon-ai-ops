/**
 * Migration 0014: V1.6 Context Binding Fields
 *
 * Phase 5: Add session_generation and context_snapshot to v16_missions and mission_grants_v16
 * to support StoreContext strict isolation and prevent A→B→A race conditions.
 *
 * @module 0014-v16-context-binding
 */

import type Database from 'better-sqlite3';

export const CONTEXT_BINDING_MIGRATION_VERSION = 14;
export const CONTEXT_BINDING_MIGRATION_NAME = 'v16-context-binding';
export const CONTEXT_BINDING_MIGRATION_CHECKSUM = 'context-binding-v1';

export class ContextBindingMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextBindingMigrationError';
  }
}

export interface ContextBindingMigrationResult {
  version: number;
  status: 'success' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string;
  addedColumns: number;
  errorMessage?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Check if migration 13 (V16 domain) has been applied
 */
function assertPrerequisites(database: Database.Database): void {
  const migration13 = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 13
  `).get() as { status: string } | undefined;

  if (!migration13) {
    throw new ContextBindingMigrationError('Migration 13 (V16 domain) must be applied first');
  }

  if (migration13.status !== 'applied') {
    throw new ContextBindingMigrationError(
      `Migration 13 status is "${migration13.status}", expected "applied"`
    );
  }
}

/**
 * Apply migration 14: Add context binding fields
 */
export function applyContextBindingMigration(database: Database.Database): ContextBindingMigrationResult {
  const started: ContextBindingMigrationResult = {
    version: CONTEXT_BINDING_MIGRATION_VERSION,
    status: 'success',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    addedColumns: 0,
  };

  assertPrerequisites(database);
  const existing = database.prepare(`
    SELECT status, checksum FROM schema_migrations WHERE version = ?
  `).get(CONTEXT_BINDING_MIGRATION_VERSION) as { status: string; checksum: string } | undefined;
  if (existing && existing.checksum !== CONTEXT_BINDING_MIGRATION_CHECKSUM) {
    throw new ContextBindingMigrationError('Migration 14 checksum mismatch');
  }
  if (existing?.status === 'applied') verifyContextBindingSchema(database);
  try {
    if (existing?.status === 'applied') {
      return {
        ...started,
        status: 'skipped',
        finishedAt: new Date().toISOString(),
        errorMessage: 'Migration 14 already applied',
      };
    }

    // Register migration start
    database.prepare(`
      INSERT OR REPLACE INTO schema_migrations (
        version, name, checksum, status, started_at
      ) VALUES (?, ?, ?, 'started', ?)
    `).run(
      CONTEXT_BINDING_MIGRATION_VERSION,
      CONTEXT_BINDING_MIGRATION_NAME,
      CONTEXT_BINDING_MIGRATION_CHECKSUM,
      started.startedAt
    );

    return database.transaction(() => {
      let columnsAdded = 0;

      // Add context binding fields to v16_missions
      try {
        database.exec(`
          ALTER TABLE v16_missions ADD COLUMN session_generation INTEGER;
        `);
        columnsAdded++;
      } catch (error) {
        // Column might already exist, ignore
        if (!String(error).includes('duplicate column')) throw error;
      }

      try {
        database.exec(`
          ALTER TABLE v16_missions ADD COLUMN context_snapshot TEXT;
        `);
        columnsAdded++;
      } catch (error) {
        if (!String(error).includes('duplicate column')) throw error;
      }

      // Add context_snapshot to mission_grants_v16 (session_generation already exists)
      try {
        database.exec(`
          ALTER TABLE mission_grants_v16 ADD COLUMN context_snapshot TEXT;
        `);
        columnsAdded++;
      } catch (error) {
        if (!String(error).includes('duplicate column')) throw error;
      }

      const result: ContextBindingMigrationResult = {
        ...started,
        status: 'success',
        finishedAt: new Date().toISOString(),
        addedColumns: columnsAdded,
      };

      // Mark migration as successful
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: CONTEXT_BINDING_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });

      return result;
    }).immediate();
  } catch (error) {
    const failed: ContextBindingMigrationResult = {
      ...started,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      addedColumns: 0,
      errorMessage: errorMessage(error),
    };

    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: CONTEXT_BINDING_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });

    if (error instanceof ContextBindingMigrationError) throw error;
    throw new ContextBindingMigrationError(failed.errorMessage ?? 'Migration 14 failed');
  }
}

/**
 * Verify that context binding fields exist
 */
export function verifyContextBindingSchema(database: Database.Database): void {
  assertPrerequisites(database);

  // Check v16_missions columns
  const missionsInfo = database.pragma('table_info(v16_missions)') as Array<{ name: string }>;
  const missionsColumns = new Set(
    missionsInfo.map((col: { name: string }) => col.name)
  );

  if (!missionsColumns.has('session_generation')) {
    throw new ContextBindingMigrationError(
      'v16_missions.session_generation column missing'
    );
  }

  if (!missionsColumns.has('context_snapshot')) {
    throw new ContextBindingMigrationError(
      'v16_missions.context_snapshot column missing'
    );
  }

  // Check mission_grants_v16 columns
  const grantsInfo = database.pragma('table_info(mission_grants_v16)') as Array<{ name: string }>;
  const grantsColumns = new Set(
    grantsInfo.map((col: { name: string }) => col.name)
  );

  if (!grantsColumns.has('session_generation')) {
    throw new ContextBindingMigrationError(
      'mission_grants_v16.session_generation column missing'
    );
  }

  if (!grantsColumns.has('context_snapshot')) {
    throw new ContextBindingMigrationError(
      'mission_grants_v16.context_snapshot column missing'
    );
  }
}
