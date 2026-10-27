// 按职责复用原有严格校验，公共入口继续保持兼容。

const { MIN_VISIBLE_FONT_SIZE_PX } = require('./workspace-ui-capture-contracts.js');

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
            if (!(element instanceof Element) || !element.isConnected)
                return false;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) {
                return false;
            }
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
        }
        function inViewport(element) {
            if (!rendered(element))
                return false;
            const rect = element.getBoundingClientRect();
            return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
        }
        function compactText(element) {
            return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        }
        function selectorFor(element) {
            if (element === document.documentElement)
                return 'documentElement';
            if (element === document.body)
                return 'body';
            if (element.id)
                return `#${CSS.escape(element.id)}`;
            const className = Array.from(element.classList || []).find(Boolean);
            if (className)
                return `.${CSS.escape(className)}`;
            const tag = element.tagName.toLowerCase();
            const parent = element.parentElement;
            if (!parent)
                return tag;
            const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === element.tagName);
            return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})` : tag;
        }
        const h1Elements = Array.from(root.querySelectorAll('h1')).filter(rendered);
        const visiblePrimaryActions = Array.from(root.querySelectorAll('[data-action-priority="primary"]')).filter(inViewport);
        const visibleSecondaryActions = Array.from(root.querySelectorAll('[data-action-priority="secondary"]')).filter(inViewport);
        const textMeasurements = [];
        const textElements = [root, ...root.querySelectorAll('*')];
        for (const element of textElements) {
            if (!rendered(element) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(element.tagName))
                continue;
            const directText = Array.from(element.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent || '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!directText)
                continue;
            const fontSizePx = Number.parseFloat(window.getComputedStyle(element).fontSize);
            if (!Number.isFinite(fontSizePx))
                continue;
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
            if (!element)
                return { missing: true, selector };
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
        const defaultOwnerDeclared = Boolean(defaultOwnerElement
            && /^(auto|scroll|overlay)$/.test(defaultOwnerStyle.overflowY));
        const allElements = Array.from(document.querySelectorAll('*'));
        const activeOwners = [];
        for (const element of allElements) {
            const style = window.getComputedStyle(element);
            const declared = /^(auto|scroll|overlay)$/.test(style.overflowY);
            const active = declared && element.scrollHeight - element.clientHeight > tolerance;
            if (!active)
                continue;
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
        const unlabelledActiveOwners = activeOwners.filter((owner) => (!owner.defaultOwner && !owner.explicitException));
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

module.exports = { collectWorkspaceDomMetrics };
