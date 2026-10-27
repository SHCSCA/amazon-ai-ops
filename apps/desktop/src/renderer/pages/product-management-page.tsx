import { BusinessDataConfigurationGuard, BusinessDataConfigurationNotice } from '../components/business-data-configuration';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';

import { FormTable, FormTableRow, StatusPill } from '../components/ui';
import { VirtualDataTable, type VirtualDataTableColumn } from '../components/virtual-data-table';
import { ResponsiveInspector, TaskBanner, WorkbenchPanel } from '../components/workspace';
import { formatPercent, formatUsd } from '../formatters';
import { hasFormalReportCoverage, importedReportTypeCoverageCount } from '../report-coverage';
import { useScopeStore } from '../scope-store';
import { buildCostInputFromProduct, DEFAULT_COST, productCostInputHint } from './product-config-page';
import { mergeProductStrategyContexts, normalizeProductPortfolioRows, type ProductManagementSummary } from '../product-management';
import type { ProductStrategyContextView } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { useWorkspaceOperation } from '../components/workspace/use-workspace-operation';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import { businessPipelineScopeKey } from '../components/business-data';
import { rendererRuntimeLog } from '../runtime-log';
import { productManagementActionRoutes, ProductStage, ProductInspectorTab, PRODUCT_INSPECTOR_TABS, productInspectorTabTarget, STAGE_OPTIONS, PRODUCT_QUICK_COST_FIELDS, PRODUCT_QUICK_TARGET_FIELDS, buildDraftFromProduct, toNumber, productTimelineScopeLabel, productTimelineScopeTone, buildProductManagementPageModel, type ProductManagementActionButtonView, productManagementActionButtonView, buildCredentialSandboxSummary, buildProductManagementTaskState, buildProductManagementOptionView, navigate, stageLabel } from './product-management-model';
export { productManagementActionRoutes, productInspectorTabTarget, PRODUCT_QUICK_COST_FIELDS, PRODUCT_QUICK_TARGET_FIELDS, productTimelineScopeLabel, productTimelineScopeTone, buildProductManagementPageModel, type ProductManagementActionButtonView, productManagementActionButtonView, buildCredentialSandboxSummary, buildProductManagementTaskState, buildProductManagementOptionView } from './product-management-model';

export function ProductManagementPage() {
  const { data, loading, error, scope, configurationRequired } = useBusinessDataPipeline();
  const storeAuthority = useMissionControlStoreContext();
  const {
    data: portfolioData,
    loading: portfolioLoading,
    error: portfolioError,
    configurationRequired: portfolioConfigurationRequired,
  } = useBusinessDataPipeline({ mode: 'portfolio' });
  const { setScope } = useScopeStore();
  const lockedAsin = String(scope.asin || '').trim().toUpperCase();
  const [focusedAsin, setFocusedAsin] = useState('');
  const readKey = `${storeAuthority.authorityKey}|${businessPipelineScopeKey(scope)}`;
  const readOperation = useWorkspaceOperation(readKey);
  const operationKey = `${readKey}|${focusedAsin}`;
  const operation = useWorkspaceOperation(operationKey);
  const [inspectorTab, setInspectorTab] = useState<ProductInspectorTab>('detail');
  const [configuredProducts, setConfiguredProducts] = useState<ProductStrategyContextView[]>([]);
  const [configuredProductsLoading, setConfiguredProductsLoading] = useState(true);
  const [configuredProductsError, setConfiguredProductsError] = useState('');
  const [productPoolReloadToken, setProductPoolReloadToken] = useState(0);
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const queueData = portfolioData || data;
  const businessConfigurationRequired = configurationRequired || portfolioConfigurationRequired;
  const supplementalProducts = useMemo(() => mergeProductStrategyContexts(
    data?.productContext?.products || [],
    configuredProducts,
  ), [configuredProducts, data?.productContext?.products]);
  const model = useMemo(() => buildProductManagementPageModel({
    data: queueData,
    scopeAsin: focusedAsin,
    authoritativeData: data,
    supplementalProducts,
  }), [data, focusedAsin, queueData, supplementalProducts]);
  const lockedModel = useMemo(() => buildProductManagementPageModel({
    data: queueData,
    scopeAsin: lockedAsin,
    authoritativeData: data,
    supplementalProducts,
  }), [data, lockedAsin, queueData, supplementalProducts]);
  const routes = productManagementActionRoutes();
  const selected = model.selectedProduct;
  const lockedProduct = lockedModel.selectedProduct;
  const focusedIsLocked = Boolean(selected && selected.asin === lockedAsin);
  const productContexts = useMemo(() => mergeProductStrategyContexts(
    queueData?.productContext?.products || [],
    supplementalProducts,
  ), [queueData?.productContext?.products, supplementalProducts]);
  const selectedContext = useMemo(() => (
    productContexts.find((product) => selected?.asin && product.asin.toUpperCase() === selected.asin.toUpperCase())
  ), [productContexts, selected?.asin]);
  const [draft, setDraft] = useState(() => buildDraftFromProduct(undefined, scope.asin));
  const [cost, setCost] = useState(DEFAULT_COST);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const importedRows = data?.quant?.importedRows ?? 0;
  const hasImportedMetrics = Boolean(data?.quant?.hasImportedMetrics && importedRows > 0);
  const importedReportTypeCount = importedReportTypeCoverageCount(data?.collection);
  const formalDataReady = Boolean(hasImportedMetrics && hasFormalReportCoverage(data?.collection));
  const queueLoading = Boolean((portfolioLoading && !portfolioData) || (configuredProductsLoading && !queueData));
  const queueError = portfolioError || configuredProductsError;
  const taskState = useMemo(
    () => buildProductManagementTaskState({
      model: lockedModel,
      loading: lockedAsin ? loading : queueLoading,
      error,
      saving,
      saveMessage,
      saveError,
      importedRows,
      hasImportedMetrics,
      importedReportTypeCount,
      formalDataReady,
    }),
    [error, formalDataReady, hasImportedMetrics, importedReportTypeCount, importedRows, loading, lockedAsin, lockedModel, queueLoading, saveError, saveMessage, saving],
  );
  const productActionBusy = saving;
  const saveProductButton = productManagementActionButtonView({
    active: saving,
    baseClassName: 'primary-button',
    busyLabel: '保存中...',
    disabled: !draft.asin.trim(),
    label: '保存产品信息',
  });
  const openConfigButton = productManagementActionButtonView({
    active: false,
    baseClassName: 'secondary-button',
    busyLabel: '处理中...',
    groupBusy: productActionBusy,
    label: '打开完整配置',
  });
  const lockedOptionFeedback = useMemo(
    () => lockedProduct
      ? buildProductManagementOptionView({
          selected: true,
          productTitle: lockedProduct.title,
          asin: lockedProduct.asin,
          hasImportedMetrics,
          dailyDays: lockedModel.selectedDailyRows.length,
        })
      : null,
    [hasImportedMetrics, lockedModel.selectedDailyRows.length, lockedProduct],
  );
  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toUpperCase();
    if (!query) return model.products;
    return model.products.filter((product) => [
      product.asin,
      product.title,
      product.skuLine,
      stageLabel(product.stage),
      product.status || '',
    ].some((value) => String(value || '').toUpperCase().includes(query)));
  }, [model.products, productSearch]);

  useEffect(() => {
    if (!selected) return;
    setDraft(buildDraftFromProduct(selectedContext || selected, selected.asin));
    setCost(buildCostInputFromProduct(selectedContext || {}));
  }, [selected, selectedContext]);

  useEffect(() => {
    const refresh = () => setProductPoolReloadToken((current) => current + 1);
    window.addEventListener('business-ui:data-updated', refresh);
    return () => window.removeEventListener('business-ui:data-updated', refresh);
  }, []);

  useEffect(() => {
    setSaving(false);
    setSaveError('');
    setSaveMessage('');
  }, [operationKey]);

  useEffect(() => {
    setFocusedAsin('');
    setConfiguredProducts([]);
  }, [storeAuthority.authorityKey]);

  useEffect(() => {
    let cancelled = false;
    const isCurrent = readOperation.capture();
    async function loadConfiguredProducts() {
      setConfiguredProducts([]);
      setConfiguredProductsLoading(true);
      setConfiguredProductsError('');
      try {
        const rows = await (window as any).electronAPI?.getProducts?.();
        if (cancelled || !isCurrent()) return;
        setConfiguredProducts(normalizeProductPortfolioRows(rows, scope));
      } catch (caught) {
        rendererRuntimeLog.error('product_management.load_failed', { error: caught });
        if (!cancelled && isCurrent()) {
          setConfiguredProductsError(toUserFacingError(caught, '读取完整产品配置池失败。'));
        }
      } finally {
        if (!cancelled && isCurrent()) setConfiguredProductsLoading(false);
      }
    }
    void loadConfiguredProducts();
    return () => {
      cancelled = true;
    };
  }, [productPoolReloadToken, readKey]);

  function lockProduct(asin: string) {
    setScope({ asin, currency: 'USD' });
  }

  function openProductInspector(asin: string, panel: ProductInspectorTab = 'detail') {
    if (saving || operation.busy) return;
    setFocusedAsin(asin);
    setInspectorTab(panel);
  }

  function clearLockedProduct() {
    setScope({ asin: undefined, currency: 'USD' });
  }

  function closeProductInspector() {
    if (saving) return;
    setFocusedAsin('');
    setInspectorTab('detail');
  }

  function selectInspectorTab(nextTab: ProductInspectorTab) {
    setInspectorTab(nextTab);
    window.requestAnimationFrame?.(() => {
      document.getElementById(`product-inspector-tab-${nextTab}`)?.focus();
    });
  }

  function handleInspectorTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentTab: ProductInspectorTab) {
    const nextTab = productInspectorTabTarget(currentTab, event.key);
    if (nextTab === currentTab) return;
    event.preventDefault();
    selectInspectorTab(nextTab);
  }

  function updateCost(key: keyof typeof cost, value: string) {
    setCost((current) => ({ ...current, [key]: toNumber(value) }));
  }

  async function saveProduct() {
    const ticket = operation.begin();
    if (!ticket) return;
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      if (!draft.asin.trim()) throw new Error('请填写 ASIN。');
      const result = await (window as any).electronAPI?.saveProductConfig?.({
        product: {
          ...draft,
          asin: draft.asin.trim().toUpperCase(),
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
        },
        cost,
      });
      if (!ticket.isCurrent()) return;
      if (!result?.success) throw new Error('保存接口没有返回成功状态。');
      const nextAsin = draft.asin.trim().toUpperCase();
      setFocusedAsin(nextAsin);
      setSaveMessage(nextAsin === lockedAsin
        ? '产品信息已保存；当前锁定产品保持不变。'
        : '产品信息已保存；尚未改变全局产品范围，如需切换请使用“锁定为当前产品”。');
      window.dispatchEvent(new Event('business-ui:data-updated'));
    } catch (caught) {
      rendererRuntimeLog.error('product_management.save_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setSaveError(toUserFacingError(caught, '保存产品信息失败。'));
    } finally {
      if (ticket.isCurrent()) setSaving(false);
      ticket.finish();
    }
  }

  const columns = useMemo<Array<VirtualDataTableColumn<ProductManagementSummary>>>(() => [
    {
      key: 'product',
      header: '产品',
      width: 'minmax(250px, 1.5fr)',
      sticky: 'left',
      cell: (product) => (
        <div>
          <strong>{product.title}</strong>
          <p>{product.asin} / {product.skuLine}</p>
        </div>
      ),
    },
    {
      key: 'stage',
      header: '阶段 / 配置',
      width: 'minmax(150px, 0.8fr)',
      cell: (product) => (
        <div>
          <StatusPill tone={product.configured ? 'ready' : 'warning'}>
            {product.configured ? '已配置' : '待补齐'}
          </StatusPill>
          <p>{stageLabel(product.stage)}{product.targetAcos !== undefined ? ` / 目标 ${formatPercent(product.targetAcos * 100)}` : ''}</p>
        </div>
      ),
    },
    {
      key: 'performance',
      header: '广告表现',
      width: 'minmax(190px, 1fr)',
      cell: (product) => (
        businessConfigurationRequired ? <span>未读取</span> : (<div>
          <strong>{formatUsd(product.cost)} / ACOS {formatPercent(product.acos * 100)}</strong>
          <p>销售 {formatUsd(product.sales)} / 订单 {product.orders}</p>
        </div>)
      ),
    },
    {
      key: 'readiness',
      header: '数据 / 风险',
      width: 'minmax(175px, 0.9fr)',
      cell: (product) => (
        businessConfigurationRequired ? <span>未读取</span> : (<div>
          <strong>{product.activeDays ? `${product.activeDays} 个活跃日` : '暂无日级指标'}</strong>
          <p>{product.lastMetricDate || '日期待导入'} / {product.highRiskCount ? `${product.highRiskCount} 个高风险` : `${product.eventCount} 个事件`}</p>
        </div>)
      ),
    },
    {
      key: 'context',
      header: '运营上下文',
      width: 'minmax(145px, 0.7fr)',
      cell: (product) => {
        const isLocked = product.asin === lockedAsin;
        return (
          <div className="product-management-row-actions">
            <StatusPill tone={isLocked ? 'ready' : 'pending'}>{isLocked ? '当前已锁定' : '仅查看'}</StatusPill>
            <WorkspaceActionButton disabledReason={isLocked ? '该产品已锁定为当前产品；如需切换，请锁定其他产品或取消锁定。' : '正在保存当前产品信息，请等待完成后切换。'}
              aria-pressed={isLocked}
              className="secondary-button compact-button"
              disabled={(isLocked || saving) || saving}
              onClick={(event) => {
                event.stopPropagation();
                lockProduct(product.asin);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              type="button"
            >
              {isLocked ? '已锁定' : '锁定'}
            </WorkspaceActionButton>
          </div>
        );
      },
    },
  ], [businessConfigurationRequired, lockedAsin, saving]);

  const selectionStatus = selected && !focusedIsLocked
    ? `正在查看 ${selected.title} / ${selected.asin}，没有改变全局产品范围。${lockedProduct ? `当前锁定产品仍为 ${lockedProduct.asin}。` : '当前尚未锁定产品。'}`
    : businessConfigurationRequired ? `当前${lockedAsin ? `已锁定 ${lockedAsin}` : '尚未锁定产品'}；广告指标尚未读取。` : lockedOptionFeedback?.statusLine || '尚未锁定产品；选择产品行只会打开详情，只有“锁定”动作才会改变全局 ASIN。';

  return (
    <div className="business-stack product-management-page-stack">
      {businessConfigurationRequired && <BusinessDataConfigurationNotice />}
      <TaskBanner
        compact
        description={businessConfigurationRequired ? '当前业务数据尚未读取；本地产品队列和产品信息仍可维护。' : taskState.detail}
        meta={businessConfigurationRequired ? '广告表现、日级指标与运营事件：未读取' : taskState.feedbackDetail}
        primaryAction={{
          label: taskState.primaryActionLabel,
          onClick: () => navigate(taskState.primaryRoute),
          disabled: taskState.primaryActionDisabled || saving,
          disabledReason: saving ? '正在保存当前产品信息，请等待返回后继续。' : '正在读取产品数据，请等待当前范围返回。',
          busy: taskState.primaryActionBusy,
          busyLabel: taskState.primaryBusyLabel,
        }}
        secondaryActions={taskState.secondaryActions.slice(0, 2).map((action) => ({
          label: action.label,
          onClick: () => navigate(action.route),
          disabled: action.disabled || saving,
          disabledReason: '正在保存当前产品信息，请等待返回后继续。',
        }))}
        status={businessConfigurationRequired ? '当前业务数据未读取' : taskState.feedbackLabel}
        title={businessConfigurationRequired ? '维护当前店铺本地产品信息' : taskState.title}
        tone={taskState.feedbackTone === 'ready' ? 'confirmed' : taskState.feedbackTone === 'blocked' ? 'blocked' : 'attention'}
      />

      <div className="business-stack product-management-workspace" data-workspace-work-surface>
        <div data-workspace-queue="products">
          <WorkbenchPanel
            className="product-management-queue"
            description={`${model.products.length} 个产品 · 选择行只查看详情，锁定按钮才会改变全局 ASIN。`}
            status={lockedProduct ? `已锁定 ${lockedProduct.asin}` : '未锁定产品'}
            title="产品对象队列"
            toolbar={(
              <>
                <label className="product-management-search">
                  <span>搜索产品</span>
                  <input disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="ASIN / 标题 / SKU / 阶段"
                    ref={productSearchRef}
                    value={productSearch}
                  />
                </label>
                <WorkspaceActionButton disabledReason={'正在保存当前产品信息，请等待完成后继续。'} className="secondary-button compact-button" disabled={(saving) || saving} onClick={() => navigate(routes.productConfig)} type="button">批量配置</WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={saving ? '正在保存当前产品信息，请等待完成。' : '当前尚未锁定产品，请先在队列选择产品并点击锁定。'} className="secondary-button compact-button" disabled={(!lockedAsin || saving) || saving} onClick={clearLockedProduct} type="button">取消锁定</WorkspaceActionButton>
              </>
            )}
            footer={(
              <>
                <p aria-live="polite" className="product-management-selection-live" role="status">{selectionStatus}</p>
                {queueError && <p className="warning-line">{queueError} 已保留其他只读产品数据。</p>}
              </>
            )}
          >
            <VirtualDataTable
              className="product-management-list-wrap"
              columns={columns}
              emptyMessage={model.products.length ? '没有匹配的产品。' : model.emptyReason}
              estimateSize={54}
              getRowKey={(product) => product.productKey}
              loading={queueLoading}
              minWidth="900px"
              onRowSelect={(product) => {
                if (!saving) openProductInspector(product.asin);
              }}
              overscan={8}
              rowAriaLabel={(product) => `${product.title}，ASIN ${product.asin}；按 Enter 或空格查看详情，锁定需使用行内锁定按钮`}
              rowClassName={(product) => product.asin === lockedAsin ? 'product-management-table-row-selected' : undefined}
              rows={visibleProducts}
              selectedRowKey={focusedAsin || null}
            />
          </WorkbenchPanel>
        </div>

        <ResponsiveInspector
          busy={saving}
          description={selected
            ? `${selected.asin} / ${selected.skuLine} · ${focusedIsLocked ? '当前已锁定' : '当前仅查看，尚未改变全局产品范围'}`
            : '选择产品后查看详情'}
          dismissDisabled={saving}
          onClose={closeProductInspector}
          open={Boolean(selected && focusedAsin)}
          resolveFocusReturnTarget={(trigger) => trigger?.isConnected === false ? productSearchRef.current : trigger || productSearchRef.current}
          title={selected?.title || '产品详情'}
        >
          {selected && (
            <div className="product-management-modal-body">
              {saving && <p id="product-management-fields-pending" role="note">当前保存或读取尚未结束，字段暂时锁定，请等待完成后继续编辑。</p>}
              <div aria-label="产品详情页签" className="product-management-modal-tabs" role="tablist">
                {PRODUCT_INSPECTOR_TABS.map((tab) => {
                  const active = inspectorTab === tab.key;
                  return (
                    <WorkspaceActionButton disabledReason={'正在保存当前产品信息，请等待完成后继续。'}
                      aria-controls={`product-inspector-panel-${tab.key}`}
                      aria-selected={active}
                      className={active ? 'primary-button compact-button' : 'secondary-button compact-button'}
                      disabled={(saving) || saving}
                      id={`product-inspector-tab-${tab.key}`}
                      key={tab.key}
                      onClick={() => selectInspectorTab(tab.key)}
                      onKeyDown={(event) => handleInspectorTabKeyDown(event, tab.key)}
                      role="tab"
                      tabIndex={active ? 0 : -1}
                      type="button"
                    >
                      {tab.label}
                    </WorkspaceActionButton>
                  );
                })}
              </div>

              <div
                aria-labelledby={`product-inspector-tab-${inspectorTab}`}
                id={`product-inspector-panel-${inspectorTab}`}
                role="tabpanel"
                tabIndex={0}
              >
                {inspectorTab === 'detail' && (
                  <div className="product-management-current-card product-management-modal-summary">
                    <div className="product-management-current-head">
                      <div>
                        <span>查看产品</span>
                        <strong>{selected.title}</strong>
                        <p>{selected.asin} / {selected.skuLine}</p>
                      </div>
                      <StatusPill tone={focusedIsLocked ? 'ready' : 'pending'}>{focusedIsLocked ? '已锁定' : '仅查看'}</StatusPill>
                    </div>
                    <BusinessDataConfigurationGuard configurationRequired={businessConfigurationRequired}>
<div className="product-management-current-metrics">
                      <div><span>阶段</span><strong>{stageLabel(selected.stage)}</strong></div>
                      <div><span>花费</span><strong>{formatUsd(selected.cost)}</strong></div>
                      <div><span>销售</span><strong>{formatUsd(selected.sales)}</strong></div>
                      <div><span>ACOS</span><strong>{formatPercent(selected.acos * 100)}</strong></div>
                      <div><span>订单</span><strong>{selected.orders}</strong></div>
                      <div><span>风险</span><strong>{selected.highRiskCount}</strong></div>
                    </div>
</BusinessDataConfigurationGuard>
                    <p className="muted-line">
                      {businessConfigurationRequired ? '当前业务数据尚未读取；量化门槛保持阻断。' : formalDataReady
                        ? '正式 8/8 报表门已闭合；只有锁定该产品后，广告表现和建议才会读取该 ASIN。'
                        : `正式数据门尚未闭合：当前 ${importedReportTypeCount}/8 类逐类入库，AI 量化保持阻断。`}
                    </p>
                  </div>
                )}

                {inspectorTab === 'edit' && (
                  <>
                    <FormTable>
                      <FormTableRow label="ASIN" required hint="产品配置主键；保存只更新本地配置，显式锁定后其他页面才会沿用该 ASIN。">
                        <input disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined} value={draft.asin} onChange={(event) => setDraft({ ...draft, asin: event.target.value })} placeholder="例如 B0..." />
                      </FormTableRow>
                      <FormTableRow label="标题" hint="用于运营识别，不自动提交到 Amazon 或领星。">
                        <input disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="产品标题" />
                      </FormTableRow>
                      <FormTableRow label="MSKU / SKU" hint="本地识别字段，可与 ERP 或 Amazon 后台对齐。">
                        <div className="inline-input-grid">
                          <input disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined} value={draft.msku} onChange={(event) => setDraft({ ...draft, msku: event.target.value })} placeholder="MSKU" />
                          <input disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined} value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} placeholder="SKU" />
                        </div>
                      </FormTableRow>
                      <FormTableRow label="阶段 / 状态" required hint="阶段和状态会参与 AI 阶段判断、动态阈值和建议风险解释。">
                        <div className="inline-input-grid">
                          <select disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined} value={draft.productStage} onChange={(event) => setDraft({ ...draft, productStage: event.target.value as ProductStage })}>
                            {STAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                          <select disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                            <option value="active">正常运营</option>
                            <option value="paused">暂停推广</option>
                            <option value="clearance">清货</option>
                            <option value="watch">观察</option>
                          </select>
                        </div>
                      </FormTableRow>
                      <FormTableRow label="成本与售价" hint={productCostInputHint(cost)}>
                        <div className="inline-input-grid inline-input-grid-3">
                          {PRODUCT_QUICK_COST_FIELDS.map((field) => (
                            <span className="inline-field" key={field.key}>
                              <span className="inline-field-label">{field.label}</span>
                              <input disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined}
                                aria-label={field.label}
                                type="number"
                                step="0.01"
                                value={cost[field.key]}
                                onChange={(event) => updateCost(field.key, event.target.value)}
                                placeholder={field.placeholder}
                              />
                            </span>
                          ))}
                        </div>
                      </FormTableRow>
                      <FormTableRow label="广告目标" hint="目标 ACOS/TACOS 和净利率会作为产品级阈值约束。">
                        <div className="inline-input-grid inline-input-grid-3">
                          {PRODUCT_QUICK_TARGET_FIELDS.map((field) => (
                            <span className="inline-field" key={field.key}>
                              <span className="inline-field-label">{field.label}</span>
                              <input disabled={saving} aria-describedby={saving ? 'product-management-fields-pending' : undefined}
                                aria-label={field.label}
                                type="number"
                                step="0.01"
                                value={cost[field.key]}
                                onChange={(event) => updateCost(field.key, event.target.value)}
                                placeholder={field.placeholder}
                              />
                            </span>
                          ))}
                        </div>
                      </FormTableRow>
                    </FormTable>
                    {saveMessage && <p className="ready-line">{saveMessage}</p>}
                    {saveError && <p className="blocked-line">{saveError}</p>}
                  </>
                )}

                {inspectorTab === 'daily' && (<BusinessDataConfigurationGuard configurationRequired={businessConfigurationRequired}>{model.selectedDailyRows.length ? (
                    <div className="table-wrap product-management-detail-table">
                      <table className="business-table">
                        <thead>
                          <tr>
                            <th>日期</th>
                            <th>花费</th>
                            <th>销售</th>
                            <th>订单</th>
                            <th>点击</th>
                            <th>ACOS</th>
                            <th>CVR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {model.selectedDailyRows.map((row) => (
                            <tr key={row.date}>
                              <td>{row.date}</td>
                              <td>{formatUsd(row.cost)}</td>
                              <td>{formatUsd(row.sales)}</td>
                              <td>{row.orders}</td>
                              <td>{row.clicks}</td>
                              <td>{formatPercent(row.acos * 100)}</td>
                              <td>{formatPercent(row.cvr * 100)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted-line">
                      当前产品还没有可回查的日级广告指标。请先完成完整 8 类报表采集并导入 DB。
                    </p>
                  )}</BusinessDataConfigurationGuard>)}

                {inspectorTab === 'timeline' && (<BusinessDataConfigurationGuard configurationRequired={businessConfigurationRequired}>{model.timeline.length ? (
                    <div className="event-timeline product-management-timeline">
                      {model.timeline.map((item) => (
                        <article className="event-card product-management-event" key={`${item.event.id}-${item.scope}`}>
                          <div className="event-card-title">
                            <strong>{item.event.eventDate} / {item.event.title}</strong>
                            <StatusPill tone={productTimelineScopeTone(item.scope)}>
                              {productTimelineScopeLabel(item.scope)}
                            </StatusPill>
                          </div>
                          <p>{item.event.eventType} / {item.event.impactExpectation || '影响待观察'}</p>
                          {item.event.notes && <p className="muted-line">{item.event.notes}</p>}
                          {item.event.evidencePath && <p className="mono-line">{item.event.evidencePath}</p>}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-line">
                      当前产品还没有产品事件或全局事件。记录 Coupon、BD、调价、Listing 或库存变化后，AI 会使用这些背景。
                    </p>
                  )}</BusinessDataConfigurationGuard>)}
              </div>

              <footer className="product-config-modal-footer">
                {inspectorTab === 'edit' ? (
                  <>
                    <WorkspaceActionButton disabledReason={'正在保存当前产品信息，请等待完成后继续。'} aria-busy={openConfigButton.ariaBusy} className={openConfigButton.className} disabled={(openConfigButton.disabled) || saving} onClick={() => navigate(routes.productConfig)} type="button">
                      {openConfigButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                      <span>{openConfigButton.label}</span>
                    </WorkspaceActionButton>
                    <WorkspaceActionButton disabledReason={saving ? '正在保存当前产品信息，请等待完成后继续。' : '请填写产品 ASIN 后保存；产品信息只写入当前店铺。'} aria-busy={saveProductButton.ariaBusy} className={saveProductButton.className} disabled={(saveProductButton.disabled) || saving} onClick={saveProduct} type="button">
                      {saveProductButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                      <span>{saveProductButton.label}</span>
                    </WorkspaceActionButton>
                  </>
                ) : (
                  <>
                    <WorkspaceActionButton disabledReason={'正在保存当前产品信息，请等待完成后继续。'} disabled={(false) || saving} className="secondary-button" onClick={() => selectInspectorTab('edit')} type="button">维护信息</WorkspaceActionButton>
                    {focusedIsLocked ? (
                      <WorkspaceActionButton disabledReason={'正在保存当前产品信息，请等待完成后继续。'} disabled={(false) || saving} className="primary-button" onClick={() => navigate(businessConfigurationRequired ? 'settings' : formalDataReady ? routes.adQuant : 'data-import-validation')} type="button">
                        {businessConfigurationRequired ? '打开店铺配置' : formalDataReady ? '进入广告表现' : '补齐逐类入库'}
                      </WorkspaceActionButton>
                    ) : (
                      <WorkspaceActionButton disabledReason={'正在保存当前产品信息，请等待完成后继续。'} disabled={(false) || saving} className="primary-button" onClick={() => lockProduct(selected.asin)} type="button">锁定为当前产品</WorkspaceActionButton>
                    )}
                  </>
                )}
              </footer>
            </div>
          )}
        </ResponsiveInspector>
      </div>
    </div>
  );
}
