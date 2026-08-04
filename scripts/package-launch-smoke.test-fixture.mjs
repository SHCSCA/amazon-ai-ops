import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const {
  packagedRendererPathForExecutable,
} = require('./smoke-package-launch.js');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function artifact(filePath) {
  const bytes = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    sizeBytes: stat.size,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    mtime: stat.mtime.toISOString(),
  };
}

export function writeValidPackageLaunchSmoke(fixtureDir, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const releaseDir = options.releaseDir || path.join(fixtureDir, 'release');
  const unpackedPath = options.unpackedPath
    || path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const portablePath = options.portablePath
    || path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  if (!fs.existsSync(unpackedPath)) {
    writeFile(unpackedPath, options.unpackedContent || 'unpacked runtime fixture\n');
  }
  if (!fs.existsSync(portablePath)) {
    writeFile(portablePath, options.portableContent || 'portable wrapper fixture\n');
  }
  const portableRuntimePath = path.join(
    fixtureDir,
    'portable-runtime',
    'AmazonAIOpsAgent.exe',
  );
  writeFile(portableRuntimePath, fs.readFileSync(unpackedPath));
  for (const executablePath of [unpackedPath, portableRuntimePath]) {
    const rendererPath = packagedRendererPathForExecutable(executablePath);
    if (!fs.existsSync(rendererPath)) writeFile(rendererPath, '<!doctype html>');
  }

  const isolatedUserData = {
    unpacked: path.join(fixtureDir, 'launch-user-data', 'win-unpacked'),
    portable: path.join(fixtureDir, 'launch-user-data', 'portable'),
  };
  const buildCheck = ({
    executablePath,
    kind,
    launcherPid,
    pid,
    userDataDir,
  }) => {
    const notBeforeMs = Date.parse(generatedAt) - 1000;
    const userDataMarker = {
      mode: 'package-launch-smoke',
      overridden: true,
      userDataDir,
      generatedAt,
      pid,
    };
    const userDataMarkerPath = writeFile(
      path.join(userDataDir, 'evidence-user-data-runtime.json'),
      `${JSON.stringify(userDataMarker, null, 2)}\n`,
    );
    const rendererPath = packagedRendererPathForExecutable(executablePath);
    const windowReadyMarker = {
      kind: 'package-launch-window-ready',
      schemaVersion: 1,
      pid,
      browserWindowId: 1,
      evidenceMode: 'package-launch-smoke',
      userDataDir,
      rendererUrl: pathToFileURL(rendererPath).href,
      generatedAt,
    };
    const windowReadyMarkerPath = writeFile(
      path.join(userDataDir, 'package-launch-window-ready.json'),
      `${JSON.stringify(windowReadyMarker, null, 2)}\n`,
    );
    const check = {
      kind,
      ok: true,
      launchError: null,
      runtimeProcess: {
        processId: pid,
        parentProcessId: kind === 'portable' ? launcherPid : 0,
        name: 'AmazonAIOpsAgent.exe',
        executablePath,
        creationDate: generatedAt,
        mainWindowHandle: 1000 + pid,
        mainWindowTitle: 'Amazon AI Ops Agent',
        windowVisible: true,
        proof: 'isolated-runtime-marker',
        notBeforeMs,
      },
      windowReadyEvidence: {
        artifact: artifact(windowReadyMarkerPath),
        marker: windowReadyMarker,
        markerPath: windowReadyMarkerPath,
        passed: true,
        rendererPath,
        state: 'valid',
        violations: [],
      },
      processCleanup: {
        attempts: 1,
        identityViolations: [],
        killAttempts: [],
        passed: true,
        remaining: [],
        remainingCount: 0,
        reusedPids: [],
        snapshotError: null,
        treeErrors: [],
        unresolved: [],
      },
      observationErrors: [],
      stdoutPath: writeFile(path.join(userDataDir, `${kind}.stdout.log`), ''),
      stderrPath: writeFile(path.join(userDataDir, `${kind}.stderr.log`), ''),
      userDataEvidence: {
        actualUserDataDir: userDataDir,
        expectedUserDataDir: userDataDir,
        passed: true,
        violations: [],
        marker: userDataMarker,
        markerError: null,
        markerPath: userDataMarkerPath,
      },
    };
    if (kind === 'win-unpacked') {
      check.marker = '[App] window-created';
      check.pid = pid;
    } else {
      check.launcherPid = launcherPid;
      check.observedProcessCount = 1;
    }
    return check;
  };

  const evidence = {
    kind: 'package-launch-smoke',
    generatedAt,
    releaseDir,
    evidenceMode: 'package-launch-smoke',
    isolatedUserData,
    userDataOverrideBundleContract: { passed: true, violations: [] },
    artifacts: {
      unpacked: artifact(unpackedPath),
      portable: artifact(portablePath),
    },
    checks: [
      buildCheck({
        executablePath: unpackedPath,
        kind: 'win-unpacked',
        launcherPid: null,
        pid: 42,
        userDataDir: isolatedUserData.unpacked,
      }),
      buildCheck({
        executablePath: portableRuntimePath,
        kind: 'portable',
        launcherPid: 900,
        pid: 84,
        userDataDir: isolatedUserData.portable,
      }),
    ],
    passed: true,
  };
  if (options.evidencePath) {
    writeFile(options.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}
