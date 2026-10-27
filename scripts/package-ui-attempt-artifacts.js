// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_OVERLAY_CHECK_IDS,
    PACKAGE_UI_PROFILE_SEQUENCE,
    PACKAGE_UI_WIDE_PROFILE,
    fs,
    path,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const fail = (...args) => dependencies.fail(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const sha256File = (...args) => dependencies.sha256File(...args);
  const violation = (...args) => dependencies.violation(...args);

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function stableFileRecord(rootPath, filePath) {
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink()) {
    fail('Packaged app content may not contain symbolic links or junctions', filePath);
  }
  if (!before.isFile() || before.nlink !== 1) {
    fail('Packaged app content contains a non-unique file leaf', filePath);
  }
  const realPath = fs.realpathSync.native(filePath);
  if (!isPathWithin(rootPath, realPath)) {
    fail('Packaged app content escapes the fixed resources/app directory', filePath);
  }
  const relativePath = path.relative(rootPath, realPath).split(path.sep).join('/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) {
    fail('Packaged app content produced an unsafe relative path', relativePath || filePath);
  }
  const buffer = fs.readFileSync(realPath);
  const after = fs.lstatSync(filePath);
  if (
    before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
    || buffer.length !== after.size
  ) {
    fail('Packaged app content changed while it was being hashed', relativePath);
  }
  return {
    path: relativePath,
    sha256: sha256Buffer(buffer),
    sizeBytes: buffer.length,
  };
}

function buildPackageUiAttemptArtifactManifest(attemptRoot) {
  const resolvedRoot = path.resolve(attemptRoot);
  if (!fs.existsSync(resolvedRoot)) {
    fail('Package UI attempt artifact directory is missing', resolvedRoot);
  }
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('Package UI attempt artifact root must be a real directory', resolvedRoot);
  }
  const rootPath = fs.realpathSync.native(resolvedRoot);
  if (normalizedWindowsPath(rootPath) !== normalizedWindowsPath(resolvedRoot)) {
    fail('Package UI attempt artifact root may not resolve through a symbolic link or junction', resolvedRoot);
  }
  const files = [];
  const visit = (directoryPath) => {
    for (const name of fs.readdirSync(directoryPath).sort((left, right) =>
      left.localeCompare(right, 'en'))) {
      const targetPath = path.join(directoryPath, name);
      const before = fs.lstatSync(targetPath);
      if (before.isSymbolicLink()) {
        fail('Package UI attempt artifacts may not contain symbolic links or junctions', targetPath);
      }
      const realPath = fs.realpathSync.native(targetPath);
      if (!isPathWithin(rootPath, realPath)) {
        fail('Package UI attempt artifact escaped its immutable attempt directory', targetPath);
      }
      if (before.isDirectory()) {
        visit(realPath);
        continue;
      }
      if (!before.isFile()) {
        fail('Package UI attempt artifacts may contain only real files and directories', targetPath);
      }
      if (before.nlink !== 1) {
        fail('Package UI attempt artifacts may not be hard-linked', targetPath);
      }
      const relativePath = path.relative(rootPath, realPath).split(path.sep).join('/');
      if (
        !relativePath
        || relativePath === '..'
        || relativePath.startsWith('../')
        || path.posix.isAbsolute(relativePath)
      ) {
        fail('Package UI attempt artifact produced an unsafe relative path', relativePath || targetPath);
      }
      const buffer = fs.readFileSync(realPath);
      const after = fs.lstatSync(targetPath);
      if (
        after.isSymbolicLink()
        || !after.isFile()
        || after.nlink !== 1
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs
        || buffer.length !== after.size
      ) {
        fail('Package UI attempt artifact changed while it was being hashed', relativePath);
      }
      files.push({
        path: relativePath,
        sha256: sha256Buffer(buffer),
        sizeBytes: buffer.length,
      });
    }
  };
  visit(rootPath);
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const content = {
    files,
    schemaVersion: 1,
  };
  return {
    fileCount: files.length,
    files,
    kind: 'package-ui-attempt-artifact-manifest',
    rootPath,
    schemaVersion: 1,
    sha256: envelopePayloadSha256(content),
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

function packageUiAttemptArtifactManifestMatches(manifest) {
  try {
    if (
      manifest?.kind !== 'package-ui-attempt-artifact-manifest'
      || manifest?.schemaVersion !== 1
      || !path.isAbsolute(String(manifest?.rootPath || ''))
      || !Number.isInteger(manifest?.fileCount)
      || manifest.fileCount < 0
      || !Number.isInteger(manifest?.sizeBytes)
      || manifest.sizeBytes < 0
      || !/^[A-F0-9]{64}$/.test(String(manifest?.sha256 || ''))
      || !Array.isArray(manifest?.files)
    ) {
      return false;
    }
    const current = buildPackageUiAttemptArtifactManifest(manifest.rootPath);
    return canonicalJson(current) === canonicalJson(manifest);
  } catch {
    return false;
  }
}

function canonicalPackageUiArtifactBinding(evidence) {
  const source = evidence?.evidenceBinding || evidence || {};
  const binding = {
    attemptId: source.attemptId,
    invocationId: source.invocationId,
    profileId: source.profileId,
    runGroupId: source.runGroupId,
    runnerContractSha256: source.runnerContractSha256,
    scalePercent: source.scalePercent,
  };
  const compactProfileMatch = /^(\d+)-compact$/.exec(
    String(binding.profileId || ''),
  );
  const expectedScale = binding.profileId === PACKAGE_UI_WIDE_PROFILE.id
    ? PACKAGE_UI_WIDE_PROFILE.scalePercent
    : compactProfileMatch
      ? Number(compactProfileMatch[1])
      : null;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{5,220}$/.test(
      String(binding.attemptId || ''),
    )
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(
      String(binding.invocationId || ''),
    )
    || !PACKAGE_UI_PROFILE_SEQUENCE.includes(binding.profileId)
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(
      String(binding.runGroupId || ''),
    )
    || !/^[A-F0-9]{64}$/.test(String(
      binding.runnerContractSha256 || '',
    ))
    || !Number.isInteger(binding.scalePercent)
    || binding.scalePercent !== expectedScale
  ) {
    fail('Package UI artifact binding is malformed or detached');
  }
  return binding;
}

function packageUiArtifactSemanticKey(binding, role, slot) {
  return envelopePayloadSha256({ binding, role, slot });
}

function packageUiAttemptKnownArtifactReferences(runEvidence) {
  const binding = canonicalPackageUiArtifactBinding(runEvidence);
  const byPath = new Map();
  const bySemanticKey = new Map();
  const add = (record, role, slot) => {
    if (!record) return;
    const semanticKey = packageUiArtifactSemanticKey(binding, role, slot);
    const reference = {
      binding,
      path: record.path,
      role,
      semanticKey,
      sha256: String(record.sha256).toUpperCase(),
      sizeBytes: record.sizeBytes,
      slot,
    };
    const semanticPrior = bySemanticKey.get(semanticKey);
    if (semanticPrior) {
      if (
        normalizedWindowsPath(semanticPrior.path)
          !== normalizedWindowsPath(reference.path)
        || semanticPrior.sha256 !== reference.sha256
        || semanticPrior.sizeBytes !== reference.sizeBytes
        || canonicalJson(semanticPrior.slot) !== canonicalJson(reference.slot)
      ) {
        fail(
          'One Package UI semantic artifact slot has conflicting files',
          semanticKey,
        );
      }
      return;
    }
    const pathKey = normalizedWindowsPath(reference.path || '');
    const pathPrior = byPath.get(pathKey);
    if (pathPrior && pathPrior.semanticKey !== semanticKey) {
      fail(
        'One Package UI artifact path cannot satisfy multiple semantic slots',
        reference.path,
      );
    }
    bySemanticKey.set(semanticKey, reference);
    byPath.set(pathKey, reference);
  };
  for (const screenshot of runEvidence?.screenshots || []) {
    add(screenshot, 'workspace-screenshot', {
      kind: 'workspace',
      overlayId: null,
      pathSha256: null,
      subview: screenshot?.subview || null,
      workspace: screenshot?.workspace || null,
    });
  }
  for (const check of runEvidence?.workspaceChecks || []) {
    add(check?.screenshot, 'workspace-screenshot', {
      kind: 'workspace',
      overlayId: null,
      pathSha256: null,
      subview: check?.subview || null,
      workspace: check?.workspace || null,
    });
    add(check?.inspectorEvidence?.screenshot, 'inspector-screenshot', {
      kind: 'inspector',
      overlayId: null,
      pathSha256: null,
      subview: check?.subview || null,
      workspace: check?.workspace || null,
    });
  }
  for (const check of runEvidence?.subviewChecks || []) {
    add(check?.screenshot, 'subview-screenshot', {
      kind: 'subview',
      overlayId: null,
      pathSha256: null,
      subview: check?.subview || null,
      workspace: check?.workspace || null,
    });
    add(check?.inspectorEvidence?.screenshot, 'inspector-screenshot', {
      kind: 'inspector',
      overlayId: null,
      pathSha256: null,
      subview: check?.subview || null,
      workspace: check?.workspace || null,
    });
  }
  for (const check of runEvidence?.overlayChecks || []) {
    add(check?.screenshot, 'overlay-screenshot', {
      kind: 'overlay',
      overlayId: check?.id || null,
      pathSha256: null,
      subview: null,
      workspace: null,
    });
  }
  for (const screenshot of runEvidence?.minimumWindow?.screenshots || []) {
    add(screenshot, 'minimum-window-screenshot', {
      kind: 'minimum-window', overlayId: null, pathSha256: null,
      subview: screenshot?.subview || null, workspace: screenshot?.workspace || null,
    });
  }
  add(runEvidence?.schedulerReadOnlyRuntime?.artifact, 'main-runtime-artifact', {
    kind: 'main-runtime',
    overlayId: null,
    pathSha256: null,
    subview: null,
    workspace: null,
  });
  const nativeSlots = [
    ['nativeLaunch', 'native-launch'], ['nativeCleanup', 'native-cleanup'],
    ['readerLaunch', 'reader-launch'], ['readerCleanup', 'reader-cleanup'],
  ];
  const nativePaths = new Set();
  for (const [field, kind] of nativeSlots) {
    const original = runEvidence?.[field];
    if (original) nativePaths.add(normalizedWindowsPath(original.path));
    add(original, kind + '-artifact', { kind, overlayId: null, pathSha256: null, subview: null, workspace: null });
  }
  for (const original of runEvidence?.nativeRuntimeArtifacts || []) {
    if (nativePaths.has(normalizedWindowsPath(original.path))) continue;
    add(original, 'native-runtime-artifact', { kind: 'native-runtime', overlayId: null,
      pathSha256: sha256Buffer(Buffer.from(normalizedWindowsPath(original.path), 'utf8')), subview: null, workspace: null });
  }
  return [...bySemanticKey.values()].sort((left, right) =>
    left.semanticKey.localeCompare(right.semanticKey, 'en'));
}

function buildPackageUiAttemptArtifactReferences(attemptArtifacts, runEvidence) {
  const references = packageUiAttemptKnownArtifactReferences(runEvidence);
  const referenced = new Set(references.map((item) => normalizedWindowsPath(item.path)));
  const binding = canonicalPackageUiArtifactBinding(runEvidence);
  if (runEvidence?.passed !== true) {
    for (const file of attemptArtifacts?.files || []) {
      const absolutePath = path.join(attemptArtifacts.rootPath, ...file.path.split('/'));
      if (referenced.has(normalizedWindowsPath(absolutePath))) continue;
      const slot = {
        kind: 'failed-capture',
        overlayId: null,
        pathSha256: sha256Buffer(Buffer.from(file.path, 'utf8')),
        subview: null,
        workspace: null,
      };
      references.push({
        binding,
        path: absolutePath,
        role: 'failed-capture-artifact',
        semanticKey: packageUiArtifactSemanticKey(
          binding,
          'failed-capture-artifact',
          slot,
        ),
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        slot,
      });
    }
  }
  references.sort((left, right) =>
    left.semanticKey.localeCompare(right.semanticKey, 'en'));
  return references;
}

function validatePackageUiAttemptArtifactMembership(attemptArtifacts, evidence) {
  const violations = [];
  if (!packageUiAttemptArtifactManifestMatches(attemptArtifacts)) {
    return {
      passed: false,
      violations: [violation(
        'ATTEMPT_ARTIFACT_MANIFEST_INVALID',
        'Attempt artifact manifest is missing, changed, or detached.',
      )],
    };
  }
  const root = fs.realpathSync.native(path.resolve(attemptArtifacts.rootPath));
  const manifestByPath = new Map(attemptArtifacts.files.map((file) => [
    file.path,
    file,
  ]));
  const persistedAttemptRecord = [
    'package-ui-attempt-invocation',
    'package-ui-profile-attempt',
  ].includes(evidence?.kind);
  let expectedBinding;
  try {
    expectedBinding = canonicalPackageUiArtifactBinding(
      evidence?.evidenceBinding
        ? evidence
        : {
            ...evidence,
            scalePercent: evidence?.profileId === PACKAGE_UI_WIDE_PROFILE.id
              ? PACKAGE_UI_WIDE_PROFILE.scalePercent
              : Number.parseInt(
                String(evidence?.profileId || '').split('-')[0],
                10,
              ),
          },
    );
  } catch (error) {
    return {
      passed: false,
      violations: [violation(
        'ATTEMPT_ARTIFACT_BINDING_INVALID',
        'Attempt evidence is missing its exact invocation/profile/scale binding.',
        sanitizeDiagnosticText(error?.message || error),
      )],
    };
  }
  let expectedReferences;
  try {
    expectedReferences = persistedAttemptRecord
      ? evidence?.artifactReferences
      : buildPackageUiAttemptArtifactReferences(attemptArtifacts, evidence);
  } catch (error) {
    return {
      passed: false,
      violations: [violation(
        'ATTEMPT_ARTIFACT_REFERENCE_CONFLICT',
        'Attempt evidence contains conflicting references to one artifact path.',
        sanitizeDiagnosticText(error?.message || error),
      )],
    };
  }
  if (!Array.isArray(expectedReferences)) {
    return {
      passed: false,
      violations: [violation(
        'ATTEMPT_ARTIFACT_DECLARATION_MISSING',
        'Persisted attempt evidence is missing its exact artifact declaration.',
      )],
    };
  }
  const declared = Array.isArray(evidence?.artifactReferences)
    ? evidence.artifactReferences
    : expectedReferences;
  if (canonicalJson(declared) !== canonicalJson(expectedReferences)) {
    violations.push(violation(
      'ATTEMPT_ARTIFACT_DECLARATION_MISMATCH',
      'Declared attempt artifacts must exactly match every evidence-bearing file and explicit failed-capture remainder.',
    ));
  }
  const declaredByRelative = new Map();
  const declaredByPathIdentity = new Map();
  const declaredBySemanticKey = new Map();
  const exactKeys = (value, keys) => (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',')
      === [...keys].sort().join(',')
  );
  const roleBySlotKind = {
    'failed-capture': 'failed-capture-artifact',
    inspector: 'inspector-screenshot',
    'main-runtime': 'main-runtime-artifact',
    'native-launch': 'native-launch-artifact', 'native-cleanup': 'native-cleanup-artifact',
    'reader-launch': 'reader-launch-artifact', 'reader-cleanup': 'reader-cleanup-artifact',
    'native-runtime': 'native-runtime-artifact',
    'minimum-window': 'minimum-window-screenshot',
    overlay: 'overlay-screenshot',
    subview: 'subview-screenshot',
    workspace: 'workspace-screenshot',
  };
  for (const record of declared) {
    if (
      !exactKeys(record, [
        'binding',
        'path',
        'role',
        'semanticKey',
        'sha256',
        'sizeBytes',
        'slot',
      ])
      || !exactKeys(record?.binding, [
        'attemptId',
        'invocationId',
        'profileId',
        'runGroupId',
        'runnerContractSha256',
        'scalePercent',
      ])
      || !exactKeys(record?.slot, [
        'kind',
        'overlayId',
        'pathSha256',
        'subview',
        'workspace',
      ])
      || !path.isAbsolute(String(record.path || ''))
      || String(record.path) !== path.resolve(String(record.path))
      || !/^[A-F0-9]{64}$/.test(String(record.sha256 || ''))
      || !/^[A-F0-9]{64}$/.test(String(record.semanticKey || ''))
      || !Number.isInteger(record.sizeBytes)
      || record.sizeBytes < 0
      || !Object.hasOwn(roleBySlotKind, record.slot.kind)
      || roleBySlotKind[record.slot.kind] !== record.role
      || canonicalJson(record.binding) !== canonicalJson(expectedBinding)
      || record.semanticKey !== packageUiArtifactSemanticKey(
        record.binding,
        record.role,
        record.slot,
      )
      || (
        record.slot.kind === 'overlay'
          ? !EXPECTED_OVERLAY_CHECK_IDS.includes(record.slot.overlayId)
            || record.slot.workspace !== null
            || record.slot.subview !== null
            || record.slot.pathSha256 !== null
          : record.slot.overlayId !== null
      )
      || (
        ['workspace', 'subview', 'inspector', 'minimum-window'].includes(record.slot.kind)
          ? typeof record.slot.workspace !== 'string'
            || record.slot.workspace.length < 1
            || typeof record.slot.subview !== 'string'
            || record.slot.subview.length < 1
            || record.slot.pathSha256 !== null
          : !['overlay', 'failed-capture', 'native-runtime'].includes(record.slot.kind)
            && (
              record.slot.workspace !== null
              || record.slot.subview !== null
              || record.slot.pathSha256 !== null
            )
      )
      || (
        ['failed-capture', 'native-runtime'].includes(record.slot.kind)
          ? !/^[A-F0-9]{64}$/.test(String(record.slot.pathSha256 || ''))
            || record.slot.workspace !== null
            || record.slot.subview !== null
          : record.slot.pathSha256 !== null
      )
    ) {
      violations.push(violation(
        'ATTEMPT_ARTIFACT_REFERENCE_INVALID',
        'Attempt artifact reference has an invalid shape.',
      ));
      continue;
    }
    if (declaredBySemanticKey.has(record.semanticKey)) {
      violations.push(violation(
        'ATTEMPT_ARTIFACT_SEMANTIC_KEY_DUPLICATE',
        'Each semantic artifact slot must have exactly one reference.',
        record.semanticKey,
      ));
      continue;
    }
    const resolved = path.resolve(record.path);
    let real;
    let stat;
    try {
      const leaf = fs.lstatSync(resolved);
      real = fs.realpathSync.native(resolved);
      stat = fs.statSync(real);
      if (
        leaf.isSymbolicLink()
        || !leaf.isFile()
        || leaf.nlink !== 1
        || stat.nlink !== 1
        || real.replace(/\\/g, '/') !== resolved.replace(/\\/g, '/')
        || normalizedWindowsPath(real) !== normalizedWindowsPath(resolved)
        || !isPathWithin(root, real)
      ) {
        throw new Error('linked-or-escaped');
      }
    } catch {
      violations.push(violation(
        'ATTEMPT_ARTIFACT_REFERENCE_ESCAPED',
        'Attempt artifact reference is linked, missing, or outside its exact attempt root.',
      ));
      continue;
    }
    const relativePath = path.relative(root, real).split(path.sep).join('/');
    const manifestRecord = manifestByPath.get(relativePath);
    if (
      !manifestRecord
      || manifestRecord.sha256 !== record.sha256
      || manifestRecord.sizeBytes !== record.sizeBytes
      || sha256File(real) !== record.sha256
      || stat.size !== record.sizeBytes
    ) {
      violations.push(violation(
        'ATTEMPT_ARTIFACT_REFERENCE_MISMATCH',
        'Attempt artifact reference does not match the immutable manifest bytes.',
      ));
      continue;
    }
    const pathIdentity = normalizedWindowsPath(real);
    if (
      declaredByRelative.has(relativePath)
      || declaredByPathIdentity.has(pathIdentity)
    ) {
      violations.push(violation(
        'ATTEMPT_ARTIFACT_PATH_REUSED',
        'One artifact path cannot satisfy multiple semantic evidence slots.',
        relativePath,
      ));
      continue;
    }
    declaredBySemanticKey.set(record.semanticKey, record);
    declaredByPathIdentity.set(pathIdentity, record);
    declaredByRelative.set(relativePath, record);
  }
  for (const relativePath of manifestByPath.keys()) {
    if (!declaredByRelative.has(relativePath)) {
      violations.push(violation(
        'ATTEMPT_ARTIFACT_CRITICAL_EXTRA',
        'Attempt artifact manifest contains an unreferenced critical file.',
        relativePath,
      ));
    }
  }
  if (
    evidence?.passed === true
    && [...declaredByRelative.values()].some(
      (record) => record.role === 'failed-capture-artifact',
    )
  ) {
    violations.push(violation(
      'ATTEMPT_ARTIFACT_SUCCESS_HAS_FAILURE_EXTRA',
      'A successful attempt may not classify an artifact as a failed capture.',
    ));
  }
  return {
    declaredFileCount: declaredByRelative.size,
    manifestFileCount: manifestByPath.size,
    passed: violations.length === 0
      && declaredByRelative.size === manifestByPath.size,
    violations,
  };
}

  return {
    isPathWithin,
    stableFileRecord,
    buildPackageUiAttemptArtifactManifest,
    packageUiAttemptArtifactManifestMatches,
    canonicalPackageUiArtifactBinding,
    packageUiArtifactSemanticKey,
    packageUiAttemptKnownArtifactReferences,
    buildPackageUiAttemptArtifactReferences,
    validatePackageUiAttemptArtifactMembership,
  };
};
