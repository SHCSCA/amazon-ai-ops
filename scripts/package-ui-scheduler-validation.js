// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    PACKAGE_UI_EVIDENCE_MODE,
    PACKAGE_UI_SCHEDULER_COUNT_KEYS,
  } = dependencies;
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const violation = (...args) => dependencies.violation(...args);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function packageUiSchedulerAuditCounts(value) {
  return Object.fromEntries(PACKAGE_UI_SCHEDULER_COUNT_KEYS.map((key) => [
    key,
    Number.isInteger(value?.[key]) && value[key] >= 0 ? value[key] : null,
  ]));
}

function derivePackageUiSchedulerGuards(counts, suppressed) {
  return {
    localSchedulerStarted: counts.localSchedulerStart > 0,
    storeCollectionSchedulerStarted: counts.storeSchedulerStart > 0,
    runNowIpcDisabled: counts.runNow === counts.runNowRejected,
    startupReconcileSuppressed:
      counts.storeSchedulerStart === 0
      && suppressed.startupReconcile > 0,
    automaticReconcileSuppressed: counts.reconcile === 0,
    readOnlyInvariantPassed:
      counts.localSchedulerStart === 0
      && counts.storeSchedulerStart === 0
      && counts.reconcile === 0
      && counts.execute === 0
      && counts.runNow === 0,
  };
}

function packageUiSchedulerAuditSnapshotViolations(snapshot, label) {
  const violations = [];
  if (
    snapshot?.kind !== 'package-ui-scheduler-audit'
    || snapshot?.schemaVersion !== 1
    || snapshot?.evidenceMode !== PACKAGE_UI_EVIDENCE_MODE
    || !Number.isInteger(snapshot?.pid)
    || snapshot.pid < 1
    || !String(snapshot?.userDataDir || '').trim()
    || !Number.isFinite(Date.parse(snapshot?.generatedAt || ''))
    || snapshot?.policies?.runNow !== 'reject'
  ) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_INVALID',
      `${label} is not a valid package UI scheduler audit snapshot.`,
      snapshot ?? null,
    ));
    return violations;
  }
  const counts = packageUiSchedulerAuditCounts(snapshot.counts);
  if (Object.values(counts).some((value) => value === null)) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_COUNTS_INVALID',
      `${label} must contain every non-negative scheduler audit counter.`,
      snapshot.counts ?? null,
    ));
  }
  const suppressed = snapshot.suppressed || {};
  if (
    !Number.isInteger(suppressed.localSchedulerStart)
    || suppressed.localSchedulerStart < 0
    || !Number.isInteger(suppressed.storeSchedulerStart)
    || suppressed.storeSchedulerStart < 0
    || !Number.isInteger(suppressed.startupReconcile)
    || suppressed.startupReconcile < 0
    || !Number.isInteger(suppressed.automaticReconcile)
    || suppressed.automaticReconcile < 0
  ) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_SUPPRESSED_COUNTS_INVALID',
      `${label} must contain every non-negative suppression counter.`,
      suppressed,
    ));
  }
  if (!Array.isArray(snapshot.events)) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_EVENTS_INVALID',
      `${label} must contain the bounded Main handler event ledger.`,
      snapshot.events ?? null,
    ));
  } else if (snapshot.events.some((event, index) => (
    event?.sequence !== index + 1
    || !Number.isFinite(Date.parse(event?.at || ''))
    || !['pending', 'succeeded', 'rejected', 'recorded'].includes(event?.outcome)
  ))) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_EVENT_INVALID',
      `${label} contains an invalid Main handler event.`,
      snapshot.events,
    ));
  }
  if (Array.isArray(snapshot.events)) {
    const eventCounts = { ...Object.fromEntries(PACKAGE_UI_SCHEDULER_COUNT_KEYS.map((key) => [key, 0])) };
    const sourceCounts = {
      'mission-control:query': 'workspaceQuery',
      'store-collection-scheduler:get': 'schedulerGet',
      'store-evidence-retention:preview': 'retentionPreview',
      'store-collection-scheduler:run-now': 'runNow',
      localSchedulerStart: 'localSchedulerStart',
      storeSchedulerStart: 'storeSchedulerStart',
      reconcile: 'reconcile',
      execute: 'execute',
    };
    for (const event of snapshot.events) {
      const countKey = sourceCounts[event?.source];
      if (countKey) eventCounts[countKey] += 1;
      if (
        event?.source === 'store-collection-scheduler:run-now'
        && event?.outcome === 'rejected'
      ) eventCounts.runNowRejected += 1;
    }
    if (canonicalJson(eventCounts) !== canonicalJson(counts)) {
      violations.push(violation(
        'PACKAGE_UI_SCHEDULER_AUDIT_EVENT_COUNT_MISMATCH',
        `${label} counters must be derived exactly from its handler/control event ledger.`,
        { actual: counts, expected: eventCounts },
      ));
    }
  }
  return violations;
}

function packageUiSchedulerAuditDelta(before, after) {
  const beforeCounts = packageUiSchedulerAuditCounts(before?.counts);
  const afterCounts = packageUiSchedulerAuditCounts(after?.counts);
  const counts = Object.fromEntries(PACKAGE_UI_SCHEDULER_COUNT_KEYS.map((key) => [
    key,
    beforeCounts[key] === null || afterCounts[key] === null
      ? null
      : afterCounts[key] - beforeCounts[key],
  ]));
  const beforeEvents = Array.isArray(before?.events) ? before.events : [];
  const afterEvents = Array.isArray(after?.events) ? after.events : [];
  const prefixMatched = canonicalJson(beforeEvents) === canonicalJson(
    afterEvents.slice(0, beforeEvents.length),
  );
  return {
    counts,
    events: prefixMatched ? afterEvents.slice(beforeEvents.length) : [],
    prefixMatched,
  };
}

function validateSchedulerSubviewRuntimeBinding(subviewEvidence, runtimeEvidence) {
  const violations = [];
  const ledgerAfter = subviewEvidence?.ledgerAfter;
  const runtimeMarker = runtimeEvidence?.marker;
  const runtimeDelta = packageUiSchedulerAuditDelta(ledgerAfter, runtimeMarker);
  const identityMatched = ledgerAfter?.pid === runtimeMarker?.pid
    && normalizedWindowsPath(ledgerAfter?.userDataDir || '')
      === normalizedWindowsPath(runtimeMarker?.userDataDir || '')
    && ledgerAfter?.evidenceMode === runtimeMarker?.evidenceMode
    && canonicalJson(ledgerAfter?.policies) === canonicalJson(runtimeMarker?.policies);
  const suppressionMatched = canonicalJson(ledgerAfter?.suppressed)
    === canonicalJson(runtimeMarker?.suppressed);
  const generatedAt = Date.parse(ledgerAfter?.generatedAt || '');
  const runtimeGeneratedAt = Date.parse(runtimeMarker?.generatedAt || '');
  const generatedAtMonotonic = Number.isFinite(generatedAt)
    && Number.isFinite(runtimeGeneratedAt)
    && runtimeGeneratedAt >= generatedAt;
  const countsMonotonic = Object.values(runtimeDelta.counts).every(
    (value) => value !== null && value >= 0,
  );

  if (
    !identityMatched
    || !suppressionMatched
    || !generatedAtMonotonic
    || !runtimeDelta.prefixMatched
    || !countsMonotonic
  ) {
    violations.push(violation(
      'SCHEDULER_SUBVIEW_RUNTIME_LEDGER_NOT_BOUND',
      'The scheduler subview ledger must be an exact event prefix of the hash-bound Main runtime attestation with one identity and monotonic counters.',
      {
        counts: runtimeDelta.counts,
        generatedAtMonotonic,
        identityMatched,
        prefixMatched: runtimeDelta.prefixMatched,
        suppressionMatched,
      },
    ));
  }

  return {
    counts: runtimeDelta.counts,
    generatedAtMonotonic,
    identityMatched,
    passed: violations.length === 0,
    prefixMatched: runtimeDelta.prefixMatched,
    suppressionMatched,
    violations,
  };
}

function latestSucceededSchedulerAuditEvent(events, source) {
  return [...(Array.isArray(events) ? events : [])]
    .reverse()
    .find((event) => event?.source === source && event?.outcome === 'succeeded') || null;
}

function validateSchedulerSubviewEvidence(input, expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0]) {
  const violations = [];
  const contextFields = [
    'storeId',
    'browserProfileId',
    'marketplace',
    'currency',
    'businessTimezone',
    'businessDate',
    'sessionGeneration',
  ];
  const contextIdentity = (value) => Object.fromEntries(
    contextFields.map((field) => [field, value?.[field] ?? null]),
  );
  const before = input?.ledgerBefore;
  const after = input?.ledgerAfter;
  violations.push(...packageUiSchedulerAuditSnapshotViolations(before, 'The pre-navigation scheduler ledger'));
  violations.push(...packageUiSchedulerAuditSnapshotViolations(after, 'The post-navigation scheduler ledger'));
  if (
    before?.pid !== after?.pid
    || normalizedWindowsPath(before?.userDataDir || '') !== normalizedWindowsPath(after?.userDataDir || '')
  ) {
    violations.push(violation(
      'SCHEDULER_AUDIT_IDENTITY_CHANGED',
      'The scheduler ledger must retain one Main PID and isolated userData identity across navigation.',
      { before: before ? { pid: before.pid, userDataDir: before.userDataDir } : null, after: after ? { pid: after.pid, userDataDir: after.userDataDir } : null },
    ));
  }
  const ledgerDelta = packageUiSchedulerAuditDelta(before, after);
  if (!ledgerDelta.prefixMatched || Object.values(ledgerDelta.counts).some((value) => value === null || value < 0)) {
    violations.push(violation(
      'SCHEDULER_AUDIT_LEDGER_NOT_APPEND_ONLY',
      'The Main scheduler audit must be append-only with monotonic counters across page navigation.',
      ledgerDelta,
    ));
  }
  if (
    ledgerDelta.counts.workspaceQuery < 1
    || ledgerDelta.counts.schedulerGet < 1
    || ledgerDelta.counts.retentionPreview < 1
    || ledgerDelta.counts.runNow !== 0
    || ledgerDelta.counts.runNowRejected !== 0
    || ledgerDelta.counts.localSchedulerStart !== 0
    || ledgerDelta.counts.storeSchedulerStart !== 0
    || ledgerDelta.counts.reconcile !== 0
    || ledgerDelta.counts.execute !== 0
  ) {
    violations.push(violation(
      'SCHEDULER_HANDLER_LEDGER_CONTRACT_FAILED',
      'Scheduler navigation must cause real page schedule/retention reads and zero run-now/start/reconcile/execute calls.',
      ledgerDelta.counts,
    ));
  }
  const afterCounts = packageUiSchedulerAuditCounts(after?.counts);
  if (
    afterCounts.workspaceQuery < 1
    || afterCounts.runNow !== 0
    || afterCounts.runNowRejected !== 0
    || afterCounts.localSchedulerStart !== 0
    || afterCounts.storeSchedulerStart !== 0
    || afterCounts.reconcile !== 0
    || afterCounts.execute !== 0
  ) {
    violations.push(violation(
      'SCHEDULER_MAIN_READ_ONLY_TOTALS_FAILED',
      'The live Main ledger must include a real workspace query and no scheduler mutation attempts.',
      afterCounts,
    ));
  }
  if (ledgerDelta.events.some((event) => event?.outcome !== 'succeeded')) {
    violations.push(violation(
      'SCHEDULER_HANDLER_EVENT_FAILED',
      'Every handler event caused by scheduler navigation must complete successfully.',
      ledgerDelta.events,
    ));
  }
  const missionEvent = latestSucceededSchedulerAuditEvent(
    ledgerDelta.events,
    'mission-control:query',
  );
  const scheduleEvent = latestSucceededSchedulerAuditEvent(
    ledgerDelta.events,
    'store-collection-scheduler:get',
  );
  const retentionEvent = latestSucceededSchedulerAuditEvent(
    ledgerDelta.events,
    'store-evidence-retention:preview',
  );
  const requestedContext = contextIdentity(missionEvent?.request?.context ?? missionEvent?.context);
  const authoritativeContext = contextIdentity(missionEvent?.response?.authoritativeContext);
  if (canonicalJson(requestedContext) !== canonicalJson(authoritativeContext)) {
    violations.push(violation(
      'SCHEDULER_AUTHORITY_CONTEXT_MISMATCH',
      'The read-only scheduler bootstrap response must retain the exact active StoreContext identity.',
      { authoritativeContext, requestedContext },
    ));
  }
  if (authoritativeContext.marketplace !== 'US' || authoritativeContext.currency !== 'USD') {
    violations.push(violation(
      'SCHEDULER_USD_IDENTITY_MISMATCH',
      'The packaged scheduler evidence is restricted to the US marketplace and USD currency.',
      authoritativeContext,
    ));
  }
  if (
    missionEvent?.request?.query !== 'workspace-bootstrap'
    || !String(missionEvent?.request?.requestId || '').startsWith('renderer-bootstrap-')
    || missionEvent?.response?.requestId !== missionEvent?.request?.requestId
    || !Number.isInteger(missionEvent?.request?.contextEpoch)
    || missionEvent?.response?.contextEpoch !== missionEvent?.request?.contextEpoch
    || missionEvent?.response?.query !== 'workspace-bootstrap'
  ) {
    violations.push(violation(
      'SCHEDULER_BOOTSTRAP_RESPONSE_MISMATCH',
      'The scheduler capability assertion must come from the matching read-only workspace bootstrap response.',
      {
        request: missionEvent?.request ?? null,
        response: missionEvent?.response ?? null,
      },
    ));
  }
  const expectedCapabilities = expected.capabilities.map((capability) => ({
    action: capability.action,
    capabilityId: capability.capabilityId,
    legacyRoute: capability.legacyRoute,
    state: capability.state,
    view: `${expected.workspace}/${expected.subview}`,
    workspace: expected.workspace,
  })).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const actualCapabilities = (
    Array.isArray(missionEvent?.response?.capabilities)
      ? missionEvent.response.capabilities
      : []
  ).map((capability) => ({
    action: capability?.action ?? null,
    capabilityId: capability?.capabilityId ?? null,
    legacyRoute: capability?.legacyRoute ?? null,
    state: capability?.state ?? null,
    view: capability?.view ?? null,
    workspace: capability?.workspace ?? null,
  })).sort((left, right) => String(left.capabilityId).localeCompare(String(right.capabilityId)));
  if (canonicalJson(actualCapabilities) !== canonicalJson(expectedCapabilities)) {
    violations.push(violation(
      'SCHEDULER_CAPABILITY_PROJECTION_MISMATCH',
      'The scheduler subview must expose the exact view, run-now, and read-only retention capability projection.',
      { actual: actualCapabilities, expected: expectedCapabilities },
    ));
  }
  const schedule = scheduleEvent?.response || {};
  if (
    String(schedule.storeId ?? '') !== String(authoritativeContext.storeId ?? '')
    || String(schedule.businessDate ?? '') !== String(authoritativeContext.businessDate ?? '')
    || !['not_configured', 'archived', 'waiting', 'due', 'claimed', 'succeeded', 'failed'].includes(schedule.state)
    || typeof schedule.enabled !== 'boolean'
    || !String(schedule.detail || '').trim()
  ) {
    violations.push(violation(
      'SCHEDULER_SCHEDULE_API_RESPONSE_INVALID',
      'The packaged page schedule API must succeed with a current-store projection.',
      schedule,
    ));
  }
  const retention = retentionEvent?.response || {};
  if (
    retention.schemaVersion !== 1
    || retention.mode !== 'dry-run'
    || retention.deletionSupported !== false
    || retention.applyable !== false
    || String(retention.storeId ?? '') !== String(authoritativeContext.storeId ?? '')
    || String(retention.profileId ?? '') !== String(authoritativeContext.browserProfileId ?? '')
    || retention.marketplace !== 'US'
    || retention.currency !== 'USD'
    || !Number.isInteger(retention.candidateCount)
    || retention.candidateCount < 0
    || !Number.isInteger(retention.blockerCount)
    || retention.blockerCount < 0
  ) {
    violations.push(violation(
      'SCHEDULER_RETENTION_API_RESPONSE_INVALID',
      'The packaged page retention API must succeed with a current-store, path-free dry-run summary.',
      retention,
    ));
  }

  const dom = input?.dom || {};
  if (
    dom.rootCount !== 1
    || dom.workspace !== expected.workspace
    || dom.subview !== expected.subview
    || dom.pageCount !== 1
    || dom.headingCount !== 1
    || dom.heading !== expected.heading
  ) {
    violations.push(violation(
      'SCHEDULER_DOM_IDENTITY_MISMATCH',
      'The visible packaged scheduler page must retain one exact settings/scheduler root and heading.',
      dom,
    ));
  }
  if (
    dom.selectedTabCount !== 1
    || dom.selectedTabId !== expected.tabId
    || dom.selectedTabCapabilityState !== 'LEGACY_ADAPTER'
  ) {
    violations.push(violation(
      'SCHEDULER_TAB_CAPABILITY_MISMATCH',
      'The selected scheduler tab must expose its exact LEGACY_ADAPTER view state.',
      dom,
    ));
  }
  if (
    dom.legacyBoundaryCount !== 1
    || dom.legacyRoute !== 'scheduler'
    || dom.legacyCapabilityState !== 'LEGACY_ADAPTER'
  ) {
    violations.push(violation(
      'SCHEDULER_LEGACY_BOUNDARY_MISMATCH',
      'The production scheduler must remain inside the exact authorized legacy adapter boundary.',
      dom,
    ));
  }
  const expectedStoreId = String(authoritativeContext.storeId ?? '');
  if (
    !expectedStoreId
    || String(dom.shellStoreId ?? '') !== expectedStoreId
    || String(dom.selectedStoreId ?? '') !== expectedStoreId
    || String(dom.legacyStoreId ?? '') !== expectedStoreId
  ) {
    violations.push(violation(
      'SCHEDULER_STORE_IDENTITY_MISMATCH',
      'The shell, selected store, legacy boundary, and Main authority must name the same store.',
      { authoritativeStoreId: expectedStoreId || null, dom },
    ));
  }
  const fixedScopeText = String(dom.fixedScopeText || '').replace(/\s+/g, ' ').trim();
  const fixedScopeTokens = fixedScopeText.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const fixedScopeIdentityTokens = fixedScopeTokens.filter((token) => /^[A-Z]{2,4}$/.test(token));
  const fixedScopeTexts = Array.isArray(dom.fixedScopeTexts)
    ? dom.fixedScopeTexts.map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    : [];
  const fixedScopeVisibleCount = Number(dom.fixedScopeVisibleCount);
  const visibleFixedScopeIdentityTokens = fixedScopeTexts.map((value) => value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .filter((token) => /^[A-Z]{2,4}$/.test(token)));
  if (
    canonicalJson(fixedScopeIdentityTokens) !== canonicalJson(['US', 'USD'])
    || !Number.isInteger(fixedScopeVisibleCount)
    || fixedScopeVisibleCount < 1
    || fixedScopeTexts.length !== fixedScopeVisibleCount
    || visibleFixedScopeIdentityTokens.some(
      (tokens) => canonicalJson(tokens) !== canonicalJson(['US', 'USD']),
    )
  ) {
    violations.push(violation(
      'SCHEDULER_FIXED_SCOPE_MISSING',
      'Every visible packaged scheduler scope surface must retain exactly the US marketplace and USD currency without another uppercase marketplace/currency token.',
      {
        fixedScopeIdentityTokens,
        fixedScopeText,
        fixedScopeTexts,
        fixedScopeVisibleCount,
        visibleFixedScopeIdentityTokens,
      },
    ));
  }
  const domRetentionCandidateCountValid = typeof dom.retentionCandidateCount === 'string'
    && /^(?:0|[1-9]\d*)$/.test(dom.retentionCandidateCount);
  const domRetentionBlockerCountValid = typeof dom.retentionBlockerCount === 'string'
    && /^(?:0|[1-9]\d*)$/.test(dom.retentionBlockerCount);
  if (
    String(dom.scheduleStoreId ?? '') !== String(schedule.storeId ?? '')
    || String(dom.scheduleBusinessDate ?? '') !== String(schedule.businessDate ?? '')
    || String(dom.scheduleState ?? '') !== String(schedule.state ?? '')
    || String(dom.scheduleEnabled ?? '') !== String(schedule.enabled)
    || dom.scheduleMarketplace !== 'US'
    || dom.scheduleCurrency !== 'USD'
    || String(dom.retentionStoreId ?? '') !== String(retention.storeId ?? '')
    || String(dom.retentionProfileId ?? '') !== String(retention.profileId ?? '')
    || !domRetentionCandidateCountValid
    || Number(dom.retentionCandidateCount) !== retention.candidateCount
    || !domRetentionBlockerCountValid
    || Number(dom.retentionBlockerCount) !== retention.blockerCount
    || dom.retentionMarketplace !== 'US'
    || dom.retentionCurrency !== 'USD'
  ) {
    violations.push(violation(
      'SCHEDULER_DOM_MAIN_RESPONSE_BINDING_MISMATCH',
      'Visible scheduler data attributes must bind field-by-field to the actual Main schedule and retention responses.',
      { dom, retention, schedule },
    ));
  }
  if (
    dom.retentionPreviewControlCount !== 1
    || dom.retentionPreviewCapabilityId !== 'settings.scheduler.retention-preview'
    || dom.retentionPreviewEnabledCount !== 1
  ) {
    violations.push(violation(
      'SCHEDULER_RETENTION_CAPABILITY_MISSING',
      'The scheduler must expose exactly one capability-bound read-only retention preview control.',
      dom,
    ));
  }
  if (
    dom.scheduleProjectionCount !== 1
    || dom.retentionSummaryCount !== 1
    || dom.schedulerErrorCount !== 0
    || dom.loadingStateCount !== 0
    || dom.busyControlCount !== 0
    || dom.scheduleRefreshEnabledCount < 1
  ) {
    violations.push(violation(
      'SCHEDULER_PAGE_RUNTIME_STATE_INVALID',
      'The packaged scheduler page must finish both read APIs without an error/loading state and retain enabled read controls.',
      dom,
    ));
  }
  if (
    dom.previewMarkerCount !== 0
    || dom.alertDialogCount !== 0
    || dom.confirmRunDialogCount !== 0
  ) {
    violations.push(violation(
      'SCHEDULER_UNSAFE_CAPTURE_STATE',
      'The scheduler screenshot must not contain preview identity or an opened run-now confirmation.',
      dom,
    ));
  }
  return {
    ...input,
    authoritativeContext,
    capabilities: actualCapabilities,
    expected: {
      capabilities: expectedCapabilities,
      heading: expected.heading,
      subview: expected.subview,
      workspace: expected.workspace,
    },
    ledgerDelta,
    passed: violations.length === 0,
    requestedContext,
    retentionApi: retention,
    scheduleApi: schedule,
    violations,
  };
}

  return {
    canonicalJson,
    packageUiSchedulerAuditCounts,
    derivePackageUiSchedulerGuards,
    packageUiSchedulerAuditSnapshotViolations,
    packageUiSchedulerAuditDelta,
    validateSchedulerSubviewRuntimeBinding,
    latestSucceededSchedulerAuditEvent,
    validateSchedulerSubviewEvidence,
  };
};
