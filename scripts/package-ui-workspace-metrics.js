// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

async function collectPackageWorkspaceMetrics(page, expected) {
  const metrics = await page.evaluate((settings) => {
    const tolerance = 1;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const targetSelector = `[data-workspace-evidence-root][data-workspace="${settings.workspace}"][data-workspace-subview="${settings.subview}"]`;
    const targetRoots = Array.from(document.querySelectorAll(targetSelector));
    const anyRoot = targetRoots[0] || document.querySelector('[data-workspace-evidence-root]');
    const rendered = (element) => {
      if (!(element instanceof Element) || !element.isConnected) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    };
    const inViewport = (element) => {
      if (!rendered(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
    };
    const compactText = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const selectorFor = (element) => {
      if (element === document.documentElement) return 'documentElement';
      if (element === document.body) return 'body';
      if (element.id) return `#${CSS.escape(element.id)}`;
      const className = Array.from(element.classList || []).find(Boolean);
      if (className) return `.${CSS.escape(className)}`;
      return element.tagName.toLowerCase();
    };

    const h1Elements = anyRoot ? Array.from(anyRoot.querySelectorAll('h1')).filter(rendered) : [];
    const primaryActions = anyRoot
      ? Array.from(anyRoot.querySelectorAll('[data-action-priority="primary"]')).filter(inViewport)
      : [];
    const activeNavigation = Array.from(document.querySelectorAll('.app-sidebar [data-operator-entry][aria-current="page"]')).filter(rendered);
    const moduleButtons = Array.from(document.querySelectorAll('.app-sidebar [data-operator-module]')).filter(rendered);
    const entryButtons = Array.from(document.querySelectorAll('.app-sidebar [data-operator-entry]')).filter(rendered);

    const horizontalTargets = [
      { element: document.documentElement, selector: 'documentElement' },
      { element: document.body, selector: 'body' },
      { element: document.querySelector('.app-shell'), selector: '.app-shell' },
      { element: document.querySelector('.app-content'), selector: '.app-content' },
    ];
    const horizontalMeasurements = horizontalTargets.map(({ element, selector }) => ({
      selector,
      missing: !element,
      clientWidth: element?.clientWidth ?? null,
      scrollWidth: element?.scrollWidth ?? null,
      overflowPx: element ? Math.max(0, element.scrollWidth - element.clientWidth) : null,
    }));
    const horizontalViolations = horizontalMeasurements.filter((item) => !item.missing && item.overflowPx > tolerance);

    const defaultOwners = Array.from(document.querySelectorAll('.app-content'));
    const defaultOwner = defaultOwners[0] || null;
    const defaultStyle = defaultOwner ? window.getComputedStyle(defaultOwner) : null;
    const declared = Boolean(defaultStyle && /^(auto|scroll|overlay)$/.test(defaultStyle.overflowY));
    const activeOwners = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const style = window.getComputedStyle(element);
      const active = /^(auto|scroll|overlay)$/.test(style.overflowY)
        && element.scrollHeight - element.clientHeight > tolerance;
      if (!active) continue;
      const explicitException = element === defaultOwner
        || element.matches('[data-scroll-owner], .app-sidebar, [role="dialog"], [role="complementary"], .responsive-inspector__body');
      activeOwners.push({
        selector: selectorFor(element),
        overflowY: style.overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        defaultOwner: element === defaultOwner,
        explicitException,
      });
    }

    const ids = new Map();
    for (const element of Array.from(document.querySelectorAll('[id]'))) {
      const id = element.id;
      if (!id) continue;
      ids.set(id, (ids.get(id) || 0) + 1);
    }
    const duplicateIds = Array.from(ids.entries()).filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
    const ariaReferenceAttributes = [
      'aria-labelledby',
      'aria-describedby',
      'aria-controls',
      'aria-owns',
      'aria-flowto',
      'aria-activedescendant',
    ];
    const brokenReferences = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of ariaReferenceAttributes) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        for (const token of value.trim().split(/\s+/).filter(Boolean)) {
          const count = ids.get(token) || 0;
          if (count !== 1) {
            brokenReferences.push({
              attribute,
              token,
              count,
              owner: selectorFor(element),
            });
          }
        }
      }
    }

    const previewMarkers = Array.from(document.querySelectorAll('[data-workspace-preview-notice], [data-preview-scenario], [data-readback-mode="preview-readonly"]'))
      .filter(rendered)
      .map((element) => ({ selector: selectorFor(element), text: compactText(element) }));
    if (/仅开发预览/.test(document.body?.innerText || '')) previewMarkers.push({ selector: 'body-text', text: '仅开发预览' });

    const visibleOperatorText = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
      const parent = textNode.parentElement;
      const text = String(textNode.textContent || '').replace(/\s+/g, ' ').trim();
      if (!parent || !text) continue;
      if (parent.closest('details, [hidden], [aria-hidden="true"], script, style, template')) continue;
      if (!rendered(parent)) continue;
      visibleOperatorText.push(text);
    }
    const normalizedOperatorText = visibleOperatorText.join(' ').replace(/\s+/g, ' ').trim();
    const forbiddenOperatorCopy = [
      { token: 'Mission', pattern: /\bMission\b/gi },
      { token: 'Experiment', pattern: /\bExperiment\b/gi },
      { token: 'UNKNOWN', pattern: /\bUNKNOWN\b/g },
      { token: 'revision', pattern: /\brevision\b/gi },
      { token: 'draft', pattern: /\bdraft\b/gi },
      { token: 'set_keyword_bid', pattern: /\bset_keyword_bid\b/g },
      { token: 'Main', pattern: /\bMain\b/gi },
      { token: 'StoreContext', pattern: /\bStoreContext\b/gi },
      { token: 'Authority', pattern: /\bAuthority\b/gi },
      { token: 'Profile', pattern: /\bProfile\b/gi },
      { token: 'dry-run', pattern: /\bdry-run\b/gi },
      { token: 'manifest', pattern: /\bmanifest\b/gi },
      { token: 'fingerprint', pattern: /\bfingerprint\b/gi },
      { token: 'Renderer', pattern: /\bRenderer\b/gi },
      { token: 'CRUD', pattern: /\bCRUD\b/gi },
      { token: 'PRODUCTION_NATIVE', pattern: /\bPRODUCTION_NATIVE\b/gi },
      { token: 'PROTOTYPE_ONLY', pattern: /\bPROTOTYPE_ONLY\b/gi },
      { token: 'LEGACY_ADAPTER', pattern: /\bLEGACY_ADAPTER\b/gi },
      { token: 'sequence', pattern: /\bsequence\b/gi },
      { token: 'append-only', pattern: /\bappend-only\b/gi },
      { token: 'correction', pattern: /\bcorrection\b/gi },
      { token: 'DECISION', pattern: /\bDECISION\b/gi },
      { token: 'ACTION', pattern: /\bACTION\b/gi },
      { token: 'READBACK', pattern: /\bREADBACK\b/gi },
      { token: 'EFFECT', pattern: /\bEFFECT\b/gi },
    ];
    const forbiddenMatches = [];
    for (const entry of forbiddenOperatorCopy) {
      for (const match of normalizedOperatorText.matchAll(entry.pattern)) {
        const index = Number(match.index || 0);
        forbiddenMatches.push({
          token: entry.token,
          text: normalizedOperatorText.slice(Math.max(0, index - 24), Math.min(normalizedOperatorText.length, index + 56)),
        });
        if (forbiddenMatches.length >= 20) break;
      }
      if (forbiddenMatches.length >= 20) break;
    }

    return {
      activeNavigation: {
        count: activeNavigation.length,
        label: compactText(activeNavigation[0]),
        view: activeNavigation[0]?.getAttribute('data-operator-entry') || null,
        moduleIds: moduleButtons.map((button) => button.getAttribute('data-operator-module')),
        activeModuleIds: moduleButtons.filter((button) => button.getAttribute('aria-expanded') === 'true')
          .map((button) => button.getAttribute('data-operator-module')),
        entryIds: entryButtons.map((button) => button.getAttribute('data-operator-entry')),
      },
      aria: { brokenReferences, duplicateIds },
      deviceScaleFactor: window.devicePixelRatio,
      h1: { count: h1Elements.length, labels: h1Elements.map(compactText) },
      horizontalOverflow: { measurements: horizontalMeasurements, violations: horizontalViolations },
      operatorCopy: {
        forbiddenMatches,
        normalizedText: normalizedOperatorText,
      },
      primaryAction: { count: primaryActions.length, labels: primaryActions.map(compactText) },
      previewMarkers,
      rendererUrl: window.location.href,
      root: {
        count: targetRoots.length,
        workspace: anyRoot?.getAttribute('data-workspace') || null,
        subview: anyRoot?.getAttribute('data-workspace-subview') || null,
      },
      scrollOwnership: {
        activeOwners,
        defaultOwner: {
          declared,
          matchCount: defaultOwners.length,
          overflowY: defaultStyle?.overflowY || null,
          scrollLeft: defaultOwner?.scrollLeft ?? null,
          scrollTop: defaultOwner?.scrollTop ?? null,
        },
        unlabelledActiveOwners: activeOwners.filter((owner) => !owner.explicitException),
      },
      viewport: { width: viewportWidth, height: viewportHeight },
    };
  }, expected);
  const normalizedOperatorText = String(metrics?.operatorCopy?.normalizedText || '');
  metrics.operatorCopy = {
    forbiddenMatches: metrics?.operatorCopy?.forbiddenMatches || [],
    textLength: normalizedOperatorText.length,
    textSha256: sha256Buffer(Buffer.from(normalizedOperatorText, 'utf8')),
  };
  return metrics;
}

  return {
    collectPackageWorkspaceMetrics,
  };
};
