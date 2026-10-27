// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT,
    DIAGNOSTIC_RENDERER_ENTRY_LIMIT,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const createStructuredFailure = (...args) => dependencies.createStructuredFailure(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);

function createRunDiagnostics(profileId, startedAt = new Date()) {
  const timestamp = startedAt instanceof Date ? startedAt.toISOString() : new Date(startedAt).toISOString();
  return {
    cleanupErrors: [],
    completedAt: null,
    failure: null,
    login: {
      attempts: [],
      completedAt: null,
      connectionBootstrap: null,
      operatorHandoff: null,
      outcome: 'not-started',
      savedCredentials: null,
      startedAt: null,
    },
    phase: 'created',
    profileId,
    renderer: {
      consoleErrors: [],
      droppedCount: {
        consoleErrors: 0,
        pageErrors: 0,
      },
      limits: {
        consoleErrors: DIAGNOSTIC_RENDERER_ENTRY_LIMIT,
        pageErrors: DIAGNOSTIC_RENDERER_ENTRY_LIMIT,
      },
      pageErrors: [],
    },
    schemaVersion: 'package-ui-run-diagnostics/v2',
    startedAt: timestamp,
    storeGate: {
      completedAt: null,
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'not-started',
      selectedStore: null,
      startedAt: null,
    },
    lifecycle: {
      droppedCount: 0,
      events: [],
      limit: DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT,
      processExit: null,
      runnerCloseRequestedAt: null,
      unexpectedCloseObserved: false,
    },
    timeline: [{ at: timestamp, phase: 'created' }],
  };
}

function appendElectronLifecycleDiagnostic(
  diagnostics,
  kind,
  extra = {},
  at = new Date().toISOString(),
) {
  const lifecycle = diagnostics?.lifecycle;
  if (
    !lifecycle
    || !Array.isArray(lifecycle.events)
    || lifecycle.limit !== DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
    || !Number.isInteger(lifecycle.droppedCount)
  ) {
    return null;
  }
  const record = {
    ...extra,
    at,
    kind: sanitizeDiagnosticText(kind || 'unknown', 80),
    phase: sanitizeDiagnosticText(diagnostics.phase || 'unknown', 160),
    runnerCloseRequested: Boolean(lifecycle.runnerCloseRequestedAt),
  };
  if (lifecycle.events.length < lifecycle.limit) {
    lifecycle.events.push(record);
  } else {
    lifecycle.droppedCount += 1;
  }
  return record;
}

function markRunnerElectronCloseRequested(diagnostics) {
  const lifecycle = diagnostics?.lifecycle;
  if (!lifecycle) return null;
  if (lifecycle.runnerCloseRequestedAt) return lifecycle.runnerCloseRequestedAt;
  lifecycle.runnerCloseRequestedAt = new Date().toISOString();
  appendElectronLifecycleDiagnostic(
    diagnostics,
    'runner-close-requested',
    {},
    lifecycle.runnerCloseRequestedAt,
  );
  return lifecycle.runnerCloseRequestedAt;
}

function attachElectronLifecycleDiagnostics(electronApp, diagnostics) {
  const attachedPages = new WeakSet();
  let nextWindowId = 0;
  const markUnexpectedClose = () => {
    if (!diagnostics?.lifecycle?.runnerCloseRequestedAt) {
      diagnostics.lifecycle.unexpectedCloseObserved = true;
    }
  };
  const attachPage = (page) => {
    if (!page || attachedPages.has(page)) return null;
    attachedPages.add(page);
    nextWindowId += 1;
    const windowId = nextWindowId;
    appendElectronLifecycleDiagnostic(diagnostics, 'window-attached', { windowId });
    page.on?.('close', () => {
      markUnexpectedClose();
      appendElectronLifecycleDiagnostic(diagnostics, 'window-closed', { windowId });
    });
    page.on?.('crash', () => {
      markUnexpectedClose();
      appendElectronLifecycleDiagnostic(diagnostics, 'window-crashed', { windowId });
    });
    page.on?.('framenavigated', (frame) => {
      let isMainFrame = false;
      try {
        isMainFrame = page.mainFrame?.() === frame;
      } catch {
        isMainFrame = false;
      }
      if (isMainFrame) {
        appendElectronLifecycleDiagnostic(diagnostics, 'main-frame-navigated', { windowId });
      }
    });
    return windowId;
  };
  electronApp?.on?.('close', () => {
    markUnexpectedClose();
    appendElectronLifecycleDiagnostic(diagnostics, 'electron-app-closed');
  });
  let electronContext = null;
  try {
    electronContext = electronApp?.context?.() || null;
  } catch {
    electronContext = null;
  }
  electronContext?.on?.('close', () => {
    markUnexpectedClose();
    appendElectronLifecycleDiagnostic(diagnostics, 'electron-context-closed');
  });
  let electronProcess = null;
  try {
    electronProcess = electronApp?.process?.() || null;
  } catch {
    electronProcess = null;
  }
  electronProcess?.once?.('exit', (code, signal) => {
    markUnexpectedClose();
    const processExit = {
      at: new Date().toISOString(),
      code: Number.isInteger(code) ? code : null,
      runnerCloseRequested: Boolean(diagnostics?.lifecycle?.runnerCloseRequestedAt),
      signal: signal ? sanitizeDiagnosticText(signal, 80) : null,
    };
    if (diagnostics?.lifecycle) diagnostics.lifecycle.processExit = processExit;
    appendElectronLifecycleDiagnostic(diagnostics, 'electron-process-exit', {
      code: processExit.code,
      signal: processExit.signal,
    }, processExit.at);
  });
  return { attachPage };
}

function appendRendererDiagnostic(diagnostics, kind, record) {
  const renderer = diagnostics?.renderer;
  const entries = renderer?.[kind];
  const limit = renderer?.limits?.[kind];
  if (!Array.isArray(entries)
    || !Number.isInteger(limit)
    || limit < 1
    || !Number.isInteger(renderer?.droppedCount?.[kind])) {
    return false;
  }
  if (entries.length < limit) {
    entries.push(record);
    return true;
  }
  renderer.droppedCount[kind] += 1;
  return false;
}

function setRunDiagnosticPhase(diagnostics, phase) {
  if (!diagnostics) return;
  const safePhase = sanitizeDiagnosticText(phase || 'unknown', 160);
  diagnostics.phase = safePhase;
  diagnostics.timeline.push({ at: new Date().toISOString(), phase: safePhase });
}

function recordRunDiagnosticFailure(diagnostics, error, phase = diagnostics?.phase || 'unknown') {
  const failure = createStructuredFailure(error, phase);
  if (diagnostics && !diagnostics.failure) diagnostics.failure = failure;
  return failure;
}

function diagnosticFailurePhase(diagnostics) {
  const cleanupPhases = new Set(['electron-close', 'process-cleanup-attestation', 'completed', 'failed']);
  if (diagnostics?.phase && !cleanupPhases.has(diagnostics.phase)) return diagnostics.phase;
  const timeline = Array.isArray(diagnostics?.timeline) ? diagnostics.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const phase = timeline[index]?.phase;
    if (phase && !cleanupPhases.has(phase)) return phase;
  }
  return 'unknown';
}

function completeRunDiagnostics(diagnostics, passed) {
  if (!diagnostics) return;
  diagnostics.phase = passed ? 'completed' : 'failed';
  diagnostics.completedAt = new Date().toISOString();
  diagnostics.timeline.push({ at: diagnostics.completedAt, phase: diagnostics.phase });
}

function validSuccessfulElectronLifecycle(lifecycle, startedAt, completedAt) {
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
  const appClosedEvents = Array.isArray(events)
    ? events.filter((event) => event.kind === 'electron-app-closed')
    : [];
  const runnerCloseIndex = Array.isArray(events)
    ? events.findIndex((event) => event.kind === 'runner-close-requested')
    : -1;
  const processExitIndex = Array.isArray(events)
    ? events.findIndex((event) => event.kind === 'electron-process-exit')
    : -1;
  const appClosedIndex = Array.isArray(events)
    ? events.findIndex((event) => event.kind === 'electron-app-closed')
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
    && events.some((event, index) => (
      event.kind === 'window-attached'
      && event.runnerCloseRequested === false
      && index < runnerCloseIndex
    ))
    && events.every((event, index) => (
      event.kind !== 'window-attached'
      || (event.runnerCloseRequested === false && index < runnerCloseIndex)
    ))
    && runnerCloseEvents.length === 1
    && runnerCloseEvents[0].runnerCloseRequested === true
    && runnerCloseEvents[0].at === lifecycle.runnerCloseRequestedAt
    && processExitEvents.length === 1
    && processExitEvents[0].runnerCloseRequested === true
    && processExitEvents[0].code === lifecycle.processExit.code
    && processExitEvents[0].signal === lifecycle.processExit.signal
    && processExitEvents[0].at === lifecycle.processExit.at
    && appClosedEvents.length === 1
    && runnerCloseIndex >= 0
    && processExitIndex > runnerCloseIndex
    && appClosedIndex > runnerCloseIndex
    && (processExitIndex === events.length - 1 || appClosedIndex === events.length - 1)
    && events.slice(processExitIndex + 1).every(
      (event) => event.kind === 'electron-app-closed',
    )
    && events.every((event, index) => (
      !terminalKinds.has(event.kind) || index > runnerCloseIndex
    ))
    && !events.some((event) => event.kind === 'window-crashed');
}

function validRunDiagnostics(diagnostics, run = {}) {
  const startedAt = Date.parse(diagnostics?.startedAt);
  const completedAt = Date.parse(diagnostics?.completedAt);
  const consoleErrors = diagnostics?.renderer?.consoleErrors;
  const pageErrors = diagnostics?.renderer?.pageErrors;
  const timeline = diagnostics?.timeline;
  const login = diagnostics?.login;
  const loginStartedAt = Date.parse(login?.startedAt);
  const loginCompletedAt = Date.parse(login?.completedAt);
  const renderer = diagnostics?.renderer;
  const session = run?.session;
  const expectedLoginOutcome = {
    'authenticated-during-credential-observation': 'authenticated-during-credential-observation',
    'existing-authenticated-session': 'existing-authenticated-session',
    'interactive-operator-login': 'interactive-operator-login',
    'saved-credentials-login': 'saved-credentials-login',
  }[session?.mode];
  const attempts = Array.isArray(login?.attempts) ? login.attempts : [];
  const loginAttemptsValid = (() => {
    if (session?.mode !== 'saved-credentials-login') return attempts.length === 0;
    if (attempts.length < 1) return false;
    let previousCompletedAt = loginStartedAt;
    return attempts.every((attempt, index) => {
      const attemptStartedAt = Date.parse(attempt?.startedAt);
      const attemptCompletedAt = Date.parse(attempt?.completedAt);
      const isFinal = index === attempts.length - 1;
      const retryableNavigation = attempt?.outcome === 'retryable-navigation';
      const successfulWorkspace = [
        'workspace-reached',
        'workspace-reached-after-navigation',
      ].includes(attempt?.outcome);
      const valid = attempt?.attempt === index + 1
        && Number.isFinite(attemptStartedAt)
        && Number.isFinite(attemptCompletedAt)
        && attemptStartedAt >= loginStartedAt
        && attemptStartedAt >= previousCompletedAt
        && attemptCompletedAt >= attemptStartedAt
        && attemptCompletedAt <= loginCompletedAt
        && (isFinal
          ? successfulWorkspace && attempt?.retryable === false
          : retryableNavigation && attempt?.retryable === true);
      previousCompletedAt = attemptCompletedAt;
      return valid;
    });
  })();
  const operatorHandoff = login?.operatorHandoff;
  const operatorHandoffStartedAt = Date.parse(operatorHandoff?.startedAt);
  const operatorHandoffCompletedAt = Date.parse(operatorHandoff?.completedAt);
  const operatorHandoffPhaseTransitions = Array.isArray(operatorHandoff?.phaseTransitions)
    ? operatorHandoff.phaseTransitions
    : [];
  const operatorHandoffElapsedMs = Number(operatorHandoff?.elapsedMs);
  const alternatingHandoffPhasesValid = operatorHandoffPhaseTransitions.length >= 2
    && operatorHandoffPhaseTransitions.length % 2 === 0
    && operatorHandoffPhaseTransitions.every((transition, index) => {
      const elapsedMs = Number(transition?.elapsedMs);
      const previousElapsedMs = index === 0
        ? 0
        : Number(operatorHandoffPhaseTransitions[index - 1]?.elapsedMs);
      const nextElapsedMs = index === operatorHandoffPhaseTransitions.length - 1
        ? operatorHandoffElapsedMs
        : Number(operatorHandoffPhaseTransitions[index + 1]?.elapsedMs);
      const expectedPhase = index % 2 === 0 ? 'preparation' : 'authorization';
      return transition?.phase === expectedPhase
        && Number.isFinite(Date.parse(transition?.startedAt))
        && Number.isFinite(elapsedMs)
        && elapsedMs >= previousElapsedMs
        && nextElapsedMs >= elapsedMs
        && nextElapsedMs - elapsedMs <= operatorHandoff?.phaseTimeoutMs;
    });
  const operatorHandoffPhasesValid = Number.isInteger(operatorHandoff?.phaseTimeoutMs)
    && operatorHandoff.phaseTimeoutMs >= 60_000
    && operatorHandoff.phaseTimeoutMs <= 900_000
    && operatorHandoff?.maximumTotalTimeoutMs === operatorHandoff.phaseTimeoutMs * 2
    && operatorHandoff?.finalPhase === 'authorization'
    && operatorHandoff?.durationClock === 'performance.now'
    && typeof operatorHandoff?.elapsedMs === 'number'
    && Number.isFinite(operatorHandoffElapsedMs)
    && Number(operatorHandoffPhaseTransitions[0]?.elapsedMs) === 0
    && alternatingHandoffPhasesValid
    && operatorHandoffElapsedMs <= operatorHandoff.maximumTotalTimeoutMs
    && operatorHandoffElapsedMs >= 0;
  const operatorHandoffValid = session?.mode === 'interactive-operator-login'
    ? (
      operatorHandoff?.kind === 'visible-user-handoff'
      && operatorHandoff?.outcome === 'workspace-reached'
      && operatorHandoff?.automationReadSecrets === false
      && operatorHandoff?.automationTypedSecrets === false
      && Number.isFinite(operatorHandoffStartedAt)
      && Number.isFinite(operatorHandoffCompletedAt)
      && operatorHandoffPhasesValid
      && canonicalJson(operatorHandoff) === canonicalJson(session?.operatorHandoff)
    )
    : operatorHandoff == null && session?.operatorHandoff == null;
  const storeGate = diagnostics?.storeGate;
  const sessionStoreGate = session?.storeGate;
  const storeGateStartedAt = Date.parse(storeGate?.startedAt);
  const storeGateCompletedAt = Date.parse(storeGate?.completedAt);
  return diagnostics?.schemaVersion === 'package-ui-run-diagnostics/v2'
    && Number.isFinite(startedAt)
    && Number.isFinite(completedAt)
    && completedAt >= startedAt
    && diagnostics.phase === 'completed'
    && diagnostics.failure === null
    && Array.isArray(diagnostics.cleanupErrors)
    && diagnostics.cleanupErrors.length === 0
    && Array.isArray(timeline)
    && timeline.length > 0
    && timeline[timeline.length - 1]?.phase === 'completed'
    && renderer?.limits?.consoleErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer?.limits?.pageErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer?.droppedCount?.consoleErrors === 0
    && renderer?.droppedCount?.pageErrors === 0
    && Array.isArray(consoleErrors)
    && consoleErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && consoleErrors.length === 0
    && Array.isArray(pageErrors)
    && pageErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && pageErrors.length === 0
    && validSuccessfulElectronLifecycle(diagnostics.lifecycle, startedAt, completedAt)
    && Array.isArray(run.consoleErrors)
    && run.consoleErrors.length === 0
    && Array.isArray(run.pageErrors)
    && run.pageErrors.length === 0
    && Array.isArray(login?.attempts)
    && Number.isFinite(loginStartedAt)
    && Number.isFinite(loginCompletedAt)
    && loginStartedAt >= startedAt
    && loginCompletedAt >= loginStartedAt
    && loginCompletedAt <= completedAt
    && typeof expectedLoginOutcome === 'string'
    && login.outcome === expectedLoginOutcome
    && loginAttemptsValid
    && operatorHandoffValid
    && Number.isFinite(storeGateStartedAt)
    && Number.isFinite(storeGateCompletedAt)
    && storeGateStartedAt >= startedAt
    && storeGateCompletedAt >= storeGateStartedAt
    && storeGateCompletedAt <= completedAt
    && ['created-and-selected-isolated-evidence-store', 'selected-existing-store']
      .includes(storeGate?.outcome)
    && storeGate.outcome === sessionStoreGate?.outcome
    && storeGate.createdEvidenceStore === sessionStoreGate?.createdEvidenceStore
    && storeGate.marketplace === 'US'
    && storeGate.currency === 'USD'
    && ['login', 'workspace'].includes(storeGate.resultingSurface)
    && storeGate.selectedStore?.idSha256 === sessionStoreGate?.selectedStore?.idSha256
    && canonicalJson(login.connectionBootstrap) === canonicalJson(session?.connectionBootstrap);
}

  return {
    createRunDiagnostics,
    appendElectronLifecycleDiagnostic,
    markRunnerElectronCloseRequested,
    attachElectronLifecycleDiagnostics,
    appendRendererDiagnostic,
    setRunDiagnosticPhase,
    recordRunDiagnosticFailure,
    diagnosticFailurePhase,
    completeRunDiagnostics,
    validSuccessfulElectronLifecycle,
    validRunDiagnostics,
  };
};
