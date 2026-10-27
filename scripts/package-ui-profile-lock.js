// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_PROFILE_LOCK_INTERNAL_DEADLINE_MS,
    PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES,
    PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES,
    PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS,
    PACKAGE_UI_PROFILE_LOCK_PROBE_SOURCE,
    PACKAGE_UI_PROFILE_LOCK_PROBE_TIMEOUT_MS,
    crypto,
    fs,
    path,
    spawnSync,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const exactObjectKeys = (...args) => dependencies.exactObjectKeys(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

function collectPackageUiProfileLockEvidence(userDataDir, options = {}) {
  const root = path.resolve(userDataDir);
  const observedAt = new Date().toISOString();
  const unresolved = [];
  const profileId = String(options.profileId || 'run-group');
  const invocationId = String(options.invocationId || 'unbound-invocation');
  const binding = {
    invocationIdSha256: sha256Buffer(Buffer.from(invocationId, 'utf8')),
    profileId,
    rootPathSha256: sha256Buffer(Buffer.from(
      root.replace(/\\/g, '/').toLowerCase(),
      'utf8',
    )),
  };
  let helper = null;
  let probeCreated = false;
  let probeRemoved = false;
  let rootBefore = null;
  let rootAfter = null;
  let probeLimits = {
    maxCriticalEntries: PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES,
    maxEntries: PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES,
    maxPathCharacters: PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS,
  };
  const probeName = `.package-ui-exclusive-lock-probe-${crypto.randomUUID()}`;
  const probePath = path.join(root, probeName);
  try {
    if (process.platform !== 'win32') {
      throw new Error('PROFILE_LOCK_PROBE_WINDOWS_ONLY');
    }
    if (options.probeLimits !== undefined) {
      const candidate = options.probeLimits;
      if (
        options.testOnlyAllowLowerLimits !== true
        || !exactObjectKeys(candidate, [
          'maxCriticalEntries',
          'maxEntries',
          'maxPathCharacters',
        ])
        || !Number.isInteger(candidate.maxEntries)
        || candidate.maxEntries < 1
        || candidate.maxEntries > PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES
        || !Number.isInteger(candidate.maxPathCharacters)
        || candidate.maxPathCharacters < 1
        || candidate.maxPathCharacters
          > PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS
        || !Number.isInteger(candidate.maxCriticalEntries)
        || candidate.maxCriticalEntries < 0
        || candidate.maxCriticalEntries
          > PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES
      ) {
        throw new Error('PROFILE_LOCK_TEST_LIMITS_INVALID');
      }
      probeLimits = { ...candidate };
    }
    const leaf = fs.lstatSync(root, { bigint: true });
    const realRoot = fs.realpathSync.native(root);
    if (
      leaf.isSymbolicLink()
      || !leaf.isDirectory()
      || realRoot.replace(/\\/g, '/').toLowerCase()
        !== root.replace(/\\/g, '/').toLowerCase()
    ) {
      throw new Error('PROFILE_ROOT_LINKED_OR_INDIRECT');
    }
    rootBefore = {
      deviceId: String(leaf.dev),
      fileId: String(leaf.ino),
    };
    const descriptor = fs.openSync(probePath, 'wx', 0o600);
    probeCreated = true;
    try {
      fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const probeStat = fs.lstatSync(probePath, { bigint: true });
    if (
      probeStat.isSymbolicLink()
      || !probeStat.isFile()
      || probeStat.nlink !== 1n
    ) {
      throw new Error('PROFILE_PROBE_IDENTITY_CHANGED');
    }
    const source = Buffer.from(
      PACKAGE_UI_PROFILE_LOCK_PROBE_SOURCE,
      'utf8',
    ).toString('base64');
    const rootArgument = Buffer.from(root, 'utf8').toString('base64');
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'))`,
      'Add-Type -TypeDefinition $source -Language CSharp',
      `$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${rootArgument}'))`,
      `$result = [PackageUiProfileLockProbe]::Probe($root, ${probeLimits.maxEntries}, ${probeLimits.maxPathCharacters}, ${probeLimits.maxCriticalEntries}, ${PACKAGE_UI_PROFILE_LOCK_INTERNAL_DEADLINE_MS})`,
      '$result | ConvertTo-Json -Compress -Depth 8',
    ].join('; ');
    const run = options.run || spawnSync;
    const result = run('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: PACKAGE_UI_PROFILE_LOCK_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    if (
      result?.status !== 0
      || result?.error
      || typeof result?.stdout !== 'string'
      || !result.stdout.trim()
      || Buffer.byteLength(result.stdout, 'utf8') > 4 * 1024 * 1024
    ) {
      throw new Error(
        result?.error?.code === 'ETIMEDOUT'
          ? 'PROFILE_LOCK_HELPER_TIMEOUT'
          : 'PROFILE_LOCK_HELPER_FAILED',
      );
    }
    helper = JSON.parse(result.stdout.trim());
    if (
      helper?.method !== 'win32-createfile-share-none-stable-tree/v1'
      || helper?.rootPathSha256 !== binding.rootPathSha256
      || helper?.maxEntries !== probeLimits.maxEntries
      || helper?.maxPathCharacters !== probeLimits.maxPathCharacters
      || helper?.maxCriticalEntries !== probeLimits.maxCriticalEntries
      || helper?.maxDurationMilliseconds
        !== PACKAGE_UI_PROFILE_LOCK_INTERNAL_DEADLINE_MS
    ) {
      throw new Error('PROFILE_LOCK_HELPER_CONTRACT_MISMATCH');
    }
    if (helper.passed !== true) {
      unresolved.push({
        nativeCode: Number.isInteger(helper.errorNativeCode)
          ? helper.errorNativeCode
          : null,
        pathSha256: /^[A-F0-9]{64}$/.test(String(helper.errorPathSha256 || ''))
          ? helper.errorPathSha256
          : binding.rootPathSha256,
        reason: sanitizeDiagnosticText(
          helper.errorCode || 'PROFILE_LOCK_HELPER_UNRESOLVED',
          160,
        ),
      });
    }
  } catch (error) {
    unresolved.push({
      nativeCode: null,
      pathSha256: binding.rootPathSha256,
      reason: sanitizeDiagnosticText(error?.message || error, 160),
    });
  } finally {
    if (fs.existsSync(probePath)) {
      try {
        const probeStat = fs.lstatSync(probePath, { bigint: true });
        if (
          probeStat.isSymbolicLink()
          || !probeStat.isFile()
          || probeStat.nlink !== 1n
          || path.dirname(probePath).replace(/\\/g, '/').toLowerCase()
            !== root.replace(/\\/g, '/').toLowerCase()
        ) {
          throw new Error('PROFILE_PROBE_CLEANUP_IDENTITY_MISMATCH');
        }
        fs.unlinkSync(probePath);
      } catch (error) {
        unresolved.push({
          nativeCode: null,
          pathSha256: sha256Buffer(Buffer.from(probeName, 'utf8')),
          reason: sanitizeDiagnosticText(error?.message || error, 160),
        });
      }
    }
    probeRemoved = probeCreated && !fs.existsSync(probePath);
    try {
      const finalRoot = fs.lstatSync(root, { bigint: true });
      rootAfter = {
        deviceId: String(finalRoot.dev),
        fileId: String(finalRoot.ino),
      };
    } catch (error) {
      unresolved.push({
        nativeCode: null,
        pathSha256: binding.rootPathSha256,
        reason: sanitizeDiagnosticText(error?.message || error, 160),
      });
    }
  }
  const rootIdentityStable = rootBefore !== null
    && rootAfter !== null
    && canonicalJson(rootBefore) === canonicalJson(rootAfter);
  const closeFailures = Array.isArray(helper?.closeFailures)
    ? helper.closeFailures
    : [];
  const criticalEntries = Array.isArray(helper?.criticalEntries)
    ? helper.criticalEntries
    : [];
  const exclusiveOpen = {
    allEntriesHeld: helper?.allEntriesHeld === true,
    closeFailureCount: Number.isInteger(helper?.closeFailureCount)
      ? helper.closeFailureCount
      : null,
    closeFailures,
    directoryCount: Number.isInteger(helper?.directoryCount)
      ? helper.directoryCount
      : null,
    entryCount: Number.isInteger(helper?.entryCount)
      ? helper.entryCount
      : null,
    fileCount: Number.isInteger(helper?.fileCount)
      ? helper.fileCount
      : null,
    heldHandleCount: Number.isInteger(helper?.heldHandleCount)
      ? helper.heldHandleCount
      : null,
    method: helper?.method || 'win32-createfile-share-none-stable-tree/v1',
  };
  const tree = {
    attestationSha256: null,
    criticalEntries,
    criticalEntryCount: Number.isInteger(helper?.criticalEntryCount)
      ? helper.criticalEntryCount
      : null,
    identitySetSha256: helper?.identitySetSha256 || null,
    limits: {
      maxCriticalEntries: Number.isInteger(helper?.maxCriticalEntries)
        ? helper.maxCriticalEntries
        : probeLimits.maxCriticalEntries,
      maxEntries: Number.isInteger(helper?.maxEntries)
        ? helper.maxEntries
        : probeLimits.maxEntries,
      maxPathCharacters: Number.isInteger(helper?.maxPathCharacters)
        ? helper.maxPathCharacters
        : probeLimits.maxPathCharacters,
    },
    pathSetSha256: helper?.pathSetSha256 || null,
    secondSnapshotEntryCount: Number.isInteger(helper?.secondSnapshotEntryCount)
      ? helper.secondSnapshotEntryCount
      : null,
    totalPathCharacters: Number.isInteger(helper?.totalPathCharacters)
      ? helper.totalPathCharacters
      : null,
    treeStable: helper?.treeStable === true,
  };
  tree.attestationSha256 = envelopePayloadSha256({
    binding,
    criticalEntries: tree.criticalEntries,
    criticalEntryCount: tree.criticalEntryCount,
    directoryCount: exclusiveOpen.directoryCount,
    entryCount: exclusiveOpen.entryCount,
    fileCount: exclusiveOpen.fileCount,
    identitySetSha256: tree.identitySetSha256,
    pathSetSha256: tree.pathSetSha256,
    secondSnapshotEntryCount: tree.secondSnapshotEntryCount,
    totalPathCharacters: tree.totalPathCharacters,
  });
  const passed = helper?.passed === true
    && unresolved.length === 0
    && probeCreated
    && probeRemoved
    && rootIdentityStable
    && exclusiveOpen.allEntriesHeld
    && exclusiveOpen.closeFailureCount === 0
    && exclusiveOpen.heldHandleCount === exclusiveOpen.entryCount
    && tree.treeStable
    && tree.secondSnapshotEntryCount === exclusiveOpen.entryCount
    && tree.criticalEntryCount === tree.criticalEntries.length
    && tree.limits.maxCriticalEntries
      === PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES
    && tree.limits.maxEntries === PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES
    && tree.limits.maxPathCharacters
      === PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS;
  return {
    binding,
    claim: 'bounded-quiescent-exclusive-open-attestation',
    exclusiveOpen,
    exclusiveProbe: {
      created: probeCreated,
      removed: probeRemoved,
    },
    kind: 'package-ui-profile-lock-snapshot',
    observedAt,
    passed,
    rootIdentityStable,
    schemaVersion: 'package-ui-profile-lock-snapshot/v2',
    tree,
    unresolved,
    unresolvedCount: unresolved.length,
  };
}

  return {
    collectPackageUiProfileLockEvidence,
  };
};
