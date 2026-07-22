import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  StoreProfileMigrationError,
  migrateLegacyStoreProfile,
  preflightLegacyStoreProfileMigration,
  type LegacyStoreProfileMigrationInput,
} from './store-profile-migration';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('legacy browser profile migration', () => {
  it('publishes one explicitly bound provider profile through a verified atomic stage', () => {
    const input = fixtureInput();
    const preflight = preflightLegacyStoreProfileMigration(input);
    expect(preflight).toMatchObject({ canMigrate: true, alreadyMigrated: false });
    expect(preflight.files.map((file) => file.relativePath)).toEqual([
      'Cookies',
      'Default/Preferences',
    ]);
    expect(fs.existsSync(preflight.targetPath)).toBe(false);

    const result = migrateLegacyStoreProfile(input);
    expect(result).toMatchObject({ status: 'published', canMigrate: true });
    expect(fs.readFileSync(path.join(result.targetPath, 'Cookies'), 'utf8')).toBe('cookie-fixture');
    expect(fs.readFileSync(path.join(result.targetPath, 'Default', 'Preferences'), 'utf8'))
      .toBe('{"account":"verified"}');
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    expect(fs.existsSync(result.claimPath)).toBe(true);
    expect(fs.existsSync(input.sourceProfilePath)).toBe(true);

    expect(migrateLegacyStoreProfile(input)).toMatchObject({ status: 'reused', alreadyMigrated: true });
  });

  it('fails closed when the same physical source is rebound to another provider', () => {
    const input = fixtureInput();
    migrateLegacyStoreProfile(input);
    const conflicting: LegacyStoreProfileMigrationInput = {
      ...input,
      binding: {
        ...input.binding,
        provider: 'amazon_ads',
        externalAccountId: 'ads-account-other',
        identityProofSha256: 'b'.repeat(64),
      },
    };
    const preflight = preflightLegacyStoreProfileMigration(conflicting);
    expect(preflight.canMigrate).toBe(false);
    expect(preflight.blockers.join(' ')).toMatch(/already bound|different store or provider/i);
    expect(() => migrateLegacyStoreProfile(conflicting)).toThrow(StoreProfileMigrationError);
  });

  it('does not trust a published manifest after a target file is tampered', () => {
    const input = fixtureInput();
    const published = migrateLegacyStoreProfile(input);
    fs.writeFileSync(path.join(published.targetPath, 'Cookies'), 'tampered-cookie-fixture');
    const preflight = preflightLegacyStoreProfileMigration(input);
    expect(preflight.canMigrate).toBe(false);
    expect(preflight.alreadyMigrated).toBe(false);
    expect(preflight.blockers.join(' ')).toMatch(/non-empty|same verified migration/i);
  });

  it('requires a stopped browser and a verified identity proof before touching target paths', () => {
    const input = fixtureInput();
    const unsafe: LegacyStoreProfileMigrationInput = {
      ...input,
      browserState: 'running',
      binding: { ...input.binding, identityProofSha256: 'not-a-hash' },
    };
    const preflight = preflightLegacyStoreProfileMigration(unsafe);
    expect(preflight.canMigrate).toBe(false);
    expect(preflight.blockers.join(' ')).toMatch(/stopped browser state/i);
    expect(preflight.blockers.join(' ')).toMatch(/identity proof/i);
    expect(fs.existsSync(preflight.targetPath)).toBe(false);
  });

  it('rejects a source tree containing a symbolic link or junction', () => {
    const input = fixtureInput();
    const outside = tempDirectory('amazon-ai-ops-profile-outside-');
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside');
    fs.symlinkSync(outside, path.join(input.sourceProfilePath, 'linked-outside'), 'junction');

    const preflight = preflightLegacyStoreProfileMigration(input);
    expect(preflight.canMigrate).toBe(false);
    expect(preflight.blockers.join(' ')).toMatch(/symbolic link|junction/i);
    expect(fs.readdirSync(outside)).toEqual(['sentinel.txt']);
  });

  it('rolls back an empty target and removes staged output after an injected copy failure', () => {
    const input = fixtureInput();
    const preflight = preflightLegacyStoreProfileMigration(input);
    fs.mkdirSync(preflight.targetPath, { recursive: true });
    expect(() => migrateLegacyStoreProfile(input, {
      afterStageVerified: () => {
        throw new Error('simulated publish failure');
      },
    })).toThrow(/simulated publish failure/i);
    expect(fs.existsSync(preflight.targetPath)).toBe(true);
    expect(fs.readdirSync(preflight.targetPath)).toEqual([]);
    expect(fs.readdirSync(path.dirname(preflight.targetPath)).some((name) => name.includes('.migration-'))).toBe(false);
    expect(fs.existsSync(input.sourceProfilePath)).toBe(true);
  });

  it('refuses a non-empty target that was not published by the same migration', () => {
    const input = fixtureInput();
    const preflight = preflightLegacyStoreProfileMigration(input);
    fs.mkdirSync(preflight.targetPath, { recursive: true });
    fs.writeFileSync(path.join(preflight.targetPath, 'foreign-cookie'), 'do not overwrite');
    const blocked = preflightLegacyStoreProfileMigration(input);
    expect(blocked.canMigrate).toBe(false);
    expect(blocked.blockers.join(' ')).toMatch(/non-empty/i);
    expect(fs.readFileSync(path.join(preflight.targetPath, 'foreign-cookie'), 'utf8')).toBe('do not overwrite');
  });
});

function fixtureInput(): LegacyStoreProfileMigrationInput {
  const root = tempDirectory('amazon-ai-ops-profile-migration-');
  const trustedLegacyRoot = path.join(root, 'legacy');
  const sourceProfilePath = path.join(trustedLegacyRoot, 'shared-profile');
  const trustedStoresRoot = path.join(root, 'stores');
  fs.mkdirSync(path.join(sourceProfilePath, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(sourceProfilePath, 'Cookies'), 'cookie-fixture');
  fs.writeFileSync(path.join(sourceProfilePath, 'Default', 'Preferences'), '{"account":"verified"}');
  return {
    trustedLegacyRoot,
    sourceProfilePath,
    trustedStoresRoot,
    browserState: 'stopped',
    binding: {
      storeId: 'store-us-one',
      browserProfileId: 'store-us-one-profile',
      provider: 'lingxing',
      externalAccountId: 'lingxing-account-one',
      identityProofSha256: 'a'.repeat(64),
      verifiedAt: '2026-07-23T00:00:00.000Z',
    },
  };
}

function tempDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}
