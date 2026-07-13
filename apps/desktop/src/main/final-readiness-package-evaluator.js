const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GATE_IDS = Object.freeze({
  'Report collection delivery': 'report-collection-delivery',
  'Lingxing Listing full read': 'lingxing-listing-full-read',
  'AI live provider': 'ai-live-provider',
  'Ad recommendation AI explanation': 'ad-recommendation-ai-explanation',
  'Listing AI draft': 'listing-ai-draft',
  'Real ad execution readback': 'real-ad-execution-readback',
  'Release package hash': 'release-package-hash',
  'Package launch smoke': 'package-launch-smoke',
});

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function latestReleasePackageFiles(releaseDir) {
  if (!releaseDir || !fs.existsSync(releaseDir)) return [];
  const files = fs.readdirSync(releaseDir)
    .filter((name) => /^AmazonAIOpsAgent-.*\.exe$/i.test(name))
    .map((name) => path.join(releaseDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const portable = files.find((filePath) => /portable/i.test(path.basename(filePath)));
  const installer = files.find((filePath) => !/portable/i.test(path.basename(filePath)));
  return [
    installer ? { kind: 'installer', filePath: installer } : null,
    portable ? { kind: 'portable', filePath: portable } : null,
  ].filter(Boolean);
}

function collectPackageIndex(releaseDir) {
  const resolvedReleaseDir = typeof releaseDir === 'string' && releaseDir.trim()
    ? path.resolve(releaseDir)
    : '';
  let packageEntries = [];
  let error = null;
  if (resolvedReleaseDir && fs.existsSync(resolvedReleaseDir)) {
    try {
      if (!fs.statSync(resolvedReleaseDir).isDirectory()) {
        error = {
          code: 'PACKAGE_RELEASE_DIR_NOT_DIRECTORY',
          message: 'releaseDir exists but is not a directory',
        };
      } else {
        packageEntries = latestReleasePackageFiles(resolvedReleaseDir);
      }
    } catch (readError) {
      error = {
        code: 'PACKAGE_RELEASE_DIR_UNREADABLE',
        message: readError instanceof Error ? readError.message : String(readError),
      };
    }
  }
  const packages = packageEntries.map((entry) => {
    const stat = fs.statSync(entry.filePath);
    return {
      kind: entry.kind,
      sourcePath: path.resolve(entry.filePath),
      fileName: path.basename(entry.filePath),
      exists: true,
      sizeBytes: stat.size,
      sha256: sha256(entry.filePath),
      modifiedAt: stat.mtime.toISOString(),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    present: packages.length > 0,
    count: packages.length,
    existingCount: packages.filter((item) => item.exists).length,
    missingCount: packages.filter((item) => !item.exists).length,
    releaseDir: resolvedReleaseDir || null,
    error,
    copyPolicy: 'Installer and portable EXE binaries are not copied into readiness evidence; this index records local paths, existence, size, and SHA-256.',
    packages,
  };
}

function currentArtifact(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { exists: false, path: filePath || null, sizeBytes: 0, sha256: null };
  }
  const stat = fs.statSync(filePath);
  return {
    exists: true,
    path: path.resolve(filePath),
    sizeBytes: stat.size,
    sha256: sha256(filePath),
  };
}

function collectPackageLaunchSmoke(filePath, selectedBy) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      present: false,
      evidencePath: filePath || null,
      selectedBy,
      smoke: null,
      currentArtifacts: null,
      readError: null,
    };
  }
  try {
    const smoke = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      present: true,
      evidencePath: path.resolve(filePath),
      selectedBy,
      smoke,
      currentArtifacts: {
        unpacked: currentArtifact(smoke.artifacts?.unpacked?.path),
        portable: currentArtifact(smoke.artifacts?.portable?.path),
      },
      readError: null,
    };
  } catch (error) {
    return {
      present: true,
      evidencePath: path.resolve(filePath),
      selectedBy,
      smoke: null,
      currentArtifacts: null,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function makeGate(id, name, ok, evidencePath, message, status = ok ? 'passed' : 'needs_work') {
  return { id, name, status, ok, evidencePath, message };
}

function packageFailure(gateId, code, message, evidencePath) {
  return { gateId, code, message, evidencePath: evidencePath || null };
}

function recordedArtifactIsCurrent(recorded, current) {
  return Boolean(
    recorded
      && typeof recorded.path === 'string'
      && recorded.path.trim()
      && current?.exists
      && path.resolve(recorded.path) === path.resolve(current.path)
      && Number(recorded.sizeBytes || 0) > 0
      && Number(recorded.sizeBytes) === Number(current.sizeBytes)
      && /^[A-F0-9]{64}$/.test(String(recorded.sha256 || '').toUpperCase())
      && String(recorded.sha256).toUpperCase() === String(current.sha256 || '').toUpperCase(),
  );
}

function evaluatePackageReadiness({ packageIndex, selectedSmoke }) {
  const failures = [];
  let packageGate;
  const installer = packageIndex.packages?.find((item) => item.kind === 'installer');
  const currentPortablePackage = packageIndex.packages?.find((item) => item.kind === 'portable') || null;

  if (packageIndex.error) {
    const message = packageIndex.error.message || 'release package directory could not be read';
    packageGate = makeGate('release-package-hash', 'Release package hash', false, packageIndex.releaseDir, message);
    failures.push(packageFailure(packageGate.id, packageIndex.error.code || 'PACKAGE_RELEASE_DIR_UNREADABLE', message, packageGate.evidencePath));
  } else if (!packageIndex.present || packageIndex.count <= 0) {
    const message = 'installer/package hash evidence is missing';
    packageGate = makeGate('release-package-hash', 'Release package hash', false, packageIndex.releaseDir, message, 'missing');
    failures.push(packageFailure(packageGate.id, 'PACKAGE_INDEX_MISSING', message, packageGate.evidencePath));
  } else if (!installer) {
    const message = 'installer package hash evidence is missing';
    packageGate = makeGate('release-package-hash', 'Release package hash', false, packageIndex.releaseDir, message);
    failures.push(packageFailure(packageGate.id, 'INSTALLER_PACKAGE_MISSING', message, packageGate.evidencePath));
  } else if (!currentPortablePackage) {
    const message = 'portable no-install package hash evidence is missing';
    packageGate = makeGate('release-package-hash', 'Release package hash', false, packageIndex.releaseDir, message);
    failures.push(packageFailure(packageGate.id, 'PORTABLE_PACKAGE_MISSING', message, packageGate.evidencePath));
  } else if (packageIndex.missingCount > 0) {
    const message = 'installer/package hash index contains missing files';
    packageGate = makeGate('release-package-hash', 'Release package hash', false, packageIndex.releaseDir, message);
    failures.push(packageFailure(packageGate.id, 'PACKAGE_INDEX_INCOMPLETE', message, packageGate.evidencePath));
  } else {
    packageGate = makeGate(
      'release-package-hash',
      'Release package hash',
      true,
      packageIndex.releaseDir,
      `${packageIndex.count} release package artifacts indexed with SHA-256.`,
    );
  }

  let smokeGate;
  let packageLaunchSmoke;
  if (!selectedSmoke.present) {
    const message = 'package launch smoke evidence is missing';
    smokeGate = makeGate('package-launch-smoke', 'Package launch smoke', false, selectedSmoke.evidencePath, message, 'missing');
    failures.push(packageFailure(smokeGate.id, 'PACKAGE_SMOKE_MISSING', message, smokeGate.evidencePath));
    packageLaunchSmoke = {
      present: false,
      evidencePath: selectedSmoke.evidencePath,
      selectedBy: selectedSmoke.selectedBy,
      passed: false,
      artifacts: null,
      checks: [],
    };
  } else if (selectedSmoke.readError || !selectedSmoke.smoke) {
    const message = `package launch smoke could not be read: ${selectedSmoke.readError || 'invalid evidence'}`;
    smokeGate = makeGate('package-launch-smoke', 'Package launch smoke', false, selectedSmoke.evidencePath, message);
    failures.push(packageFailure(smokeGate.id, 'PACKAGE_SMOKE_UNREADABLE', message, smokeGate.evidencePath));
    packageLaunchSmoke = {
      present: true,
      evidencePath: selectedSmoke.evidencePath,
      selectedBy: selectedSmoke.selectedBy,
      passed: false,
      artifacts: null,
      checks: [],
    };
  } else {
    const smoke = selectedSmoke.smoke;
    const checks = Array.isArray(smoke.checks) ? smoke.checks : [];
    const unpacked = smoke.artifacts?.unpacked;
    const portable = smoke.artifacts?.portable;
    const hasCheck = (kind) => checks.some((item) => item?.kind === kind && item.ok === true);
    const artifactsCurrent = recordedArtifactIsCurrent(unpacked, selectedSmoke.currentArtifacts?.unpacked)
      && recordedArtifactIsCurrent(portable, selectedSmoke.currentArtifacts?.portable);
    const smokeStructurallyCurrent = smoke.kind === 'package-launch-smoke'
      && smoke.passed === true
      && artifactsCurrent
      && hasCheck('win-unpacked')
      && hasCheck('portable');
    const portableMatchesPackage = Boolean(
      currentPortablePackage
        && portable
        && typeof portable.path === 'string'
        && portable.path.trim()
        && path.resolve(portable.path) === path.resolve(currentPortablePackage.sourcePath)
        && Number(portable.sizeBytes || 0) === Number(currentPortablePackage.sizeBytes || 0)
        && String(portable.sha256 || '').toUpperCase() === String(currentPortablePackage.sha256 || '').toUpperCase(),
    );
    if (!smokeStructurallyCurrent) {
      failures.push(packageFailure(
        'package-launch-smoke',
        'PACKAGE_SMOKE_STALE',
        'package launch smoke is stale or incomplete',
        selectedSmoke.evidencePath,
      ));
    }
    if (currentPortablePackage && !portableMatchesPackage) {
      failures.push(packageFailure(
        'package-launch-smoke',
        'PACKAGE_SMOKE_PORTABLE_HASH_MISMATCH',
        'package launch smoke does not match the current portable package SHA-256',
        selectedSmoke.evidencePath,
      ));
    }
    const ok = smokeStructurallyCurrent && portableMatchesPackage;
    smokeGate = makeGate(
      'package-launch-smoke',
      'Package launch smoke',
      ok,
      selectedSmoke.evidencePath,
      ok
        ? 'win-unpacked and no-install portable launch smoke passed with current portable hash.'
        : 'package launch smoke is stale, incomplete, or does not match the current portable package hash',
    );
    packageLaunchSmoke = {
      present: true,
      evidencePath: selectedSmoke.evidencePath,
      selectedBy: selectedSmoke.selectedBy,
      generatedAt: smoke.generatedAt,
      passed: smoke.passed === true,
      artifacts: {
        unpacked: unpacked ? { path: unpacked.path, sizeBytes: unpacked.sizeBytes, sha256: unpacked.sha256 } : null,
        portable: portable ? { path: portable.path, sizeBytes: portable.sizeBytes, sha256: portable.sha256 } : null,
      },
      checks: checks.map((item) => ({
        kind: item.kind,
        ok: item.ok,
        marker: item.marker,
        appChildCount: item.appChildCount,
      })),
    };
  }

  return {
    gates: [packageGate, smokeGate],
    failures,
    packageIndex,
    currentPortablePackage,
    packageLaunchSmoke,
  };
}

function evaluatePackageReadinessFromFiles({ releaseDir, packageLaunchSmokePath, selectedBy = 'latest-evidence' }) {
  return evaluatePackageReadiness({
    packageIndex: collectPackageIndex(releaseDir),
    selectedSmoke: collectPackageLaunchSmoke(packageLaunchSmokePath, selectedBy),
  });
}

function gateWithStableId(gate) {
  return { ...gate, id: gate.id || GATE_IDS[gate.name] || `unknown-${String(gate.name || 'gate').toLowerCase().replace(/[^a-z0-9]+/g, '-')}` };
}

function evaluateReadinessContract({ businessGates, packageEvaluation, manifestDriven }) {
  const normalizedBusinessGates = businessGates.map(gateWithStableId);
  const gates = [...normalizedBusinessGates, ...packageEvaluation.gates.map(gateWithStableId)];
  const businessFailures = normalizedBusinessGates
    .filter((gate) => !gate.ok)
    .map((gate) => packageFailure(gate.id, 'GATE_FAILED', gate.message || `${gate.name} did not pass`, gate.evidencePath));
  const allGatesPass = gates.every((gate) => gate.ok);
  return {
    gates,
    failures: [...businessFailures, ...packageEvaluation.failures],
    allGatesPass,
    appReady: Boolean(manifestDriven && allGatesPass),
    packageIndex: packageEvaluation.packageIndex,
    currentPortablePackage: packageEvaluation.currentPortablePackage,
    packageLaunchSmoke: packageEvaluation.packageLaunchSmoke,
  };
}

module.exports = {
  GATE_IDS,
  collectPackageIndex,
  collectPackageLaunchSmoke,
  evaluatePackageReadiness,
  evaluatePackageReadinessFromFiles,
  evaluateReadinessContract,
};
