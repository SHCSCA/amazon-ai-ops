import type { ReportParserLimits } from './report-parser-worker-contracts';

function stringBytes(text: string): number {
  let bytes = 2;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}
export function stringifyBoundedReportResult(value: unknown, limits: Pick<ReportParserLimits, 'maxResultBytes' | 'maxResultDepth' | 'maxResultNodes'>): string {
  const pending: Array<{ value: unknown; depth: number; arrayItem?: boolean; index?: number; keys?: string[]; emitted?: number }> = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let bytes = 0, nodes = 0;
  const add = (amount: number) => { bytes += amount; if (bytes > limits.maxResultBytes) throw new Error('REPORT_PARSER_RESULT_LIMIT'); };
  while (pending.length) {
    const entry = pending.pop()!, item = entry.value;
    if (entry.index !== undefined) {
      const array = Array.isArray(item), keys = entry.keys;
      const length = array ? item.length : keys!.length;
      if (entry.index >= length) { ancestors.delete(item as object); continue; }
      const key = array ? String(entry.index) : keys![entry.index];
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor && !('value' in descriptor)) throw new Error('REPORT_PARSER_RESULT_INVALID');
      const child = descriptor?.value, emitted = entry.emitted ?? 0;
      const include = array || child !== undefined;
      pending.push({ ...entry, index: entry.index + 1, emitted: emitted + (include ? 1 : 0) });
      if (include) {
        add((emitted ? 1 : 0) + (array ? 0 : stringBytes(key) + 1));
        pending.push({ value: child, depth: entry.depth + 1, arrayItem: array });
      }
      continue;
    }
    if (++nodes > limits.maxResultNodes || entry.depth > limits.maxResultDepth) throw new Error('REPORT_PARSER_RESULT_LIMIT');
    if (item === null || item === undefined && entry.arrayItem) { add(4); continue; }
    if (typeof item === 'string') { add(stringBytes(item)); continue; }
    if (typeof item === 'boolean') { add(item ? 4 : 5); continue; }
    if (typeof item === 'number' && Number.isFinite(item)) { add(String(item).length); continue; }
    if (!item || typeof item !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(item))
      || ancestors.has(item) || Object.getOwnPropertyDescriptor(item, 'toJSON')) throw new Error('REPORT_PARSER_RESULT_INVALID');
    ancestors.add(item); add(2);
    if (Array.isArray(item)) {
      if (item.length > limits.maxResultNodes) throw new Error('REPORT_PARSER_RESULT_LIMIT');
      pending.push({ value: item, depth: entry.depth, index: 0 });
    } else {
      const keys = Object.keys(item);
      if (keys.length > limits.maxResultNodes) throw new Error('REPORT_PARSER_RESULT_LIMIT');
      pending.push({ value: item, depth: entry.depth, index: 0, keys });
    }
  }
  // 重复引用按每次实际序列化计费；通过前置预算后才允许创建完整 JSON 字符串。
  const json = JSON.stringify(value);
  if (typeof json !== 'string' || Buffer.byteLength(json) !== bytes) throw new Error('REPORT_PARSER_RESULT_ENCODING_MISMATCH');
  return json;
}
