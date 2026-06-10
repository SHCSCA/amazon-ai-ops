import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('ad readback candidate from recommendation evidence', () => {
  it('creates a non-passing target-scoped candidate without treating CPC as live bid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-candidate-'));
    const source = path.join(dir, 'source.json');
    const out = path.join(dir, 'candidate.json');
    const mdOut = path.join(dir, 'candidate.md');
    fs.writeFileSync(source, JSON.stringify({
      kind: 'installed-ad-ai-explanation',
      request: { storeName: 'FT-US-US', marketplaceCode: 'US' },
      recommendations: [{
        id: 1,
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        entityType: 'search_term',
        entityName: '紧密匹配',
        actionType: 'lower_bid',
        currentValue: '2.40',
        recommendedValue: '2.16',
        metricDate: '2026-05-23',
        evidence: {
          date: '2026-05-23',
          portfolioName: 'D6-20260518',
          campaignName: 'Test Campaign',
          adGroupName: 'Test Ad Group',
        },
      }],
    }, null, 2), 'utf8');

    const result = runNode('scripts/create-ad-readback-candidate-from-recommendation.js', [
      '--source', source,
      '--recommendation-id', '1',
      '--out', out,
      '--md-out', mdOut,
    ]);

    expect(result.status).toBe(0);
    const candidate = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(candidate.status).toBe('NEEDS_WORK');
    expect(candidate.realWriteApproved).toBe(false);
    expect(candidate.target.entityType).toBe('target');
    expect(candidate.source.entityType).toBe('search_term');
    expect(candidate.source.currentValue).toBe('2.40');
    expect(candidate.source.recommendedValue).toBe('2.16');
    expect(candidate.before.value).toContain('FILL:');
    expect(candidate.after.value).toContain('FILL:');
    const checklist = fs.readFileSync(mdOut, 'utf8');
    expect(checklist).toContain('Source current metric value');
    expect(checklist).toContain('2.40');
    expect(checklist).toContain('Test Campaign');

    const verify = runNode('scripts/verify-ad-readback-evidence.js', [out]);
    expect(verify.status).not.toBe(0);
    expect(`${verify.stdout}${verify.stderr}`).toContain('NEEDS_WORK: Real ad execution readback evidence is incomplete.');
  });

  it('falls back to entityId context for installed AI explanation summaries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-candidate-summary-'));
    const source = path.join(dir, 'source.json');
    const out = path.join(dir, 'candidate.json');
    const mdOut = path.join(dir, 'candidate.md');
    fs.writeFileSync(source, JSON.stringify({
      kind: 'installed-ad-ai-explanation',
      request: { storeName: 'FT-US-US', marketplaceCode: 'US' },
      recommendations: [{
        id: 1,
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0GTTJFQTM',
        entityType: 'search_term',
        entityId: 'D6-自动-低价探索 - 5/18/2026_D6-自动-卧室室内-挖词 - 5/18/2026_紧密匹配',
        entityName: '紧密匹配',
        actionType: 'lower_bid',
        currentValue: '2.40',
        recommendedValue: '2.16',
        metricDate: '2026-05-23',
      }],
    }, null, 2), 'utf8');

    const result = runNode('scripts/create-ad-readback-candidate-from-recommendation.js', [
      '--source', source,
      '--recommendation-id', '1',
      '--out', out,
      '--md-out', mdOut,
    ]);

    expect(result.status).toBe(0);
    const candidate = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(candidate.status).toBe('NEEDS_WORK');
    expect(candidate.realWriteApproved).toBe(false);
    expect(candidate.target.campaignName).toBe('D6-自动-低价探索 - 5/18/2026');
    expect(candidate.target.adGroupName).toBe('D6-自动-卧室室内-挖词 - 5/18/2026');
    expect(candidate.target.entityType).toBe('target');
    expect(candidate.target.entityName).toBe('紧密匹配');
    expect(candidate.source.currentValue).toBe('2.40');
    expect(candidate.source.recommendedValue).toBe('2.16');
    expect(candidate.before.value).toBe('FILL: value before write');
    expect(candidate.after.value).toBe('FILL: value after write');
    expect(candidate.readback.actualValue).toBe('FILL: must equal after.value');
    expect(JSON.stringify(candidate.before)).not.toContain('2.40');
    expect(JSON.stringify(candidate.after)).not.toContain('2.16');
    expect(candidate.risk.rationale).toContain('source values are recommendation inputs, not proven live Ads bid values');
    expect(candidate.risk.rationale).toContain('entityId fallback');

    const checklist = fs.readFileSync(mdOut, 'utf8');
    expect(checklist).toContain('D6-自动-低价探索 - 5/18/2026');
    expect(checklist).toContain('Source current metric value');
    expect(checklist).toContain('2.40');

    const verify = runNode('scripts/verify-ad-readback-evidence.js', [out]);
    expect(verify.status).not.toBe(0);
    expect(`${verify.stdout}${verify.stderr}`).toContain('NEEDS_WORK: Real ad execution readback evidence is incomplete.');
  });

  it('allows explicit source metric overrides for older summary evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-candidate-overrides-'));
    const source = path.join(dir, 'source.json');
    const out = path.join(dir, 'candidate.json');
    const mdOut = path.join(dir, 'candidate.md');
    fs.writeFileSync(source, JSON.stringify({
      kind: 'installed-ad-ai-explanation',
      request: { storeName: 'FT-US-US', marketplaceCode: 'US' },
      recommendations: [{
        id: 1,
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0GTTJFQTM',
        entityId: 'Campaign Name_Ad Group Name_紧密匹配',
        entityName: '紧密匹配',
        actionType: 'lower_bid',
        metricDate: '2026-05-23',
      }],
    }, null, 2), 'utf8');

    const result = runNode('scripts/create-ad-readback-candidate-from-recommendation.js', [
      '--source', source,
      '--recommendation-id', '1',
      '--source-entity-type', 'search_term',
      '--source-current-value', '2.40',
      '--source-recommended-value', '2.16',
      '--out', out,
      '--md-out', mdOut,
    ]);

    expect(result.status).toBe(0);
    const candidate = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(candidate.source.entityType).toBe('search_term');
    expect(candidate.source.currentValue).toBe('2.40');
    expect(candidate.source.recommendedValue).toBe('2.16');
    expect(candidate.target.entityType).toBe('target');
    expect(candidate.before.value).toBe('FILL: value before write');
    expect(candidate.after.value).toBe('FILL: value after write');
    expect(JSON.stringify(candidate.before)).not.toContain('2.40');
    expect(JSON.stringify(candidate.after)).not.toContain('2.16');

    const checklist = fs.readFileSync(mdOut, 'utf8');
    expect(checklist).toContain('Source entity type | search_term');
    expect(checklist).toContain('Source current metric value | 2.40');

    const verify = runNode('scripts/verify-ad-readback-evidence.js', [out]);
    expect(verify.status).not.toBe(0);
  });
});
