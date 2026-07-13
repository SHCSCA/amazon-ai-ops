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

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
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

export function normalizeDeliveryReadiness(finalReadiness: any, filePath: string): DeliveryReadinessView {
  const gates: DeliveryReadinessGate[] = Array.isArray(finalReadiness?.gates)
    ? finalReadiness.gates.map((gate: any) => ({
        id: typeof gate?.id === 'string' ? gate.id : undefined,
        name: String(gate?.name || 'unknown_gate'),
        status: typeof gate?.status === 'string' ? gate.status : undefined,
        ok: Boolean(gate?.ok),
        evidencePath: typeof gate?.evidencePath === 'string' ? gate.evidencePath : null,
        message: typeof gate?.message === 'string' ? gate.message : undefined,
      }))
    : [];
  const failures: DeliveryReadinessFailure[] = Array.isArray(finalReadiness?.failures)
    ? finalReadiness.failures.map((failure: any) => ({
        gateId: String(failure?.gateId || ''),
        code: String(failure?.code || ''),
        message: typeof failure?.message === 'string' ? failure.message : '',
        evidencePath: typeof failure?.evidencePath === 'string' ? failure.evidencePath : null,
      }))
    : [];
  const manifestDriven = finalReadiness?.evidenceSelection?.mode === 'manifest' || finalReadiness?.manifestDriven === true;
  const allGatesPass = gates.length > 0 && gates.every((gate) => gate.ok);
  const appReady = manifestDriven && Boolean(finalReadiness?.appReady) && allGatesPass && finalReadiness?.status === 'APP_READY';
  const failedGates = gates.filter((gate) => !gate.ok);
  const normalizedMissing = readStringList(finalReadiness?.missing);
  const normalizedActionItems = readStringList(finalReadiness?.actionItems);

  return {
    available: true,
    path: filePath,
    exists: true,
    status: appReady ? 'APP_READY' : String(finalReadiness?.status || 'APP_NEEDS_WORK'),
    appReady,
    manifestDriven,
    previewOnly: finalReadiness?.previewOnly === true,
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
    missing: normalizedMissing.length
      ? normalizedMissing
      : failedGates.map((gate) => gate.message || `${gate.name} 未通过。`),
    actionItems: normalizedActionItems.length
      ? normalizedActionItems
      : failedGates.map((gate) => gate.message || `补齐 ${gate.name} 的验收证据后重新运行最终验收。`),
    recommendationReviewReasons: readStringList(finalReadiness?.recommendationReviewReasons),
    reviewBlockers: readStringList(finalReadiness?.reviewBlockers),
    deliveryReviewReasons: readStringList(finalReadiness?.deliveryReviewReasons),
    finalReadinessBlockers: readStringList(finalReadiness?.finalReadinessBlockers),
  };
}
