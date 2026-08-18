import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import evidenceModule from './package-ui-evidence.js';

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const HASH_C = 'C'.repeat(64);
const { validatePackageUiAuthoritySelection } = evidenceModule;

function authoritySelection({
  databasePath,
  shmHash = HASH_B,
  shmMtimeMs = 100,
  shmMayChange = true,
}) {
  return {
    expectedDatabasePath: databasePath,
    expectedUserDataDir: path.dirname(databasePath),
    selected: {
      logicalCapture: {
        logicalBackupSha256: HASH_C,
        logicalBackupSizeBytes: 4096,
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
        totalPages: 1,
      },
      mainFileSha256: HASH_A,
      realPath: databasePath,
      sidecarObservation: {
        shmMayChangeForReadonlyWalLocking: shmMayChange,
        shmUnchanged: false,
        walAndJournalUnchanged: true,
      },
      sidecars: {
        shm: {
          absolutePath: `${databasePath}-shm`,
          exists: true,
          mtimeMs: shmMtimeMs,
          sha256: shmHash,
          sizeBytes: 32768,
        },
      },
      sidecarsBefore: {
        shm: {
          absolutePath: `${databasePath}-shm`,
          exists: true,
          mtimeMs: shmMtimeMs - 1,
          sha256: shmHash,
          sizeBytes: 32768,
        },
      },
    },
  };
}

function receipt(selection) {
  return {
    adsExecutionInvoked: false,
    authorityDatabaseMutated: false,
    formalEvidence: false,
    kind: 'production-authority-selection-preflight',
    schemaVersion: 'production-authority-selection-preflight/v1',
    selection,
    status: 'SELECTED_SCHEMA_READY',
  };
}

function validationFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-authority-currentness-'));
  const databasePath = path.join(root, 'amazon-ai-ops.db');
  const receiptPath = path.join(root, 'authority-selection.json');
  writeFileSync(databasePath, 'protected-authority-database');
  const canonicalPaths = {
    databasePath,
    roamingAppData: root,
    userDataDir: root,
    userProfile: root,
  };
  return { canonicalPaths, databasePath, receiptPath, root };
}

describe.runIf(process.platform === 'win32')('Package UI authority currentness comparison', () => {
  it('accepts only the declared SHM mtime drift caused by consecutive read-only WAL locking', () => {
    const fixture = validationFixture();
    try {
      const saved = authoritySelection({ databasePath: fixture.databasePath, shmMtimeMs: 100 });
      const current = authoritySelection({ databasePath: fixture.databasePath, shmMtimeMs: 200 });
      writeFileSync(fixture.receiptPath, JSON.stringify(receipt(saved)));

      expect(validatePackageUiAuthoritySelection({
        authoritySelectionPath: fixture.receiptPath,
        canonicalPaths: fixture.canonicalPaths,
        protectedDatabasePath: fixture.databasePath,
        verifier: () => receipt(current),
      })).toEqual(expect.objectContaining({
        status: 'SELECTED_SCHEMA_READY',
        logicalArtifact: expect.objectContaining({ sha256: HASH_C }),
      }));
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it('still rejects SHM content drift even when read-only locking may change its timestamp', () => {
    const fixture = validationFixture();
    try {
      const saved = authoritySelection({ databasePath: fixture.databasePath, shmHash: HASH_B });
      const current = authoritySelection({ databasePath: fixture.databasePath, shmHash: HASH_A, shmMtimeMs: 200 });
      writeFileSync(fixture.receiptPath, JSON.stringify(receipt(saved)));

      expect(() => validatePackageUiAuthoritySelection({
        authoritySelectionPath: fixture.receiptPath,
        canonicalPaths: fixture.canonicalPaths,
        protectedDatabasePath: fixture.databasePath,
        verifier: () => receipt(current),
      })).toThrow(/stale or detached/i);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });
});
