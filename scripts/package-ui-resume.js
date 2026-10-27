// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_PROFILE_SEQUENCE,
    PACKAGE_UI_RESUME_INSPECTION_SCHEMA_VERSION,
    crypto,
    fs,
    path,
  } = dependencies;
  const artifactInfo = (...args) => dependencies.artifactInfo(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const fail = (...args) => dependencies.fail(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const readStableUniqueFile = (...args) => dependencies.readStableUniqueFile(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const timestampSegment = (...args) => dependencies.timestampSegment(...args);

function packageUiResumeInspectionCore(payload) {
  return {
    authorityBinding: payload?.authorityBinding,
    createdAt: payload?.createdAt,
    cursor: payload?.cursor,
    expiresAt: payload?.expiresAt,
    invocationId: payload?.invocationId,
    kind: payload?.kind,
    nextProfileId: payload?.nextProfileId,
    runGroupId: payload?.runGroupId,
    runnerContractSha256: payload?.runnerContractSha256,
    schemaVersion: payload?.schemaVersion,
  };
}

function validatePackageUiResumeInspectionReceipt({
  invocationArgv,
  receiptPath,
  runGroupId,
  runnerContractSha256,
}) {
  const stable = readStableUniqueFile(
    receiptPath,
    'Package UI resume inspection receipt',
  );
  let envelope;
  try {
    envelope = JSON.parse(stable.buffer.toString('utf8'));
  } catch {
    fail('Package UI resume inspection receipt is not valid JSON', receiptPath);
  }
  const payload = envelope?.payload;
  const expectedArgv = ['scripts/run-package-ui-evidence.js', ...invocationArgv];
  if (
    !payload
    || payload.kind !== 'package-ui-resume-inspection'
    || payload.schemaVersion !== PACKAGE_UI_RESUME_INSPECTION_SCHEMA_VERSION
    || envelope.payloadSha256 !== envelopePayloadSha256(payload)
    || payload.intentBindingSha256 !== envelopePayloadSha256(
      packageUiResumeInspectionCore(payload),
    )
    || path.basename(stable.file.path) !== `${payload.intentBindingSha256}.json`
    || payload.runGroupId !== runGroupId
    || payload.runnerContractSha256 !== runnerContractSha256
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(payload.invocationId || ''))
    || !PACKAGE_UI_PROFILE_SEQUENCE.includes(payload.nextProfileId)
    || !Array.isArray(payload.argv)
    || canonicalJson(payload.argv) !== canonicalJson(expectedArgv)
    || !Number.isFinite(Date.parse(payload.createdAt))
    || !Number.isFinite(Date.parse(payload.expiresAt))
    || Date.parse(payload.expiresAt) <= Date.parse(payload.createdAt)
    || Date.now() > Date.parse(payload.expiresAt)
  ) {
    fail(
      'Package UI resume inspection receipt is stale, malformed, detached, or does not match the exact argv',
      receiptPath,
    );
  }
  return {
    file: {
      ...artifactInfo(stable.file.path),
    },
    payload,
    payloadSha256: envelope.payloadSha256,
  };
}

function consumePackageUiResumeInspectionReceipt(record) {
  const sourcePath = record?.file?.path;
  if (!sourcePath || !record?.payload?.invocationId) {
    fail('Package UI resume inspection receipt consumption requires an exact validated record.');
  }
  const consumedRoot = path.join(path.dirname(sourcePath), 'consumed');
  fs.mkdirSync(consumedRoot, { recursive: true });
  const rootStat = fs.lstatSync(consumedRoot);
  if (
    rootStat.isSymbolicLink()
    || !rootStat.isDirectory()
    || normalizedWindowsPath(fs.realpathSync.native(consumedRoot))
      !== normalizedWindowsPath(consumedRoot)
  ) {
    fail('Package UI consumed-receipt directory must be a direct real directory', consumedRoot);
  }
  const consumedPath = path.join(
    consumedRoot,
    `${path.basename(sourcePath, '.json')}-${safeSegment(record.payload.invocationId)}.json`,
  );
  if (fs.existsSync(consumedPath)) {
    fail('Package UI resume inspection receipt was already consumed', consumedPath);
  }
  fs.renameSync(sourcePath, consumedPath);
  if (fs.existsSync(sourcePath)) {
    fail('Package UI resume inspection receipt still exists after atomic consumption', sourcePath);
  }
  const consumed = artifactInfo(consumedPath);
  if (
    consumed.sha256 !== record.file.sha256
    || consumed.sizeBytes !== record.file.sizeBytes
  ) {
    fail('Package UI resume inspection receipt changed while being consumed', consumedPath);
  }
  return {
    ...record,
    consumedAt: new Date().toISOString(),
    file: consumed,
    originalPathSha256: sha256Buffer(Buffer.from(
      normalizedWindowsPath(sourcePath),
      'utf8',
    )),
  };
}

function packageUiRunGroupId(options = {}) {
  if (options.resumeRunGroupId) return options.resumeRunGroupId;
  if (options.runGroupId) return options.runGroupId;
  return `${timestampSegment()}-${crypto.randomUUID()}`;
}

function packageUiRunGroupPaths(outputDir, runGroupId) {
  const root = path.join(path.resolve(outputDir), 'run-groups', runGroupId);
  return {
    attemptsDir: path.join(root, 'attempts'),
    checkpointsDir: path.join(root, 'checkpoints'),
    invocationReceiptsDir: path.join(root, 'invocation-receipts'),
    invocationsDir: path.join(root, 'invocations'),
    metadataPath: path.join(root, 'run-group.json'),
    root,
  };
}

  return {
    packageUiResumeInspectionCore,
    validatePackageUiResumeInspectionReceipt,
    consumePackageUiResumeInspectionReceipt,
    packageUiRunGroupId,
    packageUiRunGroupPaths,
  };
};
