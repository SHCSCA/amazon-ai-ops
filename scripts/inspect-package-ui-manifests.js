module.exports = function createInspectorModule(dependencies) {
  const {
    ALLOWED_RUN_GROUP_ENTRIES,
    INVOCATION_RECEIPT_SCHEMA,
    PROFILE_SEQUENCE,
    RESUME_INSPECTION_SCHEMA,
    fs,
    path,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const cloneSecretBlindDiagnosticRecord = (...args) => dependencies.cloneSecretBlindDiagnosticRecord(...args);
  const fail = (...args) => dependencies.fail(...args);
  const hasOnlyKeys = (...args) => dependencies.hasOnlyKeys(...args);
  const normalizedPath = (...args) => dependencies.normalizedPath(...args);
  const readEnvelope = (...args) => dependencies.readEnvelope(...args);
  const resumeInspectionCore = (...args) => dependencies.resumeInspectionCore(...args);
  const safeDirectory = (...args) => dependencies.safeDirectory(...args);
  const safeFileArtifact = (...args) => dependencies.safeFileArtifact(...args);
  const samePath = (...args) => dependencies.samePath(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const stableFileRead = (...args) => dependencies.stableFileRead(...args);
  const validIsoDate = (...args) => dependencies.validIsoDate(...args);
  const validStructuredFailure = (...args) => dependencies.validStructuredFailure(...args);
  const validateManifestEvidenceFromPureChild = (...args) => dependencies.validateManifestEvidenceFromPureChild(...args);

function validateRootStructure(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    if (!ALLOWED_RUN_GROUP_ENTRIES.includes(entry.name)) {
      fail('RECORD_ROOT_EXTRA_ENTRY', 'Run group contains an unrecognized entry.');
    }
    if (entry.name === 'run-group.json') {
      if (!entry.isFile()) fail('RECORD_ROOT_INVALID', 'run-group.json must be a direct regular file.');
    } else if (!entry.isDirectory()) fail('RECORD_ROOT_INVALID', 'Run-group collection entries must be direct directories.');
  }
  if (!entries.some((entry) => entry.name === 'run-group.json')) {
    fail('RECORD_ROOT_INVALID', 'Run group is missing run-group.json.');
  }
  for (const collection of ['attempts', 'profile-attempt-artifacts']) {
    const collectionPath = path.join(root, collection);
    if (!fs.existsSync(collectionPath)) continue;
    const collectionRoot = safeDirectory(collectionPath, `${collection} directory`);
    for (const entry of fs.readdirSync(collectionRoot, { withFileTypes: true })) {
      if (!PROFILE_SEQUENCE.includes(entry.name) || !entry.isDirectory()) {
        fail('RECORD_ROOT_INVALID', `${collection} contains an unknown profile or non-directory entry.`);
      }
      safeDirectory(path.join(collectionRoot, entry.name), `${collection} profile directory`);
    }
  }
  const checkpoints = path.join(root, 'checkpoints');
  if (fs.existsSync(checkpoints)) {
    const checkpointRoot = safeDirectory(checkpoints, 'Checkpoint directory');
    for (const entry of fs.readdirSync(checkpointRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !PROFILE_SEQUENCE.some((profile) => entry.name === `${profile}.json`)) {
        fail('RECORD_ROOT_INVALID', 'Checkpoint directory contains an unexpected entry.');
      }
    }
  }
}

function fileRecordMatches(left, right) {
  return hasOnlyKeys(left, ['path', 'sha256', 'sizeBytes', 'mtime', 'mtimeMs'])
    && samePath(String(left.path || ''), right.path)
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.mtime === right.mtime
    && left.mtimeMs === right.mtimeMs;
}

function validateManifests(
  root,
  metadataRecord,
  options,
  validateManifestEvidence = validateManifestEvidenceFromPureChild,
) {
  const metadata = metadataRecord.payload;
  const manifestsPath = path.join(root, 'manifests');
  const receiptsPath = path.join(root, 'invocation-receipts');
  if (!fs.existsSync(manifestsPath) || !fs.existsSync(receiptsPath)) {
    fail('MANIFEST_RECORD_INVALID', 'Current run group requires manifest and invocation-receipt directories.');
  }
  const directory = safeDirectory(manifestsPath, 'Run manifest directory');
  const receiptDirectory = safeDirectory(receiptsPath, 'Invocation receipt directory');
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (entries.length < 1) {
    fail('MANIFEST_RECORD_INVALID', 'Current run group requires at least one immutable invocation manifest.');
  }
  const manifests = [];
  const observedReceiptNames = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,240}\.json$/.test(entry.name)) {
      fail('MANIFEST_RECORD_INVALID', 'Run manifest directory contains an unexpected entry.');
    }
    const stable = stableFileRead(path.join(directory, entry.name), 'Package UI run manifest', 'MANIFEST_RECORD_INVALID');
    let manifest;
    try { manifest = JSON.parse(stable.buffer.toString('utf8')); } catch {
      fail('MANIFEST_RECORD_INVALID', 'Package UI run manifest is not valid JSON.');
    }
    const stem = entry.name.slice(0, -5);
    const requestedRunIds = [manifest?.requested?.runGroupId, manifest?.requested?.resumeRunGroupId].filter(Boolean);
    const invocationId = manifest?.invocation?.invocationId;
    const invocationReceiptPath = path.join(receiptDirectory, `${invocationId}.json`);
    if (
      manifest?.kind !== 'package-ui-evidence'
      || manifest?.schemaVersion !== 9
      || manifest?.runGroup?.attemptId !== stem
      || manifest?.runGroup?.runGroupId !== metadata.runGroupId
      || manifest?.runGroup?.invocationId !== invocationId
      || !requestedRunIds.includes(metadata.runGroupId)
      || manifest?.requested?.expectedExeSha256 !== options['expected-exe-sha256']
      || manifest?.requested?.expectedAppContentSha256 !== options['expected-app-content-sha256']
      || manifest?.requested?.allowInteractiveLogin !== true
      || manifest?.requested?.allowSavedLogin !== false
      || manifest?.requested?.loginMode !== 'interactive-operator-each-run'
      || !samePath(String(manifest?.requested?.userDataDir || ''), options['user-data-dir'])
      || !samePath(String(manifest?.requested?.profileBrowserUserDataDir || ''), path.join(options['user-data-dir'], 'stores'))
      || !samePath(String(manifest?.requested?.protectedDatabasePath || ''), options['protected-db'])
      || !samePath(String(manifest?.requested?.authoritySelectionPath || ''), options['authority-selection'])
      || !samePath(String(manifest?.requested?.executablePath || ''), options.executable)
      || !samePath(String(manifest?.requested?.appContentPath || ''), options.appContent)
      || manifest?.runGroup?.runnerContractSha256 !== metadata.runnerContractSha256
      || canonicalJson(manifest?.runGroup?.profileSequence) !== canonicalJson(PROFILE_SEQUENCE)
      || (
        manifest?.runGroup?.metadata != null
        && !fileRecordMatches(manifest.runGroup.metadata, metadataRecord.file)
      )
      || (
        manifest?.passed === true
        && !fileRecordMatches(manifest?.runGroup?.metadata, metadataRecord.file)
      )
      || !validIsoDate(manifest.generatedAt)
      || !validIsoDate(manifest.completedAt)
      || Date.parse(manifest.completedAt) < Date.parse(manifest.generatedAt)
      || typeof manifest.passed !== 'boolean'
      || (
        manifest.passed === true
          ? manifest.failure !== null
          : !validStructuredFailure(manifest.failure)
      )
      || canonicalJson(manifest.failure) !== canonicalJson(cloneSecretBlindDiagnosticRecord(manifest.failure))
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(invocationId || ''))
      || !Array.isArray(manifest?.invocation?.attemptReceipts)
      || manifest.invocation.attemptReceipts.some(
        (record) => record?.invocationId !== invocationId,
      )
      || manifest?.invocation?.collection?.attemptCount
        !== manifest.invocation.attemptReceipts.length
      || manifest?.invocation?.collection?.attemptInvocationManifestCount
        !== manifest.invocation.attemptReceipts.length
      || manifest?.invocation?.collection?.passed !== true
      || manifest?.invocation?.leaseHeldThroughPersistence !== true
      || !samePath(String(manifest?.invocation?.receiptPath || ''), invocationReceiptPath)
    ) fail('MANIFEST_RECORD_INVALID', 'Package UI run manifest is detached from the run-group contract.');
    if (
      manifest.passed === true
      && (
        canonicalJson(manifest?.authority?.binding)
          !== canonicalJson(metadata.authorityBinding)
        || validateManifestEvidence({
          manifest,
          runnerPath: path.join(__dirname, 'package-ui-evidence.js'),
        })?.passed !== true
      )
    ) {
      fail('MANIFEST_RECORD_INVALID', 'Successful Package UI manifest fails the complete current v9 evaluator.');
    }
    const invocationReceipt = readEnvelope(
      invocationReceiptPath,
      'package-ui-invocation-receipt',
      INVOCATION_RECEIPT_SCHEMA,
      root,
    );
    const receipt = invocationReceipt.payload;
    const summary = safeFileArtifact(
      receipt?.summary?.path,
      'Invocation summary',
      'MANIFEST_RECORD_INVALID',
    );
    if (
      !hasOnlyKeys(receipt, ['attemptReceipts', 'authorityBinding', 'completedAt', 'failure', 'invocationId', 'kind', 'lease', 'manifest', 'passed', 'resumeInspectionReceipt', 'runGroupId', 'runnerContractSha256', 'schemaVersion', 'summary'])
      || receipt.invocationId !== invocationId
      || receipt.runGroupId !== metadata.runGroupId
      || receipt.runnerContractSha256 !== metadata.runnerContractSha256
      || receipt.passed !== manifest.passed
      || canonicalJson(receipt.failure) !== canonicalJson(manifest.failure)
      || canonicalJson(receipt.attemptReceipts)
        !== canonicalJson(manifest.invocation.attemptReceipts)
      || canonicalJson(receipt.lease) !== canonicalJson(manifest.invocation.lease)
      || (manifest.passed === true
        && canonicalJson(receipt.authorityBinding)
          !== canonicalJson(metadata.authorityBinding))
      || !fileRecordMatches(receipt.manifest, stable.file)
      || !fileRecordMatches(receipt.summary, summary)
      || !validIsoDate(receipt.completedAt)
    ) fail('MANIFEST_RECORD_INVALID', 'Invocation receipt is detached from its manifest, lease, attempts, or summary.');
    if (manifest.requested.resumeRunGroupId) {
      if (
        typeof manifest.requested.resumeInspectionReceiptPath !== 'string'
        || !path.isAbsolute(manifest.requested.resumeInspectionReceiptPath)
      ) {
        fail('MANIFEST_RECORD_INVALID', 'Resume invocation has no exact inspection receipt path.');
      }
      const originalReceiptPath = path.resolve(
        manifest.requested.resumeInspectionReceiptPath,
      );
      const consumedPath = path.join(
        path.dirname(originalReceiptPath),
        'consumed',
        `${path.basename(originalReceiptPath, '.json')}-${invocationId}.json`,
      );
      if (
        fs.existsSync(originalReceiptPath)
        || manifest.invocation.resumeInspectionReceipt == null
        || receipt.resumeInspectionReceipt == null
      ) {
        fail('MANIFEST_RECORD_INVALID', 'Resume inspection receipt was not consumed exactly once.');
      }
      const consumed = stableFileRead(
        consumedPath,
        'Consumed resume inspection receipt',
        'MANIFEST_RECORD_INVALID',
      );
      let consumedEnvelope;
      try {
        consumedEnvelope = JSON.parse(consumed.buffer.toString('utf8'));
      } catch {
        fail('MANIFEST_RECORD_INVALID', 'Consumed resume inspection receipt is not valid JSON.');
      }
      const consumedPayload = consumedEnvelope?.payload;
      const expectedResumeArgv = [
        'scripts/run-package-ui-evidence.js',
        '--output', path.resolve(options.output),
        '--resume-run-group', metadata.runGroupId,
        '--expected-exe-sha256', options['expected-exe-sha256'],
        '--expected-app-content-sha256', options['expected-app-content-sha256'],
        '--user-data-dir', path.resolve(options['user-data-dir']),
        '--protected-db', path.resolve(options['protected-db']),
        '--authority-selection', path.resolve(options['authority-selection']),
        '--resume-inspection-receipt', originalReceiptPath,
        '--allow-interactive-login',
      ];
      if (
        consumedPayload?.kind !== 'package-ui-resume-inspection'
        || consumedPayload?.schemaVersion !== RESUME_INSPECTION_SCHEMA
        || consumedPayload?.invocationId !== invocationId
        || consumedPayload?.runGroupId !== metadata.runGroupId
        || consumedPayload?.runnerContractSha256 !== metadata.runnerContractSha256
        || consumedEnvelope.payloadSha256
          !== sha256Buffer(Buffer.from(canonicalJson(consumedPayload), 'utf8'))
        || consumedPayload.intentBindingSha256
          !== sha256Buffer(Buffer.from(
            canonicalJson(resumeInspectionCore(consumedPayload)),
            'utf8',
          ))
        || path.basename(originalReceiptPath)
          !== `${consumedPayload.intentBindingSha256}.json`
        || canonicalJson(consumedPayload.argv) !== canonicalJson(expectedResumeArgv)
        || consumed.file.sha256 !== manifest.invocation.resumeInspectionReceipt.sha256
        || consumedEnvelope.payloadSha256
          !== manifest.invocation.resumeInspectionReceipt.payloadSha256
        || canonicalJson(receipt.resumeInspectionReceipt)
          !== canonicalJson({
            payloadSha256: consumedEnvelope.payloadSha256,
            sha256: consumed.file.sha256,
          })
      ) {
        fail('MANIFEST_RECORD_INVALID', 'Consumed resume inspection receipt is stale or cross-bound.');
      }
    } else if (
      manifest.invocation.resumeInspectionReceipt !== null
      || receipt.resumeInspectionReceipt !== null
    ) {
      fail('MANIFEST_RECORD_INVALID', 'Fresh invocation may not claim a resume inspection receipt.');
    }
    observedReceiptNames.add(`${invocationId}.json`);
    manifests.push({
      file: stable.file,
      invocationReceipt,
      manifest,
    });
  }
  const actualReceiptNames = fs.readdirSync(receiptDirectory)
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (
    canonicalJson(actualReceiptNames)
    !== canonicalJson([...observedReceiptNames].sort((a, b) => a.localeCompare(b, 'en')))
  ) {
    fail('MANIFEST_RECORD_INVALID', 'Invocation receipts do not exactly match invocation manifests.');
  }
  return manifests;
}

function validateInvocationCollections(root, manifests, attemptRecords) {
  const manifestsByInvocation = new Map();
  for (const entry of manifests) {
    const invocationId = entry.manifest.invocation.invocationId;
    if (manifestsByInvocation.has(invocationId)) {
      fail('MANIFEST_RECORD_INVALID', 'Invocation id appears in more than one immutable manifest.');
    }
    manifestsByInvocation.set(invocationId, entry);
  }
  const expectedInvocationPaths = [];
  for (const [invocationId, entry] of manifestsByInvocation) {
    const matching = attemptRecords
      .filter((record) => record.payload.invocationId === invocationId)
      .map((record) => ({
        attemptId: record.payload.attemptId,
        file: record.file,
        invocationId,
        invocationManifest: record.payload.attemptInvocationManifest,
        ordinal: record.payload.ordinal,
        payloadSha256: record.payloadSha256,
        profileId: record.payload.profileId,
      }))
      .sort((left, right) => (
        PROFILE_SEQUENCE.indexOf(left.profileId)
          - PROFILE_SEQUENCE.indexOf(right.profileId)
        || left.ordinal - right.ordinal
      ));
    const declared = [...entry.manifest.invocation.attemptReceipts]
      .sort((left, right) => (
        PROFILE_SEQUENCE.indexOf(left.profileId)
          - PROFILE_SEQUENCE.indexOf(right.profileId)
        || left.ordinal - right.ordinal
      ));
    if (canonicalJson(matching) !== canonicalJson(declared)) {
      fail('MANIFEST_RECORD_INVALID', 'Invocation manifest attempt collection is incomplete or cross-bound.');
    }
    for (const record of matching) {
      if (!record.invocationManifest) {
        fail('ATTEMPT_RECORD_INVALID', 'Attempt invocation manifest binding is incomplete.');
      }
      const attempt = attemptRecords.find(
        (candidate) => candidate.file.sha256 === record.file.sha256,
      );
      if (
        attempt.payload.lease.generation
          !== entry.manifest.invocation.lease.generation
        || attempt.payload.lease.payloadSha256
          !== entry.manifest.invocation.lease.payloadSha256
      ) {
        fail('ATTEMPT_RECORD_INVALID', 'Attempt lease generation is detached from its exact invocation manifest.');
      }
      expectedInvocationPaths.push(
        normalizedPath(attempt.payload.attemptInvocationManifest.path),
      );
    }
  }
  if (attemptRecords.some(
    (record) => !manifestsByInvocation.has(record.payload.invocationId),
  )) {
    fail('MANIFEST_RECORD_INVALID', 'An immutable attempt has no exact invocation manifest/receipt.');
  }
  const invocationsRoot = path.join(root, 'invocations');
  const actualInvocationPaths = [];
  if (fs.existsSync(invocationsRoot)) {
    const directRoot = safeDirectory(invocationsRoot, 'Attempt invocation directory');
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          safeDirectory(target, 'Attempt invocation child directory');
          visit(target);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          actualInvocationPaths.push(normalizedPath(
            stableFileRead(target, 'Attempt invocation manifest').file.path,
          ));
        } else {
          fail('RECORD_ROOT_INVALID', 'Attempt invocation directory contains an unexpected entry.');
        }
      }
    };
    visit(directRoot);
  }
  expectedInvocationPaths.sort((a, b) => a.localeCompare(b, 'en'));
  actualInvocationPaths.sort((a, b) => a.localeCompare(b, 'en'));
  if (canonicalJson(actualInvocationPaths) !== canonicalJson(expectedInvocationPaths)) {
    fail('ATTEMPT_RECORD_INVALID', 'Attempt invocation manifests do not exactly match immutable attempts.');
  }
}

  return {
    validateRootStructure,
    fileRecordMatches,
    validateManifests,
    validateInvocationCollections,
  };
};
