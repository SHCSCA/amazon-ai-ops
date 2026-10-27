const { stableRuntimeLogAlias, runtimeLogIdentityCategory, redactRuntimeLogText } = require('./runtime-log-privacy.cjs');
const SENSITIVE_KEY_PATTERN = /password|passwd|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|session[-_]?id/i;
const LIMITS = Object.freeze({ depth: 8, entries: 100, text: 8_000, nodes: 512, totalText: 32_768 });

function redactText(value, budget) {
  if (budget.textRemaining <= 0) return '[TextLimit]';
  const text = redactRuntimeLogText(value.slice(0, LIMITS.text));
  let end = 0;
  // 按 JSON 转义后的 UTF-8 开销扣减，中文及控制字符也不能突破整条预算。
  while (end < text.length) {
    const code = text.charCodeAt(end), next = text.charCodeAt(end + 1);
    const pair = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    const cost = code < 32 ? [8, 9, 10, 12, 13].includes(code) ? 2 : 6
      : code === 34 || code === 92 ? 2 : code < 128 ? 1 : code < 2048 ? 2
        : pair ? 4 : code >= 0xd800 && code <= 0xdfff ? 6 : 3;
    if (cost > budget.textRemaining) break;
    budget.textRemaining -= cost;
    end += pair ? 2 : 1;
  }
  return end === text.length ? text : text.slice(0, end) + '[TextLimit]';
}

function sanitizeRuntimeLogValue(value, seen = new WeakSet(), depth = 0, budget = { remaining: LIMITS.nodes, textRemaining: LIMITS.totalText }, identityCategory = null) {
  if (--budget.remaining < 0) return '[EntryLimit]';
  if (identityCategory && ['string', 'number', 'bigint'].includes(typeof value)) return redactText(stableRuntimeLogAlias(identityCategory, value), budget);
  if (typeof value === 'string') return redactText(value, budget);
  if (typeof value === 'bigint') return redactText(value.toString(), budget);
  if (typeof value === 'function') return '[Function]';
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= LIMITS.depth) return '[DepthLimit]';
  seen.add(value);
  try {
    if (value instanceof Error) {
      return {
        name: redactText(value.name, budget), message: redactText(value.message, budget),
        stack: value.stack ? redactText(value.stack, budget) : undefined,
        code: sanitizeRuntimeLogValue(value.code, seen, depth + 1, budget),
        cause: sanitizeRuntimeLogValue(value.cause, seen, depth + 1, budget),
        ...(value instanceof AggregateError ? { errors: sanitizeRuntimeLogValue(value.errors, seen, depth + 1, budget) } : {}),
      };
    }
    if (Array.isArray(value)) {
      const safeArray = [];
      for (const item of value.slice(0, LIMITS.entries)) {
        if (budget.remaining <= 0) { safeArray.push('[EntryLimit]'); break; }
        safeArray.push(sanitizeRuntimeLogValue(item, seen, depth + 1, budget, identityCategory));
      }
      return safeArray;
    }
    const safeRecord = Object.create(null);
    for (const key of Object.keys(value).slice(0, LIMITS.entries)) {
      if (budget.remaining <= 0) { safeRecord.entryLimit = '[EntryLimit]'; break; }
      const safeKey = redactText(key, budget).slice(0, 160);
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        budget.remaining -= 1;
        safeRecord[safeKey] = redactText('[REDACTED]', budget);
        continue;
      }
      try {
        safeRecord[safeKey] = sanitizeRuntimeLogValue(value[key], seen, depth + 1, budget, runtimeLogIdentityCategory(key));
      } catch {
        safeRecord[safeKey] = '[Unreadable]';
      }
    }
    return safeRecord;
  } catch {
    return '[Unreadable]';
  } finally {
    seen.delete(value);
  }
}

function createRuntimeLogRecord(level, event, context, now = new Date()) {
  if (!['info', 'warn', 'error'].includes(level)) throw new TypeError('日志级别无效。');
  if (typeof event !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(event)) throw new TypeError('日志事件无效。');
  return {
    timestamp: now.toISOString(), level, event,
    ...(context ? { context: sanitizeRuntimeLogValue(context) } : {}),
  };
}

exports.sanitizeRuntimeLogValue = sanitizeRuntimeLogValue;
exports.createRuntimeLogRecord = createRuntimeLogRecord;
