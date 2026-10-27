// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_PACKAGE_UI_ENTRIES,
    PACKAGE_OBJECT_EXPERIENCE_CONTRACTS,
    PACKAGE_OBJECT_WORKSPACES,
    collectWorkspaceDomMetrics,
    path,
  } = dependencies;
  const adaptiveObjectExperienceContract = (...args) => dependencies.adaptiveObjectExperienceContract(...args);
  const captureViewportScreenshot = (...args) => dependencies.captureViewportScreenshot(...args);
  const collectObjectQueueCapacityMetrics = (...args) => dependencies.collectObjectQueueCapacityMetrics(...args);
  const collectPackageWorkspaceMetrics = (...args) => dependencies.collectPackageWorkspaceMetrics(...args);
  const collectVisibleAiRunState = (...args) => dependencies.collectVisibleAiRunState(...args);
  const exerciseObjectInspector = (...args) => dependencies.exerciseObjectInspector(...args);
  const exerciseWorkspaceTabKeyboard = (...args) => dependencies.exerciseWorkspaceTabKeyboard(...args);
  const fail = (...args) => dependencies.fail(...args);
  const navigateToWorkspace = (...args) => dependencies.navigateToWorkspace(...args);
  const restoreWorkspaceScrollTop = (...args) => dependencies.restoreWorkspaceScrollTop(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const screenshotRecord = (...args) => dependencies.screenshotRecord(...args);
  const setRunDiagnosticPhase = (...args) => dependencies.setRunDiagnosticPhase(...args);
  const validateObjectWorkspaceExperienceEvidence = (...args) => dependencies.validateObjectWorkspaceExperienceEvidence(...args);
  const validateWorkspaceRuntimeMetrics = (...args) => dependencies.validateWorkspaceRuntimeMetrics(...args);
  const waitForRendererComposite = (...args) => dependencies.waitForRendererComposite(...args);
  const waitForWorkspaceSettled = (...args) => dependencies.waitForWorkspaceSettled(...args);

async function capturePackageWorkspaceMatrix(page, electronApp, {
  diagnostics, runDir, settleMs, profileId, scalePercent, viewport, captureId = profileId, wide = false,
}) {
  const objectContract = PACKAGE_OBJECT_EXPERIENCE_CONTRACTS[wide ? 'wide' : 'compact'];
    const workspaceChecks = [];
    const screenshots = [];
    for (const workspace of EXPECTED_PACKAGE_UI_ENTRIES) {
      setRunDiagnosticPhase(diagnostics, `workspace:${workspace.workspace}/${workspace.subview}`);
      const settleEvidence = await navigateToWorkspace(page, workspace, settleMs);
      const keyboardEvidence = await exerciseWorkspaceTabKeyboard(page, workspace);
      const workspaceRoot = page.locator(
        `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`,
      );
      await waitForWorkspaceSettled(
        page,
        `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`,
        settleMs,
      );
      await restoreWorkspaceScrollTop(page);
      const compositeEvidence = await waitForRendererComposite(page, electronApp, workspaceRoot);
      const metrics = await collectPackageWorkspaceMetrics(page, workspace);
      const contract = validateWorkspaceRuntimeMetrics(metrics, workspace, viewport);
      let experienceEvidence = null;
      let inspectorEvidence = null;
      if (PACKAGE_OBJECT_WORKSPACES.some((item) => item.workspace === workspace.workspace)) {
        const rootSelector = `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`;
        const capacity = await collectObjectQueueCapacityMetrics(page, rootSelector);
        const requiredVisibleCapacity = objectContract.minFullyVisibleRows;
        const experienceMetrics = await collectWorkspaceDomMetrics(page, {
          experienceContract: adaptiveObjectExperienceContract(
            objectContract,
            capacity,
          ),
          rootSelector,
        });
        const aiRunState = workspace.workspace === 'diagnosis'
          ? await collectVisibleAiRunState(page)
          : { ariaBusy: false, observed: false, statusLabel: null, text: '', tone: null };
        experienceEvidence = validateObjectWorkspaceExperienceEvidence({
          aiRunState,
          capacity,
          metrics: experienceMetrics,
          requiredVisibleCapacity,
          workspace: workspace.workspace,
        });
        if (!experienceEvidence.passed) {
          fail('Packaged object-workspace experience contract failed', `${workspace.workspace}: ${JSON.stringify(experienceEvidence.violations)}`);
        }
      }
      const screenshotPath = path.join(
        runDir,
        `${captureId}-${safeSegment(workspace.workspace)}-${safeSegment(workspace.subview)}.png`,
      );
      const screenshotCapture = await captureViewportScreenshot(electronApp, screenshotPath);
      const screenshot = screenshotRecord(screenshotPath, {
        capture: screenshotCapture,
        heading: workspace.heading,
        scalePercent,
        profileId,
        subview: workspace.subview,
        workspace: workspace.workspace,
      });
      screenshots.push(screenshot);
      if (experienceEvidence) {
        inspectorEvidence = await exerciseObjectInspector(page, {
          electronApp,
          expectedMode: wide ? 'inline' : 'drawer',
          profileId: profileId,
          runDir,
          workspace,
        });
      }
      workspaceChecks.push({
        ...workspace,
        compositeEvidence,
        passed: contract.passed,
        settleEvidence,
        violations: contract.violations,
        metrics,
        experienceEvidence,
        inspectorEvidence,
        keyboardEvidence,
        screenshot,
      });
      if (!contract.passed) {
        fail('Packaged workspace runtime contract failed', `${workspace.workspace}/${workspace.subview}: ${JSON.stringify(contract.violations)}`);
      }
    }

  return { workspaceChecks, screenshots };
}

  return {
    capturePackageWorkspaceMatrix,
  };
};
