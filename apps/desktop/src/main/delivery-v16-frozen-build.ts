import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

declare const __V16_FROZEN_BUILD_JSON__: string;
const { validateFrozenBuild } = require('../../../../scripts/v16-trusted-runtime');

export function embeddedV16Build() {
  if (typeof __V16_FROZEN_BUILD_JSON__ !== 'string') throw new Error('V16_FROZEN_BUILD_NOT_EMBEDDED');
  return validateFrozenBuild(JSON.parse(__V16_FROZEN_BUILD_JSON__));
}

export function assertDirectDirectory(directory: string): string {
  const resolved = path.resolve(directory), stat = fs.lstatSync(resolved);
  if (!path.isAbsolute(directory) || !stat.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(resolved).toLowerCase() !== resolved.toLowerCase()) throw new Error('V16_DIRECTORY_NOT_DIRECT:' + resolved);
  return resolved;
}

export function ensureV16OwnedDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  if (!path.isAbsolute(directory)) throw new Error('V16_DIRECTORY_NOT_ABSOLUTE');
  if (!fs.existsSync(resolved)) {
    const parent = path.dirname(resolved);
    if (parent === resolved) throw new Error('V16_DIRECTORY_ROOT_MISSING');
    ensureV16OwnedDirectory(parent);
    try { fs.mkdirSync(resolved); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  return assertDirectDirectory(resolved);
}

export function materializeFrozenFile(directory: string, name: string, bytes: Buffer) {
  if (path.basename(name) !== name) throw new Error('V16_FROZEN_FILE_NAME_INVALID');
  assertDirectDirectory(directory);
  const file = path.join(directory, name);
  try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || fs.realpathSync.native(file).toLowerCase() !== file.toLowerCase()) throw new Error('V16_FROZEN_FILE_NOT_DIRECT');
  const existing = fs.readFileSync(file), after = fs.lstatSync(file);
  if (!existing.equals(bytes) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('V16_FROZEN_FILE_CHANGED');
  return { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
}

export function materializeV16Build(frozen: any, cacheRoot: string) {
  const directory = ensureV16OwnedDirectory(path.join(cacheRoot, frozen.identity.sourceSha256));
  const requirements = materializeFrozenFile(directory, 'requirements-index.json', Buffer.from(JSON.stringify(frozen.requirementsIndex, null, 2) + '\n'));
  const definition = materializeFrozenFile(directory, 'required-tests.json', Buffer.from(JSON.stringify(frozen.requiredManifestDefinition, null, 2) + '\n'));
  type SecurityRecord = { path: string; sha256: string; sizeBytes: number; contentsBase64: string };
  const securitySources = Object.fromEntries(Object.entries(frozen.securitySources as Record<string, { files: SecurityRecord[] }>).map(([name, group]) => [name, {
    files: group.files.map((record, index) => {
      const artifact = materializeFrozenFile(directory, `${name}-${index}-${path.basename(record.path)}`, Buffer.from(record.contentsBase64, 'base64'));
      if (artifact.sha256 !== record.sha256 || artifact.sizeBytes !== record.sizeBytes) throw new Error('V16_SECURITY_SOURCE_BINDING_INVALID:' + name);
      return artifact;
    }),
  }]));
  const governance = frozen.uiGovernanceSource;
  if (!governance || typeof governance.contentsBase64 !== 'string') throw new Error('V16_UI_GOVERNANCE_SOURCE_REQUIRED');
  const uiGovernanceSource = materializeFrozenFile(directory, 'ui-governance-traceability.md', Buffer.from(governance.contentsBase64, 'base64'));
  if (uiGovernanceSource.sha256 !== governance.sha256 || uiGovernanceSource.sizeBytes !== governance.sizeBytes) throw new Error('V16_UI_GOVERNANCE_SOURCE_BINDING_INVALID');
  return { directory, requirements, definition, securitySources, uiGovernanceSource };
}
