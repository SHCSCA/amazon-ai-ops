const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./playwright-loader');
const {
  enterPreviewStore,
  installPreviewApiBridge,
  startBusinessUiDevServer,
} = require('./business-ui-smoke-navigation');
const {
  EXPECTED_MISSION_CONTROL_SCALES,
  EXPECTED_MISSION_CONTROL_WORKSPACES,
  MISSION_CONTROL_UI_EVIDENCE_KIND,
  MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION,
  MISSION_CONTROL_WORKSPACE_CONTRACT,
  currentMissionControlUiEvidenceSourceHashes,
  evaluateMissionControlUiEvidenceManifest,
  fingerprintMissionControlEvidenceValue,
  missionControlBusinessFactSentinels,
  validateMissionControlUiEvidenceManifest,
} = require('./mission-control-ui-evidence-contract');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'output');
const DEFAULT_VIEWPORT = Object.freeze({ width: 1480, height: 980 });
const MINIMUM_VIEWPORT = Object.freeze({ width: 1200, height: 900 });
const PREVIEW_SCENARIO = 'diagnosis-ready';
const STORE_ID_MAP = Object.freeze({
  'preview-store-shc001': 'SHC001',
  'preview-store-shc002': 'SHC002',
});
const STORE_LABEL_MAP = Object.freeze({
  SHC001: 'SHC001-US · US · USD',
  SHC002: 'SHC002-US · US · USD',
});
const WORKSPACE_LABELS = Object.freeze({
  today: '今日任务',
  missions: '任务中心',
  decisions: '决策与审批',
  experiments: '经营实验',
  execution: '实时执行',
  memory: '因果记忆',
  objects: '店铺与广告对象',
  collection: '数据采集',
  policy: '策略与风控',
  settings: '系统设置',
});
const MAX_RUNTIME_ERRORS = 20;

function safeTimestamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveEvidenceOutputDir(repoRoot, requestedOutput, timestamp = safeTimestamp()) {
  const outputRoot = path.resolve(repoRoot, 'output');
  const target = requestedOutput
    ? path.resolve(repoRoot, requestedOutput)
    : path.join(outputRoot, 'codex-evidence', `mission-control-stage7-ui-${timestamp}`);
  if (!isPathWithin(outputRoot, target) || path.resolve(target) === outputRoot) {
    throw new Error(`Mission Control UI evidence output must be a child of ${outputRoot}`);
  }
  return target;
}

function parseArguments(argv, repoRoot = REPO_ROOT) {
  let requestedOutput;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--output') {
      requestedOutput = argv[index + 1];
      if (!requestedOutput) throw new Error('--output requires a path below output/.');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    help,
    outputDir: resolveEvidenceOutputDir(repoRoot, requestedOutput),
  };
}

function buildWorkspaceMatrix() {
  return EXPECTED_MISSION_CONTROL_SCALES.flatMap((scalePercent) => (
    EXPECTED_MISSION_CONTROL_WORKSPACES.map((workspace) => ({
      scalePercent,
      workspace,
      ...MISSION_CONTROL_WORKSPACE_CONTRACT[workspace].defaultIntent,
    }))
  ));
}

function canonicalStoreId(value) {
  const canonical = STORE_ID_MAP[String(value || '').trim().toLowerCase()];
  if (!canonical) throw new Error(`Unexpected preview Store Authority id: ${String(value || '(empty)')}`);
  return canonical;
}

function normalizedBusinessFactText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`Preview business fact ${label} must be non-empty.`);
  return normalized;
}

function normalizeVisibleIdentityText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findVisibleIdentityLeaks(visibleText, identifiers) {
  const normalizedVisibleText = normalizeVisibleIdentityText(visibleText);
  const seen = new Set();
  return identifiers.filter((identifier) => {
    const normalizedIdentifier = normalizeVisibleIdentityText(identifier);
    if (!normalizedIdentifier || seen.has(normalizedIdentifier)) return false;
    seen.add(normalizedIdentifier);
    return normalizedVisibleText.includes(normalizedIdentifier);
  });
}

function normalizeBusinessFactProjection(value) {
  const scope = value?.scope;
  const products = Array.isArray(value?.products) ? value.products : [];
  const keywordFacts = Array.isArray(value?.keywordFacts) ? value.keywordFacts : [];
  const productAsins = [...new Set(products.map((product) => (
    normalizedBusinessFactText(product?.asin, 'product.asin')
  )))].sort((left, right) => left.localeCompare(right, 'en-US'));
  const normalizedKeywordFacts = keywordFacts.map((fact) => ({
    asin: normalizedBusinessFactText(fact?.asin, 'keywordFact.asin'),
    keyword: normalizedBusinessFactText(fact?.keyword, 'keywordFact.keyword'),
  })).sort((left, right) => (
    left.asin.localeCompare(right.asin, 'en-US')
    || left.keyword.localeCompare(right.keyword, 'en-US')
  ));
  if (productAsins.length === 0 || normalizedKeywordFacts.length === 0) {
    throw new Error('Preview business fact projection must include products and keyword facts.');
  }
  return {
    scope: {
      asin: normalizedBusinessFactText(scope?.asin, 'scope.asin'),
      batchId: normalizedBusinessFactText(scope?.batchId, 'scope.batchId'),
    },
    productAsins,
    keywordFacts: normalizedKeywordFacts,
  };
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function assertSourceHashesStable(startHashes, endHashes) {
  const changedSources = [
    'runnerSha256',
    'contractSha256',
    'rendererTreeSha256',
  ].filter((key) => (
    typeof startHashes?.[key] !== 'string'
    || typeof endHashes?.[key] !== 'string'
    || startHashes[key].toLowerCase() !== endHashes[key].toLowerCase()
  ));
  if (changedSources.length > 0) {
    const error = new Error(
      `Mission Control UI evidence source changed while screenshots were being captured: ${changedSources.join(', ')}.`,
    );
    error.code = 'MISSION_CONTROL_UI_EVIDENCE_SOURCE_CHANGED';
    error.changedSources = changedSources;
    throw error;
  }
  return { ...startHashes };
}

function boundedError(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function attachRuntimeErrorCollector(page) {
  const pending = { console: [], page: [] };
  const add = (channel, value) => {
    if (pending[channel].length < MAX_RUNTIME_ERRORS) pending[channel].push(boundedError(value));
  };
  page.on('console', (message) => {
    if (message.type() === 'error') add('console', message.text());
  });
  page.on('pageerror', (error) => add('page', error?.message || error));
  return {
    checkpoint() {
      const snapshot = {
        console: pending.console.splice(0, pending.console.length),
        page: pending.page.splice(0, pending.page.length),
      };
      return snapshot;
    },
  };
}

async function viewportMetrics(page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    return {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      clientWidth: documentElement.clientWidth,
      scrollWidth: documentElement.scrollWidth,
      deviceScaleFactor: window.devicePixelRatio,
      horizontalOverflow: documentElement.scrollWidth > documentElement.clientWidth,
    };
  });
}

async function captureScreenshot(page, outputDir, fileName) {
  const absolutePath = path.resolve(outputDir, fileName);
  await page.screenshot({ path: absolutePath, fullPage: false });
  return {
    absolutePath,
    sha256: sha256File(absolutePath),
  };
}

function workspaceRootSelector(workspace, subview) {
  return `[data-workspace-evidence-root][data-workspace="${workspace}"][data-workspace-subview="${subview}"]`;
}

function workspaceSettleReady(snapshot) {
  return snapshot?.headingCount === 1
    && typeof snapshot.headingText === 'string'
    && snapshot.headingText.trim().length > 0
    && snapshot.activeTabCount === 1;
}

async function waitForWorkspace(page, workspace, subview) {
  const selector = workspaceRootSelector(workspace, subview);
  const root = page.locator(selector).first();
  await root.waitFor({ state: 'visible', timeout: 15_000 });
  const deadline = Date.now() + 15_000;
  let snapshot;
  do {
    snapshot = await root.evaluate((node) => {
      const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const visible = (candidate) => {
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const headings = Array.from(node.querySelectorAll('h1')).filter(visible);
      const activeTabs = Array.from(node.querySelectorAll(
        ':scope > .workspace-subview-shell__navigation [role="tab"][aria-selected="true"]',
      )).filter(visible);
      const localBusyCount = Array.from(node.querySelectorAll(
        '[aria-busy="true"], [data-workspace-state="loading"], [data-workspace-state="busy"]',
      )).filter(visible).length;
      return {
        headingCount: headings.length,
        headingText: compact(headings[0]?.textContent),
        activeTabCount: activeTabs.length,
        localBusyCount,
      };
    });
    if (workspaceSettleReady(snapshot)) break;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  if (!workspaceSettleReady(snapshot)) {
    throw new Error(`Workspace ${workspace}/${subview} did not expose its evidence identity: ${JSON.stringify(snapshot)}`);
  }
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  }));
  return selector;
}

async function dispatchDomClick(locator) {
  await locator.dispatchEvent('click');
}

async function clickWorkspace(page, workspace) {
  const label = WORKSPACE_LABELS[workspace];
  if (!label) throw new Error(`No visible navigation label registered for ${workspace}`);
  const navigation = page.locator('nav[aria-label="主业务导航"]');
  const item = navigation.locator('.nav-item').filter({ hasText: label });
  if (await item.count() !== 1) {
    throw new Error(`Expected exactly one visible sidebar item for ${workspace} (${label}).`);
  }
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  await dispatchDomClick(item);
  const defaultIntent = MISSION_CONTROL_WORKSPACE_CONTRACT[workspace].defaultIntent;
  await waitForWorkspace(page, workspace, defaultIntent.subview);
  const activeItems = navigation.locator('.nav-item[aria-current="page"]');
  if (await activeItems.count() !== 1 || !(await activeItems.first().innerText()).includes(label)) {
    throw new Error(`Sidebar did not make ${label} the single active workspace.`);
  }
}

async function workspaceDomEvidence(page, workspace, subview) {
  const selector = workspaceRootSelector(workspace, subview);
  return page.locator(selector).first().evaluate((root, input) => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const headings = Array.from(root.querySelectorAll('h1')).filter(visible);
    const tabs = Array.from(root.querySelectorAll(
      ':scope > .workspace-subview-shell__navigation [role="tab"]',
    )).filter(visible);
    const prefix = `${input.workspace}-workspace-tab-`;
    const renderedSubviews = tabs.map((tab) => {
      if (!tab.id.startsWith(prefix)) throw new Error(`Unexpected workspace tab id: ${tab.id}`);
      return tab.id.slice(prefix.length);
    });
    const active = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    return {
      h1: {
        count: headings.length,
        text: compact(headings[0]?.textContent),
      },
      tabs: {
        renderedSubviews,
        activeSubview: active.length === 1 && active[0].id.startsWith(prefix)
          ? active[0].id.slice(prefix.length)
          : null,
      },
    };
  }, { workspace });
}

async function authorityProjection(page) {
  const projection = await page.evaluate(async () => {
    const api = window.electronAPI;
    if (
      !api?.getActiveStoreContext
      || !api?.missionControl?.query
      || !api?.getOperationScope
      || !api?.listStoreProducts
      || !api?.listStoreKeywordFacts
    ) {
      throw new Error('Preview Mission Control authority API is unavailable.');
    }
    const context = await api.getActiveStoreContext();
    if (!context) throw new Error('Preview Store Authority is not active.');
    const [response, scope, products, keywordFacts] = await Promise.all([
      api.missionControl.query({
        query: 'workspace-bootstrap',
        requestId: `ui-evidence-${Date.now()}`,
        contextEpoch: 0,
        context,
      }),
      api.getOperationScope(context),
      api.listStoreProducts(context, {}),
      api.listStoreKeywordFacts(context, { limit: 100 }),
    ]);
    return {
      context,
      autonomy: response.data.autonomy,
      businessFacts: { scope, products, keywordFacts },
    };
  });
  return {
    ...projection,
    businessFacts: normalizeBusinessFactProjection(projection.businessFacts),
  };
}

function manifestAuthority(projection) {
  return {
    storeId: canonicalStoreId(projection.context.storeId),
    marketplace: projection.context.marketplace,
    currency: projection.context.currency,
  };
}

function manifestAutonomy(projection) {
  const autonomy = projection.autonomy;
  return {
    currentMode: autonomy.currentMode,
    manualApprovalAvailable: autonomy.manualApprovalAvailable,
    policyAutoAvailable: autonomy.policyAutoAvailable,
    policyAutoState: autonomy.policyAutoAvailable ? 'AVAILABLE' : 'BLOCKED',
    ...(!autonomy.policyAutoAvailable ? {
      policyAutoBlockerCode: autonomy.policyAutoBlockerCode,
    } : {}),
  };
}

async function captureWorkspace(page, runtimeErrors, outputDir, workspace, scalePercent, captureType = 'workspace') {
  const contract = MISSION_CONTROL_WORKSPACE_CONTRACT[workspace];
  const subview = contract.defaultIntent.subview;
  await waitForWorkspace(page, workspace, subview);
  const [dom, projection] = await Promise.all([
    workspaceDomEvidence(page, workspace, subview),
    authorityProjection(page),
  ]);
  const captureId = captureType === 'workspace'
    ? `workspace-${workspace}-${subview}-${scalePercent}`
    : `${captureType}-${workspace}-${subview}-${scalePercent}`;
  const screenshot = await captureScreenshot(page, outputDir, `${captureId}.png`);
  return {
    captureId,
    captureType,
    workspace,
    defaultIntent: { ...contract.defaultIntent },
    scalePercent,
    screenshot,
    viewport: await viewportMetrics(page),
    ...dom,
    authority: manifestAuthority(projection),
    autonomy: manifestAutonomy(projection),
    errors: runtimeErrors.checkpoint(),
  };
}

async function captureStoreGate(page, runtimeErrors, outputDir) {
  const gate = page.locator('main.mission-control-store-gate[data-state="needs-selection"]');
  await gate.waitFor({ state: 'visible', timeout: 15_000 });
  const dom = await gate.evaluate((root) => {
    const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const headings = Array.from(root.querySelectorAll('h1'));
    const options = Array.from(root.querySelectorAll('#mission-control-store-select option'))
      .filter((option) => option.value)
      .map((option) => ({ label: compact(option.textContent), value: option.value }));
    return {
      bodyText: compact(root.textContent),
      h1: { count: headings.length, text: compact(headings[0]?.textContent) },
      options,
      selectedValue: root.querySelector('#mission-control-store-select')?.value || '',
    };
  });
  if (!dom.bodyText.includes('US') || !dom.bodyText.includes('USD')) {
    throw new Error('Store Gate did not visibly prove the fixed US/USD scope.');
  }
  const availableStoreIds = dom.options.map((option) => canonicalStoreId(option.value));
  const screenshot = await captureScreenshot(page, outputDir, 'store-gate-100.png');
  return {
    captureId: 'store-gate-100',
    captureType: 'store-gate',
    state: 'needs-selection',
    scalePercent: 100,
    screenshot,
    viewport: await viewportMetrics(page),
    h1: dom.h1,
    availableStoreIds,
    activeStoreId: null,
    explicitSelectionRequired: dom.selectedValue === '',
    autoSelected: dom.selectedValue !== '',
    marketplace: 'US',
    currency: 'USD',
    errors: runtimeErrors.checkpoint(),
  };
}

async function readWorkspaceText(page, workspace, subview) {
  return page.locator(workspaceRootSelector(workspace, subview)).first().innerText();
}

async function readVisiblePageText(page) {
  return page.evaluate(() => {
    const rendered = (element) => {
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
      if (element.closest('[aria-hidden="true"], [hidden]')) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && element.getClientRects().length > 0;
    };
    const values = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        parent
        && parent.tagName !== 'OPTION'
        && parent.tagName !== 'SCRIPT'
        && parent.tagName !== 'STYLE'
        && rendered(parent)
      ) {
        const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) values.push(text);
      }
      node = walker.nextNode();
    }
    for (const select of document.querySelectorAll('select')) {
      if (!rendered(select)) continue;
      const text = select.selectedOptions[0]?.textContent?.replace(/\s+/g, ' ').trim();
      if (text) values.push(text);
    }
    return values.join(' ');
  });
}

async function switchStore(page, rawStoreId) {
  const selector = page.getByLabel('切换店铺');
  await selector.selectOption(rawStoreId);
  await page.waitForFunction(async (expectedStoreId) => {
    const shellStoreId = document.querySelector('.mission-control-shell[data-store-context]')
      ?.getAttribute('data-store-context');
    const context = await window.electronAPI?.getActiveStoreContext?.();
    return shellStoreId === expectedStoreId && context?.storeId === expectedStoreId;
  }, rawStoreId, { timeout: 15_000 });
}

async function captureStoreIsolation(page, runtimeErrors, outputDir) {
  await clickWorkspace(page, 'today');
  const contract = MISSION_CONTROL_WORKSPACE_CONTRACT.today;
  const fromProjection = await authorityProjection(page);
  if (canonicalStoreId(fromProjection.context.storeId) !== 'SHC001') {
    throw new Error('Store isolation must begin from SHC001.');
  }
  await switchStore(page, 'preview-store-shc002');
  await clickWorkspace(page, 'today');
  const toProjection = await authorityProjection(page);
  const toText = await readWorkspaceText(page, 'today', contract.defaultIntent.subview);
  const toVisiblePageText = await readVisiblePageText(page);
  const previousIdentifiers = [
    String(fromProjection.context.storeId),
    'SHC001',
    STORE_LABEL_MAP.SHC001,
    String(fromProjection.context.browserProfileId),
  ];
  const leakedStoreIds = findVisibleIdentityLeaks(toVisiblePageText, previousIdentifiers);
  const fromBusinessFactSentinels = missionControlBusinessFactSentinels(
    fromProjection.businessFacts,
  );
  const toBusinessFactSentinels = missionControlBusinessFactSentinels(
    toProjection.businessFacts,
  );
  const normalizedToBusinessFactSentinels = new Set(
    toBusinessFactSentinels.map(normalizeVisibleIdentityText),
  );
  const leakedBusinessFactSentinels = [...new Set([
    ...fromBusinessFactSentinels.filter((sentinel) => (
      normalizedToBusinessFactSentinels.has(normalizeVisibleIdentityText(sentinel))
    )),
    ...findVisibleIdentityLeaks(toVisiblePageText || toText, fromBusinessFactSentinels),
  ])];
  const capture = await captureWorkspace(
    page,
    runtimeErrors,
    outputDir,
    'today',
    100,
    'store-isolation',
  );
  capture.captureId = 'store-isolation-shc001-to-shc002';
  capture.transition = {
    fromStoreId: 'SHC001',
    toStoreId: 'SHC002',
    explicitUserAction: true,
    automatic: false,
  };
  capture.isolation = {
    previousStoreVisible: leakedStoreIds.length > 0,
    leakedStoreIds,
    fromBrowserProfileId: String(fromProjection.context.browserProfileId),
    toBrowserProfileId: String(toProjection.context.browserProfileId),
    fromIdentityFingerprint: fingerprintMissionControlEvidenceValue({
      browserProfileId: String(fromProjection.context.browserProfileId),
      storeId: 'SHC001',
    }),
    toIdentityFingerprint: fingerprintMissionControlEvidenceValue({
      browserProfileId: String(toProjection.context.browserProfileId),
      storeId: 'SHC002',
    }),
    fromBusinessFactProjection: fromProjection.businessFacts,
    toBusinessFactProjection: toProjection.businessFacts,
    fromBusinessFactsFingerprint: fingerprintMissionControlEvidenceValue(
      fromProjection.businessFacts,
    ),
    toBusinessFactsFingerprint: fingerprintMissionControlEvidenceValue(
      toProjection.businessFacts,
    ),
    fromBusinessFactSentinels,
    toBusinessFactSentinels,
    leakedBusinessFactSentinels,
  };
  return capture;
}

function gridTrackCount(value) {
  const tracks = [];
  let depth = 0;
  let token = '';
  for (const character of String(value || '').trim()) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (token) tracks.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (token) tracks.push(token);
  return tracks.length;
}

async function executionLayout(page) {
  return page.locator(workspaceRootSelector('execution', 'live')).first().evaluate((root) => {
    const room = root.querySelector('.execution-cockpit--prototype');
    const frame = root.querySelector('.execution-browser-table-stage');
    const scrollContainer = root.querySelector('.execution-object-grid');
    const table = root.querySelector('.execution-keyword-table');
    if (!room || !frame || !scrollContainer || !table) {
      throw new Error('Execution minimum-window layout nodes are missing.');
    }
    const splitTracks = (value) => {
      const tracks = [];
      let depth = 0;
      let token = '';
      for (const character of String(value || '').trim()) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        if (/\s/.test(character) && depth === 0) {
          if (token) tracks.push(token);
          token = '';
        } else {
          token += character;
        }
      }
      if (token) tracks.push(token);
      return tracks;
    };
    const scrollStyle = window.getComputedStyle(scrollContainer);
    return {
      roomColumnCount: splitTracks(window.getComputedStyle(room).gridTemplateColumns).length,
      frameClientWidth: frame.clientWidth,
      tableClientWidth: table.clientWidth,
      tableScrollWidth: table.scrollWidth,
      tableClipped: table.scrollWidth > scrollContainer.scrollWidth,
      scrollContainerOverflowX: scrollStyle.overflowX,
    };
  });
}

async function captureMinimumWindow(page, runtimeErrors, outputDir) {
  await switchStore(page, 'preview-store-shc001');
  await page.setViewportSize(MINIMUM_VIEWPORT);
  await clickWorkspace(page, 'execution');
  const capture = await captureWorkspace(
    page,
    runtimeErrors,
    outputDir,
    'execution',
    100,
    'minimum-window',
  );
  capture.captureId = 'minimum-window-execution-1200x900-100';
  capture.executionLayout = await executionLayout(page);
  return capture;
}

async function createScalePage(browser, serverUrl, scalePercent) {
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    deviceScaleFactor: scalePercent === 125 ? 1.25 : 1,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const runtimeErrors = attachRuntimeErrorCollector(page);
  await installPreviewApiBridge(page);
  await page.goto(serverUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  return { context, page, runtimeErrors };
}

function createManifest(
  workspaceCaptures,
  storeGateCapture,
  storeIsolationCapture,
  minimumWindowCapture,
  sourceHashes = currentMissionControlUiEvidenceSourceHashes(REPO_ROOT),
) {
  return {
    kind: MISSION_CONTROL_UI_EVIDENCE_KIND,
    schemaVersion: MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: 'STAGE7_UI_EVIDENCE',
    readinessImpact: 'NO_FINAL_READINESS_CREDIT',
    finalReadinessCredit: false,
    source: {
      runtime: 'vite-dev-preview',
      scenario: PREVIEW_SCENARIO,
      ...sourceHashes,
      realLoginAccessed: false,
      authorityDatabaseAccessed: false,
      adsWriteAttempted: false,
    },
    workspaceCaptures,
    storeGateCapture,
    storeIsolationCapture,
    minimumWindowCapture,
  };
}

function formatManifestViolation(violation) {
  const details = Object.fromEntries(Object.entries(violation).filter(([key]) => (
    key !== 'code' && key !== 'path' && key !== 'message'
  )));
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  return `[FAIL] ${violation.code} ${violation.path}: ${violation.message}${suffix}`;
}

function persistAndValidateManifest(manifest, manifestPath, dependencies = {}) {
  const writeManifest = dependencies.writeManifest || ((targetPath, value) => {
    fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  });
  const evaluate = dependencies.evaluate || evaluateMissionControlUiEvidenceManifest;
  const validate = dependencies.validate || validateMissionControlUiEvidenceManifest;
  const reportViolation = dependencies.reportViolation || ((violation) => {
    console.error(formatManifestViolation(violation));
  });
  const validationOptions = {
    expectedSourceHashes: dependencies.expectedSourceHashes
      || currentMissionControlUiEvidenceSourceHashes(REPO_ROOT),
    verifyScreenshotFiles: true,
  };

  writeManifest(manifestPath, manifest);
  const result = evaluate(manifest, validationOptions);
  let validationError;
  try {
    validate(manifest, validationOptions);
  } catch (error) {
    validationError = error;
  }
  if (!result.passed) {
    result.violations.forEach((violation) => reportViolation(violation));
    const error = new Error([
      `Mission Control UI evidence candidate retained at ${manifestPath}.`,
      `${result.violations.length} contract violation(s) require correction.`,
      validationError?.message || '',
    ].filter(Boolean).join('\n'));
    error.code = 'MISSION_CONTROL_UI_EVIDENCE_INVALID';
    error.manifestPath = manifestPath;
    error.violations = result.violations;
    if (validationError) error.cause = validationError;
    throw error;
  }
  if (validationError) throw validationError;
  return { manifestPath, result };
}

async function run(options) {
  const sourceHashesAtStart = currentMissionControlUiEvidenceSourceHashes(REPO_ROOT);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const server = await startBusinessUiDevServer(REPO_ROOT, PREVIEW_SCENARIO);
  let browser;
  const workspaceCaptures = [];
  let storeGateCapture;
  let storeIsolationCapture;
  let minimumWindowCapture;
  try {
    browser = await chromium.launch({ headless: true });
    for (const scalePercent of EXPECTED_MISSION_CONTROL_SCALES) {
      const scale = await createScalePage(browser, server.url, scalePercent);
      try {
        if (scalePercent === 100) {
          storeGateCapture = await captureStoreGate(scale.page, scale.runtimeErrors, options.outputDir);
        }
        await enterPreviewStore(scale.page, STORE_LABEL_MAP.SHC001);
        for (const workspace of EXPECTED_MISSION_CONTROL_WORKSPACES) {
          await clickWorkspace(scale.page, workspace);
          workspaceCaptures.push(await captureWorkspace(
            scale.page,
            scale.runtimeErrors,
            options.outputDir,
            workspace,
            scalePercent,
          ));
        }
        if (scalePercent === 100) {
          storeIsolationCapture = await captureStoreIsolation(
            scale.page,
            scale.runtimeErrors,
            options.outputDir,
          );
          minimumWindowCapture = await captureMinimumWindow(
            scale.page,
            scale.runtimeErrors,
            options.outputDir,
          );
        }
      } finally {
        await scale.context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
  }

  const sourceHashesAtEnd = currentMissionControlUiEvidenceSourceHashes(REPO_ROOT);
  assertSourceHashesStable(sourceHashesAtStart, sourceHashesAtEnd);
  const manifest = createManifest(
    workspaceCaptures,
    storeGateCapture,
    storeIsolationCapture,
    minimumWindowCapture,
    sourceHashesAtStart,
  );
  const manifestPath = path.join(options.outputDir, 'manifest.json');
  persistAndValidateManifest(manifest, manifestPath, {
    expectedSourceHashes: sourceHashesAtEnd,
  });
  console.log(`[PASS] Mission Control UI evidence v2: ${manifestPath}`);
  console.log('[PASS] 20 workspace captures + Store Gate + SHC001->SHC002 isolation + 1200x900 execution');
  return { manifest, manifestPath };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log('Usage: node scripts/run-mission-control-ui-evidence.js [--output output/<directory>]');
    return null;
  }
  return run(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[FAIL] ${error?.stack || error?.message || String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertSourceHashesStable,
  buildWorkspaceMatrix,
  canonicalStoreId,
  createManifest,
  dispatchDomClick,
  findVisibleIdentityLeaks,
  gridTrackCount,
  isPathWithin,
  main,
  normalizeBusinessFactProjection,
  parseArguments,
  persistAndValidateManifest,
  resolveEvidenceOutputDir,
  run,
  safeTimestamp,
  workspaceSettleReady,
};
