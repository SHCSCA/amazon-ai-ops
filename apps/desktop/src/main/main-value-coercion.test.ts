import { afterEach, describe, expect, it, vi } from 'vitest';
import { finiteNumberOrUndefined, parseIntegerSetting, parseJsonArray, parseNumberSetting,
  parseStringArray, stringOrUndefined } from './main-value-coercion';
import { runtimeLogger } from './runtime-logger';

afterEach(() => { vi.restoreAllMocks(); });

describe('Main value coercion', () => {
  it('preserves JSON arrays and rejects non-array shapes', () => {
    expect(parseJsonArray('[1,"two"]')).toEqual([1, 'two']);
    expect(parseJsonArray('{"one":1}')).toEqual([]);
    expect(parseJsonArray(null)).toEqual([]);
    expect(parseStringArray('[1,true]')).toEqual(['1', 'true']);
  });

  it('records malformed persisted JSON without logging its content', () => {
    const warn = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => undefined);
    expect(parseJsonArray('secret-persisted-content')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('main.json_array_invalid', { errorName: 'SyntaxError' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-persisted-content');
  });

  it('retains explicit empty and non-finite fallback semantics', () => {
    expect(stringOrUndefined('value')).toBe('value');
    expect(stringOrUndefined('')).toBeUndefined();
    expect(finiteNumberOrUndefined('2.5')).toBe(2.5);
    expect(finiteNumberOrUndefined(Number.NaN)).toBeUndefined();
    expect(parseNumberSetting('bad', 4)).toBe(4);
    expect(parseIntegerSetting('2.9', 4)).toBe(2);
    expect(parseIntegerSetting(Number.POSITIVE_INFINITY, 4)).toBe(4);
  });
});
