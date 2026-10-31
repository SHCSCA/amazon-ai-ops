import { createHash, randomUUID } from 'node:crypto';
import { observeOwnerConfirmedFamily, type FamilyReportLevel } from '@amazon-ai-ops/report-parser';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { ConfirmFamilyObservationInput, FamilyObservationFile, FamilyObservationPreview, FamilyObservationScope, PrepareFamilyObservationInput } from '../shared/family-observation-contracts';

export interface FamilyObservationSource extends FamilyObservationFile {
  storeId: string;
  status: string;
  filePath: string;
  fileSize: number;
  version: string;
}
export interface FamilyObservationAuthority {
  context: StoreContextEnvelope;
  storeName: string;
}
export interface FamilyObservationDependencies {
  authority(context: unknown): FamilyObservationAuthority;
  files(authority: FamilyObservationAuthority): FamilyObservationSource[];
  read(source: FamilyObservationSource, authority: FamilyObservationAuthority): Uint8Array;
  now?: () => number;
}
const levels = new Set<string>(['campaign', 'ad_group', 'keyword']);
const supported = new Set([...levels, 'user_search_term', 'product_targeting', 'advertised_product', 'auto_targeting', 'placement']);
function reject(): never { throw new Error('产品族只读观察范围已失效或报表不可用，请重新选择并预览。'); }
function windowValid(from: unknown, to: unknown): boolean {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  return valid(from) && valid(to) && from <= to && Date.parse(to) - Date.parse(from) <= 365 * 86400000;
}
function publicFile(file: FamilyObservationSource): FamilyObservationFile {
  const { id, fileName, batchId, reportType, sha256, dateFrom, dateTo } = file;
  return { id, fileName, batchId, reportType, sha256, dateFrom, dateTo };
}
function contextKey(context: StoreContextEnvelope): string {
  return JSON.stringify([context.storeId, context.browserProfileId, context.marketplace, context.currency,
    context.businessDate, context.businessTimezone, context.sessionGeneration]);
}
interface Pending {
  authorityKey: string;
  input: PrepareFamilyObservationInput;
  preview: FamilyObservationPreview;
  fingerprints: string[];
  expiresAt: number;
}
// 确认仅存在于当前 Main 会话；不创建持久授权或未来报表范围。
export class FamilyObservationService {
  private pending = new Map<number, Pending>();
  constructor(private readonly dependencies: FamilyObservationDependencies) {}
  cancel(senderId: number): void { this.pending.delete(senderId); }
  private authority(scope: FamilyObservationScope): FamilyObservationAuthority {
    if (!scope || !scope.storeContext || !windowValid(scope.dateFrom, scope.dateTo)) reject();
    return this.dependencies.authority(scope.storeContext);
  }
  private available(scope: FamilyObservationScope, authority: FamilyObservationAuthority): FamilyObservationSource[] {
    return this.dependencies.files(authority).filter(file => file.storeId === authority.context.storeId
      && file.status === 'imported' && Number.isSafeInteger(file.id) && file.id > 0
      && supported.has(file.reportType) && /^[a-f0-9]{64}$/.test(file.sha256)
      && windowValid(file.dateFrom, file.dateTo) && file.dateFrom >= scope.dateFrom && file.dateTo <= scope.dateTo);
  }
  list(senderId: number, scope: FamilyObservationScope): FamilyObservationFile[] {
    this.cancel(senderId);
    const authority = this.authority(scope);
    return this.available(scope, authority).map(publicFile);
  }
  private selected(input: PrepareFamilyObservationInput, authority: FamilyObservationAuthority): FamilyObservationSource[] {
    if (!Array.isArray(input.fileIds) || input.fileIds.length < 1 || input.fileIds.length > 32
      || input.fileIds.some(id => !Number.isSafeInteger(id) || id < 1)
      || new Set(input.fileIds).size !== input.fileIds.length) reject();
    const available = this.available(input, authority);
    return input.fileIds.map(id => {
      const candidates = available.filter(file => file.id === id);
      if (candidates.length !== 1) reject();
      return candidates[0];
    });
  }
  private bytes(source: FamilyObservationSource, authority: FamilyObservationAuthority): Uint8Array {
    if (!Number.isSafeInteger(source.fileSize) || source.fileSize < 1 || source.fileSize > 32 * 1024 * 1024) reject();
    const bytes = this.dependencies.read(source, authority);
    if (bytes.byteLength !== source.fileSize || createHash('sha256').update(bytes).digest('hex') !== source.sha256) reject();
    return bytes;
  }
  prepare(senderId: number, input: PrepareFamilyObservationInput): FamilyObservationPreview {
    this.cancel(senderId);
    const authority = this.authority(input);
    if (typeof input.familyLabel !== 'string' || !input.familyLabel.trim() || input.familyLabel.trim().length > 100) reject();
    const files = this.selected(input, authority);
    const typed = files.filter(file => levels.has(file.reportType));
    if (!typed.some(file => file.reportType === 'campaign') || new Set(typed.map(file => file.reportType)).size !== typed.length
      || new Set(files.map(file => file.sha256)).size !== files.length) reject();
    for (const file of files) this.bytes(file, authority);
    const preview: FamilyObservationPreview = { token: randomUUID(), familyLabel: input.familyLabel.trim(), storeName: authority.storeName,
      marketplaceCode: authority.context.marketplace, dateFrom: input.dateFrom, dateTo: input.dateTo, files: files.map(publicFile) };
    const now = this.dependencies.now?.() ?? Date.now();
    for (const [id, held] of this.pending) if (held.expiresAt <= now) this.pending.delete(id);
    if (this.pending.size >= 64) this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(senderId, { authorityKey: contextKey(authority.context),
      input: { storeContext: { ...authority.context }, dateFrom: input.dateFrom, dateTo: input.dateTo, familyLabel: preview.familyLabel, fileIds: [...input.fileIds] },
      preview, fingerprints: files.map(file => JSON.stringify(file)), expiresAt: (this.dependencies.now?.() ?? Date.now()) + 10 * 60_000 });
    return structuredClone(preview);
  }
  confirm(senderId: number, input: ConfirmFamilyObservationInput) {
    const pending = this.pending.get(senderId);
    this.cancel(senderId);
    if (!pending || !input || input.token !== pending.preview.token || (this.dependencies.now?.() ?? Date.now()) >= pending.expiresAt) reject();
    const authority = this.dependencies.authority(input.storeContext);
    if (contextKey(authority.context) !== pending.authorityKey || authority.storeName !== pending.preview.storeName) reject();
    const files = this.selected(pending.input, authority);
    if (files.some((file, i) => JSON.stringify(file) !== pending.fingerprints[i])) reject();
    const reports = files.flatMap(file => {
      const bytes = this.bytes(file, authority);
      return levels.has(file.reportType) ? [{ bytes, reportType: file.reportType as FamilyReportLevel }] : [];
    });
    return observeOwnerConfirmedFamily({ schemaVersion: 1, provenanceLabel: 'user_confirmed_scope',
      familyLabel: pending.preview.familyLabel, confirmationReference: pending.preview.token, storeName: authority.storeName,
      marketplaceCode: authority.context.marketplace, dateFrom: pending.input.dateFrom, dateTo: pending.input.dateTo,
      files: files.map(file => ({ sha256: file.sha256, reportType: levels.has(file.reportType) ? file.reportType as FamilyReportLevel : 'auxiliary', dateFrom: file.dateFrom, dateTo: file.dateTo })) },
    reports);
  }
}
