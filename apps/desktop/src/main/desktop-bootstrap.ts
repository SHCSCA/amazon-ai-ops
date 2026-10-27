import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  captureBootstrapEnvironment,
  createBootstrapConfiguration,
} from './bootstrap-configuration';
import {
  configureEvidenceUserDataPath,
  PACKAGE_LAUNCH_WINDOW_READY_MARKER,
} from './evidence-user-data-path';
import {
  enforceS7MainStartupGate,
  resolveCanonicalAuthorityUserDataDir,
  S7_STARTUP_GATE_ENV,
} from './s7-migration-startup-gate';
import { runtimeLogger, type RuntimeLogger } from './runtime-logger';

interface BootstrapAppPort {
  isPackaged: boolean;
  getPath(name: 'userData'): string;
  setPath(name: 'userData', value: string): void;
  requestSingleInstanceLock(): boolean;
  exit(code: number): void;
}

interface BootstrapOptions {
  environment?: NodeJS.ProcessEnv;
  repositoryRoot: string;
  mainModulePath: string;
  executablePath: string;
}

interface BootstrapDependencies {
  configureEvidencePath: typeof configureEvidenceUserDataPath;
  resolveCanonicalPath: typeof resolveCanonicalAuthorityUserDataDir;
  enforceStartupGate: typeof enforceS7MainStartupGate;
  removeReadyMarker(filePath: string): void;
  logger: Pick<RuntimeLogger, 'setOutputDirectory' | 'info' | 'error'>;
}

const DEFAULT_DEPENDENCIES: BootstrapDependencies = {
  configureEvidencePath: configureEvidenceUserDataPath,
  resolveCanonicalPath: resolveCanonicalAuthorityUserDataDir,
  enforceStartupGate: enforceS7MainStartupGate,
  removeReadyMarker: (filePath) => fs.rmSync(filePath, { force: true }),
  logger: runtimeLogger,
};

export function initializeDesktopBootstrap(
  electronApp: BootstrapAppPort,
  options: BootstrapOptions,
  overrides: Partial<BootstrapDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    // 路径与授权门使用同一环境快照，不能在初始化中途读取变化后的环境。
    const sourceEnvironment = options.environment ?? process.env;
    const environment = captureBootstrapEnvironment(sourceEnvironment);
    const evidenceIdentity = dependencies.configureEvidencePath(electronApp, environment);
    const userDataDir = electronApp.getPath('userData');
    const configuration = createBootstrapConfiguration({
      environment,
      isPackaged: electronApp.isPackaged,
      evidenceIdentity,
      userDataDir,
      repositoryRoot: options.repositoryRoot,
      mainModulePath: options.mainModulePath,
      executablePath: options.executablePath,
    });
    dependencies.logger.setOutputDirectory(configuration.paths.logsDir, configuration.runtimeLogRetention);
    const gateEnvironment = { ...environment };
    let admission: ReturnType<typeof enforceS7MainStartupGate>;
    try {
      admission = dependencies.enforceStartupGate({
        app: { requestSingleInstanceLock: () => electronApp.requestSingleInstanceLock() },
        currentUserDataDir: configuration.paths.userDataDir,
        canonicalUserDataDir: dependencies.resolveCanonicalPath(environment),
        evidenceUserDataIdentity: configuration.evidenceIdentity,
        isPackaged: electronApp.isPackaged,
        executablePath: configuration.executablePath,
        mainModulePath: configuration.mainModulePath,
        env: gateEnvironment,
      });
    } finally {
      // 门消费一次性绑定后同步清理原环境，不能让后续子进程继承。
      for (const name of Object.values(S7_STARTUP_GATE_ENV)) {
        if (!Object.prototype.hasOwnProperty.call(gateEnvironment, name)) delete sourceEnvironment[name];
      }
    }
    dependencies.logger.info('desktop.startup_admitted', {
      mode: admission.mode,
      admitted: admission.admitted,
      singleInstanceLockAcquired: admission.singleInstanceLockAcquired,
    });
    if (configuration.packageLaunchSmoke) {
      dependencies.removeReadyMarker(path.join(userDataDir, PACKAGE_LAUNCH_WINDOW_READY_MARKER));
    }
    return Object.freeze({ configuration, admission });
  } catch (error) {
    dependencies.logger.error('desktop.startup_blocked', { error });
    try {
      electronApp.exit(78);
    } catch (exitError) {
      dependencies.logger.error('desktop.startup_exit_failed', { error: exitError });
    }
    // exit 的替身或异常不能让数据库初始化继续执行。
    throw error;
  }
}
