import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import governance from './v16-ui-governance.js';
const document = fs.readFileSync(governance.SOURCE, 'utf8');

describe('versioned UI terminology and accessibility delta governance', () => {
  it('reads the one companion source with all declared operator terms and owned primitive risks without granting acceptance credit', () => {
    const current = governance.parseUiGovernance(document);
    expect(current.terminology.map(row => row.term)).toEqual(governance.REQUIRED_TERMS);
    expect(current.accessibility.map(row => row.primitive)).toEqual(governance.REQUIRED_PRIMITIVES);
    expect(current.accessibility.every(row => row.owner && row.keyboardFocusRisk && row.screenReaderRisk && row.motionZoomRisk && row.method)).toBe(true);
    expect(current.accessibility.every(row => row.status === 'PENDING')).toBe(true);
    expect(current).not.toHaveProperty('accepted');
    expect(current).not.toHaveProperty('currentPackagePassed');
  });
  it.each(['UI 术语表', 'Accessibility Delta Register'])('rejects the missing canonical %s section', heading => {
    expect(() => governance.parseUiGovernance(document.replace(`## ${heading}`, `## removed-${heading}`))).toThrow(/SECTION_MISSING/);
  });
  it.each(['v16.ui-terminology/1', 'v16.accessibility-delta/1'])('rejects a stale %s contract', version => {
    expect(() => governance.parseUiGovernance(document.replace(version, 'v15.historical/1'))).toThrow(/VERSION_MISMATCH/);
  });
  it('rejects missing risk, owner, method, invalid status and a missing primitive instead of accepting a generic ARIA claim', () => {
    const line = document.split('\n').find(line => line.startsWith('| ReasonRequiredDialog |'));
    for (const index of [2, 3, 4, 5, 6]) {
      const cells = line.split('|'); cells[index + 1] = ' ';
      expect(() => governance.parseUiGovernance(document.replace(line, cells.join('|')))).toThrow(/ROW_INVALID/);
    }
    expect(() => governance.parseUiGovernance(document.replace(line, line.replace('PENDING', 'ARIA_PRESENT')))).toThrow(/STATUS_INVALID/);
    expect(() => governance.parseUiGovernance(document.replace(line, ''))).toThrow(/INVENTORY_MISMATCH/);
  });
  it('does not produce current-package evidence or acceptance when all metadata rows are changed to PASS', () => {
    const current = governance.parseUiGovernance(document.replaceAll('| PENDING |', '| PASS |'));
    expect(current.accessibility.every(row => row.status === 'PASS')).toBe(true);
    expect(current).not.toHaveProperty('evidence');
    expect(current).not.toHaveProperty('accepted');
    expect(current).not.toHaveProperty('currentPackagePassed');
  });
});
