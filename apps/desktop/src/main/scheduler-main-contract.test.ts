import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop scheduler scope contract', () => {
  it('runs scheduled recommendation generation with the persisted operation scope', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const registration = source.match(/name: 'daily_recommendation_generate',[\s\S]*?\n\s*\}\);/)?.[0] || '';

    expect(registration).toContain('runRecommendationGeneration(handleGetOperationScope())');
    expect(registration).not.toContain('runRecommendationGeneration();');
  });

  it('fails the daily report task when no artifact can be produced and propagates generation failures', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('async function runDailyReportGeneration');
    const body = source.slice(start, source.indexOf('// IPC Handlers', start));

    expect(body).toContain("if (!settings.aiApiKey)");
    expect(body).toContain("throw new Error('AI Key 未配置，无法生成每日运营报告。')");
    expect(body).toMatch(/catch \(err\) \{[\s\S]*?throw err;/);
  });
});
