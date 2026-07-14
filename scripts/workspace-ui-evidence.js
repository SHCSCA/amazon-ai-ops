const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OUTPUT_DIR = 'output/workspace-ui-evidence';
const DEFAULT_VIEWPORT = { width: 1400, height: 900 };
const MIN_VISIBLE_FONT_SIZE_PX = 12;

function argumentValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value || '');
  if (!match) throw new Error('--viewport must use WIDTHxHEIGHT, for example 1200x700.');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) throw new Error('--viewport dimensions must be positive integers.');
  return { width, height };
}

function validatePreviewUrl(value, scenario, label = 'Workspace evidence URL') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid: ${value}`);
  }
  if (url.searchParams.get('preview') !== '1') {
    throw new Error(`${label} must explicitly include preview=1.`);
  }
  const urlScenario = url.searchParams.get('scenario');
  if (urlScenario !== scenario) {
    throw new Error(`${label} scenario ${urlScenario || '(missing)'} does not match recorded scenario ${scenario}.`);
  }
}

function parseWorkspaceEvidenceArgs(argv) {
  const values = {};
  let allowContractFail = false;

  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--allow-contract-fail') {
      allowContractFail = true;
      continue;
    }
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`);
    const value = argumentValue(argv, index, name);
    index += 1;
    switch (name) {
      case '--config': values.configPath = value; break;
      case '--url': values.url = value; break;
      case '--workspace': values.workspace = value; break;
      case '--subview': values.subview = value; break;
      case '--scenario': values.scenario = value; break;
      case '--viewport': values.viewport = parseViewport(value); break;
      case '--dpr': values.dpr = Number(value); break;
      case '--output': values.outputDir = value; break;
      case '--root': values.rootSelector = value; break;
      case '--wait-for': values.waitFor = value; break;
      case '--settle-ms': values.settleMs = Number(value); break;
      default: throw new Error(`Unknown argument: ${name}`);
    }
  }

  if (values.configPath) {
    const extra = Object.keys(values).filter((key) => key !== 'configPath');
    if (extra.length > 0 || allowContractFail) {
      throw new Error('--config cannot be combined with inline target arguments.');
    }
    return { configPath: values.configPath, mode: 'config' };
  }

  if (!values.url || !values.workspace || !values.subview || !values.scenario) {
    throw new Error('Inline evidence requires --url, --workspace, --subview and --scenario.');
  }
  validatePreviewUrl(values.url, values.scenario, 'Inline evidence URL');
  const dpr = values.dpr === undefined ? 1 : values.dpr;
  if (!Number.isFinite(dpr) || dpr <= 0) throw new Error('--dpr must be a positive number.');
  const settleMs = values.settleMs === undefined ? undefined : values.settleMs;
  if (settleMs !== undefined && (!Number.isFinite(settleMs) || settleMs < 0)) {
    throw new Error('--settle-ms must be a non-negative number.');
  }

  const target = {
    dpr,
    scenario: values.scenario,
    subview: values.subview,
    url: values.url,
    viewport: values.viewport || DEFAULT_VIEWPORT,
    workspace: values.workspace,
  };
  if (values.rootSelector) target.rootSelector = values.rootSelector;
  if (values.waitFor) target.waitFor = values.waitFor;
  if (settleMs !== undefined) target.settleMs = settleMs;

  const parsed = {
    mode: 'inline',
    outputDir: values.outputDir || DEFAULT_OUTPUT_DIR,
    target,
  };
  if (allowContractFail) parsed.allowContractFail = true;
  return parsed;
}

async function collectWorkspaceDomMetrics(page, options = {}) {
  const rootSelector = options.rootSelector || '[data-workspace-evidence-root]';
  const defaultScrollOwnerSelector = options.defaultScrollOwnerSelector || '.app-content';
  const scrollExceptionSelector = options.scrollExceptionSelector || '[data-scroll-owner="virtual-table"]';

  return page.evaluate((settings) => {
    const tolerance = 1;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const requestedRoot = document.querySelector(settings.rootSelector);
    const root = requestedRoot || document.querySelector('.app-content') || document.body;

    function rendered(element) {
      if (!(element instanceof Element) || !element.isConnected) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    }

    function inViewport(element) {
      if (!rendered(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
    }

    function compactText(element) {
      return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    }

    function selectorFor(element) {
      if (element === document.documentElement) return 'documentElement';
      if (element === document.body) return 'body';
      if (element.id) return `#${CSS.escape(element.id)}`;
      const className = Array.from(element.classList || []).find(Boolean);
      if (className) return `.${CSS.escape(className)}`;
      const tag = element.tagName.toLowerCase();
      const parent = element.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === element.tagName);
      return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})` : tag;
    }

    const h1Elements = Array.from(root.querySelectorAll('h1')).filter(rendered);
    const visiblePrimaryActions = Array.from(root.querySelectorAll('[data-action-priority="primary"]')).filter(inViewport);
    const visibleSecondaryActions = Array.from(root.querySelectorAll('[data-action-priority="secondary"]')).filter(inViewport);

    const textMeasurements = [];
    const textElements = [root, ...root.querySelectorAll('*')];
    for (const element of textElements) {
      if (!rendered(element) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(element.tagName)) continue;
      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!directText) continue;
      const fontSizePx = Number.parseFloat(window.getComputedStyle(element).fontSize);
      if (!Number.isFinite(fontSizePx)) continue;
      textMeasurements.push({
        fontSizePx,
        selector: selectorFor(element),
        text: directText.slice(0, 160),
      });
    }
    const minimumFontSizePx = textMeasurements.length > 0
      ? Math.min(...textMeasurements.map((measurement) => measurement.fontSizePx))
      : null;
    const undersizedText = textMeasurements.filter((measurement) => measurement.fontSizePx < settings.minimumFontSizePx);

    const horizontalTargets = [
      { element: document.documentElement, selector: 'documentElement' },
      { element: document.body, selector: 'body' },
      { element: document.querySelector('.app-shell'), selector: '.app-shell' },
      { element: document.querySelector('.app-content'), selector: '.app-content' },
    ];
    const horizontalMeasurements = horizontalTargets.map(({ element, selector }) => {
      if (!element) return { missing: true, selector };
      return {
        clientWidth: element.clientWidth,
        overflowPx: Math.max(0, element.scrollWidth - element.clientWidth),
        scrollWidth: element.scrollWidth,
        selector,
      };
    });
    const horizontalViolations = horizontalMeasurements
      .filter((measurement) => !measurement.missing && measurement.overflowPx > tolerance);
    const missingHorizontalTargets = horizontalMeasurements
      .filter((measurement) => measurement.missing)
      .map((measurement) => measurement.selector);

    const defaultOwnerElements = Array.from(document.querySelectorAll(settings.defaultScrollOwnerSelector));
    const defaultOwnerElement = defaultOwnerElements[0] || null;
    const defaultOwnerStyle = defaultOwnerElement ? window.getComputedStyle(defaultOwnerElement) : null;
    const defaultOwnerDeclared = Boolean(
      defaultOwnerElement
      && /^(auto|scroll|overlay)$/.test(defaultOwnerStyle.overflowY),
    );
    const allElements = Array.from(document.querySelectorAll('*'));
    const activeOwners = [];
    for (const element of allElements) {
      const style = window.getComputedStyle(element);
      const declared = /^(auto|scroll|overlay)$/.test(style.overflowY);
      const active = declared && element.scrollHeight - element.clientHeight > tolerance;
      if (!active) continue;
      const explicitException = element.matches(settings.scrollExceptionSelector);
      activeOwners.push({
        clientHeight: element.clientHeight,
        defaultOwner: element === defaultOwnerElement,
        explicitException,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        selector: selectorFor(element),
      });
    }
    const unlabelledActiveOwners = activeOwners.filter((owner) => (
      !owner.defaultOwner && !owner.explicitException
    ));

    const nestedDetails = Array.from(root.querySelectorAll('details details'));
    const violations = [];
    function violation(code, message, details) {
      violations.push({ code, details, message });
    }
    if (!requestedRoot) {
      violation('WORKSPACE_ROOT_MISSING', '缺少指定的工作区证据根节点。', {
        requestedSelector: settings.rootSelector,
      });
    }
    if (h1Elements.length !== 1) {
      violation('H1_COUNT', '工作区必须恰好包含一个可见 h1。', { actual: h1Elements.length });
    }
    if (visiblePrimaryActions.length !== 1) {
      violation('PRIMARY_ACTION_COUNT', '首屏必须恰好包含一个可见主动作。', { actual: visiblePrimaryActions.length });
    }
    if (visibleSecondaryActions.length > 2) {
      violation('SECONDARY_ACTION_COUNT', '首屏可见次动作不得超过两个。', { actual: visibleSecondaryActions.length });
    }
    if (undersizedText.length > 0) {
      violation('TEXT_BELOW_12PX', `可见文字不得小于 ${settings.minimumFontSizePx}px。`, {
        actualMinimumPx: minimumFontSizePx,
        samples: undersizedText.slice(0, 25),
      });
    }
    if (nestedDetails.length > 0) {
      violation('NESTED_DETAILS', '工作区不得嵌套 details disclosure。', {
        actual: nestedDetails.length,
        samples: nestedDetails.slice(0, 10).map(selectorFor),
      });
    }
    if (horizontalViolations.length > 0) {
      violation('HORIZONTAL_OVERFLOW', '页面级容器不得产生水平溢出。', { targets: horizontalViolations });
    }
    if (missingHorizontalTargets.length > 0) {
      violation('HORIZONTAL_CONTAINER_MISSING', '缺少必须检查的页面级容器。', { selectors: missingHorizontalTargets });
    }
    if (defaultOwnerElements.length !== 1 || !defaultOwnerDeclared) {
      violation('DEFAULT_SCROLL_OWNER', '.app-content 必须是唯一声明的工作区纵向滚动所有者。', {
        actualCount: defaultOwnerElements.length,
        overflowY: defaultOwnerStyle ? defaultOwnerStyle.overflowY : null,
      });
    }
    if (unlabelledActiveOwners.length > 0) {
      violation('UNLABELLED_SCROLL_OWNER', '内部纵向滚动必须是显式标记的虚拟表格例外。', {
        owners: unlabelledActiveOwners,
      });
    }

    return {
      actions: {
        primaryLabels: visiblePrimaryActions.map(compactText),
        primaryVisibleInViewport: visiblePrimaryActions.length,
        secondaryLabels: visibleSecondaryActions.map(compactText),
        secondaryVisibleInViewport: visibleSecondaryActions.length,
      },
      contract: { passed: violations.length === 0, violations },
      details: {
        nestedCount: nestedDetails.length,
      },
      dpr: window.devicePixelRatio,
      h1: {
        count: h1Elements.length,
        labels: h1Elements.map(compactText),
      },
      identity: {
        pageUrl: window.location.href,
        scenario: new URL(window.location.href).searchParams.get('scenario'),
        subview: requestedRoot ? requestedRoot.getAttribute('data-workspace-subview') : null,
        workspace: requestedRoot ? requestedRoot.getAttribute('data-workspace') : null,
      },
      horizontalOverflow: {
        measurements: horizontalMeasurements,
        missingTargets: missingHorizontalTargets,
        violations: horizontalViolations,
      },
      root: {
        found: Boolean(requestedRoot),
        requestedSelector: settings.rootSelector,
        resolvedSelector: requestedRoot ? selectorFor(requestedRoot) : null,
      },
      scrollOwnership: {
        activeOwners,
        defaultOwner: {
          declared: defaultOwnerDeclared,
          matchCount: defaultOwnerElements.length,
          overflowY: defaultOwnerStyle ? defaultOwnerStyle.overflowY : null,
          selector: settings.defaultScrollOwnerSelector,
        },
        explicitExceptions: activeOwners.filter((owner) => owner.explicitException),
        unlabelledActiveOwners,
      },
      text: {
        measuredCount: textMeasurements.length,
        minimumFontSizePx,
        undersizedCount: undersizedText.length,
        undersizedSamples: undersizedText.slice(0, 25),
      },
      viewport: { height: viewportHeight, width: viewportWidth },
    };
  }, {
    defaultScrollOwnerSelector,
    minimumFontSizePx: MIN_VISIBLE_FONT_SIZE_PX,
    rootSelector,
    scrollExceptionSelector,
  });
}

function safeSegment(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function timestampSegment(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function validateCaptureTarget(target) {
  if (!target || typeof target !== 'object') throw new Error('Workspace evidence target is required.');
  for (const field of ['workspace', 'subview', 'scenario']) {
    if (typeof target[field] !== 'string' || !target[field].trim()) {
      throw new Error(`Workspace evidence target requires ${field}.`);
    }
  }
  if (!target.viewport || !Number.isInteger(target.viewport.width) || !Number.isInteger(target.viewport.height)) {
    throw new Error('Workspace evidence target requires an integer viewport width and height.');
  }
  if (!Number.isFinite(target.dpr) || target.dpr <= 0) {
    throw new Error('Workspace evidence target requires a positive DPR.');
  }
}

function normalizeConfigViewport(value, targetNumber) {
  if (value === undefined) return { ...DEFAULT_VIEWPORT };
  if (typeof value === 'string') {
    try {
      return parseViewport(value);
    } catch (error) {
      throw new Error(`Workspace evidence target ${targetNumber} has an invalid viewport: ${error.message}`);
    }
  }
  if (value && Number.isInteger(value.width) && Number.isInteger(value.height) && value.width > 0 && value.height > 0) {
    return { width: value.width, height: value.height };
  }
  throw new Error(`Workspace evidence target ${targetNumber} has an invalid viewport.`);
}

function normalizeWorkspaceEvidenceConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Workspace evidence config must be a JSON object.');
  }
  if (!Array.isArray(config.targets) || config.targets.length === 0) {
    throw new Error('Workspace evidence config requires a non-empty targets array.');
  }

  const targets = config.targets.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`Workspace evidence target ${index + 1} must be an object.`);
    }
    const dpr = source.dpr === undefined ? 1 : Number(source.dpr);
    const target = {
      dpr,
      scenario: source.scenario,
      subview: source.subview,
      viewport: normalizeConfigViewport(source.viewport, index + 1),
      workspace: source.workspace,
    };
    validateCaptureTarget(target);

    const sourceUrl = source.url || config.baseUrl;
    if (!sourceUrl) throw new Error(`Workspace evidence target ${index + 1} requires url or config.baseUrl.`);
    let url;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw new Error(`Workspace evidence target ${index + 1} has an invalid URL: ${sourceUrl}`);
    }
    url.searchParams.set('preview', '1');
    url.searchParams.set('scenario', target.scenario);
    target.url = url.toString();
    validatePreviewUrl(target.url, target.scenario, `Workspace evidence target ${index + 1} URL`);

    for (const field of ['rootSelector', 'waitFor']) {
      const value = source[field] === undefined ? config[field] : source[field];
      if (typeof value === 'string' && value.trim()) target[field] = value;
    }
    const settleMs = source.settleMs === undefined ? config.settleMs : source.settleMs;
    if (settleMs !== undefined) {
      const parsedSettleMs = Number(settleMs);
      if (!Number.isFinite(parsedSettleMs) || parsedSettleMs < 0) {
        throw new Error(`Workspace evidence target ${index + 1} has an invalid settleMs.`);
      }
      target.settleMs = parsedSettleMs;
    }
    return target;
  });

  return {
    allowContractFail: Boolean(config.allowContractFail),
    outputDir: config.outputDir || DEFAULT_OUTPUT_DIR,
    targets,
  };
}

async function captureWorkspaceEvidence({ outputDir, page, target, timestamp = new Date() }) {
  if (!page || typeof page.screenshot !== 'function') throw new Error('A Playwright page is required.');
  if (!outputDir) throw new Error('Workspace evidence outputDir is required.');
  validateCaptureTarget(target);

  const metrics = await collectWorkspaceDomMetrics(page, { rootSelector: target.rootSelector });
  validatePreviewUrl(metrics.identity.pageUrl, target.scenario, 'Runtime workspace evidence URL');
  const identityMismatches = [];
  for (const field of ['workspace', 'subview']) {
    if (metrics.identity[field] !== target[field]) {
      identityMismatches.push(`${field} actual ${metrics.identity[field] || '(missing)'} target ${target[field]}`);
    }
  }
  if (identityMismatches.length > 0) {
    throw new Error(`Runtime workspace identity does not match target: ${identityMismatches.join('; ')}.`);
  }
  if (metrics.viewport.width !== target.viewport.width || metrics.viewport.height !== target.viewport.height) {
    throw new Error(`Runtime viewport ${metrics.viewport.width}x${metrics.viewport.height} does not match target ${target.viewport.width}x${target.viewport.height}.`);
  }
  if (Math.abs(metrics.dpr - target.dpr) > 0.001) {
    throw new Error(`Runtime DPR ${metrics.dpr} does not match target ${target.dpr}.`);
  }

  const absoluteOutputDir = path.resolve(outputDir);
  fs.mkdirSync(absoluteOutputDir, { recursive: true });
  const baseName = [
    safeSegment(target.workspace),
    safeSegment(target.subview),
    safeSegment(target.scenario),
    `${target.viewport.width}x${target.viewport.height}`,
    `dpr-${String(target.dpr).replace('.', '_')}`,
    timestampSegment(timestamp),
  ].join('--');
  const screenshotPath = path.join(absoluteOutputDir, `${baseName}.png`);
  const jsonPath = path.join(absoluteOutputDir, `${baseName}.json`);

  await page.screenshot({ fullPage: false, path: screenshotPath });
  const screenshotSha256 = createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex').toUpperCase();
  const evidence = {
    capturedAt: timestamp.toISOString(),
    domMetrics: metrics,
    dpr: metrics.dpr,
    kind: 'workspace-ui-runtime-evidence',
    pageUrl: typeof page.url === 'function' ? page.url() : null,
    scenario: target.scenario,
    schemaVersion: 'workspace-ui-evidence/v1',
    screenshot: {
      fullPage: false,
      path: screenshotPath,
      sha256: screenshotSha256,
    },
    subview: target.subview,
    viewport: metrics.viewport,
    workspace: target.workspace,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  return { evidence, jsonPath, screenshotPath };
}

async function runWorkspaceEvidenceTargets({ browser, generatedAt = new Date(), outputDir, targets }) {
  if (!browser || typeof browser.newContext !== 'function') throw new Error('A launched Playwright browser is required.');
  if (!outputDir) throw new Error('Workspace evidence outputDir is required.');
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('Workspace evidence targets are required.');

  const absoluteOutputDir = path.resolve(outputDir);
  fs.mkdirSync(absoluteOutputDir, { recursive: true });
  const results = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    validateCaptureTarget(target);
    if (typeof target.url !== 'string' || !target.url.trim()) {
      throw new Error(`Workspace evidence target ${index + 1} requires url.`);
    }
    validatePreviewUrl(target.url, target.scenario, `Workspace evidence target ${index + 1} URL`);
    const context = await browser.newContext({
      deviceScaleFactor: target.dpr,
      viewport: target.viewport,
    });
    const page = await context.newPage();
    try {
      await page.goto(target.url, { waitUntil: target.waitUntil || 'networkidle' });
      if (target.waitFor) await page.locator(target.waitFor).first().waitFor({ state: 'visible' });
      await page.evaluate(({ subview, workspace }) => {
        window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', {
          detail: { subview, workspace },
        }));
      }, { subview: target.subview, workspace: target.workspace });
      await page.waitForTimeout(target.settleMs === undefined ? 250 : target.settleMs);
      const timestamp = new Date(generatedAt.getTime() + index);
      const captured = await captureWorkspaceEvidence({ outputDir: absoluteOutputDir, page, target, timestamp });
      results.push(captured);
    } catch (error) {
      results.push({
        error: error && error.message ? error.message : String(error),
        target,
      });
    } finally {
      await context.close();
    }
  }

  const manifestTargets = results.map((result, index) => {
    const target = targets[index];
    if (result.error) {
      return {
        contractPassed: false,
        dpr: target.dpr,
        error: result.error,
        scenario: target.scenario,
        subview: target.subview,
        viewport: target.viewport,
        workspace: target.workspace,
      };
    }
    return {
      contractPassed: result.evidence.domMetrics.contract.passed,
      dpr: result.evidence.dpr,
      jsonPath: result.jsonPath,
      scenario: result.evidence.scenario,
      screenshot: result.evidence.screenshot,
      subview: result.evidence.subview,
      violations: result.evidence.domMetrics.contract.violations,
      viewport: result.evidence.viewport,
      workspace: result.evidence.workspace,
    };
  });
  const passed = manifestTargets.every((target) => target.contractPassed);
  const manifest = {
    generatedAt: generatedAt.toISOString(),
    kind: 'workspace-ui-evidence-run',
    passed,
    schemaVersion: 'workspace-ui-evidence-run/v1',
    targets: manifestTargets,
  };
  const manifestPath = path.join(
    absoluteOutputDir,
    `workspace-ui-evidence-run-${timestampSegment(generatedAt)}.json`,
  );
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { manifest, manifestPath, passed, results };
}

module.exports = {
  captureWorkspaceEvidence,
  collectWorkspaceDomMetrics,
  normalizeWorkspaceEvidenceConfig,
  parseWorkspaceEvidenceArgs,
  runWorkspaceEvidenceTargets,
};
