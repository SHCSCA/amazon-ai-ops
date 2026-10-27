module.exports = function createInspectorModule(dependencies) {
  const {
    RESUME_INSPECTION_SCHEMA,
    crypto,
    fs,
    path,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const powershellQuote = (...args) => dependencies.powershellQuote(...args);
  const processSnapshotEvidencePassed = (...args) => dependencies.processSnapshotEvidencePassed(...args);
  const profileCursorBinding = (...args) => dependencies.profileCursorBinding(...args);
  const safeDirectory = (...args) => dependencies.safeDirectory(...args);
  const safeFileArtifact = (...args) => dependencies.safeFileArtifact(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const violation = (...args) => dependencies.violation(...args);

function writeResumeInspectionIntent(options, {
  authorityBinding,
  cursor,
  nextProfileId,
  runGroupId,
  runnerContractSha256,
}) {
  const createdAt = new Date();
  const invocationId = `${createdAt.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  const core = {
    authorityBinding,
    createdAt: createdAt.toISOString(),
    cursor: cursor?.logicalDatabaseSha256
      ? cursor
      : profileCursorBinding(cursor),
    expiresAt: new Date(createdAt.valueOf() + 60 * 60 * 1000).toISOString(),
    invocationId,
    kind: 'package-ui-resume-inspection',
    nextProfileId,
    runGroupId,
    runnerContractSha256,
    schemaVersion: RESUME_INSPECTION_SCHEMA,
  };
  const intentBindingSha256 = sha256Buffer(Buffer.from(canonicalJson(core), 'utf8'));
  const intentRoot = path.join(
    path.resolve(options.output),
    'resume-intents',
    runGroupId,
  );
  fs.mkdirSync(intentRoot, { recursive: true });
  safeDirectory(intentRoot, 'Resume inspection intent directory', 'RECORD_ROOT_INVALID');
  const receiptPath = path.join(intentRoot, `${intentBindingSha256}.json`);
  const argv = [
    'scripts/run-package-ui-evidence.js',
    '--output', path.resolve(options.output),
    '--resume-run-group', runGroupId,
    '--expected-exe-sha256', options['expected-exe-sha256'],
    '--expected-app-content-sha256', options['expected-app-content-sha256'],
    '--user-data-dir', path.resolve(options['user-data-dir']),
    '--protected-db', path.resolve(options['protected-db']),
    '--authority-selection', path.resolve(options['authority-selection']),
    '--resume-inspection-receipt', receiptPath,
    '--allow-interactive-login',
  ];
  const payload = {
    ...core,
    argv,
    intentBindingSha256,
  };
  const envelope = {
    payload,
    payloadSha256: sha256Buffer(Buffer.from(canonicalJson(payload), 'utf8')),
  };
  const temporaryPath = `${receiptPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryPath, receiptPath);
    fs.unlinkSync(temporaryPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  const receipt = safeFileArtifact(
    receiptPath,
    'Resume inspection intent',
    'RECORD_ROOT_INVALID',
  );
  return {
    argv,
    command: 'node',
    inspectionReceipt: receipt,
    invocationId,
    pathInputsRequired: [],
    powershellDisplay: ['node', ...argv].map(powershellQuote).join(' '),
  };
}

function packageProcessAbsenceProven(snapshot) {
  return processSnapshotEvidencePassed(snapshot)
    && snapshot.observedCount === 0
    && snapshot.matchingCount === 0
    && snapshot.unresolvedCount === 0;
}

function profileProcessAbsenceProven(snapshot) {
  return processSnapshotEvidencePassed(snapshot)
    && snapshot.matchingCount === 0
    && snapshot.unresolvedCount === 0
    && (snapshot.ignoredUnresolvedCount === undefined
      || snapshot.ignoredUnresolvedCount === 0);
}

function runnerLeaseAbsenceProven(lease, runGroupId, runnerContractSha256) {
  return lease?.supported === true
    && lease?.passed === true
    && lease?.activeRunnerCount === 0
    && lease?.runGroupId === runGroupId
    && lease?.runnerContractSha256 === runnerContractSha256;
}

function appendProcessViolations(violations, facts, runGroupId, runnerContractSha256) {
  if (!packageProcessAbsenceProven(facts?.packageProcess)) {
    violations.push(violation(
      'PROCESS_PACKAGE_ACTIVE',
      'Every AmazonAIOpsAgent.exe process must be absent, including installed, portable, unresolved, and non-canonical copies.',
    ));
  }
  if (!profileProcessAbsenceProven(facts?.profileProcess)) {
    violations.push(violation(
      'PROCESS_PROFILE_ACTIVE',
      'A bundled Chromium process still owns the isolated profile or could not be resolved.',
    ));
  }
  if (facts?.runnerLease?.supported !== true) {
    violations.push(violation(
      'RUNNER_LEASE_UNSUPPORTED',
      'The current Package UI runner does not publish an immutable run-group lease, so an active runner Node process cannot be excluded without command-line guessing.',
    ));
  } else if (!runnerLeaseAbsenceProven(facts.runnerLease, runGroupId, runnerContractSha256)) {
    violations.push(violation(
      'PROCESS_RUNNER_ACTIVE',
      'The exact run-group lease is active, unresolved, or detached from the current runner contract.',
    ));
  }
}

function dedupeViolations(violations) {
  const seen = new Set();
  for (let index = violations.length - 1; index >= 0; index -= 1) {
    const key = canonicalJson(violations[index]);
    if (seen.has(key)) violations.splice(index, 1);
    else seen.add(key);
  }
}

  return {
    writeResumeInspectionIntent,
    packageProcessAbsenceProven,
    profileProcessAbsenceProven,
    runnerLeaseAbsenceProven,
    appendProcessViolations,
    dedupeViolations,
  };
};
