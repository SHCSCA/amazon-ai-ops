module.exports = function createInspectorModule(dependencies) {
  const {
    EXPECTED_OVERLAY_IDS,
    PROFILE_SEQUENCE,
    path,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const directoryTreeManifest = (...args) => dependencies.directoryTreeManifest(...args);
  const fail = (...args) => dependencies.fail(...args);
  const hasOnlyKeys = (...args) => dependencies.hasOnlyKeys(...args);
  const isWithin = (...args) => dependencies.isWithin(...args);
  const normalizedPath = (...args) => dependencies.normalizedPath(...args);
  const safeDirectory = (...args) => dependencies.safeDirectory(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const stableFileRead = (...args) => dependencies.stableFileRead(...args);

function attemptArtifactManifest(rootPath) {
  const root = safeDirectory(rootPath, 'Attempt artifact root', 'ATTEMPT_ARTIFACT_INVALID');
  const tree = directoryTreeManifest(root, 'Attempt artifact root', 'ATTEMPT_ARTIFACT_INVALID');
  const content = { files: tree.files, schemaVersion: 1 };
  return {
    fileCount: tree.fileCount,
    files: tree.files,
    kind: 'package-ui-attempt-artifact-manifest',
    rootPath: root,
    schemaVersion: 1,
    sha256: sha256Buffer(Buffer.from(canonicalJson(content), 'utf8')),
    sizeBytes: tree.sizeBytes,
  };
}

function attemptArtifactMembershipMatches(
  attemptArtifacts,
  artifactReferences,
  expectedBinding = null,
  expectedPassed = null,
) {
  try {
    if (!Array.isArray(artifactReferences)) return false;
    const root = safeDirectory(
      attemptArtifacts.rootPath,
      'Attempt artifact root',
      'ATTEMPT_ARTIFACT_INVALID',
    );
    const manifestByPath = new Map(
      attemptArtifacts.files.map((file) => [file.path, file]),
    );
    const observed = new Map();
    const semanticKeys = new Set();
    const pathIdentities = new Set();
    for (const reference of artifactReferences) {
      if (
        !hasOnlyKeys(reference, [
          'binding',
          'path',
          'role',
          'semanticKey',
          'sha256',
          'sizeBytes',
          'slot',
        ])
        || !hasOnlyKeys(reference.binding, [
          'attemptId',
          'invocationId',
          'profileId',
          'runGroupId',
          'runnerContractSha256',
          'scalePercent',
        ])
        || !hasOnlyKeys(reference.slot, [
          'kind',
          'overlayId',
          'pathSha256',
          'subview',
          'workspace',
        ])
        || !path.isAbsolute(String(reference.path || ''))
        || String(reference.path) !== path.resolve(String(reference.path))
        || !/^[A-F0-9]{64}$/.test(String(reference.sha256 || ''))
        || !/^[A-F0-9]{64}$/.test(String(reference.semanticKey || ''))
        || !Number.isInteger(reference.sizeBytes)
        || reference.sizeBytes < 0
        || !PROFILE_SEQUENCE.includes(reference.binding.profileId)
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,220}$/.test(String(
          reference.binding.attemptId || '',
        ))
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(
          reference.binding.invocationId || '',
        ))
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(
          reference.binding.runGroupId || '',
        ))
        || !/^[A-F0-9]{64}$/.test(String(
          reference.binding.runnerContractSha256 || '',
        ))
        || reference.binding.scalePercent
          !== (reference.binding.profileId === 'wide-1400x900-100'
            ? 100
            : Number.parseInt(reference.binding.profileId.split('-')[0], 10))
        || (
          expectedBinding
          && canonicalJson(reference.binding)
            !== canonicalJson(expectedBinding)
        )
      ) return false;
      const roleBySlot = {
        'failed-capture': 'failed-capture-artifact',
        inspector: 'inspector-screenshot',
        'main-runtime': 'main-runtime-artifact',
        'minimum-window': 'minimum-window-screenshot',
        overlay: 'overlay-screenshot',
        subview: 'subview-screenshot',
        workspace: 'workspace-screenshot',
      };
      if (
        roleBySlot[reference.slot.kind] !== reference.role
        || (
          ['workspace', 'subview', 'inspector', 'minimum-window'].includes(reference.slot.kind)
          && (
            typeof reference.slot.workspace !== 'string'
            || reference.slot.workspace.length < 1
            || typeof reference.slot.subview !== 'string'
            || reference.slot.subview.length < 1
            || reference.slot.overlayId !== null
            || reference.slot.pathSha256 !== null
          )
        )
        || (
          reference.slot.kind === 'overlay'
          && (
            !EXPECTED_OVERLAY_IDS.includes(reference.slot.overlayId)
            || reference.slot.workspace !== null
            || reference.slot.subview !== null
            || reference.slot.pathSha256 !== null
          )
        )
        || (
          reference.slot.kind === 'failed-capture'
          && (
            reference.slot.overlayId !== null
            || reference.slot.workspace !== null
            || reference.slot.subview !== null
            || !/^[A-F0-9]{64}$/.test(String(
              reference.slot.pathSha256 || '',
            ))
          )
        )
        || (
          reference.slot.kind === 'main-runtime'
          && (
            reference.slot.overlayId !== null
            || reference.slot.workspace !== null
            || reference.slot.subview !== null
            || reference.slot.pathSha256 !== null
          )
        )
        || reference.semanticKey !== sha256Buffer(Buffer.from(canonicalJson({
          binding: reference.binding,
          role: reference.role,
          slot: reference.slot,
        }), 'utf8'))
        || semanticKeys.has(reference.semanticKey)
      ) return false;
      semanticKeys.add(reference.semanticKey);
      const stable = stableFileRead(
        reference.path,
        'Attempt artifact reference',
        'ATTEMPT_ARTIFACT_INVALID',
      );
      if (
        stable.file.path.replace(/\\/g, '/')
          !== path.resolve(reference.path).replace(/\\/g, '/')
      ) return false;
      if (!isWithin(root, stable.file.path)) return false;
      const pathIdentity = normalizedPath(stable.file.path);
      if (pathIdentities.has(pathIdentity)) return false;
      pathIdentities.add(pathIdentity);
      const relative = path.relative(root, stable.file.path).split(path.sep).join('/');
      const expected = manifestByPath.get(relative);
      if (
        !expected
        || expected.sha256 !== reference.sha256
        || expected.sizeBytes !== reference.sizeBytes
        || stable.file.sha256 !== reference.sha256
        || stable.file.sizeBytes !== reference.sizeBytes
      ) return false;
      if (observed.has(relative)) return false;
      observed.set(relative, reference);
    }
    if (
      expectedPassed === true
      && artifactReferences.some(
        (reference) => reference?.role === 'failed-capture-artifact',
      )
    ) return false;
    return observed.size === manifestByPath.size
      && [...manifestByPath.keys()].every((relative) => observed.has(relative));
  } catch {
    return false;
  }
}

function readEnvelope(filePath, kind, schema, root) {
  const realRoot = safeDirectory(root, 'Run-group root');
  const resolved = path.resolve(filePath);
  if (!isWithin(realRoot, resolved)) fail('RECORD_ROOT_INVALID', 'Immutable record escaped the run-group root.');
  const stable = stableFileRead(resolved, 'Immutable record', 'RECORD_ROOT_INVALID');
  let envelope;
  try {
    envelope = JSON.parse(stable.buffer.toString('utf8'));
  } catch {
    fail('RECORD_ROOT_INVALID', 'Immutable record is not valid JSON.');
  }
  if (
    !hasOnlyKeys(envelope, ['payload', 'payloadSha256'])
    || !envelope.payload
    || typeof envelope.payload !== 'object'
    || envelope.payloadSha256 !== sha256Buffer(Buffer.from(canonicalJson(envelope.payload), 'utf8'))
    || envelope.payload.kind !== kind
    || envelope.payload.schemaVersion !== schema
  ) fail('RECORD_ROOT_INVALID', 'Immutable envelope is malformed or changed.');
  return { file: stable.file, payload: envelope.payload, payloadSha256: envelope.payloadSha256 };
}

  return {
    attemptArtifactManifest,
    attemptArtifactMembershipMatches,
    readEnvelope,
  };
};
