import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import { initSqlite } from '@amazon-ai-ops/local-db';
import { buildStoreEvidenceRetentionManifest } from './store-evidence-retention';
import {
  projectStoreEvidenceReferencePaths,
  STORE_EVIDENCE_RETENTION_REFERENCE_COLUMNS,
} from './store-evidence-reference-projection';

const NOW = '2026-07-23T12:00:00.000Z';
const STORE_A = 'store-reference-a';
const STORE_B = 'store-reference-b';
const roots: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) {
    const database = databases.pop();
    if (database?.open) database.close();
  }
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

interface Harness {
  readonly database: Database.Database;
  readonly capsuleA: StoreCapsulePaths;
  readonly capsuleB: StoreCapsulePaths;
}

function createHarness(): Harness {
  const trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'store-reference-projection-'));
  roots.push(trustedRoot);
  const database = initSqlite(':memory:');
  databases.push(database);
  insertStore(database, STORE_A, 'profile-reference-a');
  insertStore(database, STORE_B, 'profile-reference-b');
  return {
    database,
    capsuleA: ensureStoreCapsulePaths(deriveStoreCapsulePaths(
      trustedRoot,
      STORE_A,
      'profile-reference-a',
    )),
    capsuleB: ensureStoreCapsulePaths(deriveStoreCapsulePaths(
      trustedRoot,
      STORE_B,
      'profile-reference-b',
    )),
  };
}

function insertStore(database: Database.Database, storeId: string, profileId: string): void {
  database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
  `).run(storeId, profileId, storeId, NOW, NOW);
}

function writeOldFile(filePath: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, path.basename(filePath));
  const modifiedAt = new Date(new Date(NOW).getTime() - (90 * 24 * 60 * 60 * 1_000));
  fs.utimesSync(filePath, modifiedAt, modifiedAt);
  return filePath;
}

function stablePaths(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

describe('store evidence DB reference projection', () => {
  it('projects every current-schema candidate-root reference and protects all old files', () => {
    expect(STORE_EVIDENCE_RETENTION_REFERENCE_COLUMNS).toEqual([
      'action_logs.screenshot_before',
      'action_logs.screenshot_after',
      'action_logs.trace_path',
      'lingxing_report_files.failure_screenshot_path',
      'lingxing_report_files.failure_trace_path',
      'download_center_diagnostics.screenshot_path',
      'operation_events.evidence_path',
      'listing_content.screenshot_path',
      'listing_content_versions.screenshot_path',
    ]);

    const { database, capsuleA } = createHarness();
    const references = {
      actionBefore: writeOldFile(path.join(capsuleA.screenshotsDir, '01-action-before.png')),
      actionAfter: writeOldFile(path.join(capsuleA.screenshotsDir, '02-action-after.png')),
      actionTrace: writeOldFile(path.join(capsuleA.tracesDir, '03-action-trace.zip')),
      reportFailure: writeOldFile(path.join(capsuleA.screenshotsDir, '04-report-failure.png')),
      reportTrace: writeOldFile(path.join(capsuleA.tracesDir, '05-report-trace.zip')),
      diagnostic: writeOldFile(path.join(capsuleA.screenshotsDir, '06-diagnostic.png')),
      operationEvent: writeOldFile(path.join(capsuleA.screenshotsDir, '07-operation-event.png')),
      listing: writeOldFile(path.join(capsuleA.screenshotsDir, '08-listing.png')),
      listingVersion: writeOldFile(path.join(capsuleA.screenshotsDir, '09-listing-version.png')),
    };

    const recommendationId = Number(database.prepare(`
      INSERT INTO action_recommendations (store_id, action_type, status)
      VALUES (?, 'bid_adjustment', 'pending')
    `).run(STORE_A).lastInsertRowid);
    database.prepare(`
      INSERT INTO action_logs (
        store_id, recommendation_id, screenshot_before, screenshot_after, trace_path
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      STORE_A,
      recommendationId,
      references.actionBefore,
      references.actionAfter,
      references.actionTrace,
    );

    database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, date_start, date_end, status, download_dir, store_id
      ) VALUES ('batch-reference-a', '2026-07-01', '2026-07-22', 'failed', ?, ?)
    `).run(capsuleA.downloadsDir, STORE_A);
    database.prepare(`
      INSERT INTO lingxing_report_files (
        id, batch_id, report_type, display_name, status, store_id,
        failure_screenshot_path, failure_trace_path
      ) VALUES ('file-reference-a', 'batch-reference-a', 'orders', 'Orders',
        'failed', ?, ?, ?)
    `).run(STORE_A, references.reportFailure, references.reportTrace);

    database.prepare(`
      INSERT INTO download_center_diagnostics (page_model, store_id, screenshot_path)
      VALUES ('download-center', ?, ?)
    `).run(STORE_A, references.diagnostic);
    database.prepare(`
      INSERT INTO operation_events (
        event_date, store_name, marketplace_code, event_type, title,
        store_id, evidence_path
      ) VALUES ('2026-07-22', 'A', 'US', 'listing_change', 'Reference',
        ?, ?)
    `).run(STORE_A, references.operationEvent);
    const listingId = Number(database.prepare(`
      INSERT INTO listing_content (store_id, asin, title, screenshot_path)
      VALUES (?, 'B000REFERENCEA', 'Current listing', ?)
    `).run(STORE_A, references.listing).lastInsertRowid);
    database.prepare(`
      INSERT INTO listing_content_versions (
        store_id, listing_content_id, asin, title, screenshot_path
      ) VALUES (?, ?, 'B000REFERENCEA', 'Listing version', ?)
    `).run(STORE_A, listingId, references.listingVersion);

    // Duplicate and blank values must not make the projection unstable/noisy.
    database.prepare(`
      INSERT INTO download_center_diagnostics (page_model, store_id, screenshot_path)
      VALUES ('duplicate', ?, ?), ('blank', ?, '   ')
    `).run(STORE_A, references.diagnostic, STORE_A);

    const projected = projectStoreEvidenceReferencePaths(
      database,
      STORE_A.toUpperCase(),
      capsuleA,
    );
    expect(projected).toEqual({
      databaseReferencedPaths: stablePaths(Object.values(references)),
      artifactReferences: [],
      blockers: [],
    });

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule: capsuleA,
      evidenceRetentionDays: 30,
      now: NOW,
      databaseReferencedPaths: projected.databaseReferencedPaths,
      referenceBlockers: projected.blockers,
    });
    expect(manifest).toMatchObject({
      applyable: false,
      scanSafe: true,
      candidateCount: 0,
    });
    expect(manifest.protectedFiles).toHaveLength(9);
    expect(manifest.protectedFiles.every((file) => (
      file.reasons.includes('database-reference')
    ))).toBe(true);
  });

  it('protects cross-store and all three parent-mismatch references while blocking the scan', () => {
    const { database, capsuleA } = createHarness();
    const otherStoreReference = writeOldFile(
      path.join(capsuleA.screenshotsDir, 'other-store-reference.png'),
    );
    const mismatchedAction = writeOldFile(
      path.join(capsuleA.screenshotsDir, 'mismatched-action-parent.png'),
    );
    const mismatchedVersion = writeOldFile(
      path.join(capsuleA.screenshotsDir, 'mismatched-listing-parent.png'),
    );
    const mismatchedReport = writeOldFile(
      path.join(capsuleA.screenshotsDir, 'mismatched-report-parent.png'),
    );

    database.prepare(`
      INSERT INTO download_center_diagnostics (page_model, store_id, screenshot_path)
      VALUES ('other-store', ?, ?)
    `).run(STORE_B, otherStoreReference);

    const storeBRecommendationId = Number(database.prepare(`
      INSERT INTO action_recommendations (store_id, action_type, status)
      VALUES (?, 'bid_adjustment', 'pending')
    `).run(STORE_B).lastInsertRowid);
    database.prepare(`
      INSERT INTO action_logs (store_id, recommendation_id, screenshot_before)
      VALUES (?, ?, ?)
    `).run(STORE_A, storeBRecommendationId, mismatchedAction);

    // Simulate persisted corruption that bypassed the current insert trigger:
    // insert the child before its foreign-store parent while FK checks are off.
    database.pragma('foreign_keys = OFF');
    database.prepare(`
      INSERT INTO lingxing_report_files (
        id, batch_id, report_type, display_name, status, store_id,
        failure_screenshot_path
      ) VALUES ('file-mismatched-parent', 'batch-reference-b', 'orders',
        'Mismatched orders', 'failed', ?, ?)
    `).run(STORE_A, mismatchedReport);
    database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, date_start, date_end, status, download_dir, store_id
      ) VALUES ('batch-reference-b', '2026-07-01', '2026-07-22', 'failed', ?, ?)
    `).run(capsuleA.downloadsDir, STORE_B);
    database.pragma('foreign_keys = ON');

    const storeBListingId = Number(database.prepare(`
      INSERT INTO listing_content (store_id, asin, title)
      VALUES (?, 'B000REFERENCEB', 'Other store listing')
    `).run(STORE_B).lastInsertRowid);
    database.prepare(`
      INSERT INTO listing_content_versions (
        store_id, listing_content_id, asin, title, screenshot_path
      ) VALUES (?, ?, 'B000MISMATCHA', 'Mismatched version', ?)
    `).run(STORE_A, storeBListingId, mismatchedVersion);

    const projected = projectStoreEvidenceReferencePaths(database, STORE_A, capsuleA);
    expect(projected.databaseReferencedPaths).toEqual(stablePaths([
      otherStoreReference,
      mismatchedAction,
      mismatchedReport,
      mismatchedVersion,
    ]));
    expect(projected.artifactReferences).toEqual([]);
    expect(projected.blockers.filter((blocker) => (
      blocker.code === 'DATABASE_REFERENCE_OWNERSHIP_MISMATCH'
    ))).toHaveLength(3);
    expect(projected.blockers).toContainEqual(expect.objectContaining({
      code: 'CROSS_STORE_REFERENCE',
      relativePath: 'screenshots/other-store-reference.png',
    }));
    expect(JSON.stringify(projected.blockers)).not.toContain(capsuleA.storeRoot);
    expect(JSON.stringify(projected.blockers)).not.toContain(otherStoreReference);

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule: capsuleA,
      evidenceRetentionDays: 30,
      now: NOW,
      databaseReferencedPaths: projected.databaseReferencedPaths,
      referenceBlockers: projected.blockers,
    });
    expect(manifest.applyable).toBe(false);
    expect(manifest.scanSafe).toBe(false);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.protectedFiles).toHaveLength(4);
    expect(JSON.stringify(manifest.blockers)).not.toContain(capsuleA.storeRoot);
    expect(JSON.stringify(manifest.blockers)).not.toContain(otherStoreReference);
  });

  it('separates artifact IDs from legacy paths and preserves malformed raw references', () => {
    const { database, capsuleA } = createHarness();
    const missingAbsolute = path.join(capsuleA.screenshotsDir, 'missing-reference.png');
    const relative = 'screenshots/relative-reference.png';
    const artifactId = 'artifact:v1:00000000-0000-4000-8000-000000000001';
    const foreignArtifactId = 'artifact:v1:00000000-0000-4000-8000-000000000002';
    database.prepare(`
      INSERT INTO action_logs (
        store_id, screenshot_before, screenshot_after, trace_path
      ) VALUES (?, ?, ?, '   ')
    `).run(STORE_A, missingAbsolute, relative);
    database.prepare(`
      INSERT INTO operation_events (
        event_date, store_name, marketplace_code, event_type, title,
        store_id, evidence_path
      ) VALUES ('2026-07-22', 'A', 'US', 'listing_change', 'Artifact',
        ?, ?)
    `).run(STORE_A, artifactId);
    database.prepare(`
      INSERT INTO operation_events (
        event_date, store_name, marketplace_code, event_type, title,
        store_id, evidence_path
      ) VALUES ('2026-07-22', 'B', 'US', 'listing_change', 'Foreign artifact',
        ?, ?)
    `).run(STORE_B, foreignArtifactId);

    const projected = projectStoreEvidenceReferencePaths(database, STORE_A, capsuleA);
    expect(projected.databaseReferencedPaths).toEqual(stablePaths([
      missingAbsolute,
      relative,
    ]));
    expect(projected.artifactReferences).toEqual([
      {
        artifactId,
        source: 'operation_events.evidence_path',
        referencedStoreId: STORE_A,
        ownership: 'current-store',
      },
      {
        artifactId: foreignArtifactId,
        source: 'operation_events.evidence_path',
        referencedStoreId: STORE_B,
        ownership: 'foreign-store',
      },
    ]);
    expect(projected.blockers).toEqual([]);

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule: capsuleA,
      evidenceRetentionDays: 30,
      now: NOW,
      databaseReferencedPaths: projected.databaseReferencedPaths,
      referenceBlockers: projected.blockers,
    });
    expect(manifest.applyable).toBe(false);
    expect(manifest.scanSafe).toBe(false);
    expect(manifest.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['MISSING_REFERENCE', 'PATH_ESCAPE']),
    );
  });
});
