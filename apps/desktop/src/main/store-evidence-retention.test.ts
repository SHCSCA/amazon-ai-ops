import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import { buildStoreEvidenceRetentionManifest } from './store-evidence-retention';

const NOW = '2026-07-23T12:00:00.000Z';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function createCapsule(storeId = 'store-a', profileId = `profile-${storeId}`): StoreCapsulePaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-retention-'));
  roots.push(root);
  return ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, storeId, profileId));
}

function writeDated(filePath: string, contents: string, ageDays: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  const modifiedAt = new Date(new Date(NOW).getTime() - (ageDays * 24 * 60 * 60 * 1_000));
  fs.utimesSync(filePath, modifiedAt, modifiedAt);
}

describe('store evidence retention dry-run', () => {
  it('lists only expired ordinary screenshot/trace files and declares permanently protected scopes', () => {
    const capsule = createCapsule();
    writeDated(path.join(capsule.screenshotsDir, 'z-old.png'), 'old-shot', 31);
    writeDated(path.join(capsule.screenshotsDir, 'new.png'), 'new-shot', 29);
    writeDated(path.join(capsule.tracesDir, 'nested', 'a-old.zip'), 'old-trace', 45);
    writeDated(path.join(capsule.evidenceDir, 'ancient-authority.json'), 'protected', 1_000);
    writeDated(path.join(capsule.reportsDir, 'ancient-report.csv'), 'protected', 1_000);
    writeDated(path.join(capsule.downloadsDir, 'ancient-download.csv'), 'protected', 1_000);
    writeDated(path.join(capsule.backupsDir, 'ancient-backup.db'), 'protected', 1_000);

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule,
      evidenceRetentionDays: 30,
      now: NOW,
    });

    expect(manifest).toMatchObject({
      mode: 'dry-run',
      deletionSupported: false,
      storeId: 'store-a',
      profileId: 'profile-store-a',
      marketplace: 'US',
      currency: 'USD',
      retentionDays: 30,
      cutoffAt: '2026-06-23T12:00:00.000Z',
      applyable: false,
      scanSafe: true,
      candidateCount: 2,
      candidateBytes: Buffer.byteLength('old-shot') + Buffer.byteLength('old-trace'),
    });
    expect(manifest.candidates.map((candidate) => candidate.relativePath)).toEqual([
      'screenshots/z-old.png',
      'traces/nested/a-old.zip',
    ]);
    expect(manifest.protectedFiles).toEqual([
      expect.objectContaining({
        relativePath: 'screenshots/new.png',
        reasons: ['within-retention-window'],
      }),
    ]);
    expect(manifest.protectedScopes).toEqual([
      expect.objectContaining({ scope: 'evidence', relativePath: 'evidence' }),
      expect.objectContaining({ scope: 'reports', relativePath: 'reports' }),
      expect.objectContaining({ scope: 'downloads', relativePath: 'downloads' }),
      expect.objectContaining({ scope: 'backups', relativePath: 'backups' }),
      expect.objectContaining({ scope: 'browser-profiles', relativePath: 'browser/profile-store-a' }),
    ]);
  });

  it('protects every valid DB/Authority referenced file from candidacy', () => {
    const capsule = createCapsule();
    const databaseFile = path.join(capsule.screenshotsDir, 'db.png');
    const authorityFile = path.join(capsule.tracesDir, 'authority.zip');
    writeDated(databaseFile, 'db', 90);
    writeDated(authorityFile, 'authority', 90);

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule,
      evidenceRetentionDays: 30,
      now: NOW,
      databaseReferencedPaths: [databaseFile],
      authorityReferencedPaths: [authorityFile, databaseFile],
    });

    expect(manifest.applyable).toBe(false);
    expect(manifest.scanSafe).toBe(true);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.protectedFiles).toEqual([
      expect.objectContaining({
        relativePath: 'screenshots/db.png',
        reasons: ['authority-reference', 'database-reference'],
      }),
      expect.objectContaining({
        relativePath: 'traces/authority.zip',
        reasons: ['authority-reference'],
      }),
    ]);
  });

  it('fails closed for cross-store, missing, and path-escape references', () => {
    const trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'store-retention-shared-'));
    roots.push(trustedRoot);
    const capsuleA = ensureStoreCapsulePaths(deriveStoreCapsulePaths(trustedRoot, 'store-a', 'profile-a'));
    const capsuleB = ensureStoreCapsulePaths(deriveStoreCapsulePaths(trustedRoot, 'store-b', 'profile-b'));
    const crossStoreFile = path.join(capsuleB.screenshotsDir, 'other.png');
    writeDated(crossStoreFile, 'other', 90);
    const outside = path.join(path.dirname(trustedRoot), 'outside-retention-reference.png');

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule: capsuleA,
      evidenceRetentionDays: 30,
      now: NOW,
      references: [
        { source: 'authority', absolutePath: crossStoreFile },
        { source: 'database', absolutePath: path.join(capsuleA.screenshotsDir, 'missing.png') },
        { source: 'authority', absolutePath: outside },
      ],
    });

    expect(manifest.applyable).toBe(false);
    expect(manifest.scanSafe).toBe(false);
    expect(manifest.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      'CROSS_STORE_REFERENCE',
      'MISSING_REFERENCE',
      'PATH_ESCAPE',
    ]));
    expect(manifest.candidates).not.toContainEqual(expect.objectContaining({ relativePath: 'screenshots/other.png' }));
    expect(JSON.stringify(manifest)).not.toContain(crossStoreFile);
    expect(JSON.stringify(manifest)).not.toContain(capsuleB.storeRoot);
  });

  it('refuses symlinks or junctions without following them', () => {
    const capsule = createCapsule();
    const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'store-retention-link-target-'));
    roots.push(externalDirectory);
    writeDated(path.join(externalDirectory, 'old.png'), 'outside', 90);
    const linkPath = path.join(capsule.screenshotsDir, 'linked');
    try {
      fs.symlinkSync(externalDirectory, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      throw new Error('test environment must support a directory symlink or Windows junction', {
        cause: error,
      });
    }

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule,
      evidenceRetentionDays: 30,
      now: NOW,
    });

    expect(manifest.applyable).toBe(false);
    expect(manifest.scanSafe).toBe(false);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.blockers).toContainEqual(expect.objectContaining({
      code: 'UNSAFE_LINK_OR_REPARSE_POINT',
      relativePath: 'screenshots/linked',
    }));
  });

  it('fails closed on files with multiple hard links', () => {
    const capsule = createCapsule();
    const first = path.join(capsule.tracesDir, 'first.zip');
    const second = path.join(capsule.tracesDir, 'second.zip');
    writeDated(first, 'hard-link', 90);
    try {
      fs.linkSync(first, second);
    } catch (error) {
      throw new Error('test environment must support hard links', { cause: error });
    }

    const manifest = buildStoreEvidenceRetentionManifest({
      capsule,
      evidenceRetentionDays: 30,
      now: NOW,
    });

    expect(manifest.applyable).toBe(false);
    expect(manifest.scanSafe).toBe(false);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.blockers.filter((blocker) => blocker.code === 'HARD_LINKED_FILE')).toHaveLength(2);
  });

  it('is deterministic regardless of filesystem creation and reference input order', () => {
    const capsule = createCapsule();
    const trace = path.join(capsule.tracesDir, 'b.zip');
    const screenshot = path.join(capsule.screenshotsDir, 'a.png');
    writeDated(trace, 'b', 60);
    writeDated(screenshot, 'a', 60);

    const first = buildStoreEvidenceRetentionManifest({
      capsule,
      evidenceRetentionDays: 30,
      now: NOW,
      references: [
        { source: 'authority', absolutePath: trace },
        { source: 'database', absolutePath: trace },
      ],
    });
    const second = buildStoreEvidenceRetentionManifest({
      capsule,
      evidenceRetentionDays: 30,
      now: NOW,
      references: [
        { source: 'database', absolutePath: trace },
        { source: 'authority', absolutePath: trace },
      ],
    });

    expect(second).toEqual(first);
    expect(first.candidates.map((candidate) => candidate.relativePath)).toEqual(['screenshots/a.png']);
  });
});
