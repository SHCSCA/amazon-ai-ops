import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { adReadbackEvidenceToMarkdown, buildAdReadbackEvidence, type AdReadbackEvidenceInput } from './ad-readback-evidence';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-readback-'));
  tempDirs.push(dir);
  return dir;
}

function writePng(filePath: string): string {
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return filePath;
}

function completeInput(): AdReadbackEvidenceInput {
  const dir = makeTempDir();
  return {
    approval: {
      operatorConfirmed: true,
      realWriteApproved: true,
      scope: 'Approved one low-risk target bid decrease for FT-US-US / US.',
      confirmedAt: '2026-06-10T10:00:00.000Z',
      approverName: 'Ops Owner',
      approvalArtifactPath: 'approval-ticket-123',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'target',
      entityName: 'close match',
      actionType: 'lower_bid',
    },
    risk: {
      allowedByPolicy: true,
      rationale: 'Small reversible bid decrease on one target.',
    },
    before: {
      value: '2.40',
      capturedAt: '2026-06-10T10:02:00.000Z',
      liveBidSourceNote: 'Read from Ads UI target bid cell before manual change.',
      screenshotPath: writePng(path.join(dir, 'before.png')),
    },
    after: {
      value: '2.16',
      capturedAt: '2026-06-10T10:04:00.000Z',
      screenshotPath: writePng(path.join(dir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: '2026-06-10T10:05:00.000Z',
      actualValue: '2.16',
      evidencePath: writePng(path.join(dir, 'readback.png')),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-123',
      executedAt: '2026-06-10T10:03:00.000Z',
      executedBy: 'operator@example.com',
    },
  };
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ad readback evidence builder', () => {
  it('keeps an empty export as NEEDS_WORK', () => {
    const evidence = buildAdReadbackEvidence({});

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.realWriteApproved).toBe(false);
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
    expect(evidence.execution.channel).toBe('manual_ads_ui');
    expect(evidence.execution.appExecutorUsed).toBe(false);
  });

  it('marks complete evidence ready for verifier while preserving manual Ads UI execution boundaries', () => {
    const evidence = buildAdReadbackEvidence(completeInput());

    expect(evidence.status).toBe('PASS');
    expect(evidence.realWriteApproved).toBe(true);
    expect(evidence.safety).toMatchObject({
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    });
    expect(evidence.execution).toMatchObject({
      success: true,
      verified: true,
      channel: 'manual_ads_ui',
      performedBy: 'operator@example.com',
      appExecutorUsed: false,
    });
    expect(evidence.notes.join('\n')).toContain('No ad write is performed by this export action');
  });

  it('does not accept recommendation CPC values as live before/after proof', () => {
    const input = completeInput();
    input.source = {
      currentValue: '2.40',
      recommendedValue: '2.16',
    };
    input.before = {
      value: 'FILL: value before write',
      liveBidSourceNote: 'FILL: source note',
      screenshotPath: input.before?.screenshotPath,
    };

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.source).toMatchObject({
      currentValue: '2.40',
      recommendedValue: '2.16',
    });
    expect(evidence.before.value).toBe('FILL: value before write');
  });

  it('does not mark evidence complete when explicit timestamps are missing', () => {
    const input = completeInput();
    delete input.before?.capturedAt;

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.before.capturedAt).toContain('FILL:');
  });

  it('renders markdown that points to verifier instead of final readiness', () => {
    const evidence = buildAdReadbackEvidence(completeInput());
    const markdown = adReadbackEvidenceToMarkdown(evidence, 'C:\\evidence\\readback.json');

    expect(markdown).toContain('pnpm run verify:ad-readback');
    expect(markdown).toContain('appExecutorUsed=false');
    expect(markdown).toContain('final acceptance still requires the verifier command above to pass');
  });
});
