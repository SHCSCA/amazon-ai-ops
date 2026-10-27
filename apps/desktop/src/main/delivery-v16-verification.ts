import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { deriveStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { createStoreScopedReadbackAccess } from './readback-store-authority';
import { getDeliveryEvidenceStatus, type DeliveryEvidenceStatus } from './delivery-evidence-status';
import type { DeliveryReadinessView } from './delivery-readiness-view';
import type { DeliveryV16Request, DeliveryV16Result } from './delivery-v16-contracts';
import { deliveryAuthoritySha256 } from './delivery-v16-authority';
import { embeddedV16Build, ensureV16OwnedDirectory, materializeFrozenFile } from './delivery-v16-frozen-build';
import { createV16PackageRuntime } from './delivery-v16-package-runtime';

const { evaluateReleaseCore, readinessFromCore } = require('../../../../scripts/v16-release-core');
const { publicationPaths, verifyPublicationClosure, publishRelease } = require('../../../../scripts/v16-publication-closure');
const { createRuntimeLogRecord } = require('../../../../packages/shared-types/src/runtime-log-format.cjs');

function readInput(file: string): any {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16 * 1024 * 1024
    || fs.realpathSync.native(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error('V16_INPUT_NOT_DIRECT');
  const bytes = fs.readFileSync(file), after = fs.lstatSync(file);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('V16_INPUT_CHANGED');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

function projection(report: any, target: string | null, manifestExists: boolean, verifiedPublication: boolean): DeliveryReadinessView {
  const recovery: Record<string, string> = {
    L1: '补齐当前版本全部单元与合同测试原件。', L2: '重新运行当前版本类型、构建及工程规范核验。',
    L3: '补齐当前业务流程与权限链集成测试原件。', L4: '补齐当前安装包的窗口、页面及界面原件。',
    L5: '补齐当前安装包、便携包、压缩包与安全边界原件。',
    L6: '补齐两个真实美国站店铺各七个已完成工作日，以及正式库备份、迁移和隔离原件。',
    L7: '补齐人工审批与策略自动模式各自独立的真实候选、授权、执行和重新载入回读原件。',
    L8: '刷新全部需求追踪与发布闭包后重新导出。',
  };
  const gates = report.gates.map((gate: any) => ({
    id: gate.layer, name: gate.title, ok: gate.passed === true,
    status: gate.passed === true ? 'passed' : 'needs_work',
    evidencePath: target,
    message: gate.passed === true ? '当前原件已复验。' : recovery[gate.layer] ?? '补齐当前验收原件后重新刷新。',
  }));
  const failures = gates.filter((gate: any) => !gate.ok).map((gate: any) => ({ gateId: gate.id, code: 'V16_CURRENT_EVIDENCE_REQUIRED', message: `${gate.name}：${gate.message}`, evidencePath: target }));
  const appReady = manifestExists && report.overallStatus === 'APP_READY' && failures.length === 0;
  const actionItems = [
    '在存储路径中确认当前验收工作包目录，补齐原件后重新刷新。',
    ...(gates.some((gate: any) => gate.id === 'L6' && !gate.ok) ? ['补齐两个真实美国站店铺各七个已完成工作日及正式库备份、迁移、隔离原件。'] : []),
    ...(gates.some((gate: any) => gate.id === 'L7' && !gate.ok) ? ['补齐人工审批与策略自动模式各自独立的真实候选、授权、执行及重新载入回读原件。'] : []),
  ];
  return {
    ...(manifestExists && verifiedPublication ? { verificationProtocol: 'v16.current-publication/1' as const } : {}),
    available: manifestExists, path: target, exists: Boolean(target && fs.existsSync(target)),
    status: appReady ? 'APP_READY' : 'APP_NEEDS_WORK', appReady, manifestDriven: manifestExists, previewOnly: false,
    generatedAt: report.timestamp, checkedAt: new Date().toISOString(), gates, failures,
    gatesSummary: { total: gates.length, passed: gates.length - failures.length, failed: failures.length },
    missing: failures.map((failure: any) => failure.message), actionItems,
    recommendationReviewReasons: [], reviewBlockers: [], deliveryReviewReasons: [],
    finalReadinessBlockers: failures.map((failure: any) => failure.message),
    message: appReady ? '当前版本、真实原件及完整发布闭包已重新核验。' : '当前验收尚未完成，正常业务仍可使用。',
  };
}

function currentScopeCore(core: any, request: DeliveryV16Request) {
  const { authority } = request;
  const issues = [];
  if (!authority.storeContext) issues.push('V16_ACTIVE_STORE_CONTEXT_REQUIRED');
  if (!authority.scope) issues.push('V16_CURRENT_OPERATION_SCOPE_REQUIRED');
  if (!['manual_approval', 'policy_auto'].includes(authority.mode.value ?? '') || !Number.isSafeInteger(authority.mode.revision) || Number(authority.mode.revision) < 1) issues.push('V16_CURRENT_MODE_REVISION_REQUIRED');
  return issues.length ? { ...core, eligible: false, issues: [...core.issues, ...issues] } : core;
}

function evidenceStatus(request: DeliveryV16Request, diagnostics: unknown[]): DeliveryEvidenceStatus {
  const context = request.authority.storeContext;
  let database: Database.Database | undefined;
  try {
    if (context) {
      database = new Database(request.paths.authorityDbPath, { readonly: true, fileMustExist: true });
      database.pragma('query_only = ON');
      if (database.pragma('query_only', { simple: true }) !== 1) throw new Error('V16_EVIDENCE_DATABASE_NOT_QUERY_ONLY');
    }
    const access = context ? createStoreScopedReadbackAccess(context, deriveStoreCapsulePaths(path.join(path.dirname(request.paths.authorityDbPath), 'stores'), context.storeId, context.browserProfileId)) : undefined;
    return getDeliveryEvidenceStatus({
      db: database, storeId: context?.storeId ?? '', readbackDir: access?.rootDir ?? '', readbackAccess: access,
      releaseDir: path.join(request.paths.workPackageRoot, 'packages'), scope: request.authority.scope as any ?? {},
    });
  } catch (error) {
    diagnostics.push(createRuntimeLogRecord('error', 'delivery.v16_evidence_status_failed', { error }));
    return {
      listing: { readReady: false, draftReady: false, contentCount: 0, fullContentCount: 0, draftCount: 0, aiDraftCount: 0, ruleFallbackDraftCount: 0 },
      readback: { verifiedCount: 0 }, package: { installerAvailable: false },
    };
  } finally { database?.close(); }
}

export function verifyV16DeliveryRequest(request: DeliveryV16Request) {
  if (request.schemaVersion !== 'v16.delivery-request/1' || !/^[a-f0-9-]{36}$/i.test(request.binding.nonce)
    || !Number.isSafeInteger(request.binding.epoch) || request.binding.epoch < 0
    || request.binding.authoritySha256 !== deliveryAuthoritySha256({ authority: request.authority, paths: request.paths })
    || request.nativeAbi !== process.versions.modules) throw new Error('V16_WORKER_REQUEST_BINDING_INVALID');
  const frozen = embeddedV16Build();
  if (frozen.identity.packageVersion !== request.appVersion) throw new Error('V16_WORKER_BUILD_VERSION_MISMATCH');
  const runtime = createV16PackageRuntime(request, frozen), diagnostics: unknown[] = [];
  const manifestPath = path.join(request.paths.workPackageRoot, 'manifest.json');
  const manifestExists = fs.existsSync(manifestPath);
  const manifest = manifestExists ? readInput(manifestPath) : { ...frozen.requiredManifestDefinition, identity: frozen.identity };
  const compute = (candidate: any, requirements: any, root: string) => currentScopeCore(evaluateReleaseCore(candidate, requirements, root, runtime), request);
  let core = compute(manifest, frozen.requirementsIndex, request.paths.workPackageRoot);
  let paths = publicationPaths(request.paths.workPackageRoot, {
    manifestPath, requirementsPath: runtime.cache.requirements.path,
    closurePath: path.join(request.paths.publicationRoot ?? request.paths.workPackageRoot, 'publication-closure.json'),
    readinessPath: path.join(request.paths.publicationRoot ?? request.paths.workPackageRoot, 'readiness.json'),
    readmePath: path.join(request.paths.publicationRoot ?? request.paths.workPackageRoot, 'README.md'),
  });
  let publication = verifyPublicationClosure(manifest, core, request.paths.workPackageRoot, paths);
  let bundleDirectory: string | undefined;
  if (request.operation !== 'view') {
    if (!manifestExists) diagnostics.push(createRuntimeLogRecord('warn', 'delivery.v16_manifest_missing', { manifestPath }));
    else {
      const output = ensureV16OwnedDirectory(path.join(request.paths.outputRoot, request.binding.nonce));
      materializeFrozenFile(output, 'verification-authority.json', Buffer.from(JSON.stringify({ binding: request.binding, authority: request.authority }, null, 2) + '\n'));
      materializeFrozenFile(output, 'README.md', Buffer.from(`**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.** 当前版本 ${request.appVersion} 尚待本次闭包复验。\n`));
      paths = publicationPaths(request.paths.workPackageRoot, {
        manifestPath, requirementsPath: runtime.cache.requirements.path, readmePath: path.join(output, 'README.md'),
        closurePath: path.join(output, 'publication-closure.json'), readinessPath: path.join(output, 'readiness.json'),
      });
      const published = publishRelease(manifestPath, runtime.cache.requirements.path, request.paths.workPackageRoot, { ...paths, bundleDirectory: path.join(output, 'delivery-bundle') }, compute);
      core = published.core;
      publication = published.publication;
      bundleDirectory = published.bundleDirectory;
    }
  }
  const report = readinessFromCore(core, publication);
  diagnostics.push(createRuntimeLogRecord('info', 'delivery.v16_current_verification', {
    nonce: request.binding.nonce, issues: report.issues, gates: report.gates,
    workPackageRoot: request.paths.workPackageRoot,
  }));
  const result: DeliveryV16Result = {
    schemaVersion: 'v16.delivery-result/1', binding: request.binding,
    readiness: projection(report, manifestExists ? (request.operation === 'view' ? paths.closurePath : paths.readinessPath) : null, manifestExists, publication.success === true),
    evidenceStatus: evidenceStatus(request, diagnostics),
    ...(request.operation === 'refresh' ? { refresh: { success: manifestExists, evidenceManifestPath: manifestPath, finalReadinessPath: paths.readinessPath } } : {}),
    ...(request.operation === 'export' ? { exported: { success: Boolean(bundleDirectory), status: report.overallStatus, bundleDir: bundleDirectory, manifestPath: bundleDirectory ? path.join(bundleDirectory, 'delivery-bundle-manifest.json') : undefined, message: bundleDirectory ? '已导出本次重新核验的交付引用包。' : '验收工作包缺少清单，请补齐后重新导出。' } } : {}),
  };
  return { result, diagnostics };
}
