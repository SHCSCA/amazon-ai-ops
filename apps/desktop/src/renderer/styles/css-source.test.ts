import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStyleComposition } from './css-source.test-support';

function directory(): string { return mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-css-contract-')); }
describe('standard CSS composition source contracts', () => {
  it('follows ordered local CSS imports and keeps selector, declaration, media and keyframe order', () => {
    const root = directory();
    writeFileSync(path.join(root, 'entry.css'), '@import "./foundation.css";\n@import url("./override.css");\n');
    writeFileSync(path.join(root, 'foundation.css'), '.same{color:red;color:blue!important}\n@media (min-width:1px){.same{color:green}}\n');
    writeFileSync(path.join(root, 'override.css'), '@keyframes flash{to{opacity:0}}\n.same{color:black}\n');
    const css = readStyleComposition(path.join(root, 'entry.css'));
    expect(css).toContain('.same{color:red;color:blue!important}');
    expect(css.indexOf('color:green')).toBeLessThan(css.indexOf('@keyframes flash'));
    expect(css.indexOf('@keyframes flash')).toBeLessThan(css.indexOf('color:black'));
    expect(css).not.toContain('@import');
  });
  it('rejects cycles, nested or trailing imports and unsupported remote imports instead of skipping rules', () => {
    const root = directory(), entry = path.join(root, 'entry.css');
    writeFileSync(path.join(root, 'child.css'), '@import "./entry.css";');
    for (const css of ['@import "./child.css";', '.rule{color:red}\n@import "./child.css";',
      '@media (min-width:1px){@import "./child.css";}', '@import "https://example.invalid/style.css";']) {
      writeFileSync(entry, css); expect(() => readStyleComposition(entry)).toThrow();
    }
  });
});
