import { describe, expect, it } from 'vitest';
import { parseAcceptanceIds, parseMustRequirements } from './verify-v16-required-test-manifest.js';
describe('验收编号范围', () => {
  it('展开PRD完整可访问性范围并去重', () => {
    expect(parseAcceptanceIds('AC-ACC-001～AC-ACC-017、AC-ACC-009～AC-ACC-017')).toEqual(Array.from({ length: 17 }, (_, i) => `AC-ACC-${String(i + 1).padStart(3, '0')}`));
    expect(parseMustRequirements('| V16-UI-001 | MUST | 完整范围 | AC-ACC-009～AC-ACC-011 |')[0].acceptanceIds).toEqual(['AC-ACC-009', 'AC-ACC-010', 'AC-ACC-011']);
  });
  it.each(['AC-ACC-017～AC-ACC-001', 'AC-ACC-001～AC-UI-017', 'AC-ACC-001～AC-ACC-17', 'AC-ACC-001～AC-ACC-9999', 'AC-ACC-001～bad'])('拒绝异常范围%s', value => {
    expect(() => parseAcceptanceIds(value)).toThrow(/INVALID_ACCEPTANCE_RANGE/);
  });
});
