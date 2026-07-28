import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import runner from './run-mission-control-ui-evidence.js';

const {
  assertSourceHashesStable,
  buildWorkspaceMatrix,
  canonicalStoreId,
  createManifest,
  dispatchDomClick,
  findVisibleIdentityLeaks,
  gridTrackCount,
  isPathWithin,
  normalizeBusinessFactProjection,
  parseArguments,
  persistAndValidateManifest,
  resolveEvidenceOutputDir,
  workspaceSettleReady,
} = runner;

describe('Mission Control UI evidence runner', () => {
  it('builds the exact ten-workspace by two-scale matrix from the shared contract', () => {
    const matrix = buildWorkspaceMatrix();

    expect(matrix).toHaveLength(20);
    expect(matrix.map(({ workspace, scalePercent }) => `${workspace}:${scalePercent}`))
      .toEqual([
        'today:100',
        'missions:100',
        'decisions:100',
        'experiments:100',
        'execution:100',
        'memory:100',
        'objects:100',
        'collection:100',
        'policy:100',
        'settings:100',
        'today:125',
        'missions:125',
        'decisions:125',
        'experiments:125',
        'execution:125',
        'memory:125',
        'objects:125',
        'collection:125',
        'policy:125',
        'settings:125',
      ]);
    expect(matrix.find(({ workspace, scalePercent }) => (
      workspace === 'decisions' && scalePercent === 125
    ))).toMatchObject({
      subview: 'recommendations',
      view: 'decisions/recommendations',
    });
  });

  it('maps only the two deterministic preview Store Authority ids', () => {
    expect(canonicalStoreId('preview-store-shc001')).toBe('SHC001');
    expect(canonicalStoreId('PREVIEW-STORE-SHC002')).toBe('SHC002');
    expect(() => canonicalStoreId('another-store')).toThrow(/Unexpected preview Store Authority/);
  });

  it('detects raw, canonical, display-label, and profile identity leaks case-insensitively', () => {
    const identifiers = [
      'preview-store-shc001',
      'SHC001',
      'SHC001-US · US · USD',
      'preview-profile-shc001',
    ];

    expect(findVisibleIdentityLeaks(
      '旧范围 PREVIEW-STORE-SHC001 / shc001-us · us · usd / PREVIEW-PROFILE-SHC001',
      identifiers,
    )).toEqual(identifiers);
    expect(findVisibleIdentityLeaks('当前范围 SHC002-US · US · USD', identifiers)).toEqual([]);
  });

  it('normalizes store-specific business facts without store or browser identity fields', () => {
    const projection = normalizeBusinessFactProjection({
      scope: {
        asin: ' B0GTTJFQTM ',
        batchId: ' batch_shc001_20260722 ',
        storeName: 'SHC001-US',
      },
      products: [
        { asin: 'B0GVRW2HPY', storeId: 'preview-store-shc001' },
        { asin: 'B0GTTJFQTM', browserProfileId: 'preview-profile-shc001' },
        { asin: 'B0GTTJFQTM' },
      ],
      keywordFacts: [
        { asin: 'B0GTTJFQTM', keyword: ' shc001 smart lock ', storeId: 'preview-store-shc001' },
      ],
    });

    expect(projection).toEqual({
      scope: {
        asin: 'B0GTTJFQTM',
        batchId: 'batch_shc001_20260722',
      },
      productAsins: ['B0GTTJFQTM', 'B0GVRW2HPY'],
      keywordFacts: [
        { asin: 'B0GTTJFQTM', keyword: 'shc001 smart lock' },
      ],
    });
    expect(JSON.stringify(projection)).not.toMatch(/storeId|browserProfileId|storeName/);
  });

  it('fails closed when the preview business projection lacks store-specific facts', () => {
    expect(() => normalizeBusinessFactProjection({
      scope: { asin: 'B0GTTJFQTM', batchId: 'batch_shc001_20260722' },
      products: [],
      keywordFacts: [],
    })).toThrow(/must include products and keyword facts/);
  });

  it('keeps requested evidence output below the repository output directory', () => {
    const repoRoot = path.resolve('D:/example/amazon-ai-ops');
    const target = resolveEvidenceOutputDir(
      repoRoot,
      'output/codex-evidence/stage7-focused',
      'unused',
    );

    expect(isPathWithin(path.join(repoRoot, 'output'), target)).toBe(true);
    expect(() => resolveEvidenceOutputDir(repoRoot, '../escape', 'unused'))
      .toThrow(/must be a child/);
    expect(() => resolveEvidenceOutputDir(repoRoot, 'output', 'unused'))
      .toThrow(/must be a child/);
  });

  it('parses the single focused output option and rejects unknown CLI arguments', () => {
    const repoRoot = path.resolve('D:/example/amazon-ai-ops');

    expect(parseArguments(
      ['--output', 'output/codex-evidence/stage7-focused'],
      repoRoot,
    )).toMatchObject({
      help: false,
      outputDir: path.join(repoRoot, 'output', 'codex-evidence', 'stage7-focused'),
    });
    expect(parseArguments(['--help'], repoRoot).help).toBe(true);
    expect(() => parseArguments(['--headed'], repoRoot)).toThrow(/Unknown argument/);
  });

  it('counts resolved grid tracks without splitting function arguments', () => {
    expect(gridTrackCount('942px')).toBe(1);
    expect(gridTrackCount('245px 687px')).toBe(2);
    expect(gridTrackCount('minmax(0px, 1fr) minmax(470px, 1.35fr)')).toBe(2);
  });

  it('dispatches a real DOM click without Playwright actionability waiting', async () => {
    const locator = {
      dispatchEvent: vi.fn().mockResolvedValue(undefined),
      click: vi.fn(),
    };

    await dispatchDomClick(locator);

    expect(locator.dispatchEvent).toHaveBeenCalledOnce();
    expect(locator.dispatchEvent).toHaveBeenCalledWith('click');
    expect(locator.click).not.toHaveBeenCalled();
  });

  it('settles on the evidence identity even when a descendant remains locally busy', () => {
    expect(workspaceSettleReady({
      headingCount: 1,
      headingText: '实时执行',
      activeTabCount: 1,
      localBusyCount: 3,
    })).toBe(true);
    expect(workspaceSettleReady({
      headingCount: 1,
      headingText: '',
      activeTabCount: 1,
      localBusyCount: 0,
    })).toBe(false);
    expect(workspaceSettleReady({
      headingCount: 1,
      headingText: '实时执行',
      activeTabCount: 2,
      localBusyCount: 0,
    })).toBe(false);
  });

  it('creates a v2 no-readiness-credit manifest without production access claims', () => {
    const sourceHashes = {
      runnerSha256: 'a'.repeat(64),
      contractSha256: 'b'.repeat(64),
      rendererTreeSha256: 'c'.repeat(64),
    };
    const manifest = createManifest([], {}, {}, {}, sourceHashes);

    expect(manifest).toMatchObject({
      kind: 'mission-control-ui-evidence',
      schemaVersion: 'mission-control-ui-evidence/v2',
      status: 'STAGE7_UI_EVIDENCE',
      readinessImpact: 'NO_FINAL_READINESS_CREDIT',
      finalReadinessCredit: false,
      source: {
        runtime: 'vite-dev-preview',
        scenario: 'diagnosis-ready',
        realLoginAccessed: false,
        authorityDatabaseAccessed: false,
        adsWriteAttempted: false,
      },
    });
    expect(manifest.source).toMatchObject(sourceHashes);
  });

  it('fails closed when any evidence source changes between capture start and completion', () => {
    const start = {
      runnerSha256: 'a'.repeat(64),
      contractSha256: 'b'.repeat(64),
      rendererTreeSha256: 'c'.repeat(64),
    };

    expect(assertSourceHashesStable(start, { ...start })).toEqual(start);
    expect(() => assertSourceHashesStable(start, {
      ...start,
      rendererTreeSha256: 'd'.repeat(64),
    })).toThrow(/source changed while screenshots were being captured/i);
  });

  it('persists the candidate before evaluation and retains it when validation fails', () => {
    const order = [];
    let evaluationOptions;
    let validationOptions;
    const violation = {
      code: 'MINIMUM_WINDOW_EXECUTION_CLIPPED',
      path: 'minimumWindowCapture.executionLayout',
      message: 'Execution table is clipped.',
      actual: 2,
      expected: 1,
    };
    const reportViolation = vi.fn((value) => order.push(`report:${value.code}`));

    expect(() => persistAndValidateManifest(
      { kind: 'candidate' },
      'output/codex-evidence/focused/manifest.json',
      {
        writeManifest: () => order.push('write'),
        evaluate: (_manifest, options) => {
          order.push('evaluate');
          evaluationOptions = options;
          return { passed: false, violations: [violation] };
        },
        validate: (_manifest, options) => {
          order.push('validate');
          validationOptions = options;
          throw new Error('canonical validation failure');
        },
        reportViolation,
      },
    )).toThrow(/candidate retained/);

    expect(order).toEqual([
      'write',
      'evaluate',
      'validate',
      'report:MINIMUM_WINDOW_EXECUTION_CLIPPED',
    ]);
    expect(reportViolation).toHaveBeenCalledWith(violation);
    expect(evaluationOptions).toEqual(validationOptions);
    expect(evaluationOptions).toMatchObject({
      expectedSourceHashes: {
        runnerSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rendererTreeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      verifyScreenshotFiles: true,
    });
  });
});
