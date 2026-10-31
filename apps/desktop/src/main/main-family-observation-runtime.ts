import * as fs from 'node:fs';
import * as path from 'node:path';
import { deriveStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import type { ConfirmFamilyObservationInput, FamilyObservationScope, PrepareFamilyObservationInput } from '../shared/family-observation-contracts';
import { FamilyObservationService, type FamilyObservationAuthority, type FamilyObservationSource } from './family-observation-service';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { getMainRuntimeContext } from './main-runtime-access';
import { runtimeLog } from './runtime-log-adapter';
import { isRejectedEvidenceLikePath, BUSINESS_REAL_REPORT_EXTENSIONS } from './business-report-files';

function unavailable(): never { throw new Error('产品族只读观察暂不可用，请重新选择店铺并检查已导入报表。'); }
function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function assertNoLinks(candidate: string, trustedRoot: string): void {
  if (candidate !== trustedRoot && !isWithin(candidate, trustedRoot)) unavailable();
  const parts = path.relative(trustedRoot, candidate).split(path.sep).filter(Boolean);
  let current = trustedRoot;
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) unavailable();
  }
}
// 路径只来自 Main 仓库；拒绝符号链接，并将打开句柄与预检文件身份绑定。
export function readFamilyObservationFile(source: FamilyObservationSource, authority: FamilyObservationAuthority, storesRoot: string): Uint8Array {
  const capsule = deriveStoreCapsulePaths(storesRoot, authority.context.storeId, authority.context.browserProfileId);
  if (!BUSINESS_REAL_REPORT_EXTENSIONS.has(path.extname(source.filePath).toLowerCase()) || isRejectedEvidenceLikePath(source.filePath)) unavailable();
  const logical = path.resolve(source.filePath);
  if (![capsule.downloadsDir, capsule.reportsDir].some(root => isWithin(logical, root))) unavailable();
  assertNoLinks(logical, capsule.trustedStoresRoot);
  const realStoreRoot = fs.realpathSync(capsule.storeRoot);
  const realTrustedRoot = fs.realpathSync(capsule.trustedStoresRoot);
  if (!isWithin(realStoreRoot, realTrustedRoot) || path.relative(realTrustedRoot, realStoreRoot) !== authority.context.storeId) unavailable();
  const realFile = fs.realpathSync(logical);
  if (!isWithin(realFile, realStoreRoot)) unavailable();
  const expected = fs.statSync(realFile);
  if (!expected.isFile() || expected.size !== source.fileSize || expected.size < 1 || expected.size > 32 * 1024 * 1024) unavailable();
  const fd = fs.openSync(realFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.dev !== expected.dev || before.ino !== expected.ino || before.size !== expected.size || before.mtimeMs !== expected.mtimeMs) unavailable();
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    assertNoLinks(logical, capsule.trustedStoresRoot);
    const current = fs.statSync(logical);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || current.dev !== before.dev || current.ino !== before.ino || fs.realpathSync(logical) !== realFile) unavailable();
    return bytes;
  } finally { fs.closeSync(fd); }
}
const service = new FamilyObservationService({
  authority(context) {
    if (!context) unavailable();
    const { context: current, store } = resolveBusinessStoreAuthority(context);
    return { context: current, storeName: store.displayName };
  },
  files(authority) {
    const runtime = getMainRuntimeContext();
    if (!runtime.state.reportFileRepo || !runtime.state.db) unavailable();
    return runtime.state.reportFileRepo.findBusinessReportFilesForStore(authority.context.storeId, { status: 'imported', limit: 5000 }).flatMap(file => {
      const batch = runtime.state.db!.prepare(`SELECT date_start, date_end, store_name, marketplace_code FROM lingxing_report_batches WHERE id = ? AND store_id = ?`).get(file.batchId, authority.context.storeId) as
        { date_start: string; date_end: string; store_name: string; marketplace_code: string } | undefined;
      if (!batch || batch.store_name !== authority.storeName || batch.marketplace_code !== authority.context.marketplace) return [];
      return [{ id: file.id!, fileName: path.basename(file.fileName), batchId: file.batchId, reportType: file.reportType,
        sha256: file.fileHash ?? '', dateFrom: batch.date_start, dateTo: batch.date_end, storeId: file.storeId,
        status: file.status, filePath: file.filePath, fileSize: file.fileSize,
        version: JSON.stringify([file.updatedAt, file.lastImportedAt, file.importedRows, file.importError]) }];
    });
  },
  read(source, authority) { return readFamilyObservationFile(source, authority, getMainRuntimeContext().STORES_DIR); },
});
function safe<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) { runtimeLog.warn('[FamilyObservation] read-only request rejected', error); unavailable(); }
}
export function handleListFamilyObservationFiles(senderId: number, input: FamilyObservationScope) {
  return safe(() => service.list(senderId, input));
}
export function handlePrepareFamilyObservation(senderId: number, input: PrepareFamilyObservationInput) {
  return safe(() => service.prepare(senderId, input));
}
export function handleConfirmFamilyObservation(senderId: number, input: ConfirmFamilyObservationInput) {
  return safe(() => service.confirm(senderId, input));
}
export function handleCancelFamilyObservation(senderId: number) { service.cancel(senderId); }
