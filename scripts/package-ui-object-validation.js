// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const violation = (...args) => dependencies.violation(...args);

function validateObjectWorkspaceExperienceEvidence({
  aiRunState,
  capacity,
  metrics,
  requiredVisibleCapacity,
  workspace,
}) {
  const violations = [];
  const numericRequiredCapacity = Number(requiredVisibleCapacity);
  const visibleRowCapacity = Number(capacity?.visibleRowCapacity);
  if (!Number.isFinite(numericRequiredCapacity)
    || !Number.isFinite(visibleRowCapacity)
    || visibleRowCapacity < numericRequiredCapacity) {
    violations.push(violation(
      'QUEUE_CAPACITY_INSUFFICIENT',
      'The fixed object queue viewport must have measured row capacity for the profile target.',
      { actual: capacity, requiredVisibleCapacity },
    ));
  }
  const ariaRowCount = Number(capacity?.ariaRowCount);
  const initial = metrics?.experience?.initial;
  const probe = metrics?.experience?.probe;
  const maxRenderedRows = Number(metrics?.experience?.contract?.maxRenderedRows || 30);
  const indexes = Array.isArray(initial?.rowIndexes) ? initial.rowIndexes : [];
  const rowCountCredible = Number.isInteger(ariaRowCount)
    && ariaRowCount >= 1
    && ariaRowCount === Number(initial?.ariaRowCount)
    && Number(initial?.renderedRowCount) >= 1
    && Number(initial?.renderedRowCount) <= maxRenderedRows
    && indexes.length > 0
    && indexes.every((index) => Number.isInteger(index) && index >= 0 && index < ariaRowCount)
    && initial?.rowKeysUnique === true;
  if (!rowCountCredible) {
    violations.push(violation(
      'QUEUE_ROWCOUNT_NOT_CREDIBLE',
      'The package queue must expose a positive authoritative row count consistent with bounded keyed DOM rows.',
      { capacity, initial, maxRenderedRows },
    ));
  }
  const shortDataset = capacity?.scrollable === false
    && capacity?.allRowsFit === true
    && Number.isFinite(ariaRowCount)
    && Number.isFinite(visibleRowCapacity)
    && ariaRowCount <= visibleRowCapacity;
  const shortDatasetNotApplicableCodes = new Set([
    'QUEUE_VIRTUAL_WINDOW_STALE',
    'QUEUE_SCROLL_OWNER',
    'QUEUE_STICKY_HEADER',
    'QUEUE_SCROLL_LEAK',
  ]);
  const collectorViolations = Array.isArray(metrics?.contract?.violations) ? metrics.contract.violations : [];
  const applicableCollectorViolations = shortDataset
    ? collectorViolations.filter((item) => !shortDatasetNotApplicableCodes.has(item?.code))
    : collectorViolations;
  if (metrics?.experience?.enabled !== true || applicableCollectorViolations.length > 0) {
    violations.push(violation(
      'OBJECT_WORKSPACE_EXPERIENCE_CONTRACT',
      'The shared workspace DOM/experience contract must pass for the packaged object queue.',
      applicableCollectorViolations.length > 0 ? applicableCollectorViolations : metrics?.contract || null,
    ));
  }
  if (shortDataset && Number(initial?.fullyVisibleRowCount) < ariaRowCount) {
    violations.push(violation(
      'SHORT_DATASET_NOT_FULLY_VISIBLE',
      'A non-scrollable short object dataset must render every authoritative row fully in the queue viewport.',
      { ariaRowCount, fullyVisibleRowCount: initial?.fullyVisibleRowCount ?? null },
    ));
  }
  const restoredScrollTop = Number(probe?.restoredScrollTop);
  const restored = shortDataset ? null : Number.isFinite(restoredScrollTop) && Math.abs(restoredScrollTop) <= 1;
  if (!shortDataset && !restored) {
    violations.push(violation(
      'OBJECT_WORKSPACE_SCROLL_NOT_RESTORED',
      'The virtual queue probe must restore its original top window before row selection evidence.',
      { restoredScrollTop: metrics?.experience?.probe?.restoredScrollTop ?? null },
    ));
  }
  const probeApplicability = shortDataset
    ? { applicable: false, passed: true, reason: 'short-dataset' }
    : {
        applicable: true,
        passed: metrics?.contract?.passed === true
          && probe?.virtualWindowAdvanced === true
          && restored === true,
        reason: 'scrollable-dataset',
      };
  if (workspace === 'diagnosis' && (
    aiRunState?.observed !== true
    || !String(aiRunState?.text || '').trim()
  )) {
    violations.push(violation(
      'DIAGNOSIS_AI_STATE_MISSING',
      'The packaged Diagnosis workspace must record its current visible real AI run state.',
      aiRunState || null,
    ));
  }
  return {
    aiRunState,
    capacity,
    contract: metrics?.experience?.contract || null,
    metrics,
    passed: violations.length === 0,
    probeApplicability,
    requiredVisibleCapacity,
    restored,
    rowCountCredible,
    violations,
    workspace,
  };
}

function validateObjectInspectorEvidence(input) {
  const violations = [];
  const identityMatched = input.row?.selectedAfterClick === true
    && Boolean(input.row?.key)
    && input.row.key === input.escape?.focusedRowKey
    && Boolean(String(input.row?.title || '').trim())
    && String(input.row.title).trim() === String(input.inspector?.title || '').trim();
  if (!identityMatched) {
    violations.push(violation(
      'OBJECT_INSPECTOR_IDENTITY_MISMATCH',
      'The selected virtual row, visible inspector, and restored focus target must retain one stable object identity.',
      { escape: input.escape, inspector: input.inspector, row: input.row },
    ));
  }
  const modeMatched = input.expectedMode === 'drawer'
    ? input.inspector?.mode === 'drawer'
      && input.inspector?.role === 'dialog'
      && input.inspector?.ariaModal === 'true'
    : input.expectedMode === 'inline'
      && input.inspector?.mode === 'inline'
      && input.inspector?.role === 'complementary'
      && input.inspector?.ariaModal !== 'true';
  if (!modeMatched) {
    violations.push(violation(
      'OBJECT_INSPECTOR_MODALITY_MISMATCH',
      'Object details must use a modal drawer below 1400px and a non-modal inline inspector at 1400px and above.',
      { expectedMode: input.expectedMode, inspector: input.inspector },
    ));
  }
  if (input.escape?.closed !== true || input.escape?.focusRestored !== true) {
    violations.push(violation(
      'OBJECT_INSPECTOR_FOCUS_NOT_RESTORED',
      'Escape must close the object inspector and restore focus to the selected virtual row.',
      input.escape,
    ));
  }
  const operationScopeUnchanged = input.workspace !== 'product'
    || canonicalJson(input.operationScope?.before) === canonicalJson(input.operationScope?.after);
  if (!operationScopeUnchanged) {
    violations.push(violation(
      'PRODUCT_VIEW_MUTATED_OPERATION_SCOPE',
      'Selecting a product row for viewing must not change the operation scope or locked ASIN.',
      input.operationScope,
    ));
  }
  if (!/^[A-F0-9]{64}$/.test(String(input.screenshot?.sha256 || ''))) {
    violations.push(violation(
      'OBJECT_INSPECTOR_SCREENSHOT_MISSING_OR_UNHASHED',
      'The visible object inspector must have a hashed viewport screenshot.',
      input.screenshot,
    ));
  }
  return {
    ...input,
    identityMatched,
    modeMatched,
    operationScopeUnchanged,
    passed: violations.length === 0,
    violations,
  };
}

  return {
    validateObjectWorkspaceExperienceEvidence,
    validateObjectInspectorEvidence,
  };
};
