import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
  buildAdversarialNodeEnvEvidence,
  rendererPathIdentity,
} = require('./smoke-package-adversarial-node-env.js');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

export function writeValidAdversarialNodeEnvEvidence(filePath, options) {
  const identity = {
    executableSha256: String(options.executableSha256).toUpperCase(),
    appContentSha256: String(options.appContentSha256).toUpperCase(),
    mainBundleSha256: String(options.mainBundleSha256).toUpperCase(),
    rendererEntrySha256: rendererPathIdentity(options.rendererEntryPath),
  };
  const evidence = buildAdversarialNodeEnvEvidence({
    generatedAt: '2026-07-17T00:00:00.000Z',
    identityAfter: identity,
    identityBefore: identity,
    expected: identity,
    processCleanup: {
      afterMatchingCount: 0,
      attempts: 1,
      beforeMatchingCount: 0,
      passed: true,
    },
    runtime: {
      allDevToolsClosed: true,
      evidenceMode: 'package-launch-smoke',
      isPackaged: true,
      isolatedUserData: true,
      localhostDetected: false,
      nodeEnv: 'development',
      rendererEntrySha256: identity.rendererEntrySha256,
      rendererExact: true,
      rendererScheme: 'file:',
      windowCount: 1,
    },
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return {
    evidence,
    evidencePath: filePath,
    manifestEntry: {
      contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
      exists: true,
      absolutePath: filePath,
      requiredForAppReady: true,
    },
    selection: {
      contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
      present: true,
      evidencePath: filePath,
      selectedBy: 'explicit-arg',
      requiredForDeliverySafety: true,
      passed: true,
      evidenceSha256: sha256File(filePath),
      package: evidence.package,
      message: 'fixture passed',
    },
  };
}

export function bundleAdversarialNodeEnvEvidence(bundleManifestPath, sourcePath) {
  const bundlePath = 'evidence/package-adversarial-node-env.json';
  const targetPath = path.join(path.dirname(bundleManifestPath), bundlePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  const sha256 = sha256File(targetPath);
  return {
    targetPath,
    summary: {
      contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
      sourcePath,
      present: true,
      requiredByFinalReadiness: true,
      bundlePath,
      sha256,
    },
    file: {
      label: 'evidence:package-adversarial-node-env.json',
      sourcePath,
      bundlePath,
      sizeBytes: fs.statSync(targetPath).size,
      sha256,
    },
  };
}
