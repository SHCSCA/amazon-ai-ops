import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import contract from './v16-companion-responsibilities.js';
const document = fs.readFileSync(contract.SOURCE, 'utf8');

describe('canonical companion specification responsibilities', () => {
  it('locates schema template projection evidence test and release in the three existing specifications and current trace inputs', () => {
    const result = contract.verifyResponsibilities(process.cwd());
    expect(result.rows.map(row => row.responsibility)).toEqual(contract.RESPONSIBILITIES);
    expect(new Set(result.rows.map(row => row.specification))).toEqual(new Set(contract.COMPANIONS));
    expect(result).not.toHaveProperty('accepted');
  });
  it('refuses missing duplicated and noncanonical responsibility sources instead of creating another truth', () => {
    const schema = document.split('\n').find(line => line.startsWith('| schema |'));
    expect(() => contract.parseResponsibilities(document.replace(schema, ''))).toThrow(/MISSING/);
    expect(() => contract.parseResponsibilities(document.replace('| template |', '| schema |'))).toThrow(/DUPLICATE/);
    expect(() => contract.parseResponsibilities(document.replace('v16.companion-responsibilities/1', 'v15.responsibilities/1'))).toThrow(/CONTRACT/);
    expect(() => contract.parseResponsibilities(document.replace(schema, schema.replace(contract.COMPANIONS[0], 'docs/parallel-truth.md')))).toThrow(/NOT_CANONICAL/);
  });
});
