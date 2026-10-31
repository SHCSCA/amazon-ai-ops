import { describe, expect, it, vi } from 'vitest';
import { reportParserDiagnostic, assertReportParserDiagnostic } from './report-parser-diagnostics';
import { stringifyBoundedReportResult } from './report-parser-json-budget';

describe('fixed report Worker failure diagnostics', () => {
  it('retains resource code/stage and ordered primary/secondary errors without messages, paths or the first stack line', () => {
    const first = Object.assign(new Error('PRIVATE_ROW_VALUE C:/private/report.xlsx'), { name: 'ReportResourceError', code: 'REPORT_RESOURCE_LIMIT', stage: 'zip-entry-expanded' });
    const second = new Error('PRIVATE_LOG_VALUE');
    const error = Object.assign(new AggregateError([first, second], 'PRIVATE_AGGREGATE_VALUE'), { code: first.code, stage: first.stage });
    const diagnostic = reportParserDiagnostic(error, 'report');
    assertReportParserDiagnostic(diagnostic);
    expect(diagnostic).toMatchObject({ code: 'REPORT_RESOURCE_LIMIT', stage: 'zip-entry-expanded', secondary: [
      { code: 'REPORT_RESOURCE_LIMIT', stage: 'zip-entry-expanded' }, { code: 'REPORT_PARSER_FAILED' },
    ] });
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE_|private|[A-Z]:[\\/]|\.xlsx|\.test\.ts/);
  });
  it('does not interpret an arbitrary uppercase source-bearing error message as a safe system code', () => {
    expect(reportParserDiagnostic(new Error('PRIVATE_ROW_VALUE'), 'preflight').code).toBe('REPORT_PARSER_FAILED');
    expect(reportParserDiagnostic(new Error('REPORT_PRIVATE_ROW_VALUE'), 'preflight').code).toBe('REPORT_PARSER_FAILED');
    expect(reportParserDiagnostic(Object.assign(new Error('private'), { code: 'REPORT_PRIVATE_ROW_VALUE' }), 'preflight').code).toBe('REPORT_PARSER_FAILED');
  });
  it.each([{ name: 'Error', code: 'REPORT_FAILED', stage: 'parse', frames: ['C:/private/report.xlsx:1:2'], secondary: [] },
    { name: 'Error', code: 'PRIVATE_VALUE', stage: 'parse', frames: [], secondary: [] },
    { name: 'Error', code: 'REPORT_FAILED', stage: 'parse', frames: [], secondary: [], message: 'PRIVATE_ROW' }])('rejects non-contract diagnostic %j', value => {
    expect(() => assertReportParserDiagnostic(value)).toThrow('REPORT_PARSER_DIAGNOSTIC_INVALID');
  });
});

describe('report result serialization prebudget', () => {
  const limits = { maxResultBytes: 4096, maxResultDepth: 16, maxResultNodes: 1000 };
  it('counts escaped UTF8, lone surrogates, sparse arrays and repeated references exactly', () => {
    const shared = { text: '引号"\\\n\u0000😀\ud800' };
    const value = { absent: undefined, repeated: [shared, shared], sparse: [, null, -0, 1e21] };
    expect(stringifyBoundedReportResult(value, limits)).toBe(JSON.stringify(value));
  });
  it('rejects a repeated-label amplification before JSON.stringify is invoked', () => {
    const shared = { label: 'x'.repeat(500) }, value = Array.from({ length: 100 }, () => shared);
    const stringify = vi.spyOn(JSON, 'stringify');
    let error: unknown;
    try { stringifyBoundedReportResult(value, limits); } catch (caught) { error = caught; }
    const calls = stringify.mock.calls.length; stringify.mockRestore();
    expect(error).toMatchObject({ message: 'REPORT_PARSER_RESULT_LIMIT' });
    expect(calls).toBe(0);
  });
  it('rejects cyclic, accessor, custom class and deep result graphs', () => {
    const cyclic: any = {}; cyclic.self = cyclic;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('GETTER_MUST_NOT_RUN'); } });
    for (const value of [cyclic, getter, new Date()]) expect(() => stringifyBoundedReportResult(value, limits)).toThrow('REPORT_PARSER_RESULT_INVALID');
    let deep: unknown = null; for (let index = 0; index < 30; index++) deep = { deep };
    expect(() => stringifyBoundedReportResult(deep, limits)).toThrow('REPORT_PARSER_RESULT_LIMIT');
  });
});
