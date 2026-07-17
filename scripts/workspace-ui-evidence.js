const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OUTPUT_DIR = 'output/workspace-ui-evidence';
const DEFAULT_VIEWPORT = { width: 1400, height: 900 };
const MIN_VISIBLE_FONT_SIZE_PX = 12;
const VISUAL_STATE_IDS = new Set([
  'workspace-error-retry',
  'diagnosis-ai-running-with-inspector',
]);
const MOTION_PREFERENCES = new Set(['no-preference', 'reduce']);
const STATE_EVIDENCE_SCHEMA_VERSION = 'workspace-ui-state-evidence/v1';
const DEFAULT_EXPERIENCE_CONTRACT = Object.freeze({
  maxPageOverflowPx: 24,
  maxPageOverflowRatio: 1.05,
  maxPageScrollLeakPx: 1,
  maxRenderedRows: 30,
  maxStickyHeaderOffsetPx: 2,
  maxWorkSurfaceTopPx: 300,
  minAriaRowCount: 100,
  minFullyVisibleRows: 5,
  minQueueViewportHeightPx: 360,
  scrollProbeRatio: 0.5,
});

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

function validateVisualStateTarget(target, label = 'Workspace evidence target') {
  if (target.visualState === undefined && target.motionPreference === undefined) return;
  if (!VISUAL_STATE_IDS.has(target.visualState)) {
    throw new Error(`${label} visualState must be one of ${Array.from(VISUAL_STATE_IDS).join(', ')}.`);
  }
  if (!MOTION_PREFERENCES.has(target.motionPreference)) {
    throw new Error(`${label} motionPreference must be one of ${Array.from(MOTION_PREFERENCES).join(', ')}.`);
  }
  if (target.workspace !== 'diagnosis' || target.subview !== 'analysis' || target.scenario !== 'diagnosis-ready') {
    throw new Error(`${label} visual state evidence is restricted to diagnosis/analysis with scenario diagnosis-ready.`);
  }
  if (target.visualState === 'diagnosis-ai-running-with-inspector' && target.viewport?.width < 1400) {
    throw new Error(`${label} diagnosis-ai-running-with-inspector requires a viewport at least 1400px wide.`);
  }
  const url = new URL(target.url || 'http://127.0.0.1/');
  if (target.url && (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error(`${label} visual state evidence is development-preview-only and requires a local HTTP URL.`);
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
  const scrollExceptionSelector = options.scrollExceptionSelector
    || '[data-scroll-owner="virtual-table"], .responsive-inspector[data-inspector-mode] > .responsive-inspector__body';
  const experienceContract = options.experienceContract;

  return page.evaluate(async (settings) => {
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
    const pageUrl = window.location.href;
    const urlScenario = new URL(pageUrl).searchParams.get('scenario');
    const visibleScopeWarnings = Array.from(document.querySelectorAll('.scope-visible-warning'))
      .filter(rendered)
      .map((element) => ({ selector: selectorFor(element), text: compactText(element) }));
    let experience = { enabled: false };
    if (settings.experienceContract) {
      const workSurface = root.querySelector('[data-workspace-work-surface]');
      const queueRegion = root.querySelector('[data-workspace-queue-scroll]');
      const queueScrollOwner = queueRegion
        ? (queueRegion.matches('[data-scroll-owner="virtual-table"]')
          ? queueRegion
          : queueRegion.querySelector('[data-scroll-owner="virtual-table"]'))
        : null;
      const rowElements = queueRegion
        ? Array.from(queueRegion.querySelectorAll('[data-workspace-row]')).filter(rendered)
        : [];
      const headerElement = queueRegion?.querySelector('[data-workspace-queue-header]') || null;
      const ariaRowCountElement = queueRegion?.querySelector('[aria-rowcount]') || null;
      const ariaRowCount = Number.parseInt(ariaRowCountElement?.getAttribute('aria-rowcount') || '', 10);
      const workSurfaceRect = workSurface?.getBoundingClientRect() || null;
      const queueRect = queueScrollOwner?.getBoundingClientRect() || null;
      const rowKeys = rowElements.map((element) => element.getAttribute('data-row-key') || '');
      const rowIndexes = rowElements
        .map((element) => Number.parseInt(element.getAttribute('data-row-index') || '', 10))
        .filter(Number.isFinite);
      const rowKeysUnique = rowKeys.length > 0
        && rowKeys.every(Boolean)
        && new Set(rowKeys).size === rowKeys.length;
      const fullyVisibleRowCount = queueRect
        ? rowElements.filter((element) => {
            const rect = element.getBoundingClientRect();
            const top = Math.max(queueRect.top, 0);
            const bottom = Math.min(queueRect.bottom, viewportHeight);
            return rect.top >= top - tolerance && rect.bottom <= bottom + tolerance;
          }).length
        : 0;
      const pageClientHeight = defaultOwnerElement?.clientHeight || 0;
      const pageScrollHeight = defaultOwnerElement?.scrollHeight || 0;
      const pageOverflowPx = Math.max(0, pageScrollHeight - pageClientHeight);
      const pageOverflowRatio = pageClientHeight > 0 ? pageScrollHeight / pageClientHeight : null;
      const initialPageScrollTop = defaultOwnerElement?.scrollTop || 0;
      const queueStyle = queueScrollOwner ? window.getComputedStyle(queueScrollOwner) : null;
      const headerStyle = headerElement ? window.getComputedStyle(headerElement) : null;

      const initial = {
        ariaRowCount: Number.isFinite(ariaRowCount) ? ariaRowCount : null,
        fullyVisibleRowCount,
        renderedRowCount: rowElements.length,
        rowIndexes,
        rowKeys,
        rowKeysUnique,
      };
      let probe = null;
      if (queueScrollOwner) {
        const initialQueueScrollTop = queueScrollOwner.scrollTop;
        const maxScrollTop = Math.max(0, queueScrollOwner.scrollHeight - queueScrollOwner.clientHeight);
        queueScrollOwner.scrollTop = Math.round(maxScrollTop * settings.experienceContract.scrollProbeRatio);
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
        const probeRows = Array.from(queueRegion.querySelectorAll('[data-workspace-row]')).filter(rendered);
        const probeRowKeys = probeRows.map((element) => element.getAttribute('data-row-key') || '');
        const probeRowIndexes = probeRows
          .map((element) => Number.parseInt(element.getAttribute('data-row-index') || '', 10))
          .filter(Number.isFinite);
        const initialRowIndexSet = new Set(rowIndexes);
        const probeQueueRect = queueScrollOwner.getBoundingClientRect();
        const probeHeaderRect = headerElement?.getBoundingClientRect() || null;
        probe = {
          pageScrollLeakPx: Math.abs((defaultOwnerElement?.scrollTop || 0) - initialPageScrollTop),
          renderedRowCount: probeRows.length,
          rowIndexes: probeRowIndexes,
          rowKeys: probeRowKeys,
          rowKeysUnique: probeRowKeys.length > 0
            && probeRowKeys.every(Boolean)
            && new Set(probeRowKeys).size === probeRowKeys.length,
          scrollTop: queueScrollOwner.scrollTop,
          stickyHeaderOffsetPx: probeHeaderRect
            ? Math.abs(probeHeaderRect.top - probeQueueRect.top)
            : null,
          virtualWindowAdvanced: probeRowIndexes.length > 0
            && probeRowIndexes.some((index) => !initialRowIndexSet.has(index)),
        };
        queueScrollOwner.scrollTop = initialQueueScrollTop;
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
        probe.restoredScrollTop = queueScrollOwner.scrollTop;
      }

      experience = {
        contract: { ...settings.experienceContract },
        enabled: true,
        initial,
        page: {
          clientHeight: pageClientHeight,
          overflowPx: pageOverflowPx,
          overflowRatio: pageOverflowRatio,
          scrollHeight: pageScrollHeight,
        },
        probe,
        queue: {
          clientHeight: queueScrollOwner?.clientHeight || 0,
          headerPosition: headerStyle?.position || null,
          overflowY: queueStyle?.overflowY || null,
          scrollHeight: queueScrollOwner?.scrollHeight || 0,
          scrollOwnerLabel: queueScrollOwner?.getAttribute('data-scroll-owner') || null,
        },
        selectors: {
          headerFound: Boolean(headerElement),
          queueRegionFound: Boolean(queueRegion),
          queueScrollOwnerFound: Boolean(queueScrollOwner),
          workSurfaceFound: Boolean(workSurface),
        },
        workSurface: workSurfaceRect
          ? { height: workSurfaceRect.height, top: workSurfaceRect.top, width: workSurfaceRect.width }
          : null,
      };
    }
    const violations = [];
    function violation(code, message, details) {
      violations.push({ code, details, message });
    }
    if (settings.experienceContract) {
      const contract = settings.experienceContract;
      if (!experience.selectors.workSurfaceFound
        || experience.workSurface.top > contract.maxWorkSurfaceTopPx) {
        violation('WORK_SURFACE_BELOW_FOLD', '对象队列工作主区必须进入首屏上半区。', {
          actualTopPx: experience.workSurface?.top ?? null,
          maximumTopPx: contract.maxWorkSurfaceTopPx,
        });
      }
      if (!experience.selectors.queueScrollOwnerFound
        || experience.queue.clientHeight < contract.minQueueViewportHeightPx) {
        violation('QUEUE_VIEWPORT_TOO_SHORT', '对象队列必须保留足够的固定视口高度。', {
          actualHeightPx: experience.queue.clientHeight,
          minimumHeightPx: contract.minQueueViewportHeightPx,
        });
      }
      if (experience.initial.fullyVisibleRowCount < contract.minFullyVisibleRows) {
        violation('QUEUE_VISIBLE_ROWS', '首屏必须展示足够数量的完整对象行。', {
          actual: experience.initial.fullyVisibleRowCount,
          minimum: contract.minFullyVisibleRows,
        });
      }
      if (experience.initial.ariaRowCount === null
        || experience.initial.ariaRowCount < contract.minAriaRowCount) {
        violation('QUEUE_ARIA_ROWCOUNT', '对象队列必须暴露可信的完整数据行数。', {
          actual: experience.initial.ariaRowCount,
          minimum: contract.minAriaRowCount,
        });
      }
      if (experience.initial.renderedRowCount > contract.maxRenderedRows
        || (experience.probe?.renderedRowCount ?? 0) > contract.maxRenderedRows) {
        violation('QUEUE_RENDERED_ROW_LIMIT', '对象队列必须保持有界 DOM 行数并使用虚拟化。', {
          initial: experience.initial.renderedRowCount,
          maximum: contract.maxRenderedRows,
          probe: experience.probe?.renderedRowCount ?? null,
        });
      }
      if (!experience.probe?.virtualWindowAdvanced) {
        violation('QUEUE_VIRTUAL_WINDOW_STALE', '对象队列滚动到中部后必须推进虚拟渲染窗口。', {
          initialRowIndexes: experience.initial.rowIndexes.slice(0, 40),
          probeRowIndexes: experience.probe?.rowIndexes.slice(0, 40) ?? null,
        });
      }
      if (experience.page.overflowPx > contract.maxPageOverflowPx
        || (experience.page.overflowRatio ?? Number.POSITIVE_INFINITY) > contract.maxPageOverflowRatio) {
        violation('PAGE_VERTICAL_OVERFLOW', '固定视口对象工作台不得被队列数据撑成长页面。', {
          actualOverflowPx: experience.page.overflowPx,
          actualRatio: experience.page.overflowRatio,
          maximumOverflowPx: contract.maxPageOverflowPx,
          maximumRatio: contract.maxPageOverflowRatio,
        });
      }
      const queueOwnsActiveScroll = experience.selectors.queueScrollOwnerFound
        && experience.queue.scrollOwnerLabel === 'virtual-table'
        && /^(auto|scroll|overlay)$/.test(experience.queue.overflowY || '')
        && experience.queue.scrollHeight > experience.queue.clientHeight;
      if (!queueOwnsActiveScroll) {
        violation('QUEUE_SCROLL_OWNER', '对象队列必须由显式标记的虚拟表格拥有局部纵向滚动。', {
          clientHeight: experience.queue.clientHeight,
          overflowY: experience.queue.overflowY,
          scrollHeight: experience.queue.scrollHeight,
          scrollOwnerLabel: experience.queue.scrollOwnerLabel,
        });
      }
      if (!experience.selectors.headerFound
        || experience.queue.headerPosition !== 'sticky'
        || experience.probe?.stickyHeaderOffsetPx === null
        || experience.probe?.stickyHeaderOffsetPx > contract.maxStickyHeaderOffsetPx) {
        violation('QUEUE_STICKY_HEADER', '对象队列滚动到中部后表头必须保持吸顶。', {
          actualOffsetPx: experience.probe?.stickyHeaderOffsetPx ?? null,
          maximumOffsetPx: contract.maxStickyHeaderOffsetPx,
          position: experience.queue.headerPosition,
        });
      }
      if (!experience.probe
        || experience.probe.scrollTop <= 0
        || experience.probe.pageScrollLeakPx > contract.maxPageScrollLeakPx) {
        violation('QUEUE_SCROLL_LEAK', '对象队列滚动不得带动页面级滚动容器。', {
          actualLeakPx: experience.probe?.pageScrollLeakPx ?? null,
          maximumLeakPx: contract.maxPageScrollLeakPx,
          queueScrollTop: experience.probe?.scrollTop ?? null,
        });
      }
      if (!experience.initial.rowKeysUnique || !experience.probe?.rowKeysUnique) {
        violation('QUEUE_ROW_KEY_UNIQUE', '虚拟对象行必须暴露非空且唯一的稳定 data-row-key。', {
          initialKeys: experience.initial.rowKeys.slice(0, 40),
          probeKeys: experience.probe?.rowKeys.slice(0, 40) ?? null,
        });
      }
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
      violation('UNLABELLED_SCROLL_OWNER', '内部纵向滚动必须是虚拟表格或响应式检查器的受控例外。', {
        owners: unlabelledActiveOwners,
      });
    }
    if (urlScenario !== 'missing-scope' && visibleScopeWarnings.length > 0) {
      violation('UNEXPECTED_SCOPE_WARNING', '已确认范围的预览场景不得显示全局范围错误。', {
        scenario: urlScenario,
        warnings: visibleScopeWarnings,
      });
    }

    const previewScenario = requestedRoot?.getAttribute('data-preview-scenario')?.trim() || null;
    const readbackMode = requestedRoot?.getAttribute('data-readback-mode')?.trim() || null;

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
      experience,
      h1: {
        count: h1Elements.length,
        labels: h1Elements.map(compactText),
      },
      identity: {
        pageUrl,
        previewScenario,
        readbackMode,
        scenario: previewScenario || urlScenario,
        scenarioSource: previewScenario ? 'dom' : 'url',
        subview: requestedRoot ? requestedRoot.getAttribute('data-workspace-subview') : null,
        urlScenario,
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
      scopeWarnings: visibleScopeWarnings,
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
    experienceContract: experienceContract || null,
    minimumFontSizePx: MIN_VISIBLE_FONT_SIZE_PX,
    rootSelector,
    scrollExceptionSelector,
  });
}

async function prepareWorkspaceVisualState(page, target) {
  if (!target.visualState) return;
  validateVisualStateTarget(target, 'Runtime workspace evidence target');

  const preview = await page.evaluate(() => {
    const banner = Array.from(document.querySelectorAll('.app-status'))
      .find((element) => (element.textContent || '').includes('仅开发预览'));
    return {
      banner: (banner?.textContent || '').replace(/\s+/g, ' ').trim(),
      hasApi: Boolean(window.electronAPI?.getBusinessUiDataPipeline),
    };
  });
  if (!preview.banner || !preview.hasApi) {
    throw new Error('Visual state evidence requires the explicit local development-preview banner and preview API.');
  }

  if (target.visualState === 'workspace-error-retry') {
    await page.evaluate(() => {
      const api = window.electronAPI;
      const original = api.getBusinessUiDataPipeline.bind(api);
      const control = { failPipeline: true, original };
      Object.defineProperty(window, '__AMAZON_AI_OPS_WORKSPACE_EVIDENCE__', {
        configurable: true,
        value: control,
      });
      api.getBusinessUiDataPipeline = (...args) => (
        control.failPipeline
          ? Promise.reject(new Error('开发预览：模拟当前范围数据读取失败，请重新读取。'))
          : original(...args)
      );
      window.dispatchEvent(new Event('business-ui:data-updated'));
    });
    await page.locator('[data-workspace-state="error"][role="alert"]').first().waitFor({ state: 'visible' });
    await page.locator('[data-workspace-state="error"] .workspace-state__action').first().waitFor({ state: 'visible' });
    return;
  }

  await page.evaluate(() => {
    const api = window.electronAPI;
    api.runAdStrategyDiagnosis = () => new Promise(() => {});
  });
  const firstRow = page.locator('[data-workspace-row]').first();
  await firstRow.waitFor({ state: 'visible' });
  await firstRow.click();
  await page.locator('.responsive-inspector--inline[data-inspector-mode="inline"]').first().waitFor({ state: 'visible' });
  const runButton = page
    .locator('.task-banner__actions button[data-action-priority="secondary"]')
    .filter({ hasText: '运行 AI 阶段分析' })
    .first();
  await runButton.waitFor({ state: 'visible' });
  await runButton.click();
  await page.locator('#ai-strategy-run-feedback[aria-busy="true"][data-ai-run-tone="pending"]').first().waitFor({ state: 'visible' });
  await page.locator('.task-banner__actions button[aria-busy="true"]').first().waitFor({ state: 'visible' });
}

async function collectWorkspaceStateEvidence(page, target) {
  if (!target.visualState) return null;

  return page.evaluate((settings) => {
    function rendered(element) {
      if (!(element instanceof Element) || !element.isConnected) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    }

    function compactText(element) {
      return (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    }

    const violations = [];
    function violation(code, message, details = {}) {
      violations.push({ code, details, message });
    }

    const previewBanner = Array.from(document.querySelectorAll('.app-status'))
      .find((element) => rendered(element) && compactText(element).includes('仅开发预览'));
    const errorState = document.querySelector('[data-workspace-state="error"]');
    const retryAction = errorState?.querySelector('.workspace-state__action') || null;
    const aiRun = document.querySelector('#ai-strategy-run-feedback');
    const actionButtons = Array.from(document.querySelectorAll('.task-banner__actions button'))
      .filter(rendered);
    const busyAction = actionButtons.find((button) => button.getAttribute('aria-busy') === 'true') || null;
    const peerActions = actionButtons.filter((button) => button !== busyAction).map((button) => ({
      ariaBusy: button.getAttribute('aria-busy') === 'true',
      disabled: Boolean(button.disabled),
      label: compactText(button),
    }));
    const inspector = document.querySelector('.responsive-inspector[data-inspector-mode]');
    const visibleSpinners = Array.from(document.querySelectorAll('.workspace-spinner')).filter(rendered);
    const spinners = visibleSpinners.map((spinner) => {
      const style = window.getComputedStyle(spinner);
      return {
        animationDuration: style.animationDuration,
        animationIterationCount: style.animationIterationCount,
        animationName: style.animationName,
      };
    });
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const observed = {
      aiRun: {
        ariaBusy: aiRun?.getAttribute('aria-busy') === 'true',
        label: compactText(aiRun),
        tone: aiRun?.getAttribute('data-ai-run-tone') || null,
        visible: rendered(aiRun),
      },
      busyAction: busyAction ? {
        ariaBusy: busyAction.getAttribute('aria-busy') === 'true',
        disabled: Boolean(busyAction.disabled),
        label: compactText(busyAction),
        visible: rendered(busyAction),
      } : null,
      inspector: inspector ? {
        label: compactText(inspector.querySelector('h2')),
        mode: inspector.getAttribute('data-inspector-mode'),
        role: inspector.getAttribute('role'),
        visible: rendered(inspector),
      } : null,
      motion: {
        prefersReducedMotion,
        spinnerCount: visibleSpinners.length,
        spinners,
      },
      peerActions,
      previewBanner: compactText(previewBanner),
      retryAction: retryAction ? {
        ariaBusy: retryAction.getAttribute('aria-busy') === 'true',
        disabled: Boolean(retryAction.disabled),
        label: compactText(retryAction),
        visible: rendered(retryAction),
      } : null,
      workspaceState: errorState ? {
        kind: errorState.getAttribute('data-workspace-state'),
        role: errorState.getAttribute('role'),
        title: compactText(errorState.querySelector('.workspace-state__copy > strong')),
        visible: rendered(errorState),
      } : null,
    };

    if (!previewBanner) {
      violation('DEV_PREVIEW_BANNER_MISSING', 'Synthetic visual-state evidence must remain visibly marked as development preview.');
    }
    const expectsReducedMotion = settings.motionPreference === 'reduce';
    if (prefersReducedMotion !== expectsReducedMotion) {
      violation('MOTION_PREFERENCE_MISMATCH', 'Runtime prefers-reduced-motion does not match the requested evidence target.', {
        actual: prefersReducedMotion ? 'reduce' : 'no-preference',
        expected: settings.motionPreference,
      });
    }

    if (settings.visualState === 'workspace-error-retry') {
      if (!observed.workspaceState?.visible || observed.workspaceState.kind !== 'error' || observed.workspaceState.role !== 'alert') {
        violation('WORKSPACE_ERROR_STATE_MISSING', 'Workspace error evidence requires a visible alert state.');
      }
      if (!observed.retryAction?.visible || observed.retryAction.disabled || observed.retryAction.ariaBusy
        || !observed.retryAction.label.includes('重新读取')) {
        violation('WORKSPACE_RETRY_ACTION_MISSING', 'Workspace error evidence requires a visible enabled retry action.', {
          retryAction: observed.retryAction,
        });
      }
    } else {
      if (!observed.aiRun.visible || !observed.aiRun.ariaBusy || observed.aiRun.tone !== 'pending'
        || !observed.aiRun.label.includes('AI 阶段分析运行中')) {
        violation('DIAGNOSIS_RUNNING_STATUS_MISSING', 'Diagnosis running evidence requires the visible pending live status.', {
          aiRun: observed.aiRun,
        });
      }
      if (!observed.busyAction?.visible || !observed.busyAction.disabled || !observed.busyAction.ariaBusy
        || observed.busyAction.label !== 'AI 分析中...') {
        violation('DIAGNOSIS_BUSY_ACTION_MISSING', 'Diagnosis running evidence requires exactly one visible disabled busy action.', {
          busyAction: observed.busyAction,
        });
      }
      if (!observed.inspector?.visible || observed.inspector.mode !== 'inline') {
        violation('DIAGNOSIS_INLINE_INSPECTOR_MISSING', 'Diagnosis running evidence must keep the selected inline inspector visible.', {
          inspector: observed.inspector,
        });
      }
      if (observed.peerActions.length < 1 || observed.peerActions.some((action) => !action.disabled || action.ariaBusy)) {
        violation('DIAGNOSIS_PEER_LOCK_MISSING', 'Peer task actions must lock without impersonating the active busy action.', {
          peerActions: observed.peerActions,
        });
      }
      if (visibleSpinners.length < 1) {
        violation('DIAGNOSIS_BUSY_SPINNER_MISSING', 'Diagnosis running evidence requires a visible busy spinner.');
      }
      if (expectsReducedMotion && spinners.some((spinner) => spinner.animationName !== 'none')) {
        violation('REDUCED_MOTION_SPINNER_ACTIVE', 'Visible busy spinners must not animate under prefers-reduced-motion.', {
          spinners,
        });
      }
    }

    return {
      id: settings.visualState,
      observed,
      passed: violations.length === 0,
      postCapture: {
        retryAttempted: false,
        retryRecovered: settings.visualState === 'workspace-error-retry' ? false : null,
      },
      previewOnly: true,
      requested: {
        inspectorMode: settings.visualState === 'diagnosis-ai-running-with-inspector' ? 'inline' : null,
        motionPreference: settings.motionPreference,
      },
      schemaVersion: settings.schemaVersion,
      syntheticTrigger: settings.visualState === 'workspace-error-retry'
        ? 'pipeline-read-failure'
        : 'ai-promise-pending',
      violations,
    };
  }, {
    motionPreference: target.motionPreference,
    schemaVersion: STATE_EVIDENCE_SCHEMA_VERSION,
    visualState: target.visualState,
  });
}

async function verifyWorkspaceStatePostCapture(page, target, stateEvidence) {
  if (!stateEvidence || target.visualState !== 'workspace-error-retry') return stateEvidence;

  stateEvidence.postCapture.retryAttempted = true;
  try {
    await page.evaluate(() => {
      const control = window.__AMAZON_AI_OPS_WORKSPACE_EVIDENCE__;
      if (!control) throw new Error('Workspace evidence retry controller is missing.');
      control.failPipeline = false;
    });
    await page.locator('[data-workspace-state="error"] .workspace-state__action').first().click();
    await page.locator('[data-workspace-state="error"]').first().waitFor({ state: 'hidden' });
    await page.locator('[data-workspace-row]').first().waitFor({ state: 'visible' });
    stateEvidence.postCapture.retryRecovered = true;
  } catch (error) {
    stateEvidence.postCapture.retryRecovered = false;
    stateEvidence.violations.push({
      code: 'WORKSPACE_RETRY_RECOVERY_FAILED',
      details: { error: error && error.message ? error.message : String(error) },
      message: 'The visible workspace retry action did not recover the diagnosis queue after capture.',
    });
  }
  stateEvidence.passed = stateEvidence.violations.length === 0 && stateEvidence.postCapture.retryRecovered === true;
  return stateEvidence;
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
  if (target.experienceContract !== undefined) {
    normalizeExperienceContract(target.experienceContract, 'programmatic');
  }
  validateVisualStateTarget(target, 'Workspace evidence target');
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

function normalizeExperienceContract(value, targetNumber) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Workspace evidence target ${targetNumber} has an invalid experienceContract.`);
  }
  const supportedFields = new Set(Object.keys(DEFAULT_EXPERIENCE_CONTRACT));
  for (const field of Object.keys(value)) {
    if (!supportedFields.has(field)) {
      throw new Error(`Workspace evidence target ${targetNumber} experienceContract has an unknown field ${field}.`);
    }
  }
  const normalized = { ...DEFAULT_EXPERIENCE_CONTRACT, ...value };
  const positiveIntegerFields = ['maxRenderedRows', 'minAriaRowCount', 'minFullyVisibleRows'];
  const nonNegativeFields = [
    'maxPageOverflowPx',
    'maxPageScrollLeakPx',
    'maxStickyHeaderOffsetPx',
    'maxWorkSurfaceTopPx',
  ];
  for (const field of positiveIntegerFields) {
    if (!Number.isInteger(normalized[field]) || normalized[field] < 1) {
      throw new Error(`Workspace evidence target ${targetNumber} experienceContract ${field} must be a positive integer.`);
    }
  }
  for (const field of nonNegativeFields) {
    if (!Number.isFinite(normalized[field]) || normalized[field] < 0) {
      throw new Error(`Workspace evidence target ${targetNumber} experienceContract ${field} must be a non-negative number.`);
    }
  }
  if (!Number.isFinite(normalized.minQueueViewportHeightPx) || normalized.minQueueViewportHeightPx <= 0) {
    throw new Error(`Workspace evidence target ${targetNumber} experienceContract minQueueViewportHeightPx must be positive.`);
  }
  if (!Number.isFinite(normalized.maxPageOverflowRatio) || normalized.maxPageOverflowRatio < 1) {
    throw new Error(`Workspace evidence target ${targetNumber} experienceContract maxPageOverflowRatio must be at least 1.`);
  }
  if (!Number.isFinite(normalized.scrollProbeRatio)
    || normalized.scrollProbeRatio <= 0
    || normalized.scrollProbeRatio >= 1) {
    throw new Error(`Workspace evidence target ${targetNumber} experienceContract scrollProbeRatio must be between 0 and 1.`);
  }
  return normalized;
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
    if (source.visualState !== undefined) target.visualState = source.visualState;
    if (source.motionPreference !== undefined) target.motionPreference = source.motionPreference;
    const experienceContract = normalizeExperienceContract(source.experienceContract, index + 1);
    if (experienceContract) target.experienceContract = experienceContract;
    const readbackMode = source.readbackMode === undefined ? config.readbackMode : source.readbackMode;
    if (typeof readbackMode === 'string' && readbackMode.trim()) target.readbackMode = readbackMode.trim();
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
    validateVisualStateTarget(target, `Workspace evidence target ${index + 1}`);

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
  const experienceContract = normalizeExperienceContract(target.experienceContract, 'capture');

  const metrics = await collectWorkspaceDomMetrics(page, {
    experienceContract,
    rootSelector: target.rootSelector,
  });
  validatePreviewUrl(metrics.identity.pageUrl, target.scenario, 'Runtime workspace evidence URL');
  const identityMismatches = [];
  for (const field of ['workspace', 'subview']) {
    if (metrics.identity[field] !== target[field]) {
      identityMismatches.push(`${field} actual ${metrics.identity[field] || '(missing)'} target ${target[field]}`);
    }
  }
  if (target.readbackMode && metrics.identity.previewScenario !== target.scenario) {
    identityMismatches.push(
      `preview scenario actual ${metrics.identity.previewScenario || '(missing)'} target ${target.scenario}`,
    );
  }
  if (target.readbackMode && metrics.identity.readbackMode !== target.readbackMode) {
    identityMismatches.push(
      `readback mode actual ${metrics.identity.readbackMode || '(missing)'} target ${target.readbackMode}`,
    );
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
  let stateEvidence = await collectWorkspaceStateEvidence(page, target);

  const absoluteOutputDir = path.resolve(outputDir);
  fs.mkdirSync(absoluteOutputDir, { recursive: true });
  const baseNameParts = [
    safeSegment(target.workspace),
    safeSegment(target.subview),
    safeSegment(target.scenario),
    `${target.viewport.width}x${target.viewport.height}`,
    `dpr-${String(target.dpr).replace('.', '_')}`,
  ];
  if (target.visualState) {
    baseNameParts.push(`state-${safeSegment(target.visualState)}`);
    baseNameParts.push(`motion-${safeSegment(target.motionPreference)}`);
  }
  baseNameParts.push(timestampSegment(timestamp));
  const baseName = baseNameParts.join('--');
  const screenshotPath = path.join(absoluteOutputDir, `${baseName}.png`);
  const jsonPath = path.join(absoluteOutputDir, `${baseName}.json`);

  await page.screenshot({ fullPage: false, path: screenshotPath });
  const screenshotSha256 = createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex').toUpperCase();
  stateEvidence = await verifyWorkspaceStatePostCapture(page, target, stateEvidence);
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
  if (stateEvidence) evidence.stateEvidence = stateEvidence;
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
    const contextOptions = {
      deviceScaleFactor: target.dpr,
      viewport: target.viewport,
    };
    if (target.motionPreference) contextOptions.reducedMotion = target.motionPreference;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    try {
      await page.goto(target.url, { waitUntil: target.waitUntil || 'networkidle' });
      await page.evaluate(({ subview, workspace }) => {
        window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', {
          detail: { subview, workspace },
        }));
      }, { subview: target.subview, workspace: target.workspace });
      if (target.waitFor) await page.locator(target.waitFor).first().waitFor({ state: 'visible' });
      await prepareWorkspaceVisualState(page, target);
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
        motionPreference: target.motionPreference,
        scenario: target.scenario,
        subview: target.subview,
        visualState: target.visualState,
        viewport: target.viewport,
        workspace: target.workspace,
      };
    }
    return {
      contractPassed: result.evidence.domMetrics.contract.passed
        && (!result.evidence.stateEvidence || result.evidence.stateEvidence.passed),
      dpr: result.evidence.dpr,
      jsonPath: result.jsonPath,
      motionPreference: target.motionPreference,
      scenario: result.evidence.scenario,
      screenshot: result.evidence.screenshot,
      stateEvidence: result.evidence.stateEvidence,
      subview: result.evidence.subview,
      violations: result.evidence.domMetrics.contract.violations,
      visualState: target.visualState,
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
  collectWorkspaceStateEvidence,
  normalizeWorkspaceEvidenceConfig,
  parseWorkspaceEvidenceArgs,
  prepareWorkspaceVisualState,
  runWorkspaceEvidenceTargets,
};
