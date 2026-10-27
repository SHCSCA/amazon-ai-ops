// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT,
    DIAGNOSTIC_MESSAGE_LIMIT,
    DIAGNOSTIC_STACK_LIMIT,
    SENSITIVE_DIAGNOSTIC_KEY,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const packageUiAttemptCleanupEvidencePassed = (...args) => dependencies.packageUiAttemptCleanupEvidencePassed(...args);

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
  const boundedMaximum = Number.isInteger(maximumLength) && maximumLength > 0
    ? maximumLength
    : DIAGNOSTIC_MESSAGE_LIMIT;
  return redactDiagnosticSecrets(value)
    .slice(0, boundedMaximum);
}

function cloneSecretBlindDiagnosticRecord(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeDiagnosticText(value, DIAGNOSTIC_STACK_LIMIT);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || depth >= 12) {
    return sanitizeDiagnosticText(String(value), DIAGNOSTIC_MESSAGE_LIMIT);
  }
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .slice(0, 200)
      .map((entry) => cloneSecretBlindDiagnosticRecord(entry, depth + 1, seen));
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

function packageUiAttemptDiagnosticsSnapshotMatches(diagnostics, expectedProfileId) {
  const lifecycle = diagnostics?.lifecycle;
  return diagnostics?.schemaVersion === 'package-ui-run-diagnostics/v2'
    && diagnostics?.profileId === expectedProfileId
    && lifecycle?.limit === DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
    && Number.isInteger(lifecycle?.droppedCount)
    && lifecycle.droppedCount >= 0
    && Array.isArray(lifecycle?.events)
    && lifecycle.events.length <= DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
    && typeof lifecycle?.unexpectedCloseObserved === 'boolean'
    && (
      lifecycle.runnerCloseRequestedAt === null
      || Number.isFinite(Date.parse(lifecycle.runnerCloseRequestedAt))
    )
    && (
      lifecycle.processExit === null
      || (
        Number.isFinite(Date.parse(lifecycle.processExit?.at))
        && (Number.isInteger(lifecycle.processExit?.code) || lifecycle.processExit?.code === null)
        && typeof lifecycle.processExit?.runnerCloseRequested === 'boolean'
        && (
          lifecycle.processExit?.signal === null
          || typeof lifecycle.processExit?.signal === 'string'
        )
      )
    )
    && canonicalJson(diagnostics) === canonicalJson(
      cloneSecretBlindDiagnosticRecord(diagnostics),
    );
}

function createStructuredFailure(error, phase = 'unknown') {
  const source = error instanceof Error ? error : new Error(String(error || 'Unknown failure'));
  return {
    at: new Date().toISOString(),
    message: sanitizeDiagnosticText(source.message, DIAGNOSTIC_MESSAGE_LIMIT),
    name: sanitizeDiagnosticText(source.name || 'Error', 120),
    phase: sanitizeDiagnosticText(phase || 'unknown', 160),
    stack: sanitizeDiagnosticText(source.stack || '', DIAGNOSTIC_STACK_LIMIT),
  };
}

function validPackageUiStructuredFailure(failure) {
  return Boolean(
    failure
    && typeof failure === 'object'
    && !Array.isArray(failure)
    && Object.keys(failure).sort().join(',')
      === 'at,message,name,phase,stack'
    && Number.isFinite(Date.parse(failure.at))
    && typeof failure.message === 'string'
    && failure.message.length > 0
    && failure.message.length <= DIAGNOSTIC_MESSAGE_LIMIT
    && typeof failure.name === 'string'
    && failure.name.length > 0
    && failure.name.length <= 120
    && typeof failure.phase === 'string'
    && failure.phase.length > 0
    && failure.phase.length <= 160
    && typeof failure.stack === 'string'
    && failure.stack.length <= DIAGNOSTIC_STACK_LIMIT
    && canonicalJson(failure) === canonicalJson(
      cloneSecretBlindDiagnosticRecord(failure),
    )
  );
}

function packageUiAttemptOutcomeMatches(payload) {
  if (
    typeof payload?.passed !== 'boolean'
    || typeof payload?.resumable !== 'boolean'
  ) {
    return false;
  }
  if (payload.passed === true) {
    return payload.resumable === true
      && payload.failure === null
      && payload.diagnostics?.failure === null
      && payload.diagnostics?.phase === 'completed'
      && packageUiAttemptCleanupEvidencePassed(payload.cleanupEvidence);
  }
  return validPackageUiStructuredFailure(payload.failure)
    && canonicalJson(payload.failure)
      === canonicalJson(payload.diagnostics?.failure)
    && payload.diagnostics?.phase === 'failed';
}

  return {
    redactDiagnosticSecrets,
    sanitizeDiagnosticText,
    cloneSecretBlindDiagnosticRecord,
    packageUiAttemptDiagnosticsSnapshotMatches,
    createStructuredFailure,
    validPackageUiStructuredFailure,
    packageUiAttemptOutcomeMatches,
  };
};
