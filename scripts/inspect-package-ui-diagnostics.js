module.exports = function createInspectorModule(dependencies) {
  const {
    DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT,
    DIAGNOSTIC_MESSAGE_LIMIT,
    DIAGNOSTIC_STACK_LIMIT,
    SENSITIVE_DIAGNOSTIC_KEY,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const validIsoDate = (...args) => dependencies.validIsoDate(...args);

function redactDiagnosticSecrets(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_ACCOUNT]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|authorization|cookie|password|pwd|secret|session(?:[_-]?(?:id|key|token))?|token|username|user[_-]?name|account)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/(--(?:api[-_]?key|access[-_]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[-_]?(?:id|key|token))?|token|username|user[-_]?name|account))(\s*=\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '$1$2[REDACTED]')
    .replace(/(\b(?:authorization|proxy-authorization)\s*[:=])[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\b(?:cookie|set-cookie)\s*:)[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\bbearer\s+)[A-Za-z0-9._~+/-]{6,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[_ -]?(?:id|key|token))?|token|username|user_name|account)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,]+)/gi, '$1[REDACTED]');
}

function sanitizeDiagnosticText(value, maximumLength = DIAGNOSTIC_MESSAGE_LIMIT) {
  return redactDiagnosticSecrets(value).slice(0, maximumLength);
}

function cloneSecretBlindDiagnosticRecord(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeDiagnosticText(value, DIAGNOSTIC_STACK_LIMIT);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || depth >= 12) return sanitizeDiagnosticText(String(value));
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, 200).map((entry) => cloneSecretBlindDiagnosticRecord(entry, depth + 1, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [rawKey, entry] of Object.entries(value).slice(0, 200)) {
    const key = sanitizeDiagnosticText(rawKey, 160);
    result[key] = SENSITIVE_DIAGNOSTIC_KEY.test(key)
      ? '[REDACTED]'
      : cloneSecretBlindDiagnosticRecord(entry, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

function diagnosticsMatch(diagnostics, expectedProfileId) {
  const lifecycle = diagnostics?.lifecycle;
  return diagnostics?.schemaVersion === 'package-ui-run-diagnostics/v2'
    && diagnostics?.profileId === expectedProfileId
    && validIsoDate(diagnostics?.startedAt)
    && validIsoDate(diagnostics?.completedAt)
    && Date.parse(diagnostics.completedAt) >= Date.parse(diagnostics.startedAt)
    && lifecycle?.limit === DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
    && Number.isInteger(lifecycle?.droppedCount)
    && lifecycle.droppedCount >= 0
    && Array.isArray(lifecycle?.events)
    && lifecycle.events.length <= DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
    && typeof lifecycle?.unexpectedCloseObserved === 'boolean'
    && (lifecycle.runnerCloseRequestedAt === null || validIsoDate(lifecycle.runnerCloseRequestedAt))
    && (
      lifecycle.processExit === null
      || (
        validIsoDate(lifecycle.processExit?.at)
        && (Number.isInteger(lifecycle.processExit?.code) || lifecycle.processExit?.code === null)
        && typeof lifecycle.processExit?.runnerCloseRequested === 'boolean'
        && (lifecycle.processExit?.signal === null || typeof lifecycle.processExit?.signal === 'string')
      )
    )
    && canonicalJson(diagnostics) === canonicalJson(cloneSecretBlindDiagnosticRecord(diagnostics));
}

function validStructuredFailure(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && validIsoDate(value.at)
    && typeof value.message === 'string'
    && typeof value.name === 'string'
    && typeof value.phase === 'string'
    && typeof value.stack === 'string'
    && canonicalJson(value) === canonicalJson(cloneSecretBlindDiagnosticRecord(value));
}

function attemptOutcomeMatches(receipt) {
  const diagnosticsFailure = receipt?.diagnostics?.failure ?? null;
  if (receipt?.passed === true) {
    return receipt.failure === null
      && diagnosticsFailure === null
      && receipt.diagnostics?.phase === 'completed';
  }
  return receipt?.passed === false
    && receipt.diagnostics?.phase === 'failed'
    && validStructuredFailure(receipt.failure)
    && canonicalJson(receipt.failure) === canonicalJson(diagnosticsFailure);
}

  return {
    redactDiagnosticSecrets,
    sanitizeDiagnosticText,
    cloneSecretBlindDiagnosticRecord,
    diagnosticsMatch,
    validStructuredFailure,
    attemptOutcomeMatches,
  };
};
