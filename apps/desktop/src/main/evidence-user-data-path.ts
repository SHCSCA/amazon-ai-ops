import * as fs from 'fs';
import * as path from 'path';
import { runtimeLogger } from './runtime-logger';
import { normalizeEvidenceUserDataPath, normalizeWindowsPath } from './evidence-path-policy.cjs';

export const EVIDENCE_MODE_ENV = 'AMAZON_AI_OPS_EVIDENCE_MODE';
export const EVIDENCE_USER_DATA_DIR_ENV = 'AMAZON_AI_OPS_USER_DATA_DIR';
export const PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV =
  'AMAZON_AI_OPS_PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF';
export const PACKAGE_UI_EVIDENCE_MODE = 'package-ui';
export const PACKAGE_LAUNCH_SMOKE_MODE = 'package-launch-smoke';
export const EVIDENCE_USER_DATA_LOG_PREFIX = '[App] evidence-user-data ';
export const EVIDENCE_USER_DATA_LOG_EVENT = 'app.evidence_user_data';
export const EVIDENCE_USER_DATA_RUNTIME_MARKER = 'evidence-user-data-runtime.json';
export const PACKAGE_LAUNCH_WINDOW_READY_MARKER = 'package-launch-window-ready.json';

export interface PackageLaunchWindowReadyMarker {
  kind: 'package-launch-window-ready';
  schemaVersion: 1;
  pid: number;
  browserWindowId: number;
  evidenceMode: typeof PACKAGE_LAUNCH_SMOKE_MODE;
  userDataDir: string;
  rendererUrl: string;
  generatedAt: string;
}

const ALLOWED_EVIDENCE_MODES = new Set([
  PACKAGE_UI_EVIDENCE_MODE,
  PACKAGE_LAUNCH_SMOKE_MODE,
]);

interface EvidencePathIo {
  existsSync(filePath: string): boolean;
  isDirectory(filePath: string): boolean;
  realpathSync(filePath: string): string;
  writeFileSync(filePath: string, contents: string): void;
}

interface ElectronAppPathPort {
  getPath(name: 'userData'): string;
  setPath(name: 'userData', filePath: string): void;
}

const DEFAULT_IO: EvidencePathIo = {
  existsSync: (filePath) => fs.existsSync(filePath),
  isDirectory: (filePath) => fs.statSync(filePath).isDirectory(),
  realpathSync: (filePath) => fs.realpathSync.native(filePath),
  writeFileSync: (filePath, contents) => fs.writeFileSync(filePath, contents, 'utf8'),
};

function comparisonPath(filePath: string): string {
  return normalizeWindowsPath(filePath);
}

export function isPackageLaunchWindowReadyMarker(
  value: unknown,
  expected: {
    pid?: number;
    browserWindowId?: number;
    userDataDir?: string;
  } = {},
): value is PackageLaunchWindowReadyMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Partial<PackageLaunchWindowReadyMarker>;
  if (
    marker.kind !== 'package-launch-window-ready'
    || marker.schemaVersion !== 1
    || !Number.isInteger(marker.pid)
    || Number(marker.pid) < 1
    || !Number.isInteger(marker.browserWindowId)
    || Number(marker.browserWindowId) < 1
    || marker.evidenceMode !== PACKAGE_LAUNCH_SMOKE_MODE
    || typeof marker.userDataDir !== 'string'
    || !marker.userDataDir.trim()
    || typeof marker.rendererUrl !== 'string'
    || !marker.rendererUrl.trim()
    || typeof marker.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(marker.generatedAt))
  ) return false;
  if (expected.pid !== undefined && marker.pid !== expected.pid) return false;
  if (
    expected.browserWindowId !== undefined
    && marker.browserWindowId !== expected.browserWindowId
  ) return false;
  return expected.userDataDir === undefined
    || comparisonPath(marker.userDataDir) === comparisonPath(expected.userDataDir);
}

export function validateEvidenceUserDataPath(
  requestedPath: string,
  io: EvidencePathIo = DEFAULT_IO,
): string {
  const normalized = normalizeEvidenceUserDataPath(requestedPath);
  if (!io.existsSync(normalized) || !io.isDirectory(normalized)) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must already exist as a directory before Electron starts.`);
  }
  const realPath = normalizeEvidenceUserDataPath(io.realpathSync(normalized));
  if (comparisonPath(realPath) !== comparisonPath(normalized)) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} may not traverse a symlink or junction.`);
  }
  return realPath;
}

export function configureEvidenceUserDataPath(
  electronApp: ElectronAppPathPort,
  env: NodeJS.ProcessEnv = process.env,
  io: EvidencePathIo = DEFAULT_IO,
): { mode: string | null; overridden: boolean; userDataDir: string | null } {
  const mode = String(env[EVIDENCE_MODE_ENV] || '').trim();
  const requestedPath = String(env[EVIDENCE_USER_DATA_DIR_ENV] || '');

  if (!mode && !requestedPath) {
    return { mode: null, overridden: false, userDataDir: null };
  }
  if (!mode || !requestedPath) {
    throw new Error(`${EVIDENCE_MODE_ENV} and ${EVIDENCE_USER_DATA_DIR_ENV} must be provided together.`);
  }
  if (!ALLOWED_EVIDENCE_MODES.has(mode)) {
    throw new Error(`${EVIDENCE_MODE_ENV} is not an allowed evidence mode: ${mode}`);
  }

  const expectedPath = validateEvidenceUserDataPath(requestedPath, io);
  electronApp.setPath('userData', expectedPath);
  const actualPath = electronApp.getPath('userData');
  if (comparisonPath(actualPath) !== comparisonPath(expectedPath)) {
    throw new Error(`Electron userData override did not take effect: expected ${expectedPath}, received ${actualPath}.`);
  }

  const identity = { mode, overridden: true, userDataDir: actualPath };
  io.writeFileSync(path.join(actualPath, EVIDENCE_USER_DATA_RUNTIME_MARKER), `${JSON.stringify({
    ...identity,
    generatedAt: new Date().toISOString(),
    pid: process.pid,
  }, null, 2)}\n`);
  runtimeLogger.info(EVIDENCE_USER_DATA_LOG_EVENT, { identity });
  return identity;
}
