// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_OVERLAY_CHECK_IDS,
    PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME,
    READ_ONLY_INTERACTION_PLAN,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const validateLoginSessionAttestation = (...args) => dependencies.validateLoginSessionAttestation(...args);
  const violation = (...args) => dependencies.violation(...args);

function validateReadOnlyInteractionPlan(plan = READ_ONLY_INTERACTION_PLAN) {
  const violations = [];
  const allowedKinds = new Set(['navigation', 'keyboard-navigation', 'subview', 'overlay']);
  const expectedIds = new Set([
    'workspace-navigation',
    'workspace-tab-keyboard-navigation',
    'report-subview-navigation',
    'scheduler-subview-readonly',
    ...EXPECTED_OVERLAY_CHECK_IDS,
  ]);
  const ids = new Set();
  for (const item of plan) {
    ids.add(item.id);
    if (!allowedKinds.has(item.kind)) {
      violations.push(violation('FORBIDDEN_INTERACTION_KIND', 'Package evidence may not execute a mutating interaction.', item));
    }
  }
  for (const expectedId of expectedIds) {
    if (!ids.has(expectedId)) {
      violations.push(violation('READ_ONLY_INTERACTION_MISSING', 'The fixed read-only interaction plan is incomplete.', expectedId));
    }
  }
  for (const id of ids) {
    if (!expectedIds.has(id)) {
      violations.push(violation('UNAPPROVED_INTERACTION', 'The interaction plan contains an unapproved action.', id));
    }
  }
  return { passed: violations.length === 0, violations };
}

function validateOverlayTriggerContract({
  actionId,
  ariaDisabled,
  disabled,
  expectedActionId,
  rendered,
  tagName,
  triggerCount,
}) {
  const violations = [];
  if (triggerCount !== 1) {
    violations.push(violation(
      'OVERLAY_TRIGGER_COUNT_MISMATCH',
      'A read-only package evidence overlay must have exactly one trigger before any click.',
      { expected: 1, actual: triggerCount, expectedActionId },
    ));
    return { passed: false, violations };
  }
  if (String(tagName || '').toLowerCase() !== 'button') {
    violations.push(violation('OVERLAY_TRIGGER_NOT_BUTTON', 'The package evidence overlay trigger must be a real button.', tagName));
  }
  if (disabled === true || ariaDisabled === 'true') {
    violations.push(violation('OVERLAY_TRIGGER_DISABLED', 'The package evidence overlay trigger must be enabled before clicking.'));
  }
  if (rendered !== true) {
    violations.push(violation('OVERLAY_TRIGGER_NOT_RENDERED', 'The package evidence overlay trigger must be visibly rendered before clicking.'));
  }
  if (expectedActionId && actionId !== expectedActionId) {
    violations.push(violation(
      'OVERLAY_TRIGGER_ACTION_MISMATCH',
      'The package evidence runner refused to click a task action that is not the approved read-only overlay trigger.',
      { expected: expectedActionId, actual: actionId || null },
    ));
  }
  return { passed: violations.length === 0, violations };
}

function validateOverlayKeyboardEvidence({ backwardFocus, focusableCount, forwardFocus }) {
  const count = Number(focusableCount);
  const violations = [];
  if (!Number.isInteger(count) || count <= 0) {
    violations.push(violation('OVERLAY_FOCUSABLE_CONTROL_MISSING', 'The dialog must expose at least one enabled focusable control.'));
    return { mode: 'no-controls', passed: false, violations };
  }
  if (count === 1) {
    const shiftTabRetained = backwardFocus?.insideDialog === true && backwardFocus?.evidenceBoundary === 'single';
    const tabRetained = forwardFocus?.insideDialog === true && forwardFocus?.evidenceBoundary === 'single';
    if (!shiftTabRetained) {
      violations.push(violation('SINGLE_CONTROL_SHIFT_TAB_ESCAPED', 'Shift+Tab must retain focus on the unique enabled dialog control.', backwardFocus));
    }
    if (!tabRetained) {
      violations.push(violation('SINGLE_CONTROL_TAB_ESCAPED', 'Tab must retain focus on the unique enabled dialog control.', forwardFocus));
    }
    return {
      mode: 'single-control',
      passed: violations.length === 0,
      singleControlEvidence: {
        shiftTabRetained,
        tabRetained,
        uniqueBoundary: 'single',
      },
      violations,
    };
  }
  const backwardWrapped = backwardFocus?.insideDialog === true && backwardFocus?.evidenceBoundary === 'last';
  const forwardWrapped = forwardFocus?.insideDialog === true && forwardFocus?.evidenceBoundary === 'first';
  if (!backwardWrapped) {
    violations.push(violation('MULTI_CONTROL_SHIFT_TAB_DID_NOT_WRAP', 'Shift+Tab must wrap from the first to the last enabled dialog control.', backwardFocus));
  }
  if (!forwardWrapped) {
    violations.push(violation('MULTI_CONTROL_TAB_DID_NOT_WRAP', 'Tab must wrap from the last to the first enabled dialog control.', forwardFocus));
  }
  return {
    mode: 'multi-control-wrap',
    multiControlEvidence: { backwardWrapped, forwardWrapped },
    passed: violations.length === 0,
    violations,
  };
}

function validateWorkspaceTabKeyboardEvidence(input, expected) {
  const violations = [];
  const expectedTabs = Array.isArray(expected?.tabs) ? expected.tabs : [];
  const defaultSubview = expected?.subview;
  const endSubview = expectedTabs[expectedTabs.length - 1];
  for (const [phase, snapshot, expectedSubview] of [
    ['initial', input?.initial, defaultSubview],
    ['end', input?.end, endSubview],
    ['restored', input?.restored, defaultSubview],
  ]) {
    if (!snapshot || snapshot.tabCount !== expectedTabs.length) {
      violations.push(violation(
        'WORKSPACE_TAB_COUNT_MISMATCH',
        `${expected?.workspace || 'workspace'} ${phase} keyboard snapshot must expose every registered subview tab.`,
        { actual: snapshot?.tabCount ?? null, expected: expectedTabs.length },
      ));
      continue;
    }
    if (snapshot.selectedCount !== 1
      || snapshot.activeSubview !== expectedSubview
      || snapshot.selectedSubview !== expectedSubview
      || snapshot.focusedSubview !== expectedSubview) {
      violations.push(violation(
        'WORKSPACE_TAB_KEYBOARD_STATE_MISMATCH',
        `${expected?.workspace || 'workspace'} ${phase} keyboard state must select and focus ${expectedSubview}.`,
        snapshot,
      ));
    }
  }
  return {
    ...input,
    expectedTabs,
    passed: violations.length === 0,
    violations,
  };
}

function validateIsolatedProfileBootstrapEvidence(session, diagnostics) {
  const violations = [];
  const storeGate = session?.storeGate;
  const selectedStore = storeGate?.selectedStore;
  if (
    !['created-and-selected-isolated-evidence-store', 'selected-existing-store']
      .includes(storeGate?.outcome)
    || storeGate?.marketplace !== 'US'
    || storeGate?.currency !== 'USD'
    || !Number.isInteger(selectedStore?.idLength)
    || selectedStore.idLength < 1
    || !/^[A-F0-9]{64}$/.test(String(selectedStore?.idSha256 || ''))
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_STORE_BOOTSTRAP_INVALID',
      'Each packaged run must visibly and explicitly enter one bounded US/USD store in the isolated evidence profile.',
      storeGate ?? null,
    ));
  }
  if (
    storeGate?.outcome === 'created-and-selected-isolated-evidence-store'
    && (
      storeGate.createdEvidenceStore !== true
      || selectedStore?.displayName !== PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME
    )
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_CREATED_STORE_REFERENCE_INVALID',
      'A created evidence store must be clearly labelled as the fixed isolated Package UI store.',
      storeGate,
    ));
  }
  if (
    storeGate?.outcome === 'selected-existing-store'
    && (
      storeGate.createdEvidenceStore !== false
      || selectedStore?.displayName !== null
    )
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_EXISTING_STORE_REFERENCE_UNBOUNDED',
      'An existing store reference must retain only its bounded hashed id and may not expose its display name.',
      storeGate,
    ));
  }

  const connectionBootstrap = session?.connectionBootstrap;
  const connectionStartedAt = Date.parse(connectionBootstrap?.startedAt);
  const connectionCompletedAt = Date.parse(connectionBootstrap?.completedAt);
  const allowedConnectionOutcomes = new Set([
    'existing-lingxing-connection',
    'bound-isolated-evidence-lingxing-connection',
    'not-required-authenticated-workspace',
    'not-required-workspace-authenticated-during-observation',
    'operator-established-lingxing-connection-and-session',
  ]);
  if (
    !allowedConnectionOutcomes.has(connectionBootstrap?.outcome)
    || !Number.isFinite(connectionStartedAt)
    || !Number.isFinite(connectionCompletedAt)
    || connectionCompletedAt < connectionStartedAt
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_LINGXING_CONNECTION_BOOTSTRAP_INVALID',
      'Each packaged run must prove a visible ready Lingxing connection or an already authenticated workspace without retaining account data.',
      connectionBootstrap ?? null,
    ));
  }
  if (canonicalJson(connectionBootstrap) !== canonicalJson(diagnostics?.login?.connectionBootstrap)) {
    violations.push(violation(
      'ISOLATED_PROFILE_CONNECTION_DIAGNOSTICS_MISMATCH',
      'The bounded session connection bootstrap evidence must match the structured run diagnostics.',
      {
        diagnostics: diagnostics?.login?.connectionBootstrap ?? null,
        session: connectionBootstrap ?? null,
      },
    ));
  }
  const loginSessionAttestation = validateLoginSessionAttestation(
    session?.loginSessionAttestation,
    session?.mode,
  );
  if (!loginSessionAttestation.passed) {
    violations.push(...loginSessionAttestation.violations);
  }
  const storeGateDiagnostics = diagnostics?.storeGate;
  const diagnosticStoreGateStartedAt = Date.parse(storeGateDiagnostics?.startedAt);
  const diagnosticStoreGateCompletedAt = Date.parse(storeGateDiagnostics?.completedAt);
  if (
    storeGateDiagnostics?.outcome !== storeGate?.outcome
    || storeGateDiagnostics?.createdEvidenceStore !== storeGate?.createdEvidenceStore
    || storeGateDiagnostics?.marketplace !== 'US'
    || storeGateDiagnostics?.currency !== 'USD'
    || !['login', 'workspace'].includes(storeGateDiagnostics?.resultingSurface)
    || !Number.isFinite(diagnosticStoreGateStartedAt)
    || !Number.isFinite(diagnosticStoreGateCompletedAt)
    || diagnosticStoreGateCompletedAt < diagnosticStoreGateStartedAt
    || canonicalJson(storeGateDiagnostics?.selectedStore) !== canonicalJson(selectedStore)
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_STORE_DIAGNOSTICS_MISMATCH',
      'The bounded session store selection must match the structured run diagnostics.',
      {
        diagnostics: storeGateDiagnostics ?? null,
        session: storeGate ?? null,
      },
    ));
  }
  const storeAuthorityReadback = session?.storeAuthorityReadback;
  if (
    storeAuthorityReadback?.passed !== true
    || storeAuthorityReadback.actualIdSha256 !== selectedStore?.idSha256
    || storeAuthorityReadback.expectedIdSha256 !== selectedStore?.idSha256
    || storeAuthorityReadback.marketplace !== 'US'
    || storeAuthorityReadback.currency !== 'USD'
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_STORE_AUTHORITY_READBACK_INVALID',
      'The packaged shell Store Authority must hash-match the explicitly selected US/USD Store Gate option.',
      storeAuthorityReadback ?? null,
    ));
  }
  return {
    connectionBootstrap,
    loginSessionAttestation,
    passed: violations.length === 0,
    storeAuthorityReadback,
    storeGate,
    violations,
  };
}

  return {
    validateReadOnlyInteractionPlan,
    validateOverlayTriggerContract,
    validateOverlayKeyboardEvidence,
    validateWorkspaceTabKeyboardEvidence,
    validateIsolatedProfileBootstrapEvidence,
  };
};
