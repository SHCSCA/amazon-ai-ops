import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import {
  bundleWorkspaceLayoutFixture, LAYOUT_PROFILES, measureDisabledReason, measureLayout,
  recordWorkspaceLayout, withWorkspaceLayoutFixture, type LayoutBox, type LayoutSurface,
} from './workspace-layout-browser.test-support';

const bundles = new Map<LayoutSurface, Awaited<ReturnType<typeof bundleWorkspaceLayoutFixture>>>();
beforeAll(async () => {
  for (const surface of ['missions', 'decisions', 'memory', 'primitives'] as const) {
    bundles.set(surface, await bundleWorkspaceLayoutFixture(surface));
  }
}, 60_000);

type Measurement = Awaited<ReturnType<typeof measureLayout>>;
const columns = (item: Measurement) => item.gridTemplateColumns.split(/\s+/).map(Number.parseFloat);

function inside(child: LayoutBox, parent: LayoutBox): void {
  expect(child.width).toBeGreaterThan(0);
  expect(child.left).toBeGreaterThanOrEqual(parent.left - 1);
  expect(child.right).toBeLessThanOrEqual(parent.right + 1);
}

function readable(item: Measurement): void {
  expect(item.visible).toBe(true);
  expect(item.box.height).toBeGreaterThan(0);
  expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
  for (const rect of item.textRects) inside(rect, item.box);
}

function singleLine(item: Measurement): void {
  readable(item);
  expect(item.lines).toBe(1);
}

function visibleReason(item: Awaited<ReturnType<typeof measureDisabledReason>>, expected: string, minimumWidth: number): void {
  expect(item.action.disabled).toBe(true);
  expect(item.action.busy).not.toBe('true');
  expect(item.action.describedBy).toBeTruthy();
  expect(item.reason.text).toBe(expected);
  expect(item.reason.clipPath).toBe('none');
  expect(Number(item.reason.opacity)).toBeGreaterThan(0);
  expect(item.reason.box.width).toBeGreaterThanOrEqual(minimumWidth);
  readable(item.reason);
  expect(item.reason.scrollHeight).toBeLessThanOrEqual(item.reason.clientHeight + 1);
}

async function missionGeometry(page: Page) {
  return {
    contract: await measureLayout(page.locator('.mission-domain-contract')),
    header: await measureLayout(page.locator('.mission-domain-detail-header')),
    heading: await measureLayout(page.locator('.mission-domain-detail-header h2')),
    diagnostics: await measureLayout(page.locator('.mission-domain-detail-header .mission-domain-diagnostics')),
    diagnosticSummary: await measureLayout(page.locator('.mission-domain-detail-header .mission-domain-diagnostics > summary')),
    cells: await Promise.all((await page.locator('.mission-domain-contract > div').all()).map(measureLayout)),
  };
}

async function noFixtureMutations(page: Page, family: 'current' | 'canonical'): Promise<void> {
  const counts = await page.evaluate(family => {
    const fixture = family === 'current' ? (window as any).currentWorkspaceFixture : (window as any).canonicalFeedback;
    const kinds = family === 'current' ? ['transition', 'analysis', 'checkpoint', 'mode'] : ['create', 'revise', 'resolve', 'revoke', 'append'];
    return Object.fromEntries(kinds.map(kind => [kind, (fixture.calls[kind] ?? []).length]));
  }, family);
  expect(Object.values(counts).every(count => count === 0)).toBe(true);
}

for (const profile of LAYOUT_PROFILES) {
  describe(`生产 CSS 实际布局 · ${profile.id}`, () => {
    it('任务总览与事实页经真实组件依赖加载合同、动作及诊断样式', async () => {
      await withWorkspaceLayoutFixture(bundles.get('missions')!, 'missions', profile, async page => {
        await page.locator('.mission-domain-detail-header h2').filter({ hasText: '当前任务 A' }).waitFor();
        const overview = await missionGeometry(page);
        const actions = await measureLayout(page.locator('.mission-domain-actions'));
        await recordWorkspaceLayout(page, 'missions-overview', { ...overview, actions });
        expect(overview.contract.display).toBe('grid');
        expect(columns(overview.contract)).toHaveLength(profile.width >= 1200 ? 4 : 2);
        expect(overview.header.display).toBe('grid');
        expect(actions.display).toBe('flex');
        expect(overview.diagnostics.fontSize).toBe('10px');
        expect(overview.diagnosticSummary.cursor).toBe('pointer');
        expect(overview.cells).toHaveLength(4);
        for (const cell of overview.cells) inside(cell.box, overview.contract.box);
        singleLine(overview.heading);
        await page.evaluate(() => (window as any).currentWorkspaceFixture.facts());
        await page.locator('.mission-domain-workspace--facts').waitFor();
        const facts = await missionGeometry(page);
        const agentState = await measureLayout(page.locator('.mission-domain-agent-state'));
        await recordWorkspaceLayout(page, 'missions-facts', { ...facts, agentState });
        expect(facts.contract.display).toBe('grid');
        expect(columns(facts.contract)).toHaveLength(profile.width >= 1200 ? 4 : 2);
        expect(facts.diagnostics.fontSize).toBe('10px');
        expect(agentState.display).toBe('none');
        expect(await page.locator('.mission-domain-actions').count()).toBe(0);
        for (const cell of facts.cells) inside(cell.box, facts.contract.box);
        singleLine(facts.heading);
        await noFixtureMutations(page, 'current');
      });
    }, 30_000);

    it('审批与已决策窄队列保持单行标题、独立工具行及完整禁用原因', async () => {
      await withWorkspaceLayoutFixture(bundles.get('decisions')!, 'decisions', profile, async page => {
        for (const view of ['decisions/approval', 'decisions/decided']) {
          await page.evaluate(view => (window as any).canonicalFeedback.view(view), view);
          await page.locator(`[data-canonical-surface="decisions"][data-view="${view}"]`).waitFor();
          const panel = page.locator('.decision-domain-list-panel');
          const header = await measureLayout(panel.locator('> .workbench-panel__header'));
          const heading = await measureLayout(panel.locator('> .workbench-panel__header h2'));
          const toolbar = await measureLayout(panel.locator('> .workbench-panel__header > .workbench-panel__toolbar'));
          const newAction = await measureDisabledReason(page, panel.getByRole('button', { name: '新建', exact: true }));
          const batch = view.endsWith('/decided') ? {
            header: await measureLayout(panel.locator('.decision-domain-batch-authority > header')),
            explanation: await measureLayout(panel.locator('.decision-domain-batch-authority > header > div')),
            control: await measureDisabledReason(page, panel.getByRole('button', { name: '授权 0 条', exact: true })),
          } : null;
          await recordWorkspaceLayout(page, view.replace('/', '-'), { header, heading, toolbar, newAction, batch });
          expect(header.display).toBe('grid');
          expect(columns(header)).toHaveLength(1);
          singleLine(heading);
          inside(heading.box, header.box);
          expect(toolbar.box.top).toBeGreaterThanOrEqual(heading.box.bottom - 1);
          inside(toolbar.box, header.box);
          singleLine(newAction.action);
          visibleReason(newAction, '请到待判断工作台，确认当前店铺已开放新建经营决策。', 100);
          if (batch) {
            expect(batch.header.display).toBe('grid');
            expect(columns(batch.header)).toHaveLength(1);
            readable(batch.explanation);
            expect(batch.explanation.box.width).toBeGreaterThanOrEqual(batch.header.box.width * .9);
            expect(batch.control.action.box.top).toBeGreaterThanOrEqual(batch.explanation.box.bottom - 1);
            singleLine(batch.control.action);
            visibleReason(batch.control, '请先选择当前运营任务及完整最新建议批次，并确认该模式具备授权权限。', 160);
            inside(batch.control.reason.box, batch.header.box);
          }
        }
        await noFixtureMutations(page, 'canonical');
      });
    }, 30_000);

    it('十三阶段内容使用可读的两列布局且旧三子项列表保持其原结构', async () => {
      await withWorkspaceLayoutFixture(bundles.get('primitives')!, 'primitives', profile, async page => {
        const flow = page.locator('[data-layout-part="operator-flow"] > section');
        await flow.locator('li').first().waitFor();
        const measurements = [];
        for (const row of await flow.locator('li').all()) {
          const facts = { row: await measureLayout(row), content: await measureLayout(row.locator('> div')),
            action: await measureDisabledReason(page, row.locator('> .task-banner__action-shell > button')),
            definitions: await Promise.all((await row.locator('dl > div').all()).map(async pair => ({
              row: await measureLayout(pair), label: await measureLayout(pair.locator('dt')), value: await measureLayout(pair.locator('dd')),
            }))) };
          measurements.push(facts);
        }
        const legacyRoot = page.locator('[data-layout-part="legacy"] .canonical-workspace-surface');
        const legacy = await Promise.all((await legacyRoot.locator('.canonical-next-actions li').all()).map(measureLayout));
        await recordWorkspaceLayout(page, 'operator-flow-and-legacy', { measurements, legacy });
        expect(measurements).toHaveLength(13);
        for (const item of measurements) {
          expect(item.row.children).toHaveLength(2);
          expect(item.row.display).toBe('grid');
          expect(columns(item.row)).toHaveLength(2);
          expect(item.content.box.width).toBeGreaterThan(item.row.box.width * .5);
          expect(item.content.box.width).toBeGreaterThan(200);
          inside(item.content.box, item.row.box);
          expect(item.action.action.box.left).toBeGreaterThanOrEqual(item.content.box.right - 1);
          visibleReason(item.action, '当前页面入口尚未接入，请先检查当前店铺的连接与应用服务。', 100);
          expect(item.definitions).toHaveLength(2);
          for (const pair of item.definitions) {
            expect(pair.row.display).toBe('grid');
            expect(columns(pair.row)).toHaveLength(2);
            singleLine(pair.label);
            readable(pair.value);
            expect(pair.value.box.width).toBeGreaterThan(160);
            expect(pair.value.box.left).toBeGreaterThanOrEqual(pair.label.box.right - 1);
            inside(pair.value.box, item.content.box);
          }
        }
        expect(await legacyRoot.getAttribute('data-capability-state')).toBe('PROTOTYPE_ONLY');
        expect(await legacyRoot.getAttribute('data-mutations-disabled')).toBe('true');
        expect(legacy).toHaveLength(2);
        for (const item of legacy) {
          expect(item.children).toHaveLength(3);
          expect(columns(item)).toHaveLength(3);
          expect(columns(item)[0]).toBeCloseTo(24, 0);
          expect(item.children[1].width).toBeGreaterThan(200);
        }
        expect(await legacyRoot.locator('.canonical-next-actions button:not(:disabled)').count()).toBe(0);
        expect(await page.evaluate(() => (window as any).layoutPrimitiveFixture.calls.length)).toBe(0);
      });
    }, 30_000);

    it('记忆搜索的真实动作包装保持追加单行并保留忙碌时的可读禁用原因', async () => {
      await withWorkspaceLayoutFixture(bundles.get('memory')!, 'memory', profile, async page => {
        const search = page.locator('.memory-search');
        const button = search.getByRole('button', { name: '追加', exact: true });
        await button.waitFor();
        const enabled = { row: await measureLayout(search), input: await measureLayout(search.locator('> input')),
          shell: await measureLayout(search.locator('> .task-banner__action-shell')), action: await measureLayout(button) };
        await recordWorkspaceLayout(page, 'memory-enabled', enabled);
        expect(enabled.action.disabled).toBe(false);
        expect(enabled.shell.flexShrink).toBe('0');
        expect(enabled.shell.box.width).toBeGreaterThanOrEqual(84);
        singleLine(enabled.action);
        readable(enabled.input);
        expect(enabled.input.box.width).toBeGreaterThan(100);
        inside(enabled.shell.box, enabled.row.box);
        expect(enabled.input.box.right).toBeLessThanOrEqual(enabled.shell.box.left - 1);
        await page.getByRole('button', { name: '导出时间线', exact: true }).click();
        await page.getByRole('button', { name: '导出中…', exact: true }).waitFor();
        const disabled = { row: await measureLayout(search), input: await measureLayout(search.locator('> input')),
          shell: await measureLayout(search.locator('> .task-banner__action-shell')), control: await measureDisabledReason(page, button) };
        await recordWorkspaceLayout(page, 'memory-peer-disabled', disabled);
        expect(disabled.shell.box.width).toBeGreaterThanOrEqual(84);
        singleLine(disabled.control.action);
        visibleReason(disabled.control, '当前记忆操作进行中，请稍候。', 80);
        inside(disabled.shell.box, disabled.row.box);
        readable(disabled.input);
        expect(disabled.input.box.right).toBeLessThanOrEqual(disabled.shell.box.left - 1);
        expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
        expect(await page.evaluate(() => (window as any).canonicalFeedback.calls.export.length)).toBe(1);
        await noFixtureMutations(page, 'canonical');
      });
    }, 30_000);

    it('真实调度摘要在生产侧栏宽度内保留完整时区与单行会话说明', async () => {
      await withWorkspaceLayoutFixture(bundles.get('primitives')!, 'primitives', profile, async page => {
        const strip = page.locator('dl.summary-strip[aria-label="当前店铺自动化范围"]');
        await strip.waitFor();
        const timezone = strip.locator('.summary-strip__item').filter({ has: page.locator('dt', { hasText: '业务时区' }) });
        const measured = { strip: await measureLayout(strip), items: await Promise.all((await strip.locator('> div').all()).map(measureLayout)),
          field: await measureLayout(timezone.locator('dd')), value: await measureLayout(timezone.locator('strong')),
          detail: await measureLayout(timezone.locator('small')) };
        await recordWorkspaceLayout(page, 'scheduler-timezone', measured);
        expect(measured.strip.display).toBe('grid');
        expect(columns(measured.strip)).toHaveLength(profile.width > 1180 ? 4 : 2);
        expect(measured.items).toHaveLength(4);
        for (const item of measured.items) inside(item.box, measured.strip.box);
        expect(measured.field.flexWrap).toBe('wrap');
        expect(measured.value.text).toBe('America/Los_Angeles');
        expect(measured.detail.text).toBe('会话代次 1');
        expect(measured.detail.flexShrink).toBe('0');
        readable(measured.value);
        singleLine(measured.detail);
        inside(measured.value.box, measured.field.box);
        inside(measured.detail.box, measured.field.box);
        const separateRow = measured.detail.box.top >= measured.value.box.bottom - 1;
        const sameRowAfterValue = measured.detail.box.left >= measured.value.box.right - 1;
        expect(separateRow || sameRowAfterValue).toBe(true);
        expect(await page.evaluate(() => (window as any).layoutPrimitiveFixture.calls.length)).toBe(0);
      });
    }, 30_000);
  });
}

async function readWorkspaceMotion(page: Page) {
  return page.evaluate(() => {
    const frames = [...document.querySelectorAll('.workspace-page-frame')];
    if (frames.length !== 1) throw new Error('MOTION_SINGLE_PRODUCTION_PAGE_FRAME_REQUIRED');
    const durationMs = (value: string) => value.split(',').map(item => {
      const text = item.trim(), amount = Number.parseFloat(text);
      if (!Number.isFinite(amount) || !/m?s$/.test(text)) throw new Error('MOTION_COMPUTED_DURATION_INVALID');
      return text.endsWith('ms') ? amount : amount * 1000;
    });
    const elements = [...frames[0].querySelectorAll('*')];
    const computed = elements.flatMap((element, index) => [null, '::before', '::after'].map(pseudo => {
      const style = getComputedStyle(element, pseudo);
      return { index, tagName: element.tagName, pseudo, animationName: style.animationName,
        animationMs: durationMs(style.animationDuration), transitionMs: durationMs(style.transitionDuration) };
    }));
    const animations = document.getAnimations().map(animation => ({
      durationMs: animation.effect?.getComputedTiming().duration,
      playState: animation.playState,
      buttonSpinner: animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element
        && animation.effect.target.matches('.workspace-page-frame .button-spinner'),
    }));
    return { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      deviceScaleFactor: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
      elementCount: elements.length, computed, animations };
  });
}

for (const profile of LAYOUT_PROFILES) {
  describe(`生产 CSS 实际减弱动态 · ${profile.id}`, () => {
    it('正常态先产生真实非零动态，减弱动态后时长归零且不保留非零动画', async () => {
      await withWorkspaceLayoutFixture(bundles.get('memory')!, 'memory', profile, async page => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.getByRole('button', { name: '导出时间线', exact: true }).click();
        await page.getByRole('button', { name: '导出中…', exact: true }).locator('.button-spinner').waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const normal = await readWorkspaceMotion(page);
        await recordWorkspaceLayout(page, 'motion-no-preference', normal);
        expect(normal.reducedMotion).toBe(false);
        expect(normal.deviceScaleFactor).toBe(profile.scale);
        expect(normal.viewport).toEqual({ width: profile.width, height: profile.height });
        expect(normal.elementCount).toBeGreaterThan(0);
        expect(normal.computed.some(row => [...row.animationMs, ...row.transitionMs].some(duration => duration > 0))).toBe(true);
        expect(normal.animations.some(animation => animation.buttonSpinner && typeof animation.durationMs === 'number'
          && animation.durationMs > 0 && animation.playState === 'running')).toBe(true);
        // 同一真实忙碌组件切换媒体状态，不能用未产生过动态的空页面取得归零信用。
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const reduced = await readWorkspaceMotion(page);
        await recordWorkspaceLayout(page, 'motion-reduced', reduced);
        expect(reduced.reducedMotion).toBe(true);
        expect(reduced.deviceScaleFactor).toBe(profile.scale);
        expect(reduced.viewport).toEqual(normal.viewport);
        expect(reduced.elementCount).toBe(normal.elementCount);
        expect(reduced.computed).toHaveLength(reduced.elementCount * 3);
        expect(reduced.computed.every(row => [...row.animationMs, ...row.transitionMs].every(duration => duration === 0))).toBe(true);
        expect(reduced.animations.every(animation => animation.durationMs === 0)).toBe(true);
        expect(await page.evaluate(() => (window as any).canonicalFeedback.calls.export.length)).toBe(1);
        await noFixtureMutations(page, 'canonical');
      });
    }, 30_000);
  });
}
