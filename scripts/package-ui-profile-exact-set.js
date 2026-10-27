// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_WIDE_PROFILE,
    path,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const canonicalPackageUiArtifactBinding = (...args) => dependencies.canonicalPackageUiArtifactBinding(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const violation = (...args) => dependencies.violation(...args);

function exactPackageUiCollection(actual, expectedKeys, keyOf) {
  const observed = Array.isArray(actual) ? actual : [];
  const expected = new Set(expectedKeys);
  const counts = new Map();
  const invalid = [];
  for (const item of observed) {
    const key = keyOf(item);
    if (typeof key !== 'string' || key.length < 1) {
      invalid.push(key ?? null);
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count !== 1)
    .map(([key]) => key)
    .sort();
  const missing = [...expected]
    .filter((key) => !counts.has(key))
    .sort();
  const extra = [...counts.keys()]
    .filter((key) => !expected.has(key))
    .sort();
  return {
    actualLength: observed.length,
    duplicates,
    expectedLength: expectedKeys.length,
    extra,
    invalid,
    missing,
    passed: observed.length === expectedKeys.length
      && invalid.length === 0
      && duplicates.length === 0
      && missing.length === 0
      && extra.length === 0,
  };
}

function screenshotFileTuple(record) {
  return {
    path: normalizedWindowsPath(record?.path || ''),
    sha256: record?.sha256 ?? null,
    sizeBytes: record?.sizeBytes ?? null,
  };
}

function validateCurrentProfileExactSet(run, expected) {
  const violations = [];
  const expectedWorkspaceKeys = expected.workspaces.map(
    (item) => `${item.workspace}/${item.subview}`,
  );
  const expectedSubviewKeys = expected.subviews.map(
    (item) => `${item.workspace}/${item.subview}`,
  );
  const workspaceChecks = exactPackageUiCollection(
    run?.workspaceChecks,
    expectedWorkspaceKeys,
    (item) => `${item?.workspace || ''}/${item?.subview || ''}`,
  );
  const workspaceScreenshots = exactPackageUiCollection(
    run?.screenshots,
    expectedWorkspaceKeys,
    (item) => `${item?.workspace || ''}/${item?.subview || ''}`,
  );
  const subviewChecks = exactPackageUiCollection(
    run?.subviewChecks || [],
    expectedSubviewKeys,
    (item) => `${item?.workspace || ''}/${item?.subview || ''}`,
  );
  const overlayChecks = exactPackageUiCollection(
    run?.overlayChecks || [],
    expected.overlays,
    (item) => String(item?.id || ''),
  );
  for (const [name, result] of [
    ['workspaceChecks', workspaceChecks],
    ['screenshots', workspaceScreenshots],
    ['subviewChecks', subviewChecks],
    ['overlayChecks', overlayChecks],
  ]) {
    if (!result.passed) {
      violations.push(violation(
        `V9_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}_NOT_EXACT`,
        `Schema v9 ${name} must equal its canonical set with no missing, duplicate, or extra entries.`,
        result,
      ));
    }
  }
  let binding = null;
  try {
    binding = canonicalPackageUiArtifactBinding(run);
  } catch (error) {
    violations.push(violation(
      'V9_PROFILE_EVIDENCE_BINDING_INVALID',
      'Schema v9 profile evidence must bind one exact attempt, invocation, profile, scale, run group, and runner contract.',
      sanitizeDiagnosticText(error?.message || error),
    ));
  }
  if (
    binding
    && (
      binding.profileId !== expected.profileId
      || binding.scalePercent !== expected.scalePercent
      || binding.runGroupId !== expected.runGroupId
      || binding.runnerContractSha256 !== expected.runnerContractSha256
      || run?.profileId !== expected.profileId
      || canonicalJson(run?.evidenceBinding?.profileLockBinding)
        !== canonicalJson(run?.profileLockIsolation?.before?.binding)
      || run?.evidenceBinding?.profileLockBinding?.profileId
        !== expected.profileId
      || run?.evidenceBinding?.profileLockBinding?.invocationIdSha256
        !== sha256Buffer(Buffer.from(binding.invocationId, 'utf8'))
      || (
        expected.profileRootPathSha256 != null
        && run?.evidenceBinding?.profileLockBinding?.rootPathSha256
          !== expected.profileRootPathSha256
      )
    )
  ) {
    violations.push(violation(
      'V9_PROFILE_EVIDENCE_BINDING_MISMATCH',
      'Schema v9 profile evidence binding does not match its canonical profile/scale/run-group/lock lineage.',
      {
        actual: run?.evidenceBinding ?? null,
        expected: {
          profileId: expected.profileId,
          profileRootPathSha256: expected.profileRootPathSha256,
          runGroupId: expected.runGroupId,
          runnerContractSha256: expected.runnerContractSha256,
          scalePercent: expected.scalePercent,
        },
      },
    ));
  }
  if (
    run?.passed !== true
    || run?.failure !== null
    || run?.diagnostics?.failure !== null
  ) {
    violations.push(violation(
      'V9_PROFILE_OUTCOME_NOT_EXACT_SUCCESS',
      'A composed schema v9 profile must be a successful run with failure exactly null.',
      {
        diagnosticsFailure: run?.diagnostics?.failure ?? null,
        failure: run?.failure ?? null,
        passed: run?.passed ?? null,
      },
    ));
  }
  if (binding && run?.attemptArtifacts?.rootPath) {
    const attemptRoot = path.resolve(run.attemptArtifacts.rootPath);
    const expectedLeafSuffix = `-${binding.attemptId}`;
    if (
      path.basename(path.dirname(attemptRoot)).toLowerCase()
        !== binding.profileId.toLowerCase()
      || !path.basename(attemptRoot).endsWith(expectedLeafSuffix)
      || !/^\d{4}-/.test(path.basename(attemptRoot))
    ) {
      violations.push(violation(
        'V9_ATTEMPT_ARTIFACT_ROOT_BINDING_MISMATCH',
        'Schema v9 attempt artifacts must be rooted under their exact profile and attempt id.',
        {
          attemptRootSha256: sha256Buffer(Buffer.from(
            normalizedWindowsPath(attemptRoot),
            'utf8',
          )),
          profileId: binding.profileId,
        },
      ));
    }
  }
  const allScreenshotSlots = [];
  const workspaceByKey = new Map((run?.screenshots || []).map(
    (record) => [`${record?.workspace || ''}/${record?.subview || ''}`, record],
  ));
  for (const check of run?.workspaceChecks || []) {
    const key = `${check?.workspace || ''}/${check?.subview || ''}`;
    const primary = workspaceByKey.get(key);
    if (
      !primary
      || canonicalJson(screenshotFileTuple(primary))
        !== canonicalJson(screenshotFileTuple(check?.screenshot))
    ) {
      violations.push(violation(
        'V9_WORKSPACE_SCREENSHOT_BINDING_MISMATCH',
        'Each workspace check must bind the one canonical top-level screenshot for the same workspace/subview.',
        key,
      ));
    }
  }
  for (const record of run?.screenshots || []) {
    allScreenshotSlots.push({
      path: record?.path,
      slot: `workspace:${record?.workspace}/${record?.subview}`,
    });
    if (
      expected.profileId === PACKAGE_UI_WIDE_PROFILE.id
        ? record?.profileId !== expected.profileId
        : record?.scalePercent !== expected.scalePercent
    ) {
      violations.push(violation(
        'V9_WORKSPACE_SCREENSHOT_PROFILE_BINDING_MISMATCH',
        'Workspace screenshot metadata must match its exact profile/scale.',
        { profileId: record?.profileId ?? null, scalePercent: record?.scalePercent ?? null },
      ));
    }
  }
  for (const check of run?.subviewChecks || []) {
    allScreenshotSlots.push({
      path: check?.screenshot?.path,
      slot: `subview:${check?.workspace}/${check?.subview}`,
    });
    if (check?.screenshot?.scalePercent !== expected.scalePercent) {
      violations.push(violation(
        'V9_SUBVIEW_SCREENSHOT_PROFILE_BINDING_MISMATCH',
        'Subview screenshot metadata must match its exact compact scale.',
        check?.screenshot ?? null,
      ));
    }
  }
  for (const check of run?.overlayChecks || []) {
    allScreenshotSlots.push({
      path: check?.screenshot?.path,
      slot: `overlay:${check?.id}`,
    });
    if (
      check?.screenshot?.overlayId !== check?.id
      || check?.screenshot?.scalePercent !== expected.scalePercent
    ) {
      violations.push(violation(
        'V9_OVERLAY_SCREENSHOT_BINDING_MISMATCH',
        'Overlay screenshot metadata must match its exact overlay id and compact scale.',
        check?.screenshot ?? null,
      ));
    }
  }
  for (const screenshot of run?.minimumWindow?.screenshots || []) {
    allScreenshotSlots.push({ path: screenshot?.path, slot: `minimum:${screenshot?.workspace}/${screenshot?.subview}` });
  }
  const screenshotPathSlots = new Map();
  for (const item of allScreenshotSlots) {
    if (!path.isAbsolute(String(item.path || ''))) {
      violations.push(violation(
        'V9_SCREENSHOT_PATH_INVALID',
        'Every schema v9 screenshot slot must use one absolute artifact path.',
        item.slot,
      ));
      continue;
    }
    const key = normalizedWindowsPath(item.path);
    if (screenshotPathSlots.has(key)) {
      violations.push(violation(
        'V9_SCREENSHOT_PATH_REUSED',
        'One screenshot path cannot satisfy multiple schema v9 semantic slots.',
        {
          first: screenshotPathSlots.get(key),
          second: item.slot,
        },
      ));
      continue;
    }
    screenshotPathSlots.set(key, item.slot);
  }
  return {
    passed: violations.length === 0,
    violations,
  };
}

  return {
    exactPackageUiCollection,
    screenshotFileTuple,
    validateCurrentProfileExactSet,
  };
};
