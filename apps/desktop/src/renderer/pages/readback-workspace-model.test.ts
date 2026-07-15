import { describe, expect, it } from 'vitest';
import {
  buildReadbackQueryKey,
  canPublishReadbackResult,
  readbackAuthorityForMode,
  readbackGlobalBusyView,
  readbackRepairBlockersForMissing,
  readbackRepairActions,
  resolveReadbackScreenshotRepairAction,
  resolveReadbackExportRoute,
  runCurrentReadbackFinalVerification,
  runReadbackFinalVerificationWorkflow,
} from './readback-workspace-model';

describe('runReadbackFinalVerificationWorkflow', () => {
  it('exports once and sends an authoritative PASS export directly to the verifier', async () => {
    const calls: string[] = [];

    const result = await runReadbackFinalVerificationWorkflow({
      exportEvidence: async () => {
        calls.push('export');
        return {
          status: 'PASS',
          readyForVerifier: true,
          nextAction: 'verify',
          jsonPath: 'D:/evidence/readback-pass.json',
        };
      },
      verifyEvidence: async (evidencePath) => {
        calls.push(`verify:${evidencePath}`);
        return { ready: true, status: 'PASS' };
      },
    });

    expect(calls).toEqual([
      'export',
      'verify:D:/evidence/readback-pass.json',
    ]);
    expect(result).toEqual({
      kind: 'verification-result',
      exportResult: {
        status: 'PASS',
        readyForVerifier: true,
        nextAction: 'verify',
        jsonPath: 'D:/evidence/readback-pass.json',
      },
      verifyResult: { ready: true, status: 'PASS' },
    });
  });

  it('publishes NEEDS_WORK without verifying or invoking any work-package mutation', async () => {
    const calls: string[] = [];
    const exportResult = {
      status: 'NEEDS_WORK',
      readyForVerifier: false,
      nextAction: 'prepare',
      jsonPath: 'D:/evidence/readback-gap.json',
    };

    const result = await runReadbackFinalVerificationWorkflow({
      exportEvidence: async () => {
        calls.push('export');
        return exportResult;
      },
      verifyEvidence: async () => {
        calls.push('verify');
        return { ready: true, status: 'PASS' };
      },
    });

    expect(calls).toEqual(['export']);
    expect(result).toEqual({
      kind: 'needs-work',
      exportResult,
      sourcePath: 'D:/evidence/readback-gap.json',
    });
  });

  it('returns a neutral verification result when the direct verifier rejects the exported PASS candidate', async () => {
    const result = await runReadbackFinalVerificationWorkflow({
      exportEvidence: async () => ({
        status: 'PASS',
        readyForVerifier: true,
        nextAction: 'verify',
        jsonPath: 'D:/evidence/readback-pass-candidate.json',
      }),
      verifyEvidence: async () => ({ ready: false, status: 'NEEDS_WORK', issues: ['authority changed'] }),
    });

    expect(result.kind).toBe('verification-result');
    if (result.kind === 'verification-result') {
      expect(result.verifyResult).toEqual({
        ready: false,
        status: 'NEEDS_WORK',
        issues: ['authority changed'],
      });
    }
  });
});

describe('runCurrentReadbackFinalVerification', () => {
  it('does not publish an outer workflow result after its scope snapshot becomes stale', async () => {
    let resolveTask: ((value: { kind: string }) => void) | undefined;
    let current = true;
    const published: Array<{ kind: string }> = [];
    const task = new Promise<{ kind: string }>((resolve) => {
      resolveTask = resolve;
    });

    const pending = runCurrentReadbackFinalVerification(
      () => task,
      () => current,
      (result) => published.push(result),
    );
    current = false;
    resolveTask?.({ kind: 'verification-result' });

    await expect(pending).resolves.toBeUndefined();
    expect(published).toEqual([]);
  });
});

describe('resolveReadbackExportRoute', () => {
  it('routes a ready PASS export directly to verifier with the exported JSON', () => {
    expect(resolveReadbackExportRoute({
      status: 'PASS',
      readyForVerifier: true,
      nextAction: 'verify',
      jsonPath: 'D:/evidence/readback-pass.json',
    })).toEqual({
      kind: 'direct-verify',
      evidencePath: 'D:/evidence/readback-pass.json',
    });
  });

  it('routes NEEDS_WORK only to the work-package preparation path', () => {
    expect(resolveReadbackExportRoute({
      status: 'NEEDS_WORK',
      readyForVerifier: false,
      nextAction: 'prepare',
      jsonPath: 'D:/evidence/readback-gap.json',
    })).toEqual({
      kind: 'prepare-session',
      sourcePath: 'D:/evidence/readback-gap.json',
    });
  });

  it('fails closed for unknown, contradictory, or pathless export results', () => {
    expect(resolveReadbackExportRoute({
      status: 'UNKNOWN',
      readyForVerifier: true,
      nextAction: 'verify',
      jsonPath: 'D:/evidence/unknown.json',
    })).toEqual({ kind: 'blocked', reason: 'unsupported-status' });
    expect(resolveReadbackExportRoute({
      status: 'PASS',
      readyForVerifier: false,
      nextAction: 'verify',
      jsonPath: 'D:/evidence/contradictory.json',
    })).toEqual({ kind: 'blocked', reason: 'contract-mismatch' });
    expect(resolveReadbackExportRoute({
      status: 'NEEDS_WORK',
      readyForVerifier: false,
      nextAction: 'prepare',
      jsonPath: '  ',
    })).toEqual({ kind: 'blocked', reason: 'missing-json-path' });
  });
});

describe('buildReadbackQueryKey', () => {
  it('binds every readback query to date, store, site, ASIN, and batch', () => {
    expect(buildReadbackQueryKey({
      dateFrom: ' 2026-06-01 ',
      dateTo: '2026-06-30',
      storeName: ' FT-US-US ',
      marketplaceCode: ' US ',
      asin: ' B0TEST123 ',
      batchId: ' batch-42 ',
    })).toBe(JSON.stringify({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TEST123',
      batchId: 'batch-42',
    }));
  });

  it('changes when any authoritative query field changes', () => {
    const base = {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TEST123',
      batchId: 'batch-42',
    };
    const baseKey = buildReadbackQueryKey(base);

    for (const [field, value] of [
      ['dateFrom', '2026-05-01'],
      ['dateTo', '2026-07-01'],
      ['storeName', 'FT-CA-CA'],
      ['marketplaceCode', 'CA'],
      ['asin', 'B0OTHER'],
      ['batchId', 'batch-43'],
    ] as const) {
      expect(buildReadbackQueryKey({ ...base, [field]: value })).not.toBe(baseKey);
    }
  });
});

describe('canPublishReadbackResult', () => {
  const active = {
    kind: 'rows' as const,
    requestId: 7,
    queryKey: 'query-current',
    formEpoch: 3,
  };

  it('publishes only the current request snapshot', () => {
    expect(canPublishReadbackResult(active, { ...active })).toBe(true);
  });

  it('rejects stale rows by request id and stale export by query key', () => {
    expect(canPublishReadbackResult(
      { ...active, requestId: 6 },
      active,
    )).toBe(false);
    expect(canPublishReadbackResult(
      { ...active, kind: 'export', queryKey: 'query-old' },
      { ...active, kind: 'export' },
    )).toBe(false);
  });

  it('rejects stale verification after the form epoch changes', () => {
    expect(canPublishReadbackResult(
      { ...active, kind: 'verify', formEpoch: 2 },
      { ...active, kind: 'verify', formEpoch: 3 },
    )).toBe(false);
  });

  it('rejects stale work-package mutations after scope or form identity changes', () => {
    expect(canPublishReadbackResult(
      { ...active, kind: 'session', queryKey: 'query-old' },
      { ...active, kind: 'session', queryKey: 'query-current' },
    )).toBe(false);
    expect(canPublishReadbackResult(
      { ...active, kind: 'session', formEpoch: 2 },
      { ...active, kind: 'session', formEpoch: 3 },
    )).toBe(false);
  });

  it('rejects a screenshot save that completes after the active scope changes', () => {
    expect(canPublishReadbackResult(
      { ...active, kind: 'capture', queryKey: 'query-old' },
      { ...active, kind: 'capture', queryKey: 'query-current' },
    )).toBe(false);
  });
});

describe('readbackAuthorityForMode', () => {
  it('allows production workflow capabilities without inventing readiness', () => {
    expect(readbackAuthorityForMode('production', { appReady: true })).toEqual({
      mode: 'production',
      previewOnly: false,
      appReady: true,
      capabilities: {
        captureEvidence: true,
        exportEvidence: true,
        prepareSession: true,
        verifySession: true,
        fillSession: true,
        verifyEvidence: true,
      },
    });
    expect(readbackAuthorityForMode('production').appReady).toBe(false);
  });

  it('forces preview-readonly to expose no write or verifier capability and never APP_READY', () => {
    const authority = readbackAuthorityForMode('preview-readonly', { appReady: true });

    expect(authority.mode).toBe('preview-readonly');
    expect(authority.previewOnly).toBe(true);
    expect(authority.appReady).toBe(false);
    expect(Object.values(authority.capabilities)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('readbackRepairActions', () => {
  it('derives at most two repairs from current screenshot and value blockers, then exposes verification only when those are clear', () => {
    expect(readbackRepairBlockersForMissing([
      '审批凭证',
      '回读值',
      '执行前、执行后和回读证据文件不能复用',
    ])).toEqual(['screenshot', 'value']);
    expect(readbackRepairBlockersForMissing([
      '时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读',
    ])).toEqual(['verification']);
    expect(readbackRepairBlockersForMissing([])).toEqual(['verification']);
  });

  it('targets the first missing screenshot, including the approval step before execution evidence', () => {
    const base = readbackRepairActions(['screenshot'])[0];
    expect(resolveReadbackScreenshotRepairAction(base, {
      approvalArtifactPath: '',
      beforeScreenshotPath: '',
      afterScreenshotPath: '',
      readbackEvidencePath: '',
    })).toMatchObject({ stepId: 'approval', focusTarget: 'readback-first-missing-screenshot' });
    expect(resolveReadbackScreenshotRepairAction(base, {
      approvalArtifactPath: 'approval.png',
      beforeScreenshotPath: 'before.png',
      afterScreenshotPath: '',
      readbackEvidencePath: '',
    })).toMatchObject({ stepId: 'evidence', focusTarget: 'readback-first-missing-screenshot' });
  });

  it('maps screenshot, value, and verification blockers to one exact repair target each', () => {
    expect(readbackRepairActions(['screenshot', 'value', 'verification'])).toEqual([
      {
        blocker: 'screenshot',
        label: '补交截图',
        stepId: 'evidence',
        focusTarget: 'readback-first-missing-screenshot',
      },
      {
        blocker: 'value',
        label: '填写回读值',
        stepId: 'evidence',
        focusTarget: 'readback-actual-value',
      },
      {
        blocker: 'verification',
        label: '运行最终校验',
        stepId: 'verify-export',
        focusTarget: 'readback-verify-evidence',
      },
    ]);
  });

  it('deduplicates repeated blockers without creating competing repair actions', () => {
    const actions = readbackRepairActions([
      'verification',
      'screenshot',
      'verification',
      'value',
      'screenshot',
    ]);

    expect(actions).toHaveLength(3);
    expect(new Set(actions.map((action) => action.blocker)).size).toBe(3);
    expect(new Set(actions.map((action) => action.label)).size).toBe(3);
    expect(new Set(actions.map((action) => action.focusTarget)).size).toBe(3);
  });
});

describe('readbackGlobalBusyView', () => {
  it('marks only the active action busy while locking the whole workspace action group', () => {
    expect(readbackGlobalBusyView({
      action: 'export-evidence',
      activeAction: 'export-evidence',
    })).toEqual({
      workspaceLocked: true,
      peerLocked: false,
      disabled: true,
      ariaBusy: true,
      showSpinner: true,
    });
    expect(readbackGlobalBusyView({
      action: 'verify-evidence',
      activeAction: 'export-evidence',
    })).toEqual({
      workspaceLocked: true,
      peerLocked: true,
      disabled: true,
      ariaBusy: undefined,
      showSpinner: false,
    });
  });

  it('keeps idle actions available unless their own prerequisite disables them', () => {
    expect(readbackGlobalBusyView({
      action: 'verify-evidence',
      activeAction: null,
    })).toEqual({
      workspaceLocked: false,
      peerLocked: false,
      disabled: false,
      ariaBusy: undefined,
      showSpinner: false,
    });
    expect(readbackGlobalBusyView({
      action: 'verify-evidence',
      activeAction: null,
      disabled: true,
    }).disabled).toBe(true);
  });
});
