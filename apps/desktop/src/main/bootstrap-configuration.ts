import * as path from 'node:path';
import {
  EVIDENCE_MODE_ENV,
  EVIDENCE_USER_DATA_DIR_ENV,
  PACKAGE_LAUNCH_SMOKE_MODE,
  PACKAGE_UI_EVIDENCE_MODE,
  PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
} from './evidence-user-data-path';
import { S7_STARTUP_GATE_ENV } from './s7-migration-startup-gate';
import { DEFAULT_RUNTIME_LOG_RETENTION, type RuntimeLogRetentionPolicy } from './runtime-log-policy';

const BOOTSTRAP_ENVIRONMENT_KEYS = Object.freeze([
  'APPDATA',
  'NODE_ENV',
  'AMAZON_AI_OPS_FINAL_READINESS_PATH',
  'FINAL_READINESS_PATH',
  EVIDENCE_MODE_ENV,
  EVIDENCE_USER_DATA_DIR_ENV,
  PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
  ...Object.values(S7_STARTUP_GATE_ENV),
]);

export type BootstrapEnvironment = Readonly<NodeJS.ProcessEnv>;

export interface BootstrapEvidenceIdentity {
  readonly mode: string | null;
  readonly overridden: boolean;
  readonly userDataDir: string | null;
}

export interface BootstrapPaths {
  readonly userDataDir: string;
  readonly logsDir: string;
  readonly storageDir: string;
  readonly storesDir: string;
  readonly screenshotsDir: string;
  readonly domSnapshotsDir: string;
  readonly tracesDir: string;
  readonly reportsDir: string;
  readonly downloadsDir: string;
  readonly exportsDir: string;
  readonly deliveryBundlesDir: string;
  readonly repositoryRoot: string;
  readonly codexEvidenceDir: string;
  readonly pageModelsDir: string;
  readonly databasePath: string;
  readonly preloadPath: string;
  readonly rendererFilePath: string;
  readonly finalReadinessPath: string | null;
}

export interface BootstrapConfigurationInput {
  readonly environment: BootstrapEnvironment;
  readonly isPackaged: boolean;
  readonly evidenceIdentity: BootstrapEvidenceIdentity;
  readonly userDataDir: string;
  readonly repositoryRoot: string;
  readonly mainModulePath: string;
  readonly executablePath: string;
}

export interface BootstrapConfiguration {
  readonly runtimeLogRetention: RuntimeLogRetentionPolicy;
  readonly development: boolean;
  readonly packageUiReadOnly: boolean;
  readonly packageUiFreshTypedProofRequired: boolean;
  readonly packageLaunchSmoke: boolean;
  readonly evidenceIdentity: BootstrapEvidenceIdentity;
  readonly mainModulePath: string;
  readonly executablePath: string;
  readonly paths: BootstrapPaths;
}

export function captureBootstrapEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): BootstrapEnvironment {
  const snapshot: NodeJS.ProcessEnv = {};
  // 启动判定共用固定快照，避免后续环境变化引入权限或路径漂移。
  for (const key of BOOTSTRAP_ENVIRONMENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(environment, key)) {
      const value = environment[key];
      if (value !== undefined) snapshot[key] = value;
    }
  }
  return Object.freeze(snapshot);
}

export function createBootstrapConfiguration(
  input: BootstrapConfigurationInput,
): BootstrapConfiguration {
  const { userDataDir, repositoryRoot, mainModulePath, executablePath } = input;
  const storageDir = path.join(userDataDir, 'storage');
  const exportsDir = path.join(storageDir, 'exports');
  const mainDirectory = path.dirname(mainModulePath);
  const packageUiReadOnly = input.evidenceIdentity.mode === PACKAGE_UI_EVIDENCE_MODE;
  const configuredFinalReadinessPath = input.environment.AMAZON_AI_OPS_FINAL_READINESS_PATH
    || input.environment.FINAL_READINESS_PATH;
  const paths: BootstrapPaths = Object.freeze({
    userDataDir,
    logsDir: path.join(userDataDir, 'logs'),
    storageDir,
    storesDir: path.join(userDataDir, 'stores'),
    screenshotsDir: path.join(storageDir, 'screenshots'),
    domSnapshotsDir: path.join(storageDir, 'dom-snapshots'),
    tracesDir: path.join(storageDir, 'traces'),
    reportsDir: path.join(storageDir, 'reports'),
    downloadsDir: path.join(storageDir, 'downloads'),
    exportsDir,
    deliveryBundlesDir: path.join(exportsDir, 'delivery-bundles'),
    repositoryRoot,
    codexEvidenceDir: path.join(repositoryRoot, 'output', 'codex-evidence'),
    pageModelsDir: path.join(storageDir, 'page-models'),
    databasePath: path.join(userDataDir, 'amazon-ai-ops.db'),
    preloadPath: path.join(mainDirectory, '../preload/index.cjs'),
    rendererFilePath: path.join(mainDirectory, '../renderer/index.html'),
    finalReadinessPath: configuredFinalReadinessPath?.trim()
      ? path.resolve(repositoryRoot, configuredFinalReadinessPath)
      : null,
  });
  return Object.freeze({
    runtimeLogRetention: DEFAULT_RUNTIME_LOG_RETENTION,
    development: !input.isPackaged && input.environment.NODE_ENV === 'development',
    packageUiReadOnly,
    packageUiFreshTypedProofRequired: packageUiReadOnly
      && input.environment[PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV] === '1',
    packageLaunchSmoke: input.evidenceIdentity.mode === PACKAGE_LAUNCH_SMOKE_MODE,
    evidenceIdentity: Object.freeze({
      mode: input.evidenceIdentity.mode,
      overridden: input.evidenceIdentity.overridden,
      userDataDir: input.evidenceIdentity.userDataDir,
    }),
    mainModulePath,
    executablePath,
    paths,
  });
}
