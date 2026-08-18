import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export interface CanonicalDecisionFixture {
  readonly change: string;
  readonly id: string;
  readonly risk: string;
  readonly status: string;
  readonly title: string;
}

export interface CanonicalWorkspaceFixture {
  readonly batchId: string;
  readonly decisions: {
    readonly approval: readonly CanonicalDecisionFixture[];
    readonly decided: readonly CanonicalDecisionFixture[];
    readonly recommendations: readonly CanonicalDecisionFixture[];
  };
  readonly execution: {
    readonly campaign: string;
    readonly change: string;
    readonly currentBid: string;
    readonly searchTerm: string;
    readonly targetBid: string;
  };
  readonly experiment: {
    readonly analysis: string;
    readonly bidReduction: string;
    readonly hypothesis: string;
    readonly id: string;
    readonly stopCondition: string;
  };
  readonly fixtureId: string;
  readonly health: {
    readonly experimentState: string;
    readonly freshnessMinutes: number;
  };
  readonly mission: {
    readonly budgetUsd: number;
    readonly cruxCount: number;
    readonly goalAcos: string;
    readonly id: string;
    readonly observationDay: number;
    readonly observationTotal: number;
    readonly progress: number;
    readonly reportCount: number;
    readonly title: string;
  };
  readonly policy: {
    readonly budgetChangeMax: string;
    readonly id: string;
    readonly lowerBidMax: string;
    readonly raiseBidMax: string;
    readonly version: number;
  };
  readonly primaryAsin: string;
  readonly storeLabel: string;
}

const SHC001_FIXTURE: CanonicalWorkspaceFixture = {
  fixtureId: 'SHC001',
  storeLabel: 'SHC001 · 独立舱',
  primaryAsin: 'B0GTTJFQTM',
  batchId: 'BATCH-SHC001-0722',
  mission: {
    id: 'US-SP-ACOS-001',
    title: '稳定智能门锁核心搜索词花费并守住订单效率',
    progress: 64,
    goalAcos: '35%',
    budgetUsd: 120,
    observationDay: 3,
    observationTotal: 7,
    cruxCount: 2,
    reportCount: 8,
  },
  health: {
    freshnessMinutes: 18,
    experimentState: '实验观察第 3/7 天',
  },
  decisions: {
    recommendations: [
      {
        id: 'DEC-US-021',
        title: '暂停智能门锁零订单高花费搜索词',
        change: 'B0GTTJFQTM · 近 14 日花费 USD 68.40',
        risk: '需复核归因',
        status: '待判断',
      },
      {
        id: 'DEC-US-022',
        title: '降低智能门锁高花费关键词出价',
        change: 'USD 1.20 → 1.08',
        risk: '人工审批边界',
        status: '待人工审批',
      },
    ],
    approval: [
      {
        id: 'DEC-US-022',
        title: '降低智能门锁高花费关键词出价',
        change: 'USD 1.20 → 1.08',
        risk: '人工审批边界',
        status: '待人工审批',
      },
    ],
    decided: [
      {
        id: 'DEC-US-019',
        title: '保持智能门锁品牌词预算不变',
        change: 'USD 36.00 / 日',
        risk: '低风险',
        status: '已拒绝',
      },
    ],
  },
  experiment: {
    id: 'EXP-US-014',
    hypothesis: '智能门锁出价降低 10% 可改善 ACOS 且不损失订单',
    analysis: 'B0GTTJFQTM 核心词 ACOS 46.8%，高 CPC 是主要成本驱动',
    bidReduction: '10%',
    stopCondition: '订单下降 ≥ 20%',
  },
  execution: {
    searchTerm: 'smart lock bedroom',
    campaign: 'US-SP-SHC001-Exact / Core',
    currentBid: '1.20',
    targetBid: '1.08',
    change: '-10%',
  },
  policy: {
    id: 'POL-SHC001-US',
    version: 3,
    lowerBidMax: '≤ 15%',
    raiseBidMax: '≤ 10%',
    budgetChangeMax: '≤ 20%',
  },
};

const SHC002_FIXTURE: CanonicalWorkspaceFixture = {
  fixtureId: 'SHC002',
  storeLabel: 'SHC002 · 独立舱',
  primaryAsin: 'B0SHC00201',
  batchId: 'BATCH-SHC002-0722',
  mission: {
    id: 'US-SP-TACOS-002',
    title: '压低车库门开关高花费并守住转化',
    progress: 41,
    goalAcos: '32%',
    budgetUsd: 95,
    observationDay: 2,
    observationTotal: 7,
    cruxCount: 1,
    reportCount: 6,
  },
  health: {
    freshnessMinutes: 27,
    experimentState: '实验观察第 2/7 天',
  },
  decisions: {
    recommendations: [
      {
        id: 'DEC-US-121',
        title: '暂停车库门开关零转化商品投放',
        change: 'B0SHC00201 · 近 14 日花费 USD 81.60',
        risk: '需核对自然单',
        status: '待判断',
      },
      {
        id: 'DEC-US-122',
        title: '降低车库门开关宽泛词出价',
        change: 'USD 1.48 → 1.30',
        risk: '人工审批边界',
        status: '待人工审批',
      },
    ],
    approval: [
      {
        id: 'DEC-US-122',
        title: '降低车库门开关宽泛词出价',
        change: 'USD 1.48 → 1.30',
        risk: '人工审批边界',
        status: '待人工审批',
      },
    ],
    decided: [
      {
        id: 'DEC-US-119',
        title: '保留车库门开关精准词预算',
        change: 'USD 42.00 / 日',
        risk: '证据充分',
        status: '已批准',
      },
    ],
  },
  experiment: {
    id: 'EXP-US-022',
    hypothesis: '车库门开关宽泛词出价降低 12% 可收敛 TACOS',
    analysis: 'B0SHC00201 车库门词 ACOS 52.4%，宽泛匹配浪费是主要驱动',
    bidReduction: '12%',
    stopCondition: '广告订单下降 ≥ 15%',
  },
  execution: {
    searchTerm: 'garage door opener wifi',
    campaign: 'US-SP-SHC002-Garage / Broad',
    currentBid: '1.48',
    targetBid: '1.30',
    change: '-12%',
  },
  policy: {
    id: 'POL-SHC002-US',
    version: 2,
    lowerBidMax: '≤ 12%',
    raiseBidMax: '≤ 8%',
    budgetChangeMax: '≤ 15%',
  },
};

function stableStoreSuffix(storeId: string): string {
  let hash = 2166136261;
  for (const character of storeId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

function buildIsolatedFallbackFixture(
  storeContext: Pick<StoreContextEnvelope, 'businessDate' | 'storeId'> | { businessDate: string; storeId: string },
): CanonicalWorkspaceFixture {
  const suffix = stableStoreSuffix(String(storeContext.storeId));
  const asin = `B0${suffix.padStart(8, '0').slice(-8)}`;
  const batchDate = storeContext.businessDate.replaceAll('-', '').slice(-4);
  const storeLabel = '当前店铺 · 独立预览';
  return {
    fixtureId: `STORE-${suffix}`,
    storeLabel,
    primaryAsin: asin,
    batchId: `BATCH-${suffix}-${batchDate}`,
    mission: {
      id: `US-SP-${suffix}`,
      title: '建立当前店铺的独立广告事实基线',
      progress: 20,
      goalAcos: '待配置',
      budgetUsd: 0,
      observationDay: 0,
      observationTotal: 7,
      cruxCount: 0,
      reportCount: 0,
    },
    health: { freshnessMinutes: 0, experimentState: '尚未开始店铺独立实验' },
    decisions: {
      recommendations: [{ id: `DEC-${suffix}-001`, title: `核对 ${asin} 广告事实`, change: '尚无已核验数值', risk: '等待导入', status: '待判断' }],
      approval: [{ id: `DEC-${suffix}-002`, title: `确认 ${asin} 店铺边界`, change: '尚无可执行变化', risk: '等待授权', status: '待人工审批' }],
      decided: [{ id: `DEC-${suffix}-000`, title: `${asin} 尚无已处理决策`, change: '无', risk: '无', status: '只读' }],
    },
    experiment: {
      id: `EXP-${suffix}-001`,
      hypothesis: `${asin} 尚未形成可运行的店铺独立假设`,
      analysis: `${asin} 尚无已核验广告事实`,
      bidReduction: '待判断',
      stopCondition: '等待配置',
    },
    execution: {
      searchTerm: `preview-keyword-${suffix.toLowerCase()}`,
      campaign: `US-SP-${suffix} / Unconfigured`,
      currentBid: '0.00',
      targetBid: '0.00',
      change: '待判断',
    },
    policy: {
      id: `POL-${suffix}-US`,
      version: 0,
      lowerBidMax: '待配置',
      raiseBidMax: '待配置',
      budgetChangeMax: '待配置',
    },
  };
}

export function canonicalWorkspaceFixtureForStore(
  storeContext: StoreContextEnvelope | null,
): CanonicalWorkspaceFixture {
  if (!storeContext) {
    return buildIsolatedFallbackFixture({
      storeId: 'unscoped',
      businessDate: '1970-01-01',
    });
  }
  const identity = `${String(storeContext.storeId)} ${String(storeContext.browserProfileId)}`.toLowerCase();
  if (identity.includes('shc002')) {
    return SHC002_FIXTURE;
  }
  if (identity.includes('shc001') || identity.includes('store-one')) {
    return SHC001_FIXTURE;
  }
  return buildIsolatedFallbackFixture(storeContext);
}
