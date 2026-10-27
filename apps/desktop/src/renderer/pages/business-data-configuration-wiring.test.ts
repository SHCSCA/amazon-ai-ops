import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const rendererRoot = process.env.V16_BUSINESS_UI_SOURCE_ROOT
  || path.resolve(process.cwd(), 'apps/desktop/src/renderer');
const source = (name: string) => readFileSync(path.join(rendererRoot, 'pages', name), 'utf8');

function elementAncestors(name: string, tag: string, openingMarker?: string) {
  const file = ts.createSourceFile(name, source(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: string[][] = [];
  function visit(node: ts.Node, ancestors: string[]) {
    const jsx = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
    const label = ts.isJsxElement(node) ? node.openingElement.tagName.getText(file)
      : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(file) : '';
    const opening = ts.isJsxElement(node) ? node.openingElement.getText(file) : node.getText(file);
    if (jsx && label === tag && (!openingMarker || opening.includes(openingMarker))) result.push(ancestors);
    ts.forEachChild(node, (child) => visit(child, jsx ? [...ancestors, label] : ancestors));
  }
  visit(file, []);
  return result;
}

describe('合法未创建店铺运行配置的业务页面接线', () => {
  it.each([
    ['dashboard-workspace.tsx', 'PageFrame'],
    ['ad-quant-workspace.tsx', 'TaskBanner'],
    ['keyword-opportunities-workspace.tsx', 'TaskBanner'],
    ['import-validation-workspace.tsx', 'TaskBanner'],
  ])('%s 的管道派生工作台由共享 Guard 隔离', (name, tag) => {
    expect(source(name)).toContain('configurationRequired } = useBusinessDataPipeline();');
    const ancestors = elementAncestors(name, tag);
    expect(ancestors.length).toBeGreaterThan(0);
    expect(ancestors.every((row) => row.includes('BusinessDataConfigurationGuard'))).toBe(true);
    if (name === 'import-validation-workspace.tsx') {
      const page = source(name);
      expect(page).toContain("const unconfiguredLocalImportButton = dataImportActionButtonView({ mode: 'local', runningImport: actionOrigin === 'task-local' ? runningImport : null, hasRealFiles });");
      expect(page).toContain("storeAuthority.phase === 'ready'");
      expect(page).toContain('storeAuthority.authoritativeContext && storeAuthority.authorityKey');
      expect(page).toContain("storeAuthority.authoritativeContext.marketplace === 'US'");
      expect(page).toContain("storeAuthority.authoritativeContext.currency === 'USD'");
      expect(page).toContain('aria-busy={unconfiguredLocalImportButton.ariaBusy}');
      expect(page).toContain('className={unconfiguredLocalImportButton.className}');
      expect(page).toContain('Boolean(openingArtifactKey) || !unconfiguredLocalImportAuthorityReady}');
      expect(page).toContain('{unconfiguredLocalImportButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}');
      expect(page).toContain('{unconfiguredLocalImportButton.label}');
      expect(page).toContain("onClick={() => { void runImport('local', 'task-local'); }}");
      expect(page).not.toContain('operation.hasAuthority');
      expect(page).not.toContain('导入本地文件（仅检查）');
    }
  });

  it('范围确认继续调用原 Main 保存接口，未读取状态不冒充文件和指标计数', () => {
    const text = source('operation-scope-page.tsx');
    expect(text).toContain('await api.saveOperationScope(storeContext, normalizedDraft);');
    expect(text).toContain("configurationRequired ? '报表覆盖与入库指标：未读取'");
    expect(text).toContain("configurationRequired ? '未读取' : `${Math.min(realReportCount, 8)}/8 类`");
    expect(text).toContain("configurationRequired ? '未读取' : `${importedRows} 行`");
    expect(text).toContain('!configurationRequired && !collectionJobsLoading');
    expect(elementAncestors('operation-scope-page.tsx', 'TaskBanner').every((row) => !row.includes('BusinessDataConfigurationGuard'))).toBe(true);
  });

  it('采集继续使用独立静态下载目录并透传未知数据状态', () => {
    const text = source('collection-controller.tsx');
    expect(text).toContain('collection?.reportOptions?.length ? collection.reportOptions : DEFAULT_BUSINESS_REPORT_OPTIONS');
    expect(text).toContain('    configurationRequired,');
    expect(text).toContain("runDownloadAction: (mode: DownloadCollectionActionMode) => runCollectionOperation(mode, () => runDownloadAction(mode))");
  });

  it('独立采集任务和采集动作不被未知管道状态隐藏', () => {
    const name = 'collection-view.tsx';
    expect(source(name)).toContain("configurationRequired ? '当前业务数据未读取'");
    expect(source(name)).toContain("configurationRequired ? '未读取' : reportStatusLoading");
    for (const tag of ['CollectionJobWorkspace', 'TaskBanner', 'CollectionMonitorDrawer', 'CollectionReportSelectorDialog']) {
      const ancestors = elementAncestors(name, tag);
      expect(ancestors.length).toBeGreaterThan(0);
      expect(ancestors.every((row) => !row.includes('BusinessDataConfigurationGuard'))).toBe(true);
    }
  });

  it('报表选择保留手动目录，未知状态禁用基于缺失事实的快捷筛选', () => {
    const text = source('collection-selector-dialog.tsx');
    expect(text).toContain('disabled={configurationRequired || reportStatusLoading || missingReportTypes.length === 0}');
    expect(text).toContain('disabled={configurationRequired || reportStatusLoading || unimportedReportTypes.length === 0}');
    expect(text).toContain("configurationRequired ? '状态未读取'");
    expect(text).toContain('onClick={() => setSelectedTypes(reportOptions.map((item) => item.type))}');
    expect(text).toContain('onChange={() => toggleReport(item.type)}');
  });

  it('本地产品配置表单与真实产品列表继续可用，管道指标显示未读取', () => {
    const name = 'product-config-page.tsx';
    expect(source(name)).toContain("configurationRequired ? '指标未读取'");
    expect(source(name)).toContain('currentScopeProducts.map((product) =>');
    expect(elementAncestors(name, 'FormTable').every((row) => !row.includes('BusinessDataConfigurationGuard'))).toBe(true);
    expect(source(name)).toContain('await (window as any).electronAPI?.saveProductConfig?.({');
  });

  it('产品本地队列保持可读，量化和日级数据不由零值推断', () => {
    const text = source('product-management-page.tsx');
    expect(text).toContain('configurationRequired || portfolioConfigurationRequired');
    expect(text).toContain('businessConfigurationRequired ? <span>未读取</span>');
    expect(text).toContain("inspectorTab === 'daily' && (<BusinessDataConfigurationGuard");
    expect(text).toContain("inspectorTab === 'timeline' && (<BusinessDataConfigurationGuard");
    expect(elementAncestors('product-management-page.tsx', 'VirtualDataTable').every((row) => !row.includes('BusinessDataConfigurationGuard'))).toBe(true);
  });

  it('优化建议准确阻断新生成，同时保留独立队列刷新', () => {
    const controller = source('recommendation-controller.ts');
    expect(controller).toContain("issues.add('当前店铺运行配置待创建，当前业务数据尚未读取');");
    expect(controller).toContain("setMessage('当前店铺运行配置待创建，当前业务数据尚未读取；新建议生成保持锁定。');");
    const view = source('recommendation-view.tsx');
    expect(view).toContain('onClick={refreshRecommendations}');
    const auxiliary = elementAncestors('recommendation-view.tsx', 'Panel', 'title="AI + 规则并行决策模型"');
    expect(auxiliary).toHaveLength(1);
    expect(auxiliary[0]).toContain('BusinessDataConfigurationGuard');
    expect(view).toContain("<td colSpan={compactRecommendationTableColSpan}>{configurationRequired ? '当前店铺运行配置待创建，当前业务数据尚未读取。' : recommendations.length ?");
    const tables = elementAncestors('recommendation-view.tsx', 'table');
    expect(tables.some((row) => !row.includes('BusinessDataConfigurationGuard'))).toBe(true);
  });

  it('Listing 本地草案与编辑动作保持可用，未读取广告数据不冒充量化证据', () => {
    const text = source('listing-view.tsx');
    expect(text).toContain("configurationRequired ? '业务数据未读取'");
    expect(text).toContain('仅允许本地参考草案，不作为量化验收证据');
    expect(text).toContain("onClick={() => void generateDrafts('panel-generate')}");
    expect(elementAncestors('listing-view.tsx', 'FormTable').every((row) => !row.includes('BusinessDataConfigurationGuard'))).toBe(true);
  });

  it.each(['approval-workspace.tsx', 'readback-workspace.tsx', 'decisions-workspace.tsx'])('%s 保留独立队列并追加配置提示', (name) => {
    expect(source(name)).toContain('configurationRequired && <BusinessDataConfigurationNotice />');
    expect(source(name)).not.toContain('BusinessDataConfigurationGuard');
  });
});
