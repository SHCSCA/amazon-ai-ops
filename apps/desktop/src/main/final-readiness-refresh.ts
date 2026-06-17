import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { verifyAdReadbackEvidenceFile } from './ad-readback-evidence-verifier';

export interface RefreshFinalReadinessInput {
  repoRootDir: string;
  evidenceDir: string;
  releaseDir: string;
  appVersion: string;
  adReadbackPath?: string;
}

export interface RefreshedFinalReadiness {
  evidenceManifestPath: string;
  finalReadinessPath: string;
  status: string;
  appReady: boolean;
  manifestDriven: boolean;
  gates: Array<{ name: string; status: string; ok: boolean; evidencePath?: string | null; message?: string; safetyFailClosed?: boolean }>;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestEvidence(evidenceDir: string, pattern: RegExp): string | null {
  if (!fs.existsSync(evidenceDir)) return null;
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function containsObviousSecret(value: unknown): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return /sk-[A-Za-z0-9_-]{16,}/.test(text)
    || /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(text)
    || /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i.test(text);
}

function relativePath(repoRootDir: string, filePath: string | null): string | null {
  if (!filePath) return null;
  return path.relative(repoRootDir, path.resolve(filePath)).replace(/\\/g, '/');
}

function evidenceEntry(repoRootDir: string, label: string, selected: string | null, selectedBy: string) {
  return {
    label,
    path: relativePath(repoRootDir, selected),
    absolutePath: selected ? path.resolve(selected) : null,
    exists: Boolean(selected && fs.existsSync(selected)),
    selectedBy,
    requiredForAppReady: true,
  };
}

function gate(name: string, ok: boolean, evidencePath: string | null, message: string, status = ok ? 'passed' : 'needs_work') {
  return { name, status, ok, evidencePath, message };
}

function checkReportCollection(evidencePath: string | null) {
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return gate('Report collection delivery', false, evidencePath, 'missing report collection evidence', 'missing');
  }
  try {
    const evidence = readJson(evidencePath);
    const full8 = Array.isArray(evidence.steps) ? evidence.steps.find((step: any) => step?.label === 'full8') : null;
    const ok = evidence.kind === 'desktop-live-full-8-e2e'
      && evidence.safety?.full8Started === true
      && evidence.safety?.adWriteActionsPerformed === false
      && Array.isArray(evidence.errors)
      && evidence.errors.length === 0
      && Number(full8?.downloaded || 0) === 8
      && Number(full8?.failed || 0) === 0;
    return gate(
      'Report collection delivery',
      ok,
      evidencePath,
      ok ? 'full-8 Lingxing report collection evidence passed internal checks' : 'full-8 report collection evidence is incomplete',
    );
  } catch (error) {
    return gate('Report collection delivery', false, evidencePath, `report collection evidence cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkListingRead(evidencePath: string | null) {
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return gate('Lingxing Listing full read', false, evidencePath, 'missing Listing read evidence', 'missing');
  }
  try {
    const evidence = readJson(evidencePath);
    const result = evidence.listingRead || {};
    const listing = result.listing || {};
    const completeness = result.evidence?.completeness || {};
    const ok = evidence.safety?.listingReadOnly === true
      && evidence.safety?.adWriteActionsPerformed === false
      && Array.isArray(evidence.errors)
      && evidence.errors.length === 0
      && result.ready === true
      && (result.fullContentReady === true || result.evidence?.fullContentReady === true)
      && /^B0[A-Z0-9]{8}$/i.test(String(listing.asin || ''))
      && typeof listing.title === 'string'
      && listing.title.trim().length >= 5
      && Array.isArray(listing.bullets)
      && listing.bullets.length > 0
      && typeof listing.backendTerms === 'string'
      && listing.backendTerms.trim().length > 0
      && Boolean(completeness.asin && completeness.title && completeness.bullets && completeness.backendTerms);
    return gate('Lingxing Listing full read', ok, evidencePath, ok ? 'Listing full-content read evidence passed internal checks' : 'Listing read evidence is partial or incomplete');
  } catch (error) {
    return gate('Lingxing Listing full read', false, evidencePath, `Listing read evidence cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkAiLive(evidencePath: string | null) {
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return gate('AI live provider', false, evidencePath, 'missing AI live evidence', 'missing');
  }
  try {
    const evidence = readJson(evidencePath);
    const ok = evidence.readinessImpact !== 'NO_FINAL_READINESS_CREDIT'
      && evidence.kind !== 'ai-openai-compatible-structural-mock'
      && evidence.status === 'PASS'
      && evidence.keyPresent === true
      && evidence.success === true
      && !containsObviousSecret(evidence);
    return gate('AI live provider', ok, evidencePath, ok ? `AI live passed for ${evidence.model || 'provider'}` : 'AI live evidence is missing PASS status, real key proof, success, or redaction');
  } catch (error) {
    return gate('AI live provider', false, evidencePath, `AI live evidence cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkAdAiExplanation(evidencePath: string | null) {
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return gate('Ad recommendation AI explanation', false, evidencePath, 'missing ad AI explanation evidence', 'missing');
  }
  try {
    const evidence = readJson(evidencePath);
    const ok = ['ad-ai-explanation', 'installed-ad-ai-explanation'].includes(evidence.kind)
      && evidence.status === 'PASS'
      && evidence.readinessImpact !== 'NO_FINAL_READINESS_CREDIT'
      && evidence.runtimeMode === 'packaged-app'
      && evidence.safety?.adWriteActionsPerformed === false
      && evidence.safety?.adAiExplanationOnly === true
      && evidence.ai?.keyPresent === true
      && evidence.ai?.status === 'PASS'
      && Number(evidence.generation?.validAiExplainedRecommendations || 0) > 0
      && !containsObviousSecret(evidence);
    return gate('Ad recommendation AI explanation', ok, evidencePath, ok ? 'packaged ad AI explanation evidence passed internal checks' : 'ad AI explanation evidence is incomplete or not packaged-app PASS evidence');
  } catch (error) {
    return gate('Ad recommendation AI explanation', false, evidencePath, `ad AI explanation evidence cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkListingAiDraft(evidencePath: string | null) {
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return gate('Listing AI draft', false, evidencePath, 'missing Listing AI draft evidence', 'missing');
  }
  try {
    const evidence = readJson(evidencePath);
    const drafts = Array.isArray(evidence.listingAiDraft?.drafts) ? evidence.listingAiDraft.drafts : [];
    const aiDrafts = drafts.filter((draft: any) => draft.source === 'ai' && draft.hasFallback === false && draft.evidenceHasAiReason === true);
    const ok = evidence.kind === 'installed-listing-ai-draft'
      && evidence.safety?.adWriteActionsPerformed === false
      && evidence.safety?.full8Started === false
      && evidence.safety?.listingAiDraftOnly === true
      && Array.isArray(evidence.errors)
      && evidence.errors.length === 0
      && evidence.ai?.keyPresent === true
      && evidence.ai?.testSuccess === true
      && evidence.ai?.status === 'PASS'
      && aiDrafts.length > 0
      && !containsObviousSecret(evidence);
    return gate('Listing AI draft', ok, evidencePath, ok ? 'Listing AI draft evidence passed internal checks' : 'Listing AI draft evidence is incomplete');
  } catch (error) {
    return gate('Listing AI draft', false, evidencePath, `Listing AI draft evidence cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkAdExecutionReadback(evidencePath: string | null) {
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return {
      ...gate('Real ad execution readback', false, evidencePath, 'real before/after/readback evidence is missing', 'needs_work'),
      safetyFailClosed: true,
    };
  }
  const result = verifyAdReadbackEvidenceFile(evidencePath);
  return {
    ...gate(
      'Real ad execution readback',
      result.ready,
      evidencePath,
      result.ready ? 'real ad execution readback evidence passed' : result.issues.slice(-3).join('\n'),
    ),
    safetyFailClosed: true,
  };
}

function latestReleasePackageFiles(releaseDir: string) {
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
  ].filter(Boolean) as Array<{ kind: string; filePath: string }>;
}

function buildPackageIndex(releaseDir: string) {
  const packages = latestReleasePackageFiles(releaseDir).map((entry) => {
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
    releaseDir,
    copyPolicy: 'Installer and portable EXE binaries are not copied into readiness evidence; this index records local paths, existence, size, and SHA-256.',
    packages,
  };
}

function checkReleasePackageHash(packageIndex: any) {
  const hasInstaller = packageIndex.packages?.some((item: any) => item.kind === 'installer');
  const hasPortable = packageIndex.packages?.some((item: any) => item.kind === 'portable');
  const ok = packageIndex.present && hasInstaller && hasPortable && packageIndex.missingCount === 0;
  return gate('Release package hash', ok, packageIndex.releaseDir, ok ? `${packageIndex.count} release package artifacts indexed with SHA-256.` : 'installer and portable package hash evidence is incomplete', ok ? 'passed' : 'needs_work');
}

function selectAdReadbackEvidence(evidenceDir: string, explicitPath?: string): { filePath: string | null; selectedBy: string } {
  if (explicitPath && explicitPath.trim()) {
    return { filePath: path.resolve(explicitPath), selectedBy: 'explicit-arg' };
  }
  const currentCandidate = path.join(evidenceDir, 'real-ad-execution-readback-candidate-rec-4-current.json');
  if (fs.existsSync(currentCandidate)) {
    return { filePath: currentCandidate, selectedBy: 'current-candidate' };
  }
  return {
    filePath: latestEvidence(evidenceDir, /^real-ad-execution-readback-.*\.json$/i),
    selectedBy: 'latest-evidence',
  };
}

export function refreshFinalReadiness(input: RefreshFinalReadinessInput): RefreshedFinalReadiness {
  fs.mkdirSync(input.evidenceDir, { recursive: true });
  const stamp = Date.now();
  const selectedAdReadback = selectAdReadbackEvidence(input.evidenceDir, input.adReadbackPath);
  const selected = {
    delivery: { filePath: latestEvidence(input.evidenceDir, /^desktop-live-full-8-e2e-.*\.json$/i), selectedBy: 'latest-evidence' },
    listingRead: { filePath: latestEvidence(input.evidenceDir, /^(source-listing-read-detail-probe|installed-listing-read).*\.json$/i), selectedBy: 'latest-evidence' },
    aiLive: { filePath: latestEvidence(input.evidenceDir, /^deepseek-live-.*\.json$/i), selectedBy: 'latest-evidence' },
    adAiExplanation: { filePath: latestEvidence(input.evidenceDir, /^(installed-)?ad-ai-explanation-.*\.json$/i), selectedBy: 'latest-evidence' },
    listingAiDraft: { filePath: latestEvidence(input.evidenceDir, /^(installed-listing-ai-draft|listing-ai-draft).*\.json$/i), selectedBy: 'latest-evidence' },
    adReadback: selectedAdReadback,
  };
  const evidenceManifestPath = path.join(input.evidenceDir, `v15-final-readiness-evidence-manifest-desktop-${stamp}.json`);
  const finalReadinessPath = path.join(input.evidenceDir, `final-readiness-${stamp}.json`);
  const evidenceManifest = {
    kind: 'v15-final-readiness-evidence-manifest',
    generatedAt: new Date().toISOString(),
    status: 'EVIDENCE_SELECTION_ONLY',
    appVersion: input.appVersion,
    evidence: {
      delivery: evidenceEntry(input.repoRootDir, 'Report collection delivery', selected.delivery.filePath, selected.delivery.selectedBy),
      listingRead: evidenceEntry(input.repoRootDir, 'Lingxing Listing full read', selected.listingRead.filePath, selected.listingRead.selectedBy),
      aiLive: evidenceEntry(input.repoRootDir, 'AI live provider', selected.aiLive.filePath, selected.aiLive.selectedBy),
      adAiExplanation: evidenceEntry(input.repoRootDir, 'Ad recommendation AI explanation', selected.adAiExplanation.filePath, selected.adAiExplanation.selectedBy),
      listingAiDraft: evidenceEntry(input.repoRootDir, 'Listing AI draft', selected.listingAiDraft.filePath, selected.listingAiDraft.selectedBy),
      adReadback: evidenceEntry(input.repoRootDir, 'Real ad execution readback', selected.adReadback.filePath, selected.adReadback.selectedBy),
    },
    note: 'This manifest was generated by the desktop app. It selects evidence paths for final readiness and does not make APP_READY claims by itself.',
  };

  const packageIndex = buildPackageIndex(input.releaseDir);
  const gates = [
    checkReportCollection(selected.delivery.filePath),
    checkListingRead(selected.listingRead.filePath),
    checkAiLive(selected.aiLive.filePath),
    checkAdAiExplanation(selected.adAiExplanation.filePath),
    checkListingAiDraft(selected.listingAiDraft.filePath),
    checkAdExecutionReadback(selected.adReadback.filePath),
    checkReleasePackageHash(packageIndex),
  ];
  const allGatesPass = gates.every((item) => item.ok);
  const appReady = allGatesPass;
  const finalReadiness = {
    generatedAt: new Date().toISOString(),
    evidenceSelection: {
      mode: 'manifest',
      manifestPath: evidenceManifestPath,
    },
    manifestDriven: true,
    status: appReady ? 'APP_READY' : (gates[0].ok && gates[1].ok ? 'APP_NEEDS_WORK' : 'REPORT_COLLECTION_NEEDS_WORK'),
    reportCollectionReady: gates[0].ok,
    listingReadReady: gates[1].ok,
    appReady,
    allGatesPass,
    missing: gates.filter((item) => !item.ok).map((item) => item.message || `${item.name} 未通过。`),
    actionItems: gates.filter((item) => !item.ok).map((item) => `补齐 ${item.name} 证据后重新运行最终验收。`),
    packageIndex,
    gates,
  };

  fs.writeFileSync(evidenceManifestPath, `${JSON.stringify(evidenceManifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(finalReadinessPath, `${JSON.stringify(finalReadiness, null, 2)}\n`, 'utf8');
  return {
    evidenceManifestPath,
    finalReadinessPath,
    status: finalReadiness.status,
    appReady,
    manifestDriven: true,
    gates,
  };
}
