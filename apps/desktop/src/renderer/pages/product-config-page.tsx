import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { formatPercent, formatUsd } from '../formatters';
import { useScopeStore } from '../scope-store';
import type { AppRoute } from '../types';
import { toUserFacingError } from '../user-facing-error';

type ProductStage = 'cold_start' | 'keyword_exploration' | 'stable_conversion' | 'scaling' | 'profit_harvesting' | 'declining_repair';

const STAGE_OPTIONS: Array<{ value: ProductStage; label: string; description: string }> = [
  { value: 'cold_start', label: '冷启动', description: '数据少，允许适度试错，但要严格观察点击和首单。' },
  { value: 'keyword_exploration', label: '测词期', description: '重点找有效搜索词，阈值可比利润期宽松。' },
  { value: 'stable_conversion', label: '稳定转化', description: '已有稳定订单，重点控 ACOS 和预算效率。' },
  { value: 'scaling', label: '放量期', description: '可接受阶段性更高 ACOS，但必须跟踪库存和转化。' },
  { value: 'profit_harvesting', label: '利润收割', description: '严格控制 ACOS，优先降本和保利润。' },
  { value: 'declining_repair', label: '异常修复', description: '转化或 ACOS 异常，优先排查价格、库存、Listing 和流量质量。' },
];

const DEFAULT_COST = {
  purchaseCost: 0,
  firstLegCost: 0,
  fbaFee: 0,
  referralFeeRate: 0.15,
  storageFee: 0,
  otherCost: 0,
  minPrice: 0,
  targetNetMargin: 0.15,
  targetAcos: 0.35,
  targetTacos: 0.12,
};

type ProductCostInput = typeof DEFAULT_COST;

export function productCostInputHint(cost: ProductCostInput): string {
  const hasRealCostOrPrice = [
    cost.purchaseCost,
    cost.firstLegCost,
    cost.fbaFee,
    cost.storageFee,
    cost.otherCost,
    cost.minPrice,
  ].some((value) => Number(value || 0) > 0);
  if (!hasRealCostOrPrice) {
    return '当前成本和最低售价仍像默认值；保存前请替换为真实采购、物流、FBA、售价和利润目标，避免 AI 阈值被模板数字误导。';
  }
  return '已填写成本或最低售价；保存前请确认这些数字来自当前产品。';
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stageLabel(stage?: string): string {
  return STAGE_OPTIONS.find((item) => item.value === stage)?.label || stage || '未配置';
}

export function ProductConfigPage() {
  const { scope } = useScopeStore();
  const { data } = useBusinessDataPipeline();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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

  async function loadProducts() {
    setLoading(true);
    setError('');
    try {
      const rows = await (window as any).electronAPI?.getProducts?.();
      setProducts(Array.isArray(rows) ? rows : []);
    } catch (caught) {
      setError(toUserFacingError(caught, '读取产品配置失败。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      asin: current.asin || scope.asin || '',
    }));
    loadProducts();
  }, [scope.asin, scope.storeName, scope.marketplaceCode]);

  function loadProduct(product: any) {
    setDraft({
      asin: product.asin || '',
      parentAsin: product.parent_asin || '',
      msku: product.msku || '',
      sku: product.sku || '',
      title: product.title || '',
      productStage: product.product_stage || 'keyword_exploration',
      status: product.status || 'active',
    });
    setMessage(`已载入 ${product.asin}，成本配置如需复用请重新确认后保存。`);
  }

  async function save() {
    setSaving(true);
    setMessage('');
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
      if (!result?.success) throw new Error('保存接口没有返回成功状态。');
      setMessage('产品配置已保存。后续 AI 阶段诊断和动态阈值会优先参考产品阶段、目标 ACOS、毛利和成本边界。');
      window.dispatchEvent(new Event('business-ui:data-updated'));
      await loadProducts();
    } catch (caught) {
      setError(toUserFacingError(caught, '保存产品配置失败。'));
    } finally {
      setSaving(false);
    }
  }

  function updateCost(key: keyof typeof cost, value: string) {
    setCost((current) => ({ ...current, [key]: toNumber(value) }));
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="产品配置"
        description="维护产品阶段、成本、利润目标和广告目标。AI 量化阈值不能只看固定 ACOS，必须结合产品所处阶段和利润空间。"
        primaryTask="补齐产品阶段与利润约束"
        nextAction={draft.asin ? '保存产品配置' : '填写 ASIN'}
      />

      <div className="business-stack">
        <Panel title="当前范围产品配置" tone="warning">
          <div className="business-split">
            <div>
              <div className="business-scope-line">
                {scope.dateFrom} 至 {scope.dateTo} / {scope.storeName} / {scope.marketplaceCode} / USD
              </div>
              <p className="muted-line">
                当前范围已有 {importedRows} 行广告指标。产品阶段和利润目标会进入 AI 阶段判断，帮助决定目标 ACOS、高风险 ACOS、无订单点击和最低花费阈值。
              </p>
            </div>
            <StatusPill tone={currentScopeProducts.length ? 'ready' : 'pending'}>已配置产品 {currentScopeProducts.length}</StatusPill>
          </div>
        </Panel>

        <Panel title="产品基础信息">
          <div className="form-grid form-grid-four">
            <label>
              ASIN
              <input value={draft.asin} onChange={(event) => setDraft({ ...draft, asin: event.target.value })} placeholder="例如 B0..." />
            </label>
            <label>
              Parent ASIN
              <input value={draft.parentAsin} onChange={(event) => setDraft({ ...draft, parentAsin: event.target.value })} />
            </label>
            <label>
              MSKU
              <input value={draft.msku} onChange={(event) => setDraft({ ...draft, msku: event.target.value })} />
            </label>
            <label>
              SKU
              <input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} />
            </label>
            <label className="form-span-two">
              标题
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="产品标题，便于运营识别" />
            </label>
            <label>
              产品阶段
              <select value={draft.productStage} onChange={(event) => setDraft({ ...draft, productStage: event.target.value as ProductStage })}>
                {STAGE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="active">正常运营</option>
                <option value="paused">暂停推广</option>
                <option value="clearance">清货</option>
                <option value="watch">观察</option>
              </select>
            </label>
          </div>
          <div className="operation-hint">
            <strong>{stageLabel(draft.productStage)}</strong>
            <p>{selectedStage?.description}</p>
          </div>
        </Panel>

        <Panel title="利润与广告目标">
          <p className={cost.purchaseCost || cost.firstLegCost || cost.fbaFee || cost.minPrice ? 'muted-line' : 'warning-line'}>
            {costHint}
          </p>
          <div className="form-grid form-grid-four">
            <label>采购成本<input type="number" step="0.01" value={cost.purchaseCost} onChange={(event) => updateCost('purchaseCost', event.target.value)} /></label>
            <label>头程费用<input type="number" step="0.01" value={cost.firstLegCost} onChange={(event) => updateCost('firstLegCost', event.target.value)} /></label>
            <label>FBA 费用<input type="number" step="0.01" value={cost.fbaFee} onChange={(event) => updateCost('fbaFee', event.target.value)} /></label>
            <label>推荐费率<input type="number" step="0.01" value={cost.referralFeeRate} onChange={(event) => updateCost('referralFeeRate', event.target.value)} /></label>
            <label>仓储费<input type="number" step="0.01" value={cost.storageFee} onChange={(event) => updateCost('storageFee', event.target.value)} /></label>
            <label>其他成本<input type="number" step="0.01" value={cost.otherCost} onChange={(event) => updateCost('otherCost', event.target.value)} /></label>
            <label>最低售价<input type="number" step="0.01" value={cost.minPrice} onChange={(event) => updateCost('minPrice', event.target.value)} /></label>
            <label>目标净利率<input type="number" step="0.01" value={cost.targetNetMargin} onChange={(event) => updateCost('targetNetMargin', event.target.value)} /></label>
            <label>目标 ACOS<input type="number" step="0.01" value={cost.targetAcos} onChange={(event) => updateCost('targetAcos', event.target.value)} /></label>
            <label>目标 TACOS<input type="number" step="0.01" value={cost.targetTacos} onChange={(event) => updateCost('targetTacos', event.target.value)} /></label>
          </div>
          <div className="context-summary-grid">
            <div>
              <span>估算固定成本</span>
              <strong>{formatUsd(grossCost)}</strong>
              <p>采购、头程、FBA、仓储和其他成本之和。</p>
            </div>
            <div>
              <span>最低售价毛利空间</span>
              <strong>{formatPercent(minPriceMargin * 100)}</strong>
              <p>扣除固定成本和推荐费后的粗略空间，用于判断广告 ACOS 上限。</p>
            </div>
            <div>
              <span>目标 ACOS</span>
              <strong>{formatPercent(cost.targetAcos * 100)}</strong>
              <p>AI 动态阈值会把它作为产品级目标，而不是只用全局默认值。</p>
            </div>
            <div>
              <span>目标 TACOS</span>
              <strong>{formatPercent(cost.targetTacos * 100)}</strong>
              <p>后续接入总销售后可用于广告整体预算约束。</p>
            </div>
          </div>
          <div className="action-row">
            <button className="primary-button" disabled={saving || !draft.asin.trim()} onClick={save} type="button">
              {saving ? '保存中...' : '保存产品配置'}
            </button>
            <button className="secondary-button" onClick={() => navigate('operation-events')} type="button">补充运营事件</button>
            <button className="secondary-button" onClick={() => navigate('ad-quant')} type="button">进入广告量化</button>
          </div>
          {message && <p className="ready-line">{message}</p>}
          {error && <p className="blocked-line">{error}</p>}
        </Panel>

        <Panel title="当前范围产品列表" tone={currentScopeProducts.length ? 'default' : 'warning'}>
          <div className="table-wrap">
            <table className="business-table">
              <thead>
                <tr>
                  <th>ASIN</th>
                  <th>标题</th>
                  <th>MSKU/SKU</th>
                  <th>阶段</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {currentScopeProducts.map((product) => (
                  <tr key={product.id}>
                    <td>{product.asin}</td>
                    <td>{product.title || '-'}</td>
                    <td>{product.msku || '-'} / {product.sku || '-'}</td>
                    <td>{stageLabel(product.product_stage)}</td>
                    <td>{product.status || '-'}</td>
                    <td>{product.updated_at || '-'}</td>
                    <td><button className="secondary-button compact-button" onClick={() => loadProduct(product)} type="button">载入编辑</button></td>
                  </tr>
                ))}
                {!currentScopeProducts.length && (
                  <tr>
                    <td colSpan={7}>{loading ? '加载中...' : '当前店铺/站点还没有产品配置。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
