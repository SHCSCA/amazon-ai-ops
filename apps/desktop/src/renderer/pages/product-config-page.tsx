import { BusinessDataConfigurationNotice } from '../components/business-data-configuration';
// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { formatPercent, formatUsd } from '../formatters';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import { rendererRuntimeLog } from '../runtime-log';
import { usePageOperation } from './use-page-operation';
import type { WorkspaceOperationTicket } from '../components/workspace/use-workspace-operation';
import { type ProductCostKey, type InlineSaveStatus, type ProductConfigMetricTone, type ProductStage, DEFAULT_COST, STAGE_OPTIONS, PRODUCT_COST_FIELD_LABELS } from './product-config-contracts';
import { productCostInputHint, buildProductConfigTaskState, buildProductConfigBulkApplyState, productConfigBulkSelectionState, productConfigActionButtonView, productConfigInlineSaveLabel, productConfigRowHealthView, productConfigRowClass, productConfigMetricTone } from './product-config-presentation';
import { productConfigProductKey, buildCostInputFromProduct, toNumber, productConfigNudgeCostValue, navigate, stageLabel } from './product-config-values';

export function ProductConfigPage() {
  const { scope } = useScopeStore();
  const { data, configurationRequired } = useBusinessDataPipeline();
  const operation = usePageOperation(JSON.stringify(scope));
  const productApi = (window as any).electronAPI;
  const canSaveProduct = typeof productApi?.saveProductConfig === 'function';
  const canSaveBulk = typeof productApi?.bulkUpdateProductTargetAcos === 'function';
  const activeTicket = useRef<WorkspaceOperationTicket | null>(null);
  const productsLoadSequence = useRef(0);
  const inlineFeedbackSequence = useRef(0);
  const [runningAction, setRunningAction] = useState<'save' | 'inline' | 'bulk' | null>(null);
  const saving = operation.busy && (runningAction === 'save' || runningAction === 'inline');
  const bulkApplying = operation.busy && runningAction === 'bulk';
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirtyCostFields, setDirtyCostFields] = useState<Partial<Record<ProductCostKey, boolean>>>({});
  const [inlineSave, setInlineSave] = useState<{ field?: ProductCostKey; status: InlineSaveStatus }>({ status: 'idle' });
  const [nudgedCostField, setNudgedCostField] = useState<ProductCostKey | null>(null);
  const [bulkSelectedProductKeys, setBulkSelectedProductKeys] = useState<string[]>([]);
  const [bulkTargetAcosPercent, setBulkTargetAcosPercent] = useState(35);
  const [bulkFeedback, setBulkFeedback] = useState('');
  const [bulkFeedbackTone, setBulkFeedbackTone] = useState<ProductConfigMetricTone>('pending');
  const [editorMode, setEditorMode] = useState<'product' | 'target' | 'bulk' | null>(null);
  const nudgeTimerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState({
    asin: scope.asin || '',
    parentAsin: '',
    msku: '',
    sku: '',
    title: '',
    productStage: 'keyword_exploration' as ProductStage,
    status: 'active',
  });
  const [cost, setCost] = useState(DEFAULT_COST);
  const currentScopeProducts = useMemo(
    () => products.filter((item) => item.store_name === scope.storeName && item.marketplace_code === scope.marketplaceCode),
    [products, scope.marketplaceCode, scope.storeName],
  );
  const selectedStage = STAGE_OPTIONS.find((item) => item.value === draft.productStage);
  const grossCost = cost.purchaseCost + cost.firstLegCost + cost.fbaFee + cost.storageFee + cost.otherCost;
  const minPriceMargin = cost.minPrice > 0
    ? (cost.minPrice - grossCost - cost.minPrice * cost.referralFeeRate) / cost.minPrice
    : 0;
  const importedRows = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const costHint = productCostInputHint(cost);
  const taskState = buildProductConfigTaskState({
    asin: draft.asin,
    configuredProducts: currentScopeProducts.length,
    importedRows,
    saving: false,
  });
  const selectedBulkKeySet = useMemo(() => new Set(bulkSelectedProductKeys), [bulkSelectedProductKeys]);
  const selectedBulkProducts = useMemo(
    () => currentScopeProducts.filter((product) => selectedBulkKeySet.has(productConfigProductKey(product))),
    [currentScopeProducts, selectedBulkKeySet],
  );
  const bulkApplyState = buildProductConfigBulkApplyState({
    totalProducts: currentScopeProducts.length,
    selectedCount: selectedBulkProducts.length,
    targetAcosPercent: bulkTargetAcosPercent,
    applying: bulkApplying,
  });
  const bulkSelectionState = productConfigBulkSelectionState({
    selectedCount: selectedBulkProducts.length,
    totalProducts: currentScopeProducts.length,
  });
  const saveConfigButton = productConfigActionButtonView({
    active: operation.busy && runningAction === 'save',
    baseClassName: 'primary-button',
    busyLabel: '保存中...',
    disabled: !draft.asin.trim() || operation.busy || !operation.hasAuthority || loading || !canSaveProduct,
    label: '保存完整产品配置',
  });
  const bulkApplyButton = productConfigActionButtonView({
    active: bulkApplying,
    baseClassName: 'primary-button',
    busyLabel: '批量应用中...',
    disabled: !bulkApplyState.canApply || operation.busy || !operation.hasAuthority || loading || !canSaveBulk,
    label: bulkApplyState.primaryActionLabel,
  });
  const loadedProduct = currentScopeProducts.find((product) => (
    String(product.asin || '').trim().toUpperCase() === draft.asin.trim().toUpperCase()
  ));
  const loadedProductRowKey = loadedProduct ? productConfigProductKey(loadedProduct) : '';
  const editorBusy = operation.busy;
  const productDisabledReason = !operation.hasAuthority ? operation.blockedReason
    : editorBusy ? '当前产品操作正在处理中，请稍候。'
    : loading ? '正在读取当前店铺产品，请稍候。'
    : editorMode === 'bulk' && !canSaveBulk ? '当前应用未提供批量保存接口。'
    : editorMode !== 'bulk' && !canSaveProduct ? '当前应用未提供产品保存接口。'
    : !draft.asin.trim() ? '保存前请先填写 ASIN。' : '';
  const productConfigDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: editorBusy,
    onDismiss: closeEditor,
    open: Boolean(editorMode),
  });

  function closeEditor() {
    if (activeTicket.current?.isCurrent()) return;
    setEditorMode(null);
  }

  async function loadProducts(isCurrent = operation.capture()) {
    if (!operation.hasAuthority) { setProducts([]); setLoading(false); return; }
    const request = ++productsLoadSequence.current;
    setLoading(true);
    setError('');
    try {
      const rows = await (window as any).electronAPI?.getProducts?.();
      if (!isCurrent() || request !== productsLoadSequence.current) return;
      setProducts(Array.isArray(rows) ? rows : []);
    } catch (caught) {
      rendererRuntimeLog.error('product_config.load_failed', { error: caught });
      if (!isCurrent() || request !== productsLoadSequence.current) return;
      setError(toUserFacingError(caught, '读取产品配置失败。'));
    } finally {
      if (isCurrent() && request === productsLoadSequence.current) setLoading(false);
    }
  }

  useLayoutEffect(() => {
    inlineFeedbackSequence.current += 1;
    setProducts([]);
    setDraft({ asin: scope.asin || '', parentAsin: '', msku: '', sku: '', title: '', productStage: 'keyword_exploration', status: 'active' });
    setCost(DEFAULT_COST);
    setEditorMode(null);
    setDirtyCostFields({});
    setInlineSave({ status: 'idle' });
    setNudgedCostField(null);
    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);
    setBulkSelectedProductKeys([]);
    setBulkFeedback('');
    setMessage('');
    setError('');
  }, [operation.contextKey]);

  useEffect(() => { void loadProducts(); }, [operation.contextKey]);

  useEffect(() => () => {
    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);
  }, []);

  useEffect(() => {
    const currentKeys = new Set(currentScopeProducts.map(productConfigProductKey));
    setBulkSelectedProductKeys((current) => {
      const next = current.filter((key) => currentKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [currentScopeProducts]);

  useEffect(() => {
    if (editorMode) return;
    if (Object.values(dirtyCostFields).some(Boolean)) return;
    const targetAsin = String(scope.asin || draft.asin || '').trim().toUpperCase();
    if (!targetAsin) return;
    const product = currentScopeProducts.find((item) => String(item.asin || '').trim().toUpperCase() === targetAsin);
    if (!product) return;
    setDraft({
      asin: product.asin || '',
      parentAsin: product.parent_asin || '',
      msku: product.msku || '',
      sku: product.sku || '',
      title: product.title || '',
      productStage: product.product_stage || 'keyword_exploration',
      status: product.status || 'active',
    });
    setCost(buildCostInputFromProduct(product));
  }, [currentScopeProducts, dirtyCostFields, draft.asin, editorMode, scope.asin]);

  function loadProduct(product: any) {
    if (activeTicket.current?.isCurrent() || !operation.hasAuthority) return;
    setDraft({
      asin: product.asin || '',
      parentAsin: product.parent_asin || '',
      msku: product.msku || '',
      sku: product.sku || '',
      title: product.title || '',
      productStage: product.product_stage || 'keyword_exploration',
      status: product.status || 'active',
    });
    setCost(buildCostInputFromProduct(product));
    setDirtyCostFields({});
    setInlineSave({ status: 'idle' });
    setMessage(`已载入 ${product.asin}，成本配置如需复用请重新确认后保存。`);
  }

  function openProductEditor(product: any, mode: 'product' | 'target') {
    if (activeTicket.current?.isCurrent() || !operation.hasAuthority || loading) return;
    if (product) loadProduct(product);
    setEditorMode(mode);
  }

  function openBulkEditor() {
    if (activeTicket.current?.isCurrent() || !operation.hasAuthority || loading) return;
    if (currentScopeProducts.length && bulkSelectedProductKeys.length === 0) {
      setBulkSelectedProductKeys(currentScopeProducts.map(productConfigProductKey).filter(Boolean));
    }
    setEditorMode('bulk');
  }

  async function saveProductConfig(options: { source?: 'manual' | 'inline'; field?: ProductCostKey } = {}) {
    const ticket = operation.begin();
    if (!ticket) return;
    activeTicket.current = ticket;
    const feedbackRequest = ++inlineFeedbackSequence.current;
    setRunningAction(options.source === 'inline' ? 'inline' : 'save');
    if (options.source === 'inline' && options.field) {
      setInlineSave({ field: options.field, status: 'saving' });
    } else {
      setMessage('');
      setInlineSave({ status: 'idle' });
    }
    setError('');
    try {
      if (!draft.asin.trim()) throw new Error('请填写 ASIN。');
      const result = await (window as any).electronAPI?.saveProductConfig?.({
        product: {
          ...draft,
          asin: draft.asin.trim(),
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
        },
        cost,
      });
      if (!ticket.isCurrent()) return;
      if (!result?.success) throw new Error('保存接口没有返回成功状态。');
      if (options.source === 'inline' && options.field) {
        setDirtyCostFields((current) => ({ ...current, [options.field as ProductCostKey]: false }));
        setInlineSave({ field: options.field, status: 'saved' });
        setMessage(`${PRODUCT_COST_FIELD_LABELS[options.field]} 已保存，AI 阈值会读取新的产品边界。`);
        const isCurrent = operation.capture();
        window.setTimeout(() => { if (isCurrent() && feedbackRequest === inlineFeedbackSequence.current) setInlineSave((current) => (
          current.field === options.field && current.status === 'saved' ? { status: 'idle' } : current
        )); }, 900);
      } else {
        setDirtyCostFields({});
        setMessage('产品配置已保存。后续 AI 阶段诊断和动态阈值会优先参考产品阶段、目标 ACOS、毛利和成本边界。');
      }
      window.dispatchEvent(new Event('business-ui:data-updated'));
      await loadProducts(ticket.isCurrent);
    } catch (caught) {
      rendererRuntimeLog.error('product_config.save_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      if (options.source === 'inline' && options.field) {
        setInlineSave({ field: options.field, status: 'error' });
      }
      setError(toUserFacingError(caught, '保存产品配置失败。'));
    } finally {
      if (activeTicket.current === ticket) activeTicket.current = null;
      ticket.finish();
    }
  }

  async function save() {
    await saveProductConfig({ source: 'manual' });
  }

  function toggleBulkProduct(productKey: string, checked: boolean) {
    if (activeTicket.current?.isCurrent()) return;
    setBulkSelectedProductKeys((current) => {
      if (checked) return Array.from(new Set([...current, productKey]));
      return current.filter((key) => key !== productKey);
    });
  }

  function toggleAllBulkProducts(checked: boolean) {
    if (activeTicket.current?.isCurrent()) return;
    setBulkSelectedProductKeys(checked ? currentScopeProducts.map(productConfigProductKey).filter(Boolean) : []);
  }

  async function applyBulkTargetAcos() {
    if (!bulkApplyState.canApply || bulkApplyState.targetAcos === null) {
      setBulkFeedback(bulkApplyState.statusMessage);
      setBulkFeedbackTone(bulkApplyState.statusTone);
      return;
    }
    const targetAcos = bulkApplyState.targetAcos;
    const targetLabel = bulkApplyState.targetAcosLabel;
    const selectedRows = selectedBulkProducts;
    const ticket = operation.begin();
    if (!ticket) return;
    activeTicket.current = ticket;
    setRunningAction('bulk');
    setBulkFeedback(`正在把目标 ACOS ${targetLabel} 应用到 ${selectedRows.length} 个产品...`);
    setBulkFeedbackTone('warning');
    setError('');
    try {
      const api = (window as any).electronAPI;
      if (!api?.bulkUpdateProductTargetAcos) throw new Error('批量目标 ACOS 保存接口未暴露。');
      const result = await api.bulkUpdateProductTargetAcos({
        targetAcos,
        products: selectedRows.map((product) => ({
          asin: product.asin,
          storeName: product.store_name || scope.storeName,
          marketplaceCode: product.marketplace_code || scope.marketplaceCode,
        })),
      });
      if (!ticket.isCurrent()) return;
      if (!result?.success || result.updatedCount !== selectedRows.length) {
        throw new Error('批量目标 ACOS 未完整写入，事务已回滚。');
      }
      if (selectedRows.some((product) => String(product.asin || '').toUpperCase() === draft.asin.trim().toUpperCase())) {
        setCost((current) => ({ ...current, targetAcos }));
      }
      setBulkSelectedProductKeys([]);
      setBulkFeedback(`已把目标 ACOS ${targetLabel} 应用到 ${selectedRows.length} 个产品。`);
      setBulkFeedbackTone('ready');
      window.dispatchEvent(new Event('business-ui:data-updated'));
      await loadProducts(ticket.isCurrent);
    } catch (caught) {
      rendererRuntimeLog.error('product_config.bulk_save_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setBulkFeedback('批量应用失败，已保留勾选。');
      setBulkFeedbackTone('blocked');
      setError(toUserFacingError(caught, '批量应用目标 ACOS 失败。'));
    } finally {
      if (activeTicket.current === ticket) activeTicket.current = null;
      ticket.finish();
    }
  }

  function updateCost(key: ProductCostKey, value: string) {
    if (activeTicket.current?.isCurrent()) return;
    setCost((current) => ({ ...current, [key]: toNumber(value) }));
    setDirtyCostFields((current) => ({ ...current, [key]: true }));
    if (inlineSave.field === key && inlineSave.status !== 'saving') setInlineSave({ status: 'idle' });
  }

  function nudgeCost(key: ProductCostKey, direction: 'up' | 'down', step: string) {
    if (activeTicket.current?.isCurrent()) return;
    setCost((current) => ({ ...current, [key]: productConfigNudgeCostValue(key, current[key], direction, step) }));
    setDirtyCostFields((current) => ({ ...current, [key]: true }));
    if (inlineSave.field === key && inlineSave.status !== 'saving') setInlineSave({ status: 'idle' });
    setNudgedCostField(key);
    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = window.setTimeout(() => setNudgedCostField(null), 650);
  }

  async function commitCostField(key: ProductCostKey) {
    if (saving || !dirtyCostFields[key]) return;
    await saveProductConfig({ source: 'inline', field: key });
  }

  function renderCostInput(key: ProductCostKey, step = '0.01') {
    const status = inlineSave.field === key ? inlineSave.status : 'idle';
    const saveLabel = productConfigInlineSaveLabel(key, status);
    const feedbackLabel = saveLabel || (nudgedCostField === key ? `${PRODUCT_COST_FIELD_LABELS[key]} 已调整，失焦或回车保存` : '');
    return (
      <div className={[
        'inline-save-field',
        status !== 'idle' ? `inline-save-field-${status}` : '',
        nudgedCostField === key ? 'inline-save-field-nudged' : '',
      ].filter(Boolean).join(' ')}>
        <input
          aria-label={PRODUCT_COST_FIELD_LABELS[key]}
          title="使用上下方向键微调；失焦或回车保存。"
          type="number"
          inputMode="decimal"
          step={step}
          value={cost[key]}
          onBlur={() => { void commitCostField(key); }}
          onChange={(event) => updateCost(key, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              nudgeCost(key, event.key === 'ArrowUp' ? 'up' : 'down', step);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitCostField(key);
            }
          }}
        />
        <span className="inline-save-status" aria-live="polite">{feedbackLabel}</span>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.productConfig}
        description="查看当前范围内产品的成本、售价边界和目标 ACOS；编辑动作进入弹窗，不把表单常驻在工作台。"
      />
      {configurationRequired && <BusinessDataConfigurationNotice />}

      <TaskBanner
        description={configurationRequired ? '当前业务数据尚未读取；本地产品信息、成本和目标仍可维护。' : taskState.detail}
        meta={configurationRequired ? `${currentScopeProducts.length} 个本地产品配置 · 当前范围指标未读取` : `${currentScopeProducts.length} 个产品配置 · ${importedRows} 行当前范围指标`}
        primaryAction={{
          label: taskState.primaryActionLabel,
          disabled: editorBusy || loading || !operation.hasAuthority,
          disabledReason: productDisabledReason,
          busy: false,
          busyLabel: taskState.primaryActionBusyLabel,
          onClick: () => { if (!activeTicket.current?.isCurrent()) setEditorMode(draft.asin ? 'target' : 'product'); },
        }}
        secondaryActions={[
          { label: taskState.secondaryActionLabel, onClick: () => navigate('ad-quant'), disabled: editorBusy, disabledReason: productDisabledReason },
          { label: '补充运营事件', onClick: () => navigate('operation-events'), disabled: editorBusy, disabledReason: productDisabledReason },
        ]}
        status={draft.asin ? `当前 ${draft.asin}` : '待创建产品'}
        title={taskState.title}
        tone={draft.asin ? 'confirmed' : 'attention'}
      />
      {!editorMode && productDisabledReason && <p role="status">{productDisabledReason}</p>}

      <div className="business-stack product-config-page-stack">
        <Panel className="product-config-list-panel" title="产品目标列表" tone={currentScopeProducts.length ? 'default' : 'warning'}>
          <div className="product-config-list-head">
            <div className="product-config-list-facts" aria-label="当前产品目标概览">
              <StatusPill tone={currentScopeProducts.length ? 'ready' : 'pending'}>{currentScopeProducts.length} 个产品</StatusPill>
              <StatusPill tone={configurationRequired ? 'pending' : importedRows > 0 ? 'ready' : 'blocked'}>{configurationRequired ? '指标未读取' : `${importedRows} 行指标`}</StatusPill>
              <StatusPill tone={draft.asin ? 'ready' : 'pending'}>{draft.asin ? `当前 ${draft.asin}` : '未选产品'}</StatusPill>
            </div>
            <details className="product-config-action-menu">
              <summary>更多产品操作</summary>
              <div className="product-config-list-actions">
                <button className="secondary-button compact-button" disabled={!draft.asin || editorBusy || loading || !operation.hasAuthority} onClick={() => openProductEditor(null, 'product')} type="button">编辑信息</button>
                <button className="secondary-button compact-button" disabled={!currentScopeProducts.length || editorBusy || loading || !operation.hasAuthority} onClick={openBulkEditor} type="button">批量设置</button>
                <button className="primary-button compact-button" disabled={editorBusy || loading || !operation.hasAuthority} onClick={() => openProductEditor(null, 'product')} type="button">新建产品</button>
              </div>
            </details>
          </div>
          {message && <p className="ready-line" role="status" aria-live="polite">{message}</p>}
          {error && <p className="blocked-line">{error}</p>}
          {bulkFeedback && (
            <p className={bulkFeedbackTone === 'blocked' ? 'blocked-line' : 'ready-line'} aria-live="polite">
              {bulkFeedback}
            </p>
          )}
          <div className="table-wrap">
            <table className="business-table">
              <thead>
                <tr>
                  <th>ASIN</th>
                  <th>标题</th>
                  <th>MSKU/SKU</th>
                  <th>目标 ACOS</th>
                  <th>健康度</th>
                  <th>阶段</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {currentScopeProducts.map((product) => {
                  const productKey = productConfigProductKey(product);
                  const rowLoaded = Boolean(productKey && productKey === loadedProductRowKey);
                  const productTargetAcos = Number(product.cost?.targetAcos || 0);
                  const rowHealth = productConfigRowHealthView({
                    targetAcos: productTargetAcos,
                  });
                  return (
                    <tr className={productConfigRowClass({ bulkSelected: false, loaded: rowLoaded })} key={productKey || product.id || product.asin}>
                      <td>{product.asin}</td>
                      <td>{product.title || '-'}</td>
                      <td>{product.msku || '-'} / {product.sku || '-'}</td>
                      <td className="product-row-acos-cell">
                        <div className="product-row-target-readout">
                          <strong>{productTargetAcos > 0 ? formatPercent(productTargetAcos * 100) : '-'}</strong>
                        </div>
                      </td>
                      <td className="product-row-health-cell">
                        <div className={rowHealth.className} aria-label={rowHealth.ariaLabel}>
                          <StatusPill tone={rowHealth.tone}>{rowHealth.label}</StatusPill>
                          <span className="product-row-health-detail">{rowHealth.detail}</span>
                        </div>
                      </td>
                      <td>{stageLabel(product.product_stage)}</td>
                      <td>{product.status || '-'}</td>
                      <td>{product.updated_at || '-'}</td>
                      <td>
                        <div className="product-config-row-actions">
                          <button
                            disabled={editorBusy || loading || !operation.hasAuthority}
                            aria-pressed={rowLoaded}
                            className="secondary-button compact-button"
                            onClick={() => openProductEditor(product, 'target')}
                            type="button"
                          >
                            编辑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!currentScopeProducts.length && (
                  <tr>
                    <td colSpan={9}>{loading ? '加载中...' : '当前店铺/站点还没有产品配置。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <details className="folded-ops-panel product-config-scope-panel">
          <summary>
            <span>范围口径与后续影响</span>
            <StatusPill tone={currentScopeProducts.length ? 'ready' : 'pending'}>{scope.storeName} / {scope.marketplaceCode}</StatusPill>
          </summary>
          <div className="folded-ops-body">
            <div className="context-summary-grid compact-summary">
              <div>
                <span>工作范围</span>
                <strong>{scope.dateFrom} 至 {scope.dateTo}</strong>
                <p>{scope.storeName} / {scope.marketplaceCode} / USD；全局范围已经在顶部栏维护，本页不再重复放大。</p>
              </div>
              <div>
                <span>产品目标用途</span>
                <strong>AI 阈值和广告表现解释</strong>
                <p>产品阶段、成本、最低可接受售价、目标 ACOS/TACOS 会影响量化诊断。</p>
              </div>
              <div>
                <span>安全边界</span>
                <strong>只保存本地目标</strong>
                <p>本页不会批准建议，不会写入 Amazon Ads。</p>
              </div>
            </div>
            <div className="action-row product-config-prototype-actions">
              <button className="secondary-button" disabled={editorBusy} onClick={() => navigate('ad-quant')} type="button">
                {taskState.secondaryActionLabel}
              </button>
              <button className="secondary-button" disabled={editorBusy} onClick={() => navigate('operation-events')} type="button">
                补充运营事件
              </button>
            </div>
          </div>
        </details>
      </div>

      {editorMode && (
        <div
          className="product-config-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
          ref={productConfigDialogFocus.overlayRootRef}
          role="presentation"
        >
          <section
            aria-labelledby="product-config-editor-title"
            aria-modal="true"
            className={`product-config-modal ${editorMode === 'target' ? 'product-config-target-panel' : editorMode === 'bulk' ? 'product-config-bulk-panel' : 'product-config-basic-panel'}`}
            onMouseDown={(event) => event.stopPropagation()}
            ref={productConfigDialogFocus.surfaceRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="product-config-modal-header">
              <div>
                <span>{editorMode === 'bulk' ? bulkSelectionState.countLabel : draft.asin || '新产品'}</span>
                <h2 id="product-config-editor-title">
                  {editorMode === 'target' ? '编辑利润与广告目标' : editorMode === 'bulk' ? '批量设置目标 ACOS' : '编辑产品基础信息'}
                </h2>
              </div>
              <button className="secondary-button compact-button" disabled={editorBusy} onClick={closeEditor} type="button">关闭</button>
            </div>

            <fieldset disabled={editorBusy || !operation.hasAuthority} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {editorMode === 'product' ? (
              <div className="product-config-modal-body">
                <FormTable>
                  <FormTableRow label="ASIN" required hint="当前产品配置的主键；保存后进入 AI 阶段判断和动态阈值。">
                    <input value={draft.asin} onChange={(event) => setDraft({ ...draft, asin: event.target.value })} placeholder="例如 B0..." />
                  </FormTableRow>
                  <FormTableRow label="Parent ASIN" hint="可选；用于后续父子体汇总。">
                    <input value={draft.parentAsin} onChange={(event) => setDraft({ ...draft, parentAsin: event.target.value })} />
                  </FormTableRow>
                  <FormTableRow label="MSKU" hint="可选；便于运营识别本地 SKU。">
                    <input value={draft.msku} onChange={(event) => setDraft({ ...draft, msku: event.target.value })} />
                  </FormTableRow>
                  <FormTableRow label="SKU" hint="可选；与 ERP 或 Amazon 后台 SKU 对齐。">
                    <input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} />
                  </FormTableRow>
                  <FormTableRow label="标题" hint="产品标题只用于运营识别，不自动改写 Listing。">
                    <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="产品标题，便于运营识别" />
                  </FormTableRow>
                  <FormTableRow label="产品阶段" required hint={selectedStage?.description || '不同阶段会影响 AI 对目标 ACOS、放量和降价的解释。'}>
                    <select value={draft.productStage} onChange={(event) => setDraft({ ...draft, productStage: event.target.value as ProductStage })}>
                      {STAGE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </FormTableRow>
                  <FormTableRow label="状态" required hint="状态用于提示规则引擎是否应保守处理扩量、清货或暂停产品。">
                    <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                      <option value="active">正常运营</option>
                      <option value="paused">暂停推广</option>
                      <option value="clearance">清货</option>
                      <option value="watch">观察</option>
                    </select>
                  </FormTableRow>
                </FormTable>
                <div className="operation-hint">
                  <strong>{stageLabel(draft.productStage)}</strong>
                  <p>{selectedStage?.description}</p>
                </div>
              </div>
            ) : editorMode === 'bulk' ? (
              <div className="product-config-modal-body">
                <div className="product-bulk-toolbar product-bulk-toolbar-modal" aria-label="批量目标 ACOS 工具栏">
                  <div className="product-bulk-copy">
                    <strong>统一应用目标 ACOS</strong>
                    <p>只改本地产品目标，不批准优化建议，不执行 Amazon Ads。</p>
                  </div>
                  <div className={`product-bulk-selection product-bulk-selection-${bulkSelectionState.tone}`}>
                    <strong key={bulkSelectionState.countLabel} className={bulkSelectionState.countClassName}>
                      {bulkSelectionState.countLabel}
                    </strong>
                    <span
                      aria-hidden="true"
                      className="product-bulk-selection-progress"
                      style={bulkSelectionState.progressStyle}
                    />
                    <p className="product-bulk-selection-live" aria-live="polite">{bulkSelectionState.ariaStatus}</p>
                  </div>
                  <label className="product-bulk-input">
                    <span>目标 ACOS (%)</span>
                    <input
                      aria-label="批量目标 ACOS 百分比"
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.5"
                      value={bulkTargetAcosPercent}
                      onChange={(event) => setBulkTargetAcosPercent(toNumber(event.target.value))}
                      disabled={bulkApplying}
                    />
                  </label>
                  <StatusPill tone={bulkApplyState.statusTone}>{bulkApplyState.statusMessage}</StatusPill>
                </div>
                <div className="product-config-bulk-picker" aria-label="批量目标 ACOS 产品选择">
                  <div className="product-config-bulk-picker-head">
                    <div>
                      <strong>选择要批量更新的产品</strong>
                      <p>选择只在本弹窗内维护；主表保持只读，避免误以为勾选就已经保存。</p>
                    </div>
                    <div className="table-action-row">
                      <button
                        className="secondary-button compact-button"
                        disabled={!currentScopeProducts.length || bulkApplying}
                        onClick={() => toggleAllBulkProducts(true)}
                        type="button"
                      >
                        全选
                      </button>
                      <button
                        className="secondary-button compact-button"
                        disabled={!currentScopeProducts.length || bulkApplying || !selectedBulkProducts.length}
                        onClick={() => toggleAllBulkProducts(false)}
                        type="button"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="product-config-bulk-row-grid">
                    {currentScopeProducts.map((product) => {
                      const productKey = productConfigProductKey(product);
                      const checked = selectedBulkKeySet.has(productKey);
                      return (
                        <label className={checked ? 'product-config-bulk-row product-config-bulk-row-selected' : 'product-config-bulk-row'} key={productKey || product.id || product.asin}>
                          <input
                            aria-label={`批量选择产品 ${product.asin}`}
                            type="checkbox"
                            checked={checked}
                            disabled={bulkApplying}
                            onChange={(event) => toggleBulkProduct(productKey, event.target.checked)}
                          />
                          <span>{product.asin}</span>
                          <strong>{product.title || product.asin}</strong>
                          <small>当前目标 ACOS {formatPercent(Number(product.cost?.targetAcos || 0) * 100)}</small>
                        </label>
                      );
                    })}
                    {!currentScopeProducts.length && (
                      <p className="warning-line">当前范围暂无产品，不能批量设置目标 ACOS。</p>
                    )}
                  </div>
                </div>
                {selectedBulkProducts.length ? (
                  <div className="context-summary-grid product-config-bulk-preview">
                    <div>
                      <span>将要更新</span>
                      <strong>{selectedBulkProducts.length} 个产品</strong>
                      <p>{selectedBulkProducts.map((product) => product.asin).join('、')}</p>
                    </div>
                    <div>
                      <span>目标 ACOS</span>
                      <strong>{bulkApplyState.targetAcosLabel}</strong>
                      <p>{bulkApplyState.statusMessage}</p>
                    </div>
                    <div>
                      <span>安全边界</span>
                      <strong>只保存本地目标</strong>
                      <p>不会批准建议，不会写入 Amazon Ads。</p>
                    </div>
                  </div>
                ) : (
                  <p className="warning-line">请先在本弹窗内选择需要批量设置的产品。</p>
                )}
              </div>
            ) : (
              <div className="product-config-modal-body">
                <div className="product-target-editor">
                  <p className={cost.purchaseCost || cost.firstLegCost || cost.fbaFee || cost.minPrice ? 'muted-line product-target-editor-note' : 'warning-line product-target-editor-note'}>
                    {costHint}
                  </p>
                  <div className="context-summary-grid product-target-summary-grid">
                  <div>
                    <span>估算固定成本</span>
                    <strong>{formatUsd(grossCost)}</strong>
                    <StatusPill tone={productConfigMetricTone('grossCost', grossCost)}>{grossCost > 0 ? '已填写' : '待填写'}</StatusPill>
                  </div>
                  <div>
                    <span>最低价毛利空间</span>
                    <strong>{formatPercent(minPriceMargin * 100)}</strong>
                    <StatusPill tone={productConfigMetricTone('margin', cost.minPrice > 0 ? minPriceMargin : Number.NaN)}>
                      {cost.minPrice > 0 ? '实时判定' : '待售价'}
                    </StatusPill>
                  </div>
                  <div>
                    <span>目标 ACOS</span>
                    <strong>{formatPercent(cost.targetAcos * 100)}</strong>
                    <StatusPill tone={productConfigMetricTone('targetAcos', cost.targetAcos)}>实时目标</StatusPill>
                  </div>
                  <div>
                    <span>目标 TACOS</span>
                    <strong>{formatPercent(cost.targetTacos * 100)}</strong>
                    <StatusPill tone={productConfigMetricTone('targetTacos', cost.targetTacos)}>实时目标</StatusPill>
                  </div>
                </div>
                  <div className="product-target-field-groups">
                    <section className="product-target-field-group" aria-labelledby="product-target-cost-heading">
                      <header>
                        <span>01</span>
                        <div>
                          <h3 id="product-target-cost-heading">成本构成</h3>
                          <p>只维护产品本地成本口径，用于毛利和最低价判断。</p>
                        </div>
                      </header>
                      <div className="product-target-field-grid">
                        <label className="product-target-field-cell">
                          <span>采购成本</span>
                          {renderCostInput('purchaseCost')}
                          <small>商品采购成本，单位 USD。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>头程费用</span>
                          {renderCostInput('firstLegCost')}
                          <small>头程、清关或入仓前费用。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>FBA 费用</span>
                          {renderCostInput('fbaFee')}
                          <small>亚马逊履约费用。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>推荐费率</span>
                          {renderCostInput('referralFeeRate')}
                          <small>小数格式，例如 0.15 表示 15%。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>仓储费</span>
                          {renderCostInput('storageFee')}
                          <small>可按单件或估算值维护。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>其他成本</span>
                          {renderCostInput('otherCost')}
                          <small>包装、售后或额外成本。</small>
                        </label>
                      </div>
                    </section>

                    <section className="product-target-field-group" aria-labelledby="product-target-price-heading">
                      <header>
                        <span>02</span>
                        <div>
                          <h3 id="product-target-price-heading">售价与利润</h3>
                          <p>这里不改 Amazon 售价，只给 AI 和运营判断价格边界。</p>
                        </div>
                      </header>
                      <div className="product-target-field-grid product-target-field-grid-compact">
                        <label className="product-target-field-cell">
                          <span>当前售价</span>
                          {renderCostInput('currentPrice')}
                          <small>运营判断当前价格口径。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>最低可接受售价</span>
                          {renderCostInput('minPrice')}
                          <small>用于估算最低毛利空间。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>目标净利率</span>
                          {renderCostInput('targetNetMargin')}
                          <small>小数格式，例如 0.15。</small>
                        </label>
                      </div>
                    </section>

                    <section className="product-target-field-group" aria-labelledby="product-target-ad-heading">
                      <header>
                        <span>03</span>
                        <div>
                          <h3 id="product-target-ad-heading">广告目标</h3>
                          <p>这些目标会参与广告表现解释和建议阈值，不会直接执行广告。</p>
                        </div>
                      </header>
                      <div className="product-target-field-grid product-target-field-grid-compact">
                        <label className="product-target-field-cell">
                          <span>目标 ACOS</span>
                          {renderCostInput('targetAcos')}
                          <small>产品级广告目标，小数格式。</small>
                        </label>
                        <label className="product-target-field-cell">
                          <span>目标 TACOS</span>
                          {renderCostInput('targetTacos')}
                          <small>总销售接入后用于整体预算约束。</small>
                        </label>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}

            </fieldset>
            {productDisabledReason && <p role="status">{productDisabledReason}</p>}
            <div className="product-config-modal-footer">
              {editorMode === 'bulk' ? (
                <>
                  <button
                    className={bulkApplyButton.className}
                    type="button"
                    disabled={bulkApplyButton.disabled}
                    aria-busy={bulkApplyButton.ariaBusy}
                    onClick={() => { void applyBulkTargetAcos(); }}
                  >
                    {bulkApplyButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{bulkApplyButton.label}</span>
                  </button>
                  <button className="secondary-button" disabled={editorBusy} onClick={closeEditor} type="button">关闭</button>
                </>
              ) : (
                <>
                  <button aria-busy={saveConfigButton.ariaBusy} className={saveConfigButton.className} disabled={saveConfigButton.disabled} onClick={save} type="button">
                    {saveConfigButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{saveConfigButton.label}</span>
                  </button>
                  <button className="secondary-button" disabled={editorBusy} onClick={closeEditor} type="button">关闭</button>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export { DEFAULT_COST, type ProductConfigActionButtonView, type ProductConfigLoadButtonView, type ProductConfigRowTargetAcosView, type ProductConfigRowHealthView } from './product-config-contracts';

export { productConfigActionButtonView, productConfigRowClass, productConfigLoadButtonView, productConfigRowTargetAcosView, productConfigRowHealthView, productCostInputHint, productConfigInlineSaveLabel, productConfigMetricTone, buildProductConfigTaskState, productConfigBulkSelectionState, buildProductConfigBulkApplyState } from './product-config-presentation';

export { buildCostInputFromProduct, isProductConfigAutoSaveField, productConfigNudgeCostValue, normalizeProductConfigAcosPercent, productConfigProductKey, buildProductConfigBulkSaveInput } from './product-config-values';
