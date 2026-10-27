// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_RUNNER_LEASE_SCHEMA_VERSION,
    crypto,
    fs,
    path,
    spawnSync,
  } = dependencies;
  const artifactInfo = (...args) => dependencies.artifactInfo(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const createImmutableEnvelope = (...args) => dependencies.createImmutableEnvelope(...args);
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const fail = (...args) => dependencies.fail(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const packageUiLeasePath = (...args) => dependencies.packageUiLeasePath(...args);
  const readStableUniqueFile = (...args) => dependencies.readStableUniqueFile(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const timestampSegment = (...args) => dependencies.timestampSegment(...args);

function collectPackageUiProcessStartIdentity(processId = process.pid, run = spawnSync) {
  if (!Number.isInteger(processId) || processId <= 0) {
    return { alive: false, passed: false, processId, reasonCode: 'PROCESS_ID_INVALID' };
  }
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$item = Get-CimInstance Win32_Process -Filter "ProcessId=${processId}" | Select-Object ProcessId,CreationDate,ExecutablePath`,
    'ConvertTo-Json -InputObject $item -Compress',
  ].join('; ');
  const result = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 20_000,
    windowsHide: true,
  });
  if (result?.error || result?.status !== 0 || result?.signal) {
    return {
      alive: null,
      passed: false,
      processId,
      reasonCode: 'PROCESS_IDENTITY_UNRESOLVED',
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '').trim() || 'null');
  } catch {
    return {
      alive: null,
      passed: false,
      processId,
      reasonCode: 'PROCESS_IDENTITY_MALFORMED',
    };
  }
  if (!parsed) {
    return {
      alive: false,
      passed: true,
      processId,
      reasonCode: 'PROCESS_NOT_FOUND',
    };
  }
  const observedProcessId = Number(parsed.ProcessId);
  const creationDate = String(parsed.CreationDate || '').trim();
  const executablePath = String(parsed.ExecutablePath || '').trim();
  if (
    observedProcessId !== processId
    || !creationDate
    || !path.isAbsolute(executablePath)
  ) {
    return {
      alive: null,
      passed: false,
      processId,
      reasonCode: 'PROCESS_IDENTITY_INCOMPLETE',
    };
  }
  const binding = {
    creationDate,
    executablePathSha256: sha256Buffer(Buffer.from(
      normalizedWindowsPath(executablePath),
      'utf8',
    )),
    processId,
  };
  return {
    ...binding,
    alive: true,
    identitySha256: envelopePayloadSha256(binding),
    passed: true,
    reasonCode: null,
  };
}

function readPackageUiLeaseEnvelope(leasePath) {
  const stable = readStableUniqueFile(leasePath, 'Package UI runner lease');
  let envelope;
  try {
    envelope = JSON.parse(stable.buffer.toString('utf8'));
  } catch {
    fail('Package UI runner lease is not valid JSON', leasePath);
  }
  if (
    !envelope?.payload
    || envelope.payload.kind !== 'package-ui-runner-lease'
    || envelope.payload.schemaVersion !== PACKAGE_UI_RUNNER_LEASE_SCHEMA_VERSION
    || envelope.payloadSha256 !== envelopePayloadSha256(envelope.payload)
  ) {
    fail('Package UI runner lease is malformed or changed', leasePath);
  }
  return {
    file: {
      ...artifactInfo(leasePath),
    },
    payload: envelope.payload,
    payloadSha256: envelope.payloadSha256,
  };
}

function inspectPackageUiRunGroupLease({
  collectProcessIdentity = collectPackageUiProcessStartIdentity,
  outputDir,
  runGroupId,
  runnerContractSha256,
}) {
  const leasePath = packageUiLeasePath(outputDir, runGroupId);
  if (!fs.existsSync(leasePath)) {
    return {
      activeRunnerCount: 0,
      leasePathSha256: sha256Buffer(Buffer.from(
        normalizedWindowsPath(leasePath),
        'utf8',
      )),
      passed: true,
      reasonCode: null,
      runGroupId,
      runnerContractSha256,
      state: 'absent',
      supported: true,
    };
  }
  let record;
  try {
    record = readPackageUiLeaseEnvelope(leasePath);
  } catch {
    return {
      activeRunnerCount: null,
      passed: false,
      reasonCode: 'RUNNER_LEASE_INVALID',
      runGroupId,
      runnerContractSha256,
      state: 'unresolved',
      supported: true,
    };
  }
  const payload = record.payload;
  if (
    payload.runGroupId !== runGroupId
    || payload.runnerContractSha256 !== runnerContractSha256
    || !/^[A-F0-9]{64}$/.test(String(payload.processStartIdentitySha256 || ''))
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(payload.invocationId || ''))
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(payload.generation || ''))
  ) {
    return {
      activeRunnerCount: null,
      passed: false,
      reasonCode: 'RUNNER_LEASE_LINEAGE_MISMATCH',
      runGroupId,
      runnerContractSha256,
      state: 'unresolved',
      supported: true,
    };
  }
  const identity = collectProcessIdentity(payload.processId);
  if (
    identity?.passed === true
    && identity.alive === true
    && identity.identitySha256 === payload.processStartIdentitySha256
  ) {
    return {
      activeRunnerCount: 1,
      invocationId: payload.invocationId,
      leaseGeneration: payload.generation,
      passed: false,
      reasonCode: 'RUNNER_LEASE_ACTIVE',
      runGroupId,
      runnerContractSha256,
      state: 'active',
      supported: true,
    };
  }
  if (identity?.passed === true && identity.alive === false) {
    return {
      activeRunnerCount: null,
      invocationId: payload.invocationId,
      leaseGeneration: payload.generation,
      passed: false,
      reasonCode: 'RUNNER_LEASE_STALE',
      runGroupId,
      runnerContractSha256,
      state: 'stale',
      supported: true,
    };
  }
  return {
    activeRunnerCount: null,
    invocationId: payload.invocationId,
    leaseGeneration: payload.generation,
    passed: false,
    reasonCode: 'RUNNER_LEASE_UNRESOLVED',
    runGroupId,
    runnerContractSha256,
    state: 'unresolved',
    supported: true,
  };
}

function acquirePackageUiRunGroupLease({
  collectProcessIdentity = collectPackageUiProcessStartIdentity,
  invocationId,
  outputDir,
  randomUUID = crypto.randomUUID,
  runGroupId,
  runnerContractSha256,
}) {
  const processIdentity = collectProcessIdentity(process.pid);
  if (
    processIdentity?.passed !== true
    || processIdentity.alive !== true
    || !/^[A-F0-9]{64}$/.test(String(processIdentity.identitySha256 || ''))
  ) {
    fail('Current runner PID/start identity could not be proven before acquiring the run-group lease');
  }
  const leasePath = packageUiLeasePath(outputDir, runGroupId);
  const leaseRoot = path.dirname(leasePath);
  fs.mkdirSync(leaseRoot, { recursive: true });
  const leaseRootStat = fs.lstatSync(leaseRoot);
  if (
    leaseRootStat.isSymbolicLink()
    || !leaseRootStat.isDirectory()
    || normalizedWindowsPath(fs.realpathSync.native(leaseRoot))
      !== normalizedWindowsPath(leaseRoot)
  ) {
    fail('Package UI lease root must be a direct real directory', leaseRoot);
  }
  const generation = `${timestampSegment()}-${randomUUID()}`;
  const payload = {
    acquiredAt: new Date().toISOString(),
    generation,
    invocationId,
    kind: 'package-ui-runner-lease',
    processId: process.pid,
    processStartIdentitySha256: processIdentity.identitySha256,
    runGroupId,
    runnerContractSha256,
    schemaVersion: PACKAGE_UI_RUNNER_LEASE_SCHEMA_VERSION,
  };
  let descriptor;
  try {
    descriptor = fs.openSync(leasePath, 'wx', 0o600);
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify(createImmutableEnvelope(payload), null, 2)}\n`,
      'utf8',
    );
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const state = inspectPackageUiRunGroupLease({
        collectProcessIdentity,
        outputDir,
        runGroupId,
        runnerContractSha256,
      });
      fail(
        `Package UI run-group lease already exists (${state.reasonCode || state.state}); stale and concurrent leases fail closed`,
        leasePath,
      );
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const record = readPackageUiLeaseEnvelope(leasePath);
  if (canonicalJson(record.payload) !== canonicalJson(payload)) {
    fail('Package UI runner lease changed immediately after acquisition', leasePath);
  }
  return {
    file: record.file,
    leasePath,
    payload,
    payloadSha256: record.payloadSha256,
  };
}

function releasePackageUiRunGroupLease(lease) {
  if (!lease?.leasePath || !lease?.payload) {
    fail('Package UI runner lease release requires the exact acquired lease.');
  }
  const current = readPackageUiLeaseEnvelope(lease.leasePath);
  if (
    current.payloadSha256 !== lease.payloadSha256
    || canonicalJson(current.payload) !== canonicalJson(lease.payload)
  ) {
    fail('Package UI runner lease changed before release', lease.leasePath);
  }
  fs.unlinkSync(lease.leasePath);
  if (fs.existsSync(lease.leasePath)) {
    fail('Package UI runner lease still exists after release', lease.leasePath);
  }
  return {
    generation: lease.payload.generation,
    invocationId: lease.payload.invocationId,
    released: true,
  };
}

  return {
    collectPackageUiProcessStartIdentity,
    readPackageUiLeaseEnvelope,
    inspectPackageUiRunGroupLease,
    acquirePackageUiRunGroupLease,
    releasePackageUiRunGroupLease,
  };
};
