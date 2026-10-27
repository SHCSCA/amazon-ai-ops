import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLegacyDeliveryBundleExporter as createDeliveryBundleExporter } from './delivery-legacy-bundle-export';
import { normalizeDeliveryReadiness, type DeliveryReadinessView } from './delivery-readiness-view';

const roots: string[] = [];

function writeJson(filePath: string, payload: unknown): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-bundle-export-'));
  roots.push(root);
  const evidenceManifestPath = writeJson(path.join(root, 'evidence-manifest.json'), { kind: 'test-manifest' });
  const finalReadinessPath = writeJson(path.join(root, 'final-readiness.json'), {
    status: 'APP_READY', appReady: true,
    evidenceSelection: { mode: 'manifest', manifestPath: evidenceManifestPath },
    gates: [{ id: 'gate-a', name: 'Gate A', ok: true }],
    scope: { storeName: 'Manifest Store' },
  });
  const readiness = normalizeDeliveryReadiness(JSON.parse(fs.readFileSync(finalReadinessPath, 'utf8')), finalReadinessPath);
  const active = { scope: { storeName: 'Store A' } as unknown };
  const jsonPath = writeJson(path.join(root, 'reconciliation.json'), { source: 'current-db' });
  const markdownPath = path.join(root, 'reconciliation.md');
  fs.writeFileSync(markdownPath, '# 数据口径核对\n');
  const options = {
    paths: { deliveryBundlesDir: path.join(root, 'bundles') },
    getReadiness: vi.fn(() => readiness),
    getOperationScope: vi.fn(() => active.scope),
    exportDataReconciliation: vi.fn((_scope: unknown) => ({
      success: true, canonicalSource: 'current-db', canonical: { rows: 42 }, blockers: [] as string[],
      jsonPath, markdownPath,
    })),
    logger: { error: vi.fn() },
  };
  return {
    root, evidenceManifestPath, finalReadinessPath, readiness, active, options,
    exportBundle: createDeliveryBundleExporter(options),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('delivery bundle READY gates', () => {
  it.each([
    ['unavailable', { available: false }],
    ['missing-path', { path: null }],
    ['not-manifest-driven', { manifestDriven: false }],
    ['missing-readiness-file', { exists: false }],
    ['needs-work-status', { status: 'APP_NEEDS_WORK' }],
    ['not-app-ready', { appReady: false }],
    ['preview-only', { previewOnly: true }],
    ['no-gates', { gates: [] }],
    ['failed-gate', { gates: [{ id: 'failed', name: 'Failed', ok: false }] }],
    ['authority-failure', { failures: [{ gateId: 'package', code: 'STALE', message: 'stale', evidencePath: null }] }],
  ] as Array<[string, Partial<DeliveryReadinessView>]>)('blocks %s without creating a bundle', (_label, override) => {
    const input = harness();
    input.options.getReadiness.mockReturnValue({ ...input.readiness, ...override });
    expect(input.exportBundle()).toMatchObject({ success: false });
    expect(fs.existsSync(input.options.paths.deliveryBundlesDir)).toBe(false);
    expect(input.options.exportDataReconciliation).not.toHaveBeenCalled();
  });

  it('preserves the unavailable-readiness message and repair actions', () => {
    const input = harness();
    input.options.getReadiness.mockReturnValue({
      ...input.readiness, available: false, message: 'missing evidence', missing: ['missing-a'], actionItems: ['repair-a'],
    });
    expect(input.exportBundle()).toEqual({
      success: false, status: 'APP_NEEDS_WORK', message: 'missing evidence',
      missing: ['missing-a'], actionItems: ['repair-a'],
    });
  });

  it.each(['absent-file', 'missing-field', 'invalid-field'] as const)('blocks %s evidence manifest', (mode) => {
    const input = harness();
    if (mode === 'absent-file') fs.unlinkSync(input.evidenceManifestPath);
    else writeJson(input.finalReadinessPath, { evidenceSelection: { manifestPath: mode === 'invalid-field' ? 42 : undefined } });
    expect(input.exportBundle()).toMatchObject({
      success: false, status: 'APP_NEEDS_WORK', missing: ['最终就绪 evidence manifest 缺失'],
      finalReadinessPath: input.finalReadinessPath,
    });
    expect(fs.existsSync(input.options.paths.deliveryBundlesDir)).toBe(false);
  });

  it('rechecks the current readiness on every export', () => {
    const input = harness();
    input.options.getReadiness.mockReturnValue({ ...input.readiness, appReady: false });
    expect(input.exportBundle()).toMatchObject({ success: false });
    input.options.getReadiness.mockReturnValue(input.readiness);
    expect(input.exportBundle()).toMatchObject({ success: true });
    expect(input.options.getReadiness).toHaveBeenCalledTimes(2);
  });
});

describe('delivery bundle reconciliation and evidence', () => {
  it('copies readiness and reconciliation artifacts and writes the original manifest contract', () => {
    const input = harness();
    const result = input.exportBundle();
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('EXPECTED_BUNDLE');
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath!, 'utf8'));
    expect(manifest).toMatchObject({
      status: 'APP_READY', appReady: true,
      finalReadinessPath: input.finalReadinessPath,
      finalReadinessCopy: path.basename(input.finalReadinessPath),
      dataReconciliation: {
        canonicalSource: 'current-db', canonical: { rows: 42 }, blockers: [],
        sourceJsonPath: input.options.exportDataReconciliation.mock.results[0].value.jsonPath,
        sourceMarkdownPath: input.options.exportDataReconciliation.mock.results[0].value.markdownPath,
        bundleJson: 'data-reconciliation.json', bundleMarkdown: 'data-reconciliation.md',
      },
      gates: JSON.parse(JSON.stringify(input.readiness.gates)), gatesSummary: input.readiness.gatesSummary,
    });
    expect(fs.readFileSync(path.join(result.bundleDir!, 'final-readiness.json'), 'utf8'))
      .toBe(fs.readFileSync(input.finalReadinessPath, 'utf8'));
    expect(JSON.parse(fs.readFileSync(result.dataReconciliation!.jsonPath!, 'utf8'))).toEqual({ source: 'current-db' });
    expect(fs.readFileSync(result.dataReconciliation!.markdownPath!, 'utf8')).toBe('# 数据口径核对\n');
    expect(input.options.exportDataReconciliation).toHaveBeenCalledWith(input.active.scope);
    expect(input.options.logger.error).not.toHaveBeenCalled();
  });

  it('prioritizes an explicit scope without reading active scope', () => {
    const input = harness();
    const scope = { storeName: 'Explicit Store' };
    input.exportBundle(scope);
    expect(input.options.exportDataReconciliation).toHaveBeenCalledWith(scope);
    expect(input.options.getOperationScope).not.toHaveBeenCalled();
  });

  it('reads the newly active scope after construction', () => {
    const input = harness();
    input.active.scope = { storeName: 'Store B' };
    input.exportBundle();
    expect(input.options.exportDataReconciliation).toHaveBeenCalledWith({ storeName: 'Store B' });
  });

  it('falls back to the final manifest scope when no active scope exists', () => {
    const input = harness();
    input.active.scope = null;
    input.exportBundle();
    expect(input.options.exportDataReconciliation).toHaveBeenCalledWith({ storeName: 'Manifest Store' });
  });

  it('retains a missing-scope blocker when neither source provides scope', () => {
    const input = harness();
    input.active.scope = null;
    const readiness = JSON.parse(fs.readFileSync(input.finalReadinessPath, 'utf8'));
    delete readiness.scope; writeJson(input.finalReadinessPath, readiness);
    expect(input.exportBundle()).toMatchObject({
      success: true,
      dataReconciliation: { blockers: ['未生成数据口径核对报告：交付包导出时没有收到当前运营范围。'] },
    });
    expect(input.options.exportDataReconciliation).not.toHaveBeenCalled();
  });

  it('preserves failed reconciliation blockers without claiming a successful report', () => {
    const input = harness();
    input.options.exportDataReconciliation.mockReturnValueOnce({
      success: false, canonicalSource: 'current-db', canonical: { rows: 0 }, blockers: ['MISSING_REPORT'],
      jsonPath: '', markdownPath: '',
    });
    const result = input.exportBundle();
    expect(result).toMatchObject({ success: true, dataReconciliation: { blockers: ['MISSING_REPORT'] } });
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath!, 'utf8'));
    expect(manifest.dataReconciliation.blockers).toEqual(['MISSING_REPORT']);
    expect(manifest.dataReconciliation.bundleJson).toBeUndefined();
  });

  it.each(['scope', 'reconciliation'] as const)('logs and preserves the %s failure contract', (stage) => {
    const input = harness();
    const error = new Error(`RECONCILIATION_${stage.toUpperCase()}_FAILED`);
    if (stage === 'scope') input.options.getOperationScope.mockImplementationOnce(() => { throw error; });
    if (stage === 'reconciliation') input.options.exportDataReconciliation.mockImplementationOnce(() => { throw error; });
    const result = input.exportBundle();
    expect(result).toMatchObject({
      success: true, dataReconciliation: { blockers: [`数据口径核对报告生成失败：${error.message}`] },
    });
    expect(input.options.logger.error).toHaveBeenCalledWith('delivery.data_reconciliation_failed', {
      error, finalReadinessPath: input.finalReadinessPath,
    });
    expect(JSON.parse(fs.readFileSync(result.manifestPath!, 'utf8')).dataReconciliation.blockers)
      .toEqual([`数据口径核对报告生成失败：${error.message}`]);
  });

  it('contains and logs an artifact-copy failure', () => {
    const input = harness();
    const directoryPath = path.join(input.root, 'invalid-report-directory');
    fs.mkdirSync(directoryPath);
    input.options.exportDataReconciliation.mockReturnValueOnce({
      success: true, canonicalSource: 'current-db', canonical: { rows: 42 }, blockers: [],
      jsonPath: directoryPath, markdownPath: '',
    });
    const result = input.exportBundle();
    expect(result.success).toBe(true);
    expect(result.dataReconciliation!.blockers).toEqual([
      expect.stringContaining('数据口径核对报告生成失败：'),
    ]);
    expect(input.options.logger.error).toHaveBeenCalledWith('delivery.data_reconciliation_failed', {
      error: expect.any(Error), finalReadinessPath: input.finalReadinessPath,
    });
  });

  it('omits nonexistent optional report artifacts without changing blockers', () => {
    const input = harness();
    fs.unlinkSync(input.options.exportDataReconciliation({}).jsonPath);
    const result = input.exportBundle();
    expect(result.success).toBe(true);
    expect(result.dataReconciliation!.jsonPath).toBeUndefined();
    expect(result.dataReconciliation!.markdownPath).toBeTruthy();
  });

  it('propagates readiness JSON failures to the tracked IPC boundary', () => {
    const input = harness();
    fs.writeFileSync(input.finalReadinessPath, '{broken');
    expect(() => input.exportBundle()).toThrow(SyntaxError);
    expect(input.options.logger.error).not.toHaveBeenCalled();
  });
});
