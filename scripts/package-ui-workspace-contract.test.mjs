import { packageUiFunctionSource } from './package-ui-test-sources.mjs';
import {
  EXPECTED_PACKAGE_UI_ENTRIES,
  EXPECTED_PACKAGE_UI_MODULES,
  EXPECTED_PACKAGE_UI_SCALES,
  EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  EXPECTED_PACKAGE_UI_WORKSPACES,
  HASH_A,
  HASH_B,
  MISSION_CONTROL_WORKSPACE_CONTRACT,
  PACKAGE_UI_WIDE_PROFILE,
  V16_MODULE_INTENT_MAP,
  buildAppContentManifest,
  decisionsTabAccessibleNamePattern,
  describe,
  evaluatePackageUiProfileEvidence,
  evaluatePackageViewportContract,
  expect,
  it,
  path,
  readFileSync,
  rmSync,
  validatePackageMinimumWindow,
  validatePackageUiDatabaseCheckpointReceipts,
  validatePackageUiDatabaseMutationAudit,
  validatePackageUiReadOnlyRuntimeEvidence,
  validateSchedulerSubviewEvidence,
  validateSchedulerSubviewRuntimeBinding,
  validateWorkspaceRuntimeMetrics,
  validateWorkspaceTabKeyboardEvidence,
} from './package-ui-test-context.mjs';
import {
  databaseCheckpointReceipts,
  validDatabaseMutationAudit,
  validMetrics,
  validReadOnlyRuntime,
  validRun,
  validSchedulerSubviewEvidence,
  withValidAppContent,
} from './package-ui-test-fixtures.mjs';

describe('package workspace runtime contract', () => {
  it('matches Decisions tabs by their dynamic loaded-count accessible names', () => {
    expect(decisionsTabAccessibleNamePattern('已决策').test('已决策（已载入 12）')).toBe(true);
    expect(decisionsTabAccessibleNamePattern('待判断').test('待判断（已载入 0）')).toBe(true);
    expect(decisionsTabAccessibleNamePattern('待判断').test('待判断 生产')).toBe(true);
    expect(decisionsTabAccessibleNamePattern('待判断').test('待判断 任意状态')).toBe(false);
    expect(decisionsTabAccessibleNamePattern('已决策').test('已决策')).toBe(false);
  });

  it('fails closed when the packaged Playwright Chromium runtime is missing', () => {
    withValidAppContent((root) => {
      rmSync(path.join(root, 'playwright-browsers/chrome-win64/chrome.exe'));
      expect(() => buildAppContentManifest(root)).toThrow(
        /required packaged runtime entry is missing.*playwright-browsers\/chrome-win64\/chrome\.exe/i,
      );
    });
  });

  it('locks the exact ten canonical Mission Control workspace identities and registered tabs', () => {
    expect(EXPECTED_PACKAGE_UI_WORKSPACES).toEqual([
      { workspace: 'today', subview: 'overview', label: '今日任务', heading: '今日任务', tabs: ['overview', 'events'] },
      { workspace: 'missions', subview: 'overview', label: '任务中心', heading: '任务中心', tabs: ['overview', 'facts'] },
      { workspace: 'decisions', subview: 'recommendations', label: '决策与审批', heading: '建议与审批', tabs: ['recommendations', 'approval', 'decided'] },
      { workspace: 'experiments', subview: 'ledger', label: '经营实验', heading: '经营实验', tabs: ['ledger'] },
      { workspace: 'execution', subview: 'live', label: '实时执行', heading: '实时执行', tabs: ['live', 'evidence'] },
      { workspace: 'memory', subview: 'timeline', label: '因果记忆', heading: '因果记忆', tabs: ['timeline'] },
      { workspace: 'objects', subview: 'products', label: '产品与广告对象', heading: '产品与广告对象', tabs: ['products', 'targets', 'keywords', 'listing'] },
      { workspace: 'collection', subview: 'scope', label: '数据采集', heading: '工作范围', tabs: ['scope', 'reports', 'import-check'] },
      { workspace: 'policy', subview: 'rules', label: '策略与风控', heading: '策略与风控', tabs: ['rules'] },
      { workspace: 'settings', subview: 'ai-and-local', label: '系统设置', heading: '店铺与运行设置', tabs: ['ai-and-local', 'scheduler', 'delivery'] },
    ]);
  });

  it('keeps package headings and tabs exactly aligned with the source Stage7 evidence contract', () => {
    expect(EXPECTED_PACKAGE_UI_WORKSPACES.map(({ workspace, subview, heading, tabs }) => ({
      workspace,
      subview,
      heading,
      tabs,
    }))).toEqual(Object.entries(MISSION_CONTROL_WORKSPACE_CONTRACT).map(([workspace, contract]) => ({
      workspace,
      subview: contract.defaultIntent.subview,
      heading: contract.heading,
      tabs: [...contract.tabs],
    })));
  });

  it('captures each production entry exactly once under its actual six-module parent at both scales and wide', () => {
    expect(EXPECTED_PACKAGE_UI_MODULES).toEqual(V16_MODULE_INTENT_MAP.map((module) => ({ id: module.id, workspaces: [...module.workspaceIds] })));
    const keys = EXPECTED_PACKAGE_UI_ENTRIES.map((entry) => `${entry.workspace}/${entry.subview}`).sort();
    expect(keys).toHaveLength(22);
    expect(new Set(keys).size).toBe(22);
    expect(keys).toEqual(V16_MODULE_INTENT_MAP.flatMap((module) => module.intents.map((intent) => `${intent.workspace}/${intent.subview}`)).sort());
    expect(PACKAGE_UI_WIDE_PROFILE.workspaces).toEqual(EXPECTED_PACKAGE_UI_ENTRIES);
  });

  it.each([
    ['missing native capture', (run) => { delete run.minimumWindow; }, 'MINIMUM_WINDOW_BOUNDS'],
    ['content viewport substituted for native minimum', (run) => { run.minimumWindow.nativeWindow.bounds.height = 740; }, 'MINIMUM_WINDOW_BOUNDS'],
    ['missing middle entry', (run) => { run.minimumWindow.workspaceChecks.splice(3, 1); }, 'MINIMUM_WINDOW_ENTRIES_NOT_EXACT'],
    ['raw metrics missing despite passed flag', (run) => { delete run.workspaceChecks[0].metrics; }, 'H1_CONTRACT'],
    ['wrong module despite passed flag', (run) => { run.workspaceChecks[0].metrics.activeNavigation.activeModuleIds = ['system-settings']; }, 'ACTIVE_NAVIGATION_CONTRACT'],
    ['keyboard focus mismatch despite passed flag', (run) => { run.workspaceChecks[0].keyboardEvidence.restored.focusedSubview = 'events'; }, 'WORKSPACE_TAB_KEYBOARD_STATE_MISMATCH'],
    ['reused regular capture for minimum window', (run) => { run.minimumWindow.screenshots[0] = run.screenshots[0]; run.minimumWindow.workspaceChecks[0].screenshot = run.screenshots[0]; }, 'V9_SCREENSHOT_PATH_REUSED'],
  ])('rejects %s without trusting the saved passed flags', (_name, mutate, code) => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    expect(validatePackageMinimumWindow(run.minimumWindow).passed).toBe(true);
    mutate(run);
    const result = evaluatePackageUiProfileEvidence('100-compact', run);
    expect(result.passed).toBe(false);
    expect(result.relevantViolations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it('locks the read-only production scheduler subview without duplicating the settings workspace matrix entry', () => {
    expect(EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS).toEqual([{
      workspace: 'settings',
      subview: 'scheduler',
      label: '系统设置',
      heading: '当前店铺自动化',
      tabId: 'settings-workspace-tab-scheduler',
      capabilities: [
        {
          action: 'view',
          capabilityId: 'settings.scheduler.view',
          legacyRoute: 'scheduler',
          state: 'LEGACY_ADAPTER',
        },
        {
          action: 'start',
          capabilityId: 'settings.scheduler.run-now',
          legacyRoute: null,
          state: 'PRODUCTION_NATIVE',
        },
        {
          action: 'view',
          capabilityId: 'settings.scheduler.retention-preview',
          legacyRoute: null,
          state: 'PRODUCTION_NATIVE',
        },
      ],
    }]);
    expect(EXPECTED_PACKAGE_UI_WORKSPACES.filter((workspace) => workspace.workspace === 'settings')).toHaveLength(1);
    expect(validateSchedulerSubviewEvidence(validSchedulerSubviewEvidence())).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));
  });

  it('binds the Main scheduler read-only attestation to the live PID, mode, guards and current artifact', () => {
    const input = validReadOnlyRuntime('runtime-attestation-valid');

    expect(validatePackageUiReadOnlyRuntimeEvidence(
      input,
      { requireSchedulerReads: true },
    )).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));

    const unsafe = structuredClone(input);
    unsafe.marker.guards.runNowIpcDisabled = false;
    expect(validatePackageUiReadOnlyRuntimeEvidence(unsafe).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_UI_READ_ONLY_RUNTIME_GUARDS_NOT_DERIVED' }),
      expect.objectContaining({ code: 'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_MISMATCH' }),
    ]));
  });

  it('accepts only exact ordered Main-derived database checkpoints and receipt binding', () => {
    const runtime = validReadOnlyRuntime('database-audit-valid');
    expect(validatePackageUiDatabaseMutationAudit(
      runtime.marker.databaseMutationAudit,
    )).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));
    expect(validatePackageUiDatabaseCheckpointReceipts(
      databaseCheckpointReceipts(runtime),
      runtime,
    )).toEqual(expect.objectContaining({
      passed: true,
      terminalCheckpoint: expect.objectContaining({ phase: 'pre-close-terminal' }),
      violations: [],
    }));

    const forgedReceipt = databaseCheckpointReceipts(runtime);
    forgedReceipt.postBootstrap.metrics.totalChanges += 1;
    expect(validatePackageUiDatabaseCheckpointReceipts(
      forgedReceipt,
      runtime,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_UI_DATABASE_CHECKPOINT_RECEIPTS_NOT_BOUND' }),
    ]));

    const noConfirmedExit = structuredClone(runtime);
    noConfirmedExit.processExitConfirmed = false;
    expect(validatePackageUiReadOnlyRuntimeEvidence(noConfirmedExit).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_UI_READ_ONLY_RUNTIME_PROCESS_EXIT_UNCONFIRMED',
        }),
      ]),
    );
  });

  it('retrieves Renderer receipts around navigation and copies terminal Main evidence only after close', () => {
    const compact = packageUiFunctionSource('package-ui-profile-run.js', 'runScaleEvidenceCore');
    const wide = packageUiFunctionSource('package-ui-profile-run.js', 'runWideProfileEvidenceCore');

    for (const runner of [compact, wide]) {
      const authorityReadback = runner.indexOf(
        'session.storeAuthorityReadback = await collectEvidenceStoreAuthorityReadback',
      );
      const baselineReceipt = runner.indexOf(
        "requestPackageUiDatabaseCheckpoint(page, 'post-bootstrap')",
      );
      const navigation = runner.indexOf('await capturePackageWorkspaceMatrix(');
      const finalCheckpoint = runner.indexOf("'post-navigation'", navigation);
      const electronClose = runner.indexOf('await electronApp.close()', finalCheckpoint);
      const runtimeMarker = runner.indexOf('collectPackageUiReadOnlyRuntimeEvidence');
      expect(authorityReadback).toBeGreaterThan(0);
      expect(baselineReceipt).toBeGreaterThan(authorityReadback);
      expect(navigation).toBeGreaterThan(baselineReceipt);
      expect(finalCheckpoint).toBeGreaterThan(navigation);
      expect(electronClose).toBeGreaterThan(finalCheckpoint);
      expect(runtimeMarker).toBeGreaterThan(electronClose);
    }
  });

  it('restores the requested viewport after authentication before any workspace evidence is captured', () => {
    const compact = packageUiFunctionSource('package-ui-profile-run.js', 'runScaleEvidenceCore');
    const wide = packageUiFunctionSource('package-ui-profile-run.js', 'runWideProfileEvidenceCore');

    for (const runner of [compact, wide]) {
      const authentication = runner.indexOf('const session = await ensureAuthenticatedWorkspace');
      const viewportRestore = runner.indexOf('await restoreElectronViewportAfterAuthentication', authentication);
      const navigation = runner.indexOf('await capturePackageWorkspaceMatrix(', authentication);
      expect(authentication).toBeGreaterThan(0);
      expect(viewportRestore).toBeGreaterThan(authentication);
      expect(navigation).toBeGreaterThan(viewportRestore);
    }
  });

  it('captures a fresh scheduler workspace bootstrap inside the read-only ledger delta', () => {
    const compact = packageUiFunctionSource('package-ui-profile-run.js', 'runScaleEvidenceCore');
    const source = readFileSync(new URL('./package-ui-workspace-navigation.js', import.meta.url), 'utf8');
    const subviewLoop = compact.indexOf('for (const subview of EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS)');
    const navigationBoundary = compact.indexOf(
      'await prepareReadOnlySubviewNavigationBoundary(page, subview, options.settleMs)',
      subviewLoop,
    );
    const ledgerBefore = compact.indexOf(
      'const schedulerLedgerBefore = readPackageUiSchedulerAudit(options.userDataDir)',
      subviewLoop,
    );
    const rendererReload = compact.indexOf(
      'await reloadAuthenticatedWorkspaceForSubviewEvidence(page)',
      subviewLoop,
    );
    const schedulerNavigation = compact.indexOf(
      'const settleEvidence = await navigateToReadOnlySubview(page, subview, options.settleMs)',
      subviewLoop,
    );

    expect(subviewLoop).toBeGreaterThan(0);
    expect(navigationBoundary).toBeGreaterThan(subviewLoop);
    expect(ledgerBefore).toBeGreaterThan(navigationBoundary);
    expect(rendererReload).toBeGreaterThan(ledgerBefore);
    expect(schedulerNavigation).toBeGreaterThan(rendererReload);

    const helperStart = source.indexOf('async function prepareReadOnlySubviewNavigationBoundary');
    const helperEnd = source.indexOf('async function navigateToReadOnlySubview', helperStart);
    const helper = source.slice(helperStart, helperEnd);
    expect(helperStart).toBeGreaterThan(0);
    expect(helper).toContain('candidate.workspace !== expected.workspace');
    expect(helper).toContain('await navigateToWorkspace(page, boundaryWorkspace, settleMs)');

    const reloadHelperStart = source.indexOf('async function reloadAuthenticatedWorkspaceForSubviewEvidence');
    const reloadHelperEnd = source.indexOf('async function prepareReadOnlySubviewNavigationBoundary', reloadHelperStart);
    const reloadHelper = source.slice(reloadHelperStart, reloadHelperEnd);
    expect(reloadHelperStart).toBeGreaterThan(0);
    expect(reloadHelper).toContain("await page.reload({ waitUntil: 'domcontentloaded' })");
    expect(reloadHelper).toContain('await hasAuthenticatedWorkspace(page, 15_000)');
  });

  it('reads scheduler store identity from the visible authority summary with separated scope tokens', () => {
    const evidenceSource = readFileSync(new URL('./package-ui-scheduler-collector.js', import.meta.url), 'utf8');
    const shellSource = readFileSync(
      new URL('../apps/desktop/src/renderer/mission-control/mission-control-shell.tsx', import.meta.url),
      'utf8',
    );

    expect(shellSource).toContain('data-store-id={activeStoreId}');
    expect(evidenceSource).toContain('const storeSummary = document.querySelector(');
    expect(evidenceSource).toContain(
      '.mission-control-store-select--readonly[aria-label="当前店铺权威摘要"][data-store-id]',
    );
    expect(evidenceSource).toContain(
      "selectedStoreId: storeSummary?.getAttribute('data-store-id') || null",
    );
    expect(evidenceSource).toContain('Array.from(fixedScope.children)');
    expect(evidenceSource).toContain('.map((node) => compactText(node))');
    expect(evidenceSource).toContain(".join(' ')");
  });

  it('collects every visible responsive scheduler scope surface and ignores hidden duplicates', () => {
    const evidenceSource = readFileSync(new URL('./package-ui-scheduler-collector.js', import.meta.url), 'utf8');

    expect(evidenceSource).toContain('const fixedScopeSurfaces = Array.from(document.querySelectorAll(');
    expect(evidenceSource).toContain(
      "'.mission-control-fixed-scope, .mission-control-legacy-adapter__context',",
    );
    expect(evidenceSource).toContain(')).filter(visible);');
    expect(evidenceSource).toContain('fixedScopeTexts,');
    expect(evidenceSource).toContain('fixedScopeVisibleCount: fixedScopeSurfaces.length');
  });

  it('rejects absent or conflicting visible responsive scheduler scope surfaces', () => {
    const absent = validSchedulerSubviewEvidence();
    absent.dom.fixedScopeTexts = [];
    absent.dom.fixedScopeVisibleCount = 0;
    expect(validateSchedulerSubviewEvidence(absent).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_FIXED_SCOPE_MISSING' }),
    ]));

    const conflicting = validSchedulerSubviewEvidence();
    conflicting.dom.fixedScopeTexts = ['US USD', 'US USDT'];
    conflicting.dom.fixedScopeVisibleCount = 2;
    expect(validateSchedulerSubviewEvidence(conflicting).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_FIXED_SCOPE_MISSING' }),
    ]));
  });

  it.each([
    ['reordered checkpoints', (audit) => audit.checkpoints.reverse()],
    ['duplicate checkpoint phase', (audit) => {
      audit.checkpoints[1].phase = 'post-bootstrap';
    }],
    ['missing Main terminal checkpoint', (audit) => {
      audit.checkpoints.pop();
    }],
    ['removed metric field', (audit) => {
      delete audit.checkpoints[1].metrics.dataVersion;
    }],
    ['changed same-connection total_changes', (audit) => {
      audit.checkpoints[1].metrics.totalChanges += 1;
    }],
    ['changed external data_version', (audit) => {
      audit.checkpoints[1].metrics.dataVersion += 1;
    }],
    ['changed terminal total_changes', (audit) => {
      audit.checkpoints[2].metrics.totalChanges += 1;
    }],
    ['changed StoreContext digest', (audit) => {
      audit.checkpoints[1].contextDigestSha256 = HASH_A;
    }],
    ['forged pass/comparison fields', (audit) => {
      audit.checkpoints[1].metrics.digestSha256 = HASH_B;
      audit.passed = true;
      audit.comparisons.digestMatched = true;
    }],
  ])('fails closed for database audit tamper: %s', (_label, mutate) => {
    const audit = validDatabaseMutationAudit();
    mutate(audit);
    const result = validatePackageUiDatabaseMutationAudit(audit);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it.each([
    [
      'Main capability projection drift',
      (evidence) => {
        evidence.ledgerAfter.events[0].response.capabilities
          .find((item) => item.capabilityId === 'settings.scheduler.run-now').state = 'BLOCKED';
      },
      'SCHEDULER_CAPABILITY_PROJECTION_MISMATCH',
    ],
    [
      'StoreContext identity drift',
      (evidence) => {
        evidence.ledgerAfter.events[0].response.authoritativeContext = {
          ...evidence.ledgerAfter.events[0].response.authoritativeContext,
          storeId: 'other-store',
        };
      },
      'SCHEDULER_AUTHORITY_CONTEXT_MISMATCH',
    ],
    [
      'opened run-now confirmation',
      (evidence) => {
        evidence.dom.confirmRunDialogCount = 1;
        evidence.dom.alertDialogCount = 1;
      },
      'SCHEDULER_UNSAFE_CAPTURE_STATE',
    ],
    [
      'missing zero-valued retention attribute',
      (evidence) => {
        evidence.dom.retentionCandidateCount = null;
      },
      'SCHEDULER_DOM_MAIN_RESPONSE_BINDING_MISMATCH',
    ],
  ])('fails closed for scheduler %s', (_label, mutate, code) => {
    const evidence = validSchedulerSubviewEvidence();
    mutate(evidence);
    const result = validateSchedulerSubviewEvidence(evidence);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code }),
    ]));
  });

  it('rejects a reused bootstrap event and exact-scope token drift such as USDT', () => {
    const reused = validSchedulerSubviewEvidence();
    reused.ledgerBefore = structuredClone(reused.ledgerAfter);
    expect(validateSchedulerSubviewEvidence(reused).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_HANDLER_LEDGER_CONTRACT_FAILED' }),
      expect.objectContaining({ code: 'SCHEDULER_BOOTSTRAP_RESPONSE_MISMATCH' }),
    ]));

    const usdt = validSchedulerSubviewEvidence();
    usdt.dom.fixedScopeText = 'US USD USDT';
    expect(validateSchedulerSubviewEvidence(usdt).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_FIXED_SCOPE_MISSING' }),
    ]));
  });

  it('binds each scheduler subview ledger to the hash-proven Main runtime event prefix', () => {
    const subview = validSchedulerSubviewEvidence();
    const runtime = validReadOnlyRuntime('scheduler-binding');
    expect(validateSchedulerSubviewRuntimeBinding(subview, runtime)).toEqual(expect.objectContaining({
      passed: true,
      prefixMatched: true,
      violations: [],
    }));

    const detached = structuredClone(subview);
    detached.ledgerAfter.events[0].request.requestId = 'renderer-bootstrap-detached-1';
    detached.ledgerAfter.events[0].response.requestId = 'renderer-bootstrap-detached-1';
    expect(validateSchedulerSubviewEvidence(detached).passed).toBe(true);
    expect(validateSchedulerSubviewRuntimeBinding(detached, runtime).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_SUBVIEW_RUNTIME_LEDGER_NOT_BOUND' }),
    ]));
  });

  it('fails closed unless End and Home select and focus the registered canonical tabs', () => {
    const expected = EXPECTED_PACKAGE_UI_WORKSPACES.find((workspace) => workspace.workspace === 'objects');
    const snapshot = (activeSubview) => ({
      activeSubview,
      focusedSubview: activeSubview,
      selectedCount: 1,
      selectedSubview: activeSubview,
      tabCount: expected.tabs.length,
    });
    expect(validateWorkspaceTabKeyboardEvidence({
      initial: snapshot('products'),
      end: snapshot('listing'),
      restored: snapshot('products'),
    }, expected)).toEqual(expect.objectContaining({ passed: true, violations: [] }));

    const failed = validateWorkspaceTabKeyboardEvidence({
      initial: snapshot('products'),
      end: { ...snapshot('listing'), focusedSubview: 'products' },
      restored: snapshot('products'),
    }, expected);
    expect(failed.passed).toBe(false);
    expect(failed.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_TAB_KEYBOARD_STATE_MISMATCH' }),
    ]));
  });

  it('accepts unique semantics, one primary action and page-owned scrolling', () => {
    const expected = EXPECTED_PACKAGE_UI_WORKSPACES[0];
    expect(validateWorkspaceRuntimeMetrics(validMetrics(expected), expected)).toEqual({ passed: true, violations: [] });
  });

  it.each([
    ['100% exact viewport', { height: 700, width: 1200 }, 1, true],
    ['125% Windows height rounding by +2 CSS px', { height: 702, width: 1200 }, 1.25, true],
    ['layout drift beyond +2 CSS px', { height: 703, width: 1200 }, 1.25, false],
  ])('%s has the strict nominal viewport tolerance', (_label, actual, actualDeviceScaleFactor, passed) => {
    const result = evaluatePackageViewportContract({
      actual,
      actualDeviceScaleFactor,
      expectedDeviceScaleFactor: actualDeviceScaleFactor === 1 ? 1 : 1.25,
      requested: { height: 700, width: 1200 },
    });
    expect(result.passed).toBe(passed);
    expect(result).toEqual(expect.objectContaining({
      actual: { ...actual, deviceScaleFactor: actualDeviceScaleFactor },
      delta: {
        deviceScaleFactor: 0,
        height: actual.height - 700,
        width: actual.width - 1200,
      },
      requested: { deviceScaleFactor: actualDeviceScaleFactor === 1 ? 1 : 1.25, height: 700, width: 1200 },
      tolerance: { deviceScaleFactor: 0.02, height: 2, width: 2 },
    }));
  });

  it('rejects device scale factor drift beyond 0.02', () => {
    const result = evaluatePackageViewportContract({
      actual: { height: 700, width: 1200 },
      actualDeviceScaleFactor: 1.271,
      expectedDeviceScaleFactor: 1.25,
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DEVICE_SCALE_FACTOR_DELTA' }),
    ]));
  });

  it('locks the visible operator-copy collector to the complete technical vocabulary', () => {
    const collectorSource = packageUiFunctionSource('package-ui-workspace-metrics.js', 'collectPackageWorkspaceMetrics');
    const vocabularyStart = collectorSource.indexOf('const forbiddenOperatorCopy = [');
    const vocabularyEnd = collectorSource.indexOf('];', vocabularyStart);
    const vocabularySource = collectorSource.slice(vocabularyStart, vocabularyEnd);
    const vocabulary = vocabularySource
      .split(/\r?\n/)
      .map((line) => line.match(/\{ token: '([^']+)', pattern: (\/.+\/[a-z]*) \},/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]);

    expect(vocabulary).toEqual([
      ['Mission', '/\\bMission\\b/gi'],
      ['Experiment', '/\\bExperiment\\b/gi'],
      ['UNKNOWN', '/\\bUNKNOWN\\b/g'],
      ['revision', '/\\brevision\\b/gi'],
      ['draft', '/\\bdraft\\b/gi'],
      ['set_keyword_bid', '/\\bset_keyword_bid\\b/g'],
      ['Main', '/\\bMain\\b/gi'],
      ['StoreContext', '/\\bStoreContext\\b/gi'],
      ['Authority', '/\\bAuthority\\b/gi'],
      ['Profile', '/\\bProfile\\b/gi'],
      ['dry-run', '/\\bdry-run\\b/gi'],
      ['manifest', '/\\bmanifest\\b/gi'],
      ['fingerprint', '/\\bfingerprint\\b/gi'],
      ['Renderer', '/\\bRenderer\\b/gi'],
      ['CRUD', '/\\bCRUD\\b/gi'],
      ['PRODUCTION_NATIVE', '/\\bPRODUCTION_NATIVE\\b/gi'],
      ['PROTOTYPE_ONLY', '/\\bPROTOTYPE_ONLY\\b/gi'],
      ['LEGACY_ADAPTER', '/\\bLEGACY_ADAPTER\\b/gi'],
      ['sequence', '/\\bsequence\\b/gi'],
      ['append-only', '/\\bappend-only\\b/gi'],
      ['correction', '/\\bcorrection\\b/gi'],
      ['DECISION', '/\\bDECISION\\b/gi'],
      ['ACTION', '/\\bACTION\\b/gi'],
      ['READBACK', '/\\bREADBACK\\b/gi'],
      ['EFFECT', '/\\bEFFECT\\b/gi'],
    ]);
    expect(collectorSource).toContain(
      `parent.closest('details, [hidden], [aria-hidden="true"], script, style, template')`,
    );
  });

  it.each([
    ['workspace identity', { root: { count: 1, workspace: 'product', subview: 'products' } }, 'WORKSPACE_IDENTITY_MISMATCH'],
    ['heading', { h1: { count: 2, labels: ['今日任务', '重复标题'] } }, 'H1_CONTRACT'],
    ['primary action', { primaryAction: { count: 0, labels: [] } }, 'PRIMARY_ACTION_CONTRACT'],
    ['horizontal overflow', { horizontalOverflow: { violations: [{ selector: '.app-content', overflowPx: 4 }] } }, 'PAGE_HORIZONTAL_OVERFLOW'],
    ['duplicate ids', { aria: { duplicateIds: ['duplicate'], brokenReferences: [] } }, 'DUPLICATE_DOM_ID'],
    ['broken aria refs', { aria: { duplicateIds: [], brokenReferences: [{ attribute: 'aria-labelledby', token: 'missing' }] } }, 'BROKEN_ARIA_REFERENCE'],
    ['nested scroll', { scrollOwnership: { defaultOwner: { declared: true, matchCount: 1 }, unlabelledActiveOwners: [{ selector: '.table-wrap' }] } }, 'UNLABELLED_SCROLL_OWNER'],
    ['workspace retained scroll position', { scrollOwnership: { defaultOwner: { declared: true, matchCount: 1, scrollTop: 120 }, unlabelledActiveOwners: [] } }, 'WORKSPACE_NOT_AT_TOP'],
    ['preview marker', { previewMarkers: ['仅开发预览'] }, 'PREVIEW_MARKER_PRESENT'],
    ['missing operator-copy audit', { operatorCopy: null }, 'OPERATOR_COPY_AUDIT_MISSING'],
    ['operator-facing internal copy', { operatorCopy: { forbiddenMatches: [{ token: 'Mission', text: 'Mission 队列' }], textLength: 128, textSha256: HASH_A } }, 'OPERATOR_INTERNAL_COPY_VISIBLE'],
  ])('rejects %s', (_label, overrides, code) => {
    const expected = EXPECTED_PACKAGE_UI_WORKSPACES[0];
    const result = validateWorkspaceRuntimeMetrics(validMetrics(expected, overrides), expected);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});
