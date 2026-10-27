import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { deliveryActionButtonView } from './delivery-actions';
import { NonReadyDeliveryEvidenceExport } from './delivery-export-control';
import { canExportNonReadyDeliveryEvidence, exportNonReadyDeliveryEvidence } from './delivery-export-policy';
import { createDeliveryOperationState, deliveryOperationContextKey } from './delivery-operation-state';
import type { DeliveryReadinessView, OperationScope } from '../types';
import { readFileSync } from 'node:fs';

const readiness = { available: true, exists: true, manifestDriven: true, appReady: false,
  status: 'APP_NEEDS_WORK', verificationProtocol: 'v16.current-publication/1' } as DeliveryReadinessView;
const scope: OperationScope = { storeName: '店铺甲', marketplaceCode: 'US', dateFrom: '2026-10-01', dateTo: '2026-10-07', currency: 'USD', asin: 'ASIN-A', batchId: 'batch-a' };

describe('V16 non ready delivery export', () => {
  it('requires the current verified real V16 publication before enabling evidence export', () => {
    expect(canExportNonReadyDeliveryEvidence(readiness)).toBe(true);
    expect(canExportNonReadyDeliveryEvidence(readiness, true)).toBe(false);
    expect(canExportNonReadyDeliveryEvidence(null)).toBe(false);
    for (const patch of [{ verificationProtocol: undefined }, { verificationProtocol: 'v15' }, { available: false },
      { exists: false }, { manifestDriven: false }, { previewOnly: true }, { appReady: true }, { status: 'APP_READY' }]) {
      expect(canExportNonReadyDeliveryEvidence({ ...readiness, ...patch } as DeliveryReadinessView)).toBe(false);
    }
  });

  it('never invokes the export bridge for stale legacy or preview readiness', async () => {
    const exporter = vi.fn();
    await expect(exportNonReadyDeliveryEvidence({ ...readiness, verificationProtocol: undefined }, false, scope, exporter)).rejects.toThrow('真实应用');
    await expect(exportNonReadyDeliveryEvidence(readiness, true, scope, exporter)).rejects.toThrow('真实应用');
    expect(exporter).not.toHaveBeenCalled();
  });

  it('passes the complete current scope to Main revalidation without changing readiness or granting authority', async () => {
    const original = structuredClone(readiness);
    const exporter = vi.fn(async (received: OperationScope) => {
      expect(received).toEqual(scope);
      expect(received).not.toBe(scope);
      return { success: true, status: 'APP_NEEDS_WORK', bundleDir: 'private-current-evidence' };
    });
    await expect(exportNonReadyDeliveryEvidence(readiness, false, scope, exporter)).resolves.toMatchObject({ status: 'APP_NEEDS_WORK' });
    expect(exporter).toHaveBeenCalledTimes(1);
    expect(readiness).toEqual(original);
    expect(readiness.appReady).toBe(false);
  });

  it('preserves bridge rejection and refuses a successful result without a current conclusion', async () => {
    await expect(exportNonReadyDeliveryEvidence(readiness, false, scope, async () => { throw new Error('STALE_CONTEXT'); })).rejects.toThrow('STALE_CONTEXT');
    await expect(exportNonReadyDeliveryEvidence(readiness, false, scope, async () => ({ success: true }))).rejects.toThrow('本次验收结论');
    await expect(exportNonReadyDeliveryEvidence(readiness, false, scope, async () => ({ success: false, message: 'missing' }))).resolves.toMatchObject({ success: false });
  });

  it('shows a separate explicit incomplete evidence action with a linked limitation and busy feedback', () => {
    const button = deliveryActionButtonView({ action: 'export-non-ready', activeAction: null,
      baseClassName: 'secondary-button', busyLabel: '导出中...', idleLabel: '导出未完成验收材料' });
    expect(renderToStaticMarkup(<NonReadyDeliveryEvidenceExport available={false} button={button} onExport={() => {}} />)).toBe('');
    const markup = renderToStaticMarkup(<NonReadyDeliveryEvidenceExport available button={button} onExport={() => {}} />);
    expect(markup).toContain('导出未完成验收材料');
    expect(markup).toContain('aria-describedby="delivery-non-ready-export-note"');
    expect(markup).toContain('不能作为生产就绪证明');
    expect(markup).not.toContain('可以交付');
    const busy = deliveryActionButtonView({ action: 'export-non-ready', activeAction: 'export-non-ready',
      baseClassName: 'secondary-button', busyLabel: '导出中...', idleLabel: '导出未完成验收材料' });
    const pending = renderToStaticMarkup(<NonReadyDeliveryEvidenceExport available button={busy} onExport={() => {}} />);
    expect(pending).toContain('aria-busy="true"');
    expect(pending).toContain('disabled=""');
    expect(pending).toContain('button-spinner');
  });
});

describe('delivery operation context', () => {
  const authority = { authorityKey: 'store-a|profile-a|1', contextEpoch: 1, phase: 'ready' };

  it('binds store session epoch phase and every operation scope field', () => {
    const base = deliveryOperationContextKey(scope, authority);
    for (const key of ['storeName', 'marketplaceCode', 'dateFrom', 'dateTo', 'asin', 'batchId', 'currency']) {
      expect(deliveryOperationContextKey({ ...scope, [key]: 'different' }, authority)).not.toBe(base);
    }
    for (const patch of [{ authorityKey: 'store-b|profile-b|1' }, { contextEpoch: 2 }, { phase: 'switching' }]) {
      expect(deliveryOperationContextKey(scope, { ...authority, ...patch })).not.toBe(base);
    }
  });

  it('locks repeated clicks before rendering and ignores A to B to A results', () => {
    const operations = createDeliveryOperationState();
    const key = deliveryOperationContextKey(scope, authority);
    operations.update(key);
    const current = operations.capture();
    const first = operations.begin()!;
    expect(operations.begin()).toBeNull();
    operations.update('other-scope');
    operations.update(key);
    expect(current()).toBe(false);
    expect(first.isCurrent()).toBe(false);
    const next = operations.begin()!;
    first.finish();
    expect(next.isCurrent()).toBe(true);
    expect(operations.begin()).toBeNull();
    next.finish();
    expect(operations.begin()).not.toBeNull();
  });

  it('invalidates unloaded results and releases only the owning action', () => {
    const operations = createDeliveryOperationState();
    operations.update('same');
    const current = operations.capture();
    const first = operations.begin()!;
    operations.update('same');
    expect(current()).toBe(true);
    operations.invalidate();
    expect(current()).toBe(false);
    expect(first.isCurrent()).toBe(false);
    expect(operations.begin()).not.toBeNull();
  });

  it('wires scope invalidation and the synchronous gate into the production controller', () => {
    const source = readFileSync(new URL('./delivery-controller.tsx', import.meta.url), 'utf8');
    expect(source).toContain('useWorkspaceOperation(deliveryContextKey)');
    expect(source).toContain('const operation = operations.begin()');
    expect(source).toContain('operation.finish()');
    expect(source).toContain('if (operation.isCurrent()) setDeliveryActionBusy(null)');
    expect(source).toContain('if (!loaded || !isCurrent()) return');
    expect(source).toContain('storeContext: { ...storeAuthority.authoritativeContext! }');
    expect(source).toContain('exportNonReadyDeliveryEvidence(readiness, Boolean(previewState), scope');
  });
});
