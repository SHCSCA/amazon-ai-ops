import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { governanceFixture } from './v16-native-ui-governance-fixture.mjs';
const cases = [['propertypage', 'tabpanel', true], ['propertypage', 'button', false], ['propertypages', 'tabpanel', false],
  ['heading', 'tabpanel', false], ['editabletext', 'textbox', true], ['radiobutton', 'radio', true]];
describe('精确原生角色映射闭包保留raw角色和全部其它门', () => {
  it.each(cases)('Python gainFocus ACK与实际speech读取%s→%s仅固定映射接受=%s', (raw, canonical, passed) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-role-model-'));
    const output = execFileSync('python', [path.resolve('scripts/v16-nvda-role-test-model.py'), directory,
      path.resolve('scripts/v16-nvda-speech-observer.py'), raw, canonical, passed ? 'accept' : 'reject'], { encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(output)).toEqual({ isolatedModel: true, rawRolePreserved: true, focusAckAndSpeechMatch: true,
      accepted: passed, actualNvdaCredit: false, ownerHandleClosed: true });
  });
  it.each(cases)('JS provider与最终治理回放%s→%s保持原件且接受=%s', (raw, canonical, passed) => {
    const value = governanceFixture();
    try {
      value.changeSpeech((lines, observation) => {
        const line = lines[1], witness = line.providerWitness;
        line.role = canonical; witness.request.role = canonical;
        value.update(witness.speechSource.focusModeReceipt, receipt => { receipt.request.role = canonical; receipt.node.role = canonical; });
        for (const key of ['hostBefore', 'hostAfter']) witness[key].dom.role = canonical;
        for (const row of line.actualNvdaRows) { row.request.role = canonical; row.focusRole = raw; }
        value.update(observation.dom, dom => { dom.nodes.find(node => node.id === line.targetId).role = canonical; });
        value.rewriteRaw(witness, rows => { for (const row of line.actualNvdaRows) rows[row.rawIndex] = row; });
        expect(line.actualNvdaRows[0].focusRole).toBe(raw);
        expect(Object.keys(witness.request)).toHaveLength(8);
      });
      if (passed) expect(value.verify()).toBe(true);
      else expect(() => value.verify()).toThrow('UI_NVDA_PROVIDER_ACTUAL_NAME_OR_ROLE_MISMATCH');
    } finally { value.cleanup(); }
  });
});
