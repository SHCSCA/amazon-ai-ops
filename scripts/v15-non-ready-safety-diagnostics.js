// 按职责复用原有严格校验，公共入口继续保持兼容。

const { DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT, DIAGNOSTIC_RENDERER_ENTRY_LIMIT, samePath } = require('./v15-non-ready-safety-contracts.js');

function processSnapshotIsStrictlyZero(snapshot, expectedProfilePath, requireAttempts = false) {
    if (snapshot?.passed !== true
        || !Number.isInteger(snapshot?.observedCount)
        || snapshot.observedCount < 0
        || !Array.isArray(snapshot?.matching)
        || snapshot?.matchingCount !== 0
        || snapshot.matchingCount !== snapshot.matching.length
        || !Array.isArray(snapshot?.unresolved)
        || snapshot?.unresolvedCount !== 0
        || snapshot.unresolvedCount !== snapshot.unresolved.length
        || snapshot.observedCount < snapshot.matchingCount + snapshot.unresolvedCount
        || snapshot?.error !== null
        || (requireAttempts && (!Number.isInteger(snapshot?.attempts) || snapshot.attempts < 1))) {
        return false;
    }
    if (expectedProfilePath && !samePath(snapshot.profilePath, expectedProfilePath))
        return false;
    return true;
}

function containsCommandLineField(value) {
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some((item) => containsCommandLineField(item));
    return Object.entries(value).some(([key, item]) => (/^commandline$/i.test(key) || containsCommandLineField(item)));
}

function processIsolationIsStrictlyValid(evidence, expectedProfilePath = null) {
    return evidence?.passed === true
        && processSnapshotIsStrictlyZero(evidence.before, expectedProfilePath)
        && processSnapshotIsStrictlyZero(evidence.after, expectedProfilePath, true)
        && (!expectedProfilePath || !containsCommandLineField(evidence));
}

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

function diagnosticValueIsSanitized(value, depth = 0) {
    if (depth > 12)
        return false;
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number')
        return true;
    if (typeof value === 'string') {
        if (value.length > 4000)
            return false;
        return redactDiagnosticSecrets(value) === value;
    }
    if (Array.isArray(value))
        return value.every((item) => diagnosticValueIsSanitized(item, depth + 1));
    if (typeof value !== 'object')
        return false;
    return Object.entries(value).every(([entryKey, item]) => (!/^(?:api[_-]?key|password|passwd|pwd|secret|token|access[_-]?token|authorization|cookie|set-cookie|session(?:[_-]?(?:id|key|token))?|username|user[_-]?name|account|commandline)$/i.test(entryKey)
        && diagnosticValueIsSanitized(item, depth + 1)));
}

function electronLifecycleIsStrictlyValid(lifecycle, startedAt, completedAt) {
    const events = lifecycle?.events;
    const runnerCloseRequestedAt = Date.parse(lifecycle?.runnerCloseRequestedAt);
    const processExitAt = Date.parse(lifecycle?.processExit?.at);
    const terminalKinds = new Set([
        'electron-app-closed',
        'electron-context-closed',
        'electron-process-exit',
        'window-closed',
        'window-crashed',
    ]);
    let previousEventAt = startedAt;
    const eventsValid = Array.isArray(events)
        && events.length >= 3
        && events.length <= DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
        && events.every((event) => {
            const at = Date.parse(event?.at);
            const valid = Number.isFinite(at)
                && at >= startedAt
                && at <= completedAt
                && at >= previousEventAt
                && typeof event?.kind === 'string'
                && event.kind.length > 0
                && event.kind.length <= 80
                && typeof event?.phase === 'string'
                && event.phase.length > 0
                && event.phase.length <= 160
                && typeof event?.runnerCloseRequested === 'boolean'
                && (!terminalKinds.has(event.kind) || event.runnerCloseRequested === true);
            previousEventAt = Number.isFinite(at) ? at : previousEventAt;
            return valid;
        });
    const runnerCloseEvents = Array.isArray(events)
        ? events.filter((event) => event.kind === 'runner-close-requested')
        : [];
    const processExitEvents = Array.isArray(events)
        ? events.filter((event) => event.kind === 'electron-process-exit')
        : [];
    const runnerCloseIndex = Array.isArray(events)
        ? events.findIndex((event) => event.kind === 'runner-close-requested')
        : -1;
    const processExitIndex = Array.isArray(events)
        ? events.findIndex((event) => event.kind === 'electron-process-exit')
        : -1;
    return lifecycle?.limit === DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
        && lifecycle?.droppedCount === 0
        && lifecycle?.unexpectedCloseObserved === false
        && Number.isFinite(runnerCloseRequestedAt)
        && runnerCloseRequestedAt >= startedAt
        && runnerCloseRequestedAt <= completedAt
        && lifecycle?.processExit?.code === 0
        && lifecycle?.processExit?.signal === null
        && lifecycle?.processExit?.runnerCloseRequested === true
        && Number.isFinite(processExitAt)
        && processExitAt >= runnerCloseRequestedAt
        && processExitAt <= completedAt
        && eventsValid
        && events.some((event, index) => (event.kind === 'window-attached'
            && event.runnerCloseRequested === false
            && index < runnerCloseIndex))
        && events.every((event, index) => (event.kind !== 'window-attached'
            || (event.runnerCloseRequested === false && index < runnerCloseIndex)))
        && runnerCloseEvents.length === 1
        && runnerCloseEvents[0].runnerCloseRequested === true
        && runnerCloseEvents[0].at === lifecycle.runnerCloseRequestedAt
        && processExitEvents.length === 1
        && processExitEvents[0].runnerCloseRequested === true
        && processExitEvents[0].code === lifecycle.processExit.code
        && processExitEvents[0].signal === lifecycle.processExit.signal
        && processExitEvents[0].at === lifecycle.processExit.at
        && runnerCloseIndex >= 0
        && processExitIndex === events.length - 1
        && events.every((event, index) => (!terminalKinds.has(event.kind) || index > runnerCloseIndex))
        && !events.some((event) => event.kind === 'window-crashed');
}

function runDiagnosticsAreStrictlyValid(diagnostics, run, expectedProfileId) {
    const startedAt = Date.parse(diagnostics?.startedAt);
    const completedAt = Date.parse(diagnostics?.completedAt);
    const loginStartedAt = Date.parse(diagnostics?.login?.startedAt);
    const loginCompletedAt = Date.parse(diagnostics?.login?.completedAt);
    const timeline = diagnostics?.timeline;
    const loginAttempts = diagnostics?.login?.attempts;
    const renderer = diagnostics?.renderer;
    const successfulLoginOutcomes = new Set([
        'existing-authenticated-session',
        'interactive-operator-login',
        'saved-credentials-auto-login',
        'saved-credentials-login',
    ]);
    const timelineValid = Array.isArray(timeline)
        && timeline.length >= 2
        && timeline.every((item) => (Number.isFinite(Date.parse(item?.at))
            && Date.parse(item.at) >= startedAt
            && Date.parse(item.at) <= completedAt
            && typeof item?.phase === 'string'
            && item.phase.length > 0
            && item.phase.length <= 160))
        && timeline.at(-1)?.phase === 'completed';
    const loginAttemptsValid = Array.isArray(loginAttempts)
        && loginAttempts.every((attempt) => (Number.isInteger(attempt?.attempt)
            && attempt.attempt >= 1
            && Number.isFinite(Date.parse(attempt?.startedAt))
            && Number.isFinite(Date.parse(attempt?.completedAt))
            && Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt)
            && typeof attempt?.outcome === 'string'
            && attempt.outcome !== 'in-progress'
            && typeof attempt?.retryable === 'boolean'
            && (attempt.message === null || typeof attempt.message === 'string')));
    return diagnostics?.schemaVersion === 'package-ui-run-diagnostics/v2'
        && diagnostics?.profileId === expectedProfileId
        && Number.isFinite(startedAt)
        && Number.isFinite(completedAt)
        && completedAt >= startedAt
        && diagnostics.phase === 'completed'
        && diagnostics.failure === null
        && Array.isArray(diagnostics.cleanupErrors)
        && diagnostics.cleanupErrors.length === 0
        && timelineValid
        && renderer?.limits?.consoleErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
        && renderer?.limits?.pageErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
        && renderer?.droppedCount?.consoleErrors === 0
        && renderer?.droppedCount?.pageErrors === 0
        && Array.isArray(renderer?.consoleErrors)
        && renderer.consoleErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
        && renderer.consoleErrors.length === 0
        && Array.isArray(renderer?.pageErrors)
        && renderer.pageErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
        && renderer.pageErrors.length === 0
        && electronLifecycleIsStrictlyValid(diagnostics.lifecycle, startedAt, completedAt)
        && Array.isArray(run?.consoleErrors)
        && run.consoleErrors.length === 0
        && Array.isArray(run?.pageErrors)
        && run.pageErrors.length === 0
        && Number.isFinite(loginStartedAt)
        && Number.isFinite(loginCompletedAt)
        && loginCompletedAt >= loginStartedAt
        && successfulLoginOutcomes.has(diagnostics?.login?.outcome)
        && loginAttemptsValid
        && diagnosticValueIsSanitized(diagnostics);
}

module.exports = { processSnapshotIsStrictlyZero, containsCommandLineField, processIsolationIsStrictlyValid, redactDiagnosticSecrets, diagnosticValueIsSanitized, electronLifecycleIsStrictlyValid, runDiagnosticsAreStrictlyValid };
