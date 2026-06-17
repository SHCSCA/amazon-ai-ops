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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validEvidence(overrides = {}) {
  return {
    kind: 'installed-ad-ai-explanation',
    status: 'PASS',
    runtimeMode: 'packaged-app',
    readinessImpact: 'FINAL_READINESS_CREDIT',
    safety: {
      adAiExplanationOnly: true,
      adWriteActionsPerformed: false,
      full8Started: false,
      reportTypesRequested: [],
    },
    ai: {
      keyPresent: true,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      testSuccess: true,
    },
    adAiExplanation: {
      settingsRestored: true,
    },
    recommendations: [{
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      entityId: 'Campaign_AdGroup_close_match',
      entityName: 'close match',
      actionType: 'lower_bid',
      currentValue: '1.20',
      recommendedValue: '1.08',
      explanationSource: 'ai',
      aiExplanation: '基于当前真实广告数据和规则阈值，建议降低该投放对象出价。',
      aiModel: 'deepseek-v4-flash',
      metricDate: '2026-06-12',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      sourceRow: 12,
    }],
    ...overrides,
  };
}

describe('verify ad AI explanation evidence', () => {
  it('rejects evidence that contains bearer-token shaped secret material', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-ai-explanation-secret-'));
    const evidencePath = path.join(dir, 'installed-ad-ai-explanation-secret.json');
    writeJson(evidencePath, validEvidence({
      debugRequest: {
        authorization: 'Bearer abcdefghijklmnopqrstuvwxyz1234567890',
      },
    }));

    const result = runNode('scripts/verify-ad-ai-explanation-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('appears to contain an API key');
  });

  it('rejects AI explanation evidence that only points at a stale non-executable recommendation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-ai-explanation-stale-'));
    const evidencePath = path.join(dir, 'installed-ad-ai-explanation-stale.json');
    writeJson(evidencePath, validEvidence({
      recommendations: [{
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        entityId: 'Campaign_AdGroup_close_match',
        entityName: 'close match',
        actionType: 'lower_bid',
        currentValue: '1.20',
        recommendedValue: '',
        explanationSource: 'ai',
        aiExplanation: '这是历史 AI 解释，但缺少可执行建议值和来源行。',
        aiModel: 'deepseek-v4-flash',
        metricDate: '2026-06-12',
        sourceFiles: ['C:/reports/user-search-term.xlsx'],
      }],
    }));

    const result = runNode('scripts/verify-ad-ai-explanation-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('missing executable recommended value');
  });

  it('accepts saved-key evidence without restore proof when settings were not changed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-ai-explanation-saved-key-'));
    const evidencePath = path.join(dir, 'installed-ad-ai-explanation-saved-key.json');
    writeJson(evidencePath, validEvidence({
      aiSettingsChanged: false,
      ai: {
        keyPresent: true,
        storedKeyAccepted: true,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        testSuccess: true,
      },
      adAiExplanation: undefined,
    }));

    const result = runNode('scripts/verify-ad-ai-explanation-evidence.js', [evidencePath]);

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('AI settings were not modified during evidence run');
  });
});
