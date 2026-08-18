import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CURRENT_MISSION_CONTROL_SMOKES = {
  'smoke-business-ui-shell.js': 'diagnosis-ready',
  'smoke-business-ui-data-pipeline.js': 'diagnosis-ready',
  'smoke-business-ui-keyword-listing.js': 'diagnosis-ready',
  'smoke-business-ui-ad-execution.js': 'missing-readback-evidence',
  'smoke-business-ui-settings-delivery.js': 'delivery-ready',
};

function readSmoke(fileName) {
  return readFileSync(new URL(fileName, import.meta.url), 'utf8');
}

function expectExplicitDevScenario(source, scenario) {
  const directCall = `startBusinessUiDevServer(root, '${scenario}')`;
  const boundScenario = `const previewScenario = '${scenario}';`;
  const boundCall = 'startBusinessUiDevServer(root, previewScenario)';

  expect(
    source.includes(directCall)
      || (source.includes(boundScenario) && source.includes(boundCall)),
  ).toBe(true);
}

describe('current Mission Control browser smoke bootstrap contract', () => {
  for (const [fileName, scenario] of Object.entries(CURRENT_MISSION_CONTROL_SMOKES)) {
    it(`${fileName} starts the Vite preview with explicit scenario ${scenario}`, () => {
      const source = readSmoke(fileName);

      expectExplicitDevScenario(source, scenario);
      expect(source).toContain('installPreviewApiBridge(page)');
      expect(source).toContain('page.goto(server.url');
      expect(source).toContain('enterPreviewStore(page');
      expect(source).not.toMatch(/page\.goto\(\s*['"`]http:\/\/127\.0\.0\.1/);
    });

    it(`${fileName} enters Store Gate and proves the fixed Amazon US / USD scope`, () => {
      const source = readSmoke(fileName);

      expect(source).toContain("getByLabel('美国站，美元')");
      expect(source).toContain('USD');
      expect(source).toMatch(/APP_READY[\s\S]*?不可视为 APP_READY|不可视为 APP_READY[\s\S]*?APP_READY/);
    });
  }
});

describe('Mission Control workspace and CRUD smoke contract', () => {
  it('shell proves canonical workspace identity and the current product CRUD surface', () => {
    const source = readSmoke('smoke-business-ui-shell.js');

    expect(source).toContain('[data-workspace-evidence-root]');
    expect(source).toContain('.store-scoped-objects[data-store-object-subview="products"]');
    expect(source).toContain("name: '产品与经营目标'");
    expect(source).toContain('查询 ASIN / 标题 / SKU');
    expect(source).toContain('name: /新建产品/');
    expect(source).toContain("heading: /运营任务事实链/");
  });

  it('data pipeline proves collection lineage, event CRUD entry, and Mission facts', () => {
    const source = readSmoke('smoke-business-ui-data-pipeline.js');

    for (const marker of [
      "expectHeading(page, '报表采集')",
      "assertWorkspace(page, 'collection', 'reports')",
      '8 类报表工作台',
      '生产采集血缘待建立',
      'DEV 预览不会注入伪造任务',
      "name: /记录事件/",
      'AI 因果上下文',
      "expectHeading(page, '运营任务事实链')",
      "assertWorkspace(page, 'missions', 'facts')",
      '任务来源链',
      '不进入决策',
    ]) {
      expect(source).toContain(marker);
    }
  });

  it('keyword and Listing smoke proves store isolation plus create-update-delete-history behavior', () => {
    const source = readSmoke('smoke-business-ui-keyword-listing.js');

    for (const marker of [
      "switchStore(page, 'preview-store-shc002', 'SHC002-US')",
      'keyword store isolation',
      "name: '新建 Listing'",
      "name: `编辑 ${NEW_ASIN}`",
      "name: `删除 ${NEW_ASIN}`",
      "name: '确认删除'",
      "name: '查看当前店铺 Listing 版本账本'",
      '已删除 Listing 的历史快照也会保留在这里',
      'isolated in-memory Listing CRUD only; no Amazon or Lingxing writes',
    ]) {
      expect(source).toContain(marker);
    }
  });

  it('settings smoke proves store-scoped runtime-config CRUD and cross-store isolation', () => {
    const source = readSmoke('smoke-business-ui-settings-delivery.js');

    for (const marker of [
      "createStoreRuntimeConfig: wrapPreview('createStoreRuntimeConfig'",
      "updateStoreRuntimeConfig: wrapPreview('updateStoreRuntimeConfig'",
      "archiveStoreRuntimeConfig: wrapPreview('archiveStoreRuntimeConfig'",
      "restoreStoreRuntimeConfig: wrapPreview('restoreStoreRuntimeConfig'",
      "switchStore(page, 'preview-store-shc002', 'SHC002-US')",
      "item.type === 'updateStoreRuntimeConfig' && item.storeId === 'preview-store-shc001'",
      "item.type === 'updateStoreRuntimeConfig' && item.storeId === 'preview-store-shc002'",
      'Runtime config writes were not isolated by store',
    ]) {
      expect(source).toContain(marker);
    }
  });
});

describe('advertising execution smoke safety contract', () => {
  it('uses only the explicit in-memory Mission execution harness and disables production mutations', () => {
    const source = readSmoke('smoke-business-ui-ad-execution.js');

    expectExplicitDevScenario(source, 'missing-readback-evidence');
    expect(source).toContain('.execution-workspace--mission[data-mutations-disabled="true"]');
    expect(source).toContain('仅开发预览 · 不连接真实广告页面，不提交任何广告调整');
    expect(source).toContain('auto-advanced-in-memory-only');
    expect(source).toContain('结果不确定 · 队列已停止');
    expect(source).toContain('不会自动重试');
    expect(source).not.toContain('smoke=ad-execution-authoritative');
  });

  it('keeps readback preview-only, readonly, and formally locked', () => {
    const source = readSmoke('smoke-business-ui-ad-execution.js');

    for (const marker of [
      '.readback-page-preview-readonly',
      "data-preview-scenario') !== 'missing-readback-evidence'",
      '仅开发预览，不代表正式交付就绪',
      '当前仅展示只读结果核对布局',
      '所有证据写入与真实校验均已锁定',
      'Readback preview exposed an enabled mutation button',
      '.isDisabled()',
    ]) {
      expect(source).toContain(marker);
    }
  });
});

describe('settings and delivery preview safety contract', () => {
  it('records a credential-free, memory-only runtime with no Amazon Ads writes', () => {
    const source = readSmoke('smoke-business-ui-settings-delivery.js');

    expect(source).toContain("mode: 'dev-preview-memory-only'");
    expect(source).toContain('credentialsUsed: false');
    expect(source).toContain('amazonAdsWrites: false');
    expect(source).toContain('/credential|password|amazon.?ads|execute|exportDeliveryBundle/i');
    expect(source).toContain('Smoke crossed the approved memory-only settings boundary');
  });

  it('cannot present preview delivery as APP_READY or enable bundle export', () => {
    const source = readSmoke('smoke-business-ui-settings-delivery.js');

    expect(source).toContain('不可视为 APP_READY');
    expect(source).toContain('也不能满足真实导出或验收 gate');
    expect(source).toContain("name: '导出交付包'");
    expect(source).toContain('Preview-only delivery must not enable delivery bundle export');
    expect(source).toContain('.isDisabled()');
  });
});
