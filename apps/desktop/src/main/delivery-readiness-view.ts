export interface DeliveryReadinessGate {
  id?: string;
  name: string;
  status?: string;
  ok: boolean;
  evidencePath?: string | null;
  message?: string;
}

export interface DeliveryReadinessFailure {
  gateId: string;
  code: string;
  message: string;
  evidencePath: string | null;
}

export interface DeliveryReadinessView {
  available: boolean;
  path: string | null;
  exists: boolean;
  status: string;
  appReady: boolean;
  manifestDriven: boolean;
  previewOnly: boolean;
  generatedAt?: string;
  checkedAt?: string;
  gates: DeliveryReadinessGate[];
  failures: DeliveryReadinessFailure[];
  gatesSummary: {
    total: number;
    passed: number;
    failed: number;
  };
  missing: string[];
  actionItems: string[];
  recommendationReviewReasons: string[];
  reviewBlockers: string[];
  deliveryReviewReasons: string[];
  finalReadinessBlockers: string[];
  message?: string;
}

export interface CurrentDeliveryPackageEvidence {
  installerAvailable?: boolean;
  installerPath?: string;
  portablePath?: string;
  sha256?: string;
}

export interface DeliveryReadinessAuthority {
  currentPackage?: CurrentDeliveryPackageEvidence | null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeSha256(value: unknown): string | null {
  const hash = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-F0-9]{64}$/.test(hash) ? hash : null;
}

function packageAuthorityFailures(
  finalReadiness: any,
  filePath: string,
  currentPackage: CurrentDeliveryPackageEvidence,
): DeliveryReadinessFailure[] {
  const failures: DeliveryReadinessFailure[] = [];
  if (!currentPackage.installerAvailable || !currentPackage.installerPath) {
    failures.push({
      gateId: 'release-package-hash',
      code: 'CURRENT_INSTALLER_PACKAGE_MISSING',
      message: 'current installer package is missing',
      evidencePath: filePath,
    });
  }
  const currentHash = normalizeSha256(currentPackage.sha256);
  if (!currentPackage.portablePath || !currentHash) {
    failures.push({
      gateId: 'release-package-hash',
      code: 'CURRENT_PORTABLE_PACKAGE_MISSING',
      message: 'current portable package path or SHA-256 is missing',
      evidencePath: filePath,
    });
    return failures;
  }

  const installerVersion = currentPackage.installerPath
    ? /AmazonAIOpsAgent-([^-]+(?:\.[^-]+)*)\.exe$/i.exec(currentPackage.installerPath)?.[1]
    : undefined;
  const portableVersion = /AmazonAIOpsAgent-([^-]+(?:\.[^-]+)*)-portable\.exe$/i.exec(currentPackage.portablePath)?.[1];
  if (installerVersion && portableVersion && installerVersion !== portableVersion) {
    failures.push({
      gateId: 'release-package-hash',
      code: 'CURRENT_PACKAGE_VERSION_MISMATCH',
      message: `current installer version ${installerVersion} does not match portable version ${portableVersion}`,
      evidencePath: filePath,
    });
  }

  const indexedPortable = Array.isArray(finalReadiness?.packageIndex?.packages)
    ? finalReadiness.packageIndex.packages.find((item: any) => item?.kind === 'portable')
    : null;
  const records = [
    {
      gateId: 'release-package-hash',
      code: 'FINAL_READINESS_PORTABLE_HASH_MISMATCH',
      message: 'final-readiness portable SHA-256 does not match the current portable package',
      record: finalReadiness?.currentPortablePackage,
      evidencePath: filePath,
    },
    {
      gateId: 'release-package-hash',
      code: 'PACKAGE_INDEX_PORTABLE_HASH_MISMATCH',
      message: 'package index portable SHA-256 does not match the current portable package',
      record: indexedPortable,
      evidencePath: typeof finalReadiness?.packageIndex?.releaseDir === 'string'
        ? finalReadiness.packageIndex.releaseDir
        : filePath,
    },
    {
      gateId: 'package-launch-smoke',
      code: 'PACKAGE_SMOKE_PORTABLE_HASH_MISMATCH',
      message: 'package launch smoke portable SHA-256 does not match the current portable package',
      record: finalReadiness?.packageLaunchSmoke?.artifacts?.portable,
      evidencePath: typeof finalReadiness?.packageLaunchSmoke?.evidencePath === 'string'
        ? finalReadiness.packageLaunchSmoke.evidencePath
        : filePath,
    },
  ];

  return [...failures, ...records
    .filter(({ record }) => normalizeSha256(record?.sha256) !== currentHash)
    .map(({ gateId, code, message, evidencePath }) => ({
      gateId,
      code,
      message,
      evidencePath,
    }))];
}

function gateName(gateId: string): string {
  if (gateId === 'package-launch-smoke') return 'Package launch smoke';
  if (gateId === 'final-readiness') return 'Final readiness provenance';
  return 'Release package hash';
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

export function deliveryReadinessAllowsExport(readiness: DeliveryReadinessView): boolean {
  return readiness.available
    && readiness.exists
    && readiness.status === 'APP_READY'
    && readiness.appReady
    && readiness.manifestDriven
    && !readiness.previewOnly
    && readiness.gates.length > 0
    && readiness.gates.every((gate) => gate.ok)
    && readiness.failures.length === 0;
}

export function missingReadinessView(message: string, configuredPath: string | null): DeliveryReadinessView {
  return {
    available: false,
    path: configuredPath,
    exists: false,
    status: 'APP_NEEDS_WORK',
    appReady: false,
    manifestDriven: false,
    previewOnly: false,
    gates: [],
    failures: [],
    gatesSummary: { total: 0, passed: 0, failed: 0 },
    missing: ['最终验收 manifest 尚未生成'],
    actionItems: ['运行最终验收，生成 output/codex-evidence/final-readiness-*.json。'],
    recommendationReviewReasons: [],
    reviewBlockers: [],
    deliveryReviewReasons: [],
    finalReadinessBlockers: [],
    message,
  };
}

export function normalizeDeliveryReadiness(
  finalReadiness: any,
  filePath: string,
  authority: DeliveryReadinessAuthority = {},
): DeliveryReadinessView {
  const declaredGates: DeliveryReadinessGate[] = Array.isArray(finalReadiness?.gates)
    ? finalReadiness.gates.map((gate: any) => ({
        id: typeof gate?.id === 'string' ? gate.id : undefined,
        name: String(gate?.name || 'unknown_gate'),
        status: typeof gate?.status === 'string' ? gate.status : undefined,
        ok: Boolean(gate?.ok),
        evidencePath: typeof gate?.evidencePath === 'string' ? gate.evidencePath : null,
        message: typeof gate?.message === 'string' ? gate.message : undefined,
      }))
    : [];
  const declaredFailures: DeliveryReadinessFailure[] = Array.isArray(finalReadiness?.failures)
    ? finalReadiness.failures.map((failure: any) => ({
        gateId: String(failure?.gateId || ''),
        code: String(failure?.code || ''),
        message: typeof failure?.message === 'string' ? failure.message : '',
        evidencePath: typeof failure?.evidencePath === 'string' ? failure.evidencePath : null,
    }))
    : [];
  const previewOnly = finalReadiness?.previewOnly === true;
  const packageFailures = authority.currentPackage
    ? packageAuthorityFailures(finalReadiness, filePath, authority.currentPackage)
    : [];
  const authorityFailures: DeliveryReadinessFailure[] = [
    ...packageFailures,
    ...(previewOnly ? [{
      gateId: 'final-readiness',
      code: 'PREVIEW_ONLY_FINAL_READINESS',
      message: 'preview-only final readiness cannot authorize a production delivery export',
      evidencePath: filePath,
    }] : []),
  ];
  const authorityFailureByGate = new Map<string, DeliveryReadinessFailure>();
  for (const failure of authorityFailures) {
    if (!authorityFailureByGate.has(failure.gateId)) authorityFailureByGate.set(failure.gateId, failure);
  }
  const gates: DeliveryReadinessGate[] = declaredGates.map((gate) => {
    const authorityFailure = gate.id ? authorityFailureByGate.get(gate.id) : undefined;
    return authorityFailure
      ? { ...gate, status: 'needs_work', ok: false, message: authorityFailure.message }
      : gate;
  });
  for (const [gateId, failure] of authorityFailureByGate) {
    if (!gates.some((gate) => gate.id === gateId)) {
      gates.push({
        id: gateId,
        name: gateName(gateId),
        status: 'needs_work',
        ok: false,
        evidencePath: failure.evidencePath,
        message: failure.message,
      });
    }
  }
  const failures = [...declaredFailures, ...authorityFailures];
  const manifestDriven = finalReadiness?.evidenceSelection?.mode === 'manifest' || finalReadiness?.manifestDriven === true;
  const allGatesPass = gates.length > 0 && gates.every((gate) => gate.ok);
  const packageAuthorityCurrent = authorityFailures.length === 0;
  const appReady = manifestDriven
    && Boolean(finalReadiness?.appReady)
    && allGatesPass
    && packageAuthorityCurrent
    && !previewOnly
    && finalReadiness?.status === 'APP_READY';
  const failedGates = gates.filter((gate) => !gate.ok);
  const normalizedMissing = readStringList(finalReadiness?.missing);
  const normalizedActionItems = readStringList(finalReadiness?.actionItems);
  const authorityMessages = authorityFailures.map((failure) => failure.message);

  return {
    available: true,
    path: filePath,
    exists: true,
    status: authorityFailures.length > 0
      ? 'APP_NEEDS_WORK'
      : (appReady ? 'APP_READY' : String(finalReadiness?.status || 'APP_NEEDS_WORK')),
    appReady,
    manifestDriven,
    previewOnly,
    generatedAt: typeof finalReadiness?.generatedAt === 'string' ? finalReadiness.generatedAt : undefined,
    checkedAt: typeof finalReadiness?.checkedAt === 'string' ? finalReadiness.checkedAt : (
      typeof finalReadiness?.generatedAt === 'string' ? finalReadiness.generatedAt : undefined
    ),
    gates,
    failures,
    gatesSummary: {
      total: gates.length,
      passed: gates.filter((gate) => gate.ok).length,
      failed: failedGates.length,
    },
    missing: uniqueStrings([
      ...normalizedMissing,
      ...(normalizedMissing.length ? authorityMessages : failedGates.map((gate) => gate.message || `${gate.name} 未通过。`)),
    ]),
    actionItems: uniqueStrings([
      ...normalizedActionItems,
      ...(normalizedActionItems.length
        ? authorityMessages.map((message) => `${message}; rebuild, smoke and refresh final-readiness.`)
        : failedGates.map((gate) => gate.message || `补齐 ${gate.name} 的验收证据后重新运行最终验收。`)),
    ]),
    recommendationReviewReasons: readStringList(finalReadiness?.recommendationReviewReasons),
    reviewBlockers: readStringList(finalReadiness?.reviewBlockers),
    deliveryReviewReasons: readStringList(finalReadiness?.deliveryReviewReasons),
    finalReadinessBlockers: readStringList(finalReadiness?.finalReadinessBlockers),
  };
}
