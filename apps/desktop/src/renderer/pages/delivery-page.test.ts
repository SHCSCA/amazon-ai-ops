import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDeliveryItems, buildDeliveryOverviewFacts, buildDeliveryReadbackRepairIntent, buildManifestActions, canExportDeliveryBundle, deliveryActionButtonView, deliveryCopySummaryActionView, deliveryTextForDisplay, findReadbackBlockerGate, packageEvidenceSummary, readbackBlockerSummary, readbackSessionStatusCopy } from './delivery-page';

describe('buildDeliveryOverviewFacts', () => {
  it('keeps the delivery first screen to short operator facts instead of long manifest paths', () => {
    const facts = buildDeliveryOverviewFacts({
      scopeSummary: 'FT-US-US / US / 2026-06-01 - 2026-06-12 / USD',
      realFileCount: 8,
      importedRows: 96,
      readinessStatusText: '未就绪',
      gateSummaryText: '5/7 通过',
      packageSummaryText: 'C:/release/AmazonAIOpsAgent-1.5.0-portable.exe / SHA-256 ABCDEF123456...',
    });

    expect(facts).toEqual([
      { label: '运营范围', value: 'FT-US-US / US / 2026-06-01 - 2026-06-12 / USD' },
      { label: '真实数据', value: '8 个文件 / 96 行' },
      { label: '最终验收', value: '未就绪 / 5/7 通过' },
      { label: '安装包', value: '已记录' },
    ]);
    expect(facts.map((item) => item.value).join(' ')).not.toContain('C:/release');
  });
});

describe('buildManifestActions', () => {
  it('surfaces final readiness review and blocker reasons instead of only generic action items', () => {
    const actions = buildManifestActions({
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      gates: [
        {
          name: 'ai-evidence',
          ok: false,
          message: 'AI 候选动作无法绑定当前范围内的真实广告对象。',
        },
      ],
      gatesSummary: { total: 1, passed: 0, failed: 1 },
      missing: ['缺少产品 ASIN。'],
      actionItems: ['补齐真实广告报表 sourceFile/sourceRow。'],
      recommendationReviewReasons: ['AI 阶段判断引用的指标证据缺少产品 ASIN。'],
      reviewBlockers: ['当前范围指标证据缺少真实广告报表 sourceFile/sourceRow。'],
      deliveryReviewReasons: ['交付包缺少最终复核说明。'],
      finalReadinessBlockers: ['AI 候选动作无法绑定当前范围内的真实广告对象。'],
    } as any);

    expect(actions).toContain('补齐真实广告报表 sourceFile/sourceRow。');
    expect(actions).toContain('缺少产品 ASIN。');
    expect(actions).toContain('AI 阶段判断引用的指标证据缺少产品 ASIN。');
    expect(actions).toContain('当前范围指标证据缺少真实广告报表 sourceFile/sourceRow。');
    expect(actions).toContain('交付包缺少最终复核说明。');
    expect(actions.filter((item) => item === 'AI 候选动作无法绑定当前范围内的真实广告对象。')).toHaveLength(1);
  });
});

describe('deliveryTextForDisplay', () => {
  it('translates final readiness and evidence terms before showing them in delivery UI', () => {
    const text = deliveryTextForDisplay('APP_READY final readiness gate needs session-input.json before/after readback verifier and manifest hash.');

    expect(text).toContain('可交付状态');
    expect(text).toContain('最终验收项');
    expect(text).toContain('填写文件');
    expect(text).toContain('执行前/执行后回读');
    expect(text).toContain('本地校验');
    expect(text).toContain('最终验收汇总');
    expect(text).toContain('校验码');
    expect(text).not.toMatch(/final readiness|session-input|before\/after|verifier|manifest|hash/i);
  });
});

describe('readbackSessionStatusCopy', () => {
  it('translates readback work package check details to operator wording', () => {
    const copy = readbackSessionStatusCopy({
      ready: true,
      captureReady: false,
      captureMissingFields: [
        { group: '执行前', label: '执行前 Ads UI live bid' },
        { group: '执行后', label: '执行后 Ads UI live bid' },
      ],
    });

    expect(copy.detail).toBe('还需填写：执行前/现场出价、执行后/现场出价');
    expect(copy.detail).not.toContain('Ads UI');
  });

  it('does not expose session-input or verifier when capture is ready', () => {
    const copy = readbackSessionStatusCopy({ ready: true, captureReady: true });

    expect(copy.detail).toBe('填写文件已补齐，可生成回读证据并进入本地校验。');
    expect(copy.detail).not.toMatch(/session-input|verifier/i);
  });
});

describe('packageEvidenceSummary', () => {
  it('formats package path and hash without treating missing evidence as ready', () => {
    expect(packageEvidenceSummary(null)).toBe('安装包未记录');
    expect(packageEvidenceSummary({
      installerAvailable: true,
      installerPath: 'C:/release/AmazonAIOpsAgent-1.5.0.exe',
      portablePath: 'C:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
      sha256: 'ABCDEF1234567890',
      latestBuiltAt: '2026-06-17T12:00:00.000Z',
    })).toBe('C:/release/AmazonAIOpsAgent-1.5.0-portable.exe / SHA-256 ABCDEF123456...');
  });
});

describe('canExportDeliveryBundle', () => {
  const readyReadiness = {
    available: true,
    path: 'C:/evidence/final-readiness.json',
    exists: true,
    status: 'APP_READY',
    appReady: true,
    manifestDriven: true,
    gates: [],
    gatesSummary: { total: 1, passed: 1, failed: 0 },
  } as any;

  const recordedPackage = {
    installerAvailable: true,
    installerPath: 'C:/release/AmazonAIOpsAgent-1.5.0.exe',
    portablePath: 'C:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
    sha256: 'ABCDEF123456',
  } as any;

  it('only allows bundle export after final readiness and package evidence are both recorded', () => {
    expect(canExportDeliveryBundle(readyReadiness, recordedPackage)).toBe(true);
    expect(canExportDeliveryBundle({ ...readyReadiness, appReady: false }, recordedPackage)).toBe(false);
    expect(canExportDeliveryBundle({ ...readyReadiness, manifestDriven: false }, recordedPackage)).toBe(false);
    expect(canExportDeliveryBundle(readyReadiness, null)).toBe(false);
    expect(canExportDeliveryBundle(readyReadiness, { ...recordedPackage, installerAvailable: false })).toBe(false);
  });

  it('keeps the blocked export button physically disabled with a red forbidden cursor contract', () => {
    const source = readFileSync(new URL('./delivery-page.tsx', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('disabled: !deliveryReady');
    expect(source).toContain('disabled={exportBundleButton.disabled}');
    expect(source).toContain('delivery-export-blocked');
    expect(stylesheet).toContain('.delivery-export-blocked:disabled');
    expect(stylesheet).toContain('cursor: no-drop');
    expect(stylesheet).toContain('var(--tone-blocked-border)');
    expect(stylesheet).toContain('content: ""');
  });
});

describe('deliveryActionButtonView', () => {
  it('locks delivery async action peers while only the active action shows busy feedback', () => {
    const active = deliveryActionButtonView({
      action: 'refresh-final',
      activeAction: 'refresh-final',
      baseClassName: 'primary-button',
      busyLabel: '刷新中...',
      idleLabel: '用回读证据刷新最终验收',
    });

    expect(active.label).toBe('刷新中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    const lockedPeer = deliveryActionButtonView({
      action: 'verify-readback-evidence',
      activeAction: 'refresh-final',
      baseClassName: 'secondary-button',
      busyLabel: '校验中...',
      idleLabel: '校验回读证据',
    });

    expect(lockedPeer.label).toBe('校验回读证据');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });
});

describe('deliveryCopySummaryActionView', () => {
  it('gives the delivery summary copy action its own busy feedback contract', () => {
    const onClick = () => undefined;
    const active = deliveryCopySummaryActionView({
      copying: true,
      onClick,
    });

    expect(active.label).toBe('复制摘要');
    expect(active.busy).toBe(true);
    expect(active.busyLabel).toBe('复制中...');
    expect(active.disabled).toBe(true);
    expect(active.onClick).toBe(onClick);

    const lockedByDeliveryAction = deliveryCopySummaryActionView({
      copying: false,
      disabled: true,
      onClick,
    });

    expect(lockedByDeliveryAction.label).toBe('复制摘要');
    expect(lockedByDeliveryAction.busy).toBe(false);
    expect(lockedByDeliveryAction.busyLabel).toBe('复制中...');
    expect(lockedByDeliveryAction.disabled).toBe(true);
  });
});

describe('readback blocker helpers', () => {
  it('finds the failed readback gate and includes the candidate path in the operator summary', () => {
    const gate = findReadbackBlockerGate({
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      gates: [
        {
          name: 'Report collection',
          ok: true,
          message: 'Full 8 report collection passed.',
        },
        {
          name: 'Real ad execution readback',
          ok: false,
          message: 'Current candidate is missing before/after/reload readback proof.',
          evidencePath: 'C:/evidence/real-ad-execution-readback-candidate-rec-4-current.json',
        },
      ],
      gatesSummary: { total: 2, passed: 1, failed: 1 },
    } as any);

    expect(gate?.name).toBe('Real ad execution readback');
    expect(readbackBlockerSummary(gate)).toContain('当前候选动作缺少执行前、执行后和刷新回读证明。');
    expect(readbackBlockerSummary(gate)).toContain('real-ad-execution-readback-candidate-rec-4-current.json');
  });

  it('does not treat passed readback gates as blockers', () => {
    const gate = findReadbackBlockerGate({
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_READY',
      appReady: true,
      manifestDriven: true,
      gates: [
        {
          name: 'Real ad execution readback',
          ok: true,
          message: 'Readback passed.',
          evidencePath: 'C:/evidence/readback.json',
        },
      ],
      gatesSummary: { total: 1, passed: 1, failed: 0 },
    } as any);

    expect(gate).toBeNull();
    expect(readbackBlockerSummary(gate)).toContain('没有检测到广告回读');
  });

  it('builds a delivery-to-readback repair intent with the candidate path and evidence step', () => {
    const intent = buildDeliveryReadbackRepairIntent({
      name: 'Real ad execution readback',
      ok: false,
      message: 'Current candidate is missing before/after/reload readback proof.',
      evidencePath: 'C:/evidence/readback-candidate.json',
    } as any);

    expect(intent).toMatchObject({
      source: 'delivery',
      step: 'evidence',
      candidatePath: 'C:/evidence/readback-candidate.json',
    });
    expect(intent.missingFields).toEqual(expect.arrayContaining(['执行前截图', '执行后截图', '回读证据']));
    expect(intent.summary).toContain('当前候选动作缺少执行前、执行后和刷新回读证明。');
  });

  it('persists the repair intent before navigating to readback', () => {
    const source = readFileSync(new URL('./delivery-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('READBACK_REPAIR_INTENT_STORAGE_KEY');
    expect(source).toContain('READBACK_REPAIR_INTENT_EVENT');
    expect(source).toContain("navigate('readback')");
    expect(source).toContain('直达补执行证据');
  });
});

describe('buildDeliveryItems', () => {
  it('separates APP_READY manifest from installer package evidence', () => {
    const readiness = {
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_READY',
      appReady: true,
      manifestDriven: true,
      gates: [],
      gatesSummary: { total: 0, passed: 0, failed: 0 },
    } as any;

    const withoutPackage = buildDeliveryItems(null, readiness, null);
    const blockedPackage = withoutPackage.find((item) => item.title === '安装包');
    expect(blockedPackage?.tone).toBe('pending');
    expect(blockedPackage?.summary).toContain('安装包/校验码还未记录');

    const withPackage = buildDeliveryItems(null, readiness, {
      package: {
        installerAvailable: true,
        installerPath: 'C:/release/AmazonAIOpsAgent-1.5.0.exe',
        portablePath: 'C:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
        sha256: 'ABCDEF123456',
        latestBuiltAt: '2026-06-17T12:00:00.000Z',
      },
    } as any);
    const readyPackage = withPackage.find((item) => item.title === '安装包');

    expect(readyPackage?.tone).toBe('ready');
    expect(readyPackage?.summary).toContain('安装包/校验码已记录');
    expect(readyPackage?.evidence).toContain('安装包：C:/release/AmazonAIOpsAgent-1.5.0.exe');
    expect(readyPackage?.evidence).toContain('免安装版：C:/release/AmazonAIOpsAgent-1.5.0-portable.exe');
    expect(readyPackage?.evidence).toContain('SHA-256：ABCDEF123456');
  });

  it('uses the same readiness blocker reasons in the current blocker card', () => {
    const items = buildDeliveryItems(null, {
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      gates: [],
      gatesSummary: { total: 0, passed: 0, failed: 0 },
      missing: [],
      actionItems: [],
      recommendationReviewReasons: ['AI 候选缺少可回查证据引用。'],
      reviewBlockers: ['真实报表 sourceRow 缺失。'],
      deliveryReviewReasons: [],
      finalReadinessBlockers: [],
    } as any);

    const blockerItem = items.find((item) => item.title === '当前阻塞项');

    expect(blockerItem?.actions).toContain('AI 候选缺少可回查证据引用。');
    expect(blockerItem?.actions).toContain('真实报表 sourceRow 缺失。');
  });
});
