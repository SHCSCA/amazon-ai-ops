import React, { useState, useEffect, useCallback } from 'react';
import { create } from 'zustand';
import { toUserFacingError } from './user-facing-error';

// Types
interface AppState {
  isLoggedIn: boolean;
  currentStore: string;
  loginSession?: LoginSessionInfo | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  setLoginState: (isLoggedIn: boolean, store?: string, loginSession?: LoginSessionInfo | null) => void;
}

interface LoginSessionInfo {
  erpSessionReused?: boolean;
  adsEntryMode?: string;
  adsUrl?: string;
  adsTitle?: string;
}

interface RuleConfig {
  targetAcos: number;
  maxCpc: number;
  noOrderClickThreshold: number;
  highAcosThreshold: number;
  enableAutoLowerBid: boolean;
  enableAutoAddNegative: boolean;
}

interface Recommendation {
  id: number;
  actionType: string;
  entityType?: string;
  entityName: string;
  currentValue?: string;
  recommendedValue?: string;
  reason: string;
  acos: number;
  clicks: number;
  cost: number;
  riskLevel: string;
  status: string;
  confidence: number;
  evidence?: {
    date?: string;
    portfolioName?: string;
    campaignName?: string;
    adGroupName?: string;
    asin?: string;
    targeting?: string;
    searchTerm?: string;
    matchType?: string;
    explanationSource?: 'ai' | 'rule';
    aiExplanation?: string;
    aiRiskWarnings?: string[];
    aiAlternativeSuggestions?: string[];
    aiFallbackReason?: string;
    acos: number;
    cost: number;
    clicks: number;
  };
}

interface AdReadbackFormState {
  targetStoreName: string;
  targetMarketplaceCode: string;
  targetPortfolioName: string;
  targetAsin: string;
  targetMetricDate: string;
  targetCampaignName: string;
  targetAdGroupName: string;
  targetEntityType: string;
  targetEntityName: string;
  targetActionType: string;
  sourceRecommendationId: string;
  sourceEvidencePath: string;
  sourceEntityType: string;
  sourceCurrentValue: string;
  sourceRecommendedValue: string;
  operatorConfirmed: boolean;
  realWriteApproved: boolean;
  allowedByPolicy: boolean;
  executionSuccess: boolean;
  executionVerified: boolean;
  readbackVerified: boolean;
  approverName: string;
  approvalArtifactPath: string;
  approvalConfirmedAt: string;
  executedBy: string;
  liveBidSourceNote: string;
  beforeValue: string;
  beforeCapturedAt: string;
  afterValue: string;
  afterCapturedAt: string;
  beforeScreenshotPath: string;
  afterScreenshotPath: string;
  readbackActualValue: string;
  readbackMethod: string;
  readbackReadAt: string;
  readbackEvidencePath: string;
  executionId: string;
  executionExecutedAt: string;
  riskRationale: string;
}

type DeliveryGateStatus = 'passed' | 'blocked' | 'pending' | 'warning';
type V15Section = 'delivery' | 'reports' | 'keywords' | 'listing';

interface DeliveryGateItem {
  name: string;
  status: DeliveryGateStatus;
  detail: string;
}

const DELIVERY_GATE_LABELS: Record<DeliveryGateStatus, string> = {
  passed: '通过',
  blocked: '阻塞',
  pending: '待验证',
  warning: '需复核',
};

const PRODUCT_DELIVERY_GATES: DeliveryGateItem[] = [
  {
    name: '领星广告报表采集',
    status: 'passed',
    detail: '历史验收快照已通过；当前范围仍需按下方任务流刷新页面诊断和采集证据',
  },
  {
    name: '广告指标口径',
    status: 'warning',
    detail: '默认 KPI 不跨 campaign/ad_group/placement/advertised_product/search_term 重复相加；总盘需以单一权威报表或对账脚本为准',
  },
  {
    name: 'DeepSeek / AI 连接',
    status: 'passed',
    detail: '真实 DeepSeek live evidence 已通过；证据文件已脱敏且不保存真实 Key',
  },
  {
    name: '广告建议 AI 解释',
    status: 'passed',
    detail: '安装版已生成 explanationSource=ai 的广告建议解释证据，并通过 verify:ad-ai-explanation',
  },
  {
    name: 'Listing 读取',
    status: 'passed',
    detail: '真实领星 Listing 列表页到编辑页只读读取已验证；标题、五点和后台词完整证据已通过验收',
  },
  {
    name: 'Listing AI 草案',
    status: 'passed',
    detail: 'Listing AI 草案已证明 source=ai、无 fallback、含 AI reason，并通过 verify:listing-ai-draft',
  },
  {
    name: '广告执行',
    status: 'passed',
    detail: '已完成一次真实低风险样例：暂停活动 target 出价 1.20 -> 1.08，并通过 before/after/reload readback 验证；后续每个广告动作仍必须逐项审批和回读',
  },
];

const VERIFIED_DELIVERY_SNAPSHOT = {
  title: '已验证交付快照',
  scope: '2026-05-01 至 2026-05-25 / FT-US-US / US',
  batchId: 'batch_20260609045655853_ft8uda',
  reportCount: '8/8 报表已下载，0 失败',
  listing: 'Listing 详情只读读取已通过，同 ASIN、标题、10 条五点和后台词完整',
};

const SCOPE_PRESETS = [
  {
    id: 'verified-full8-2026-05',
    label: '已验证 full-8 范围',
    description: '2026-05-01 至 2026-05-25 / FT-US-US / US',
    start: '2026-05-01',
    end: '2026-05-25',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
  },
];

const CURRENT_SAFE_MODE_ITEMS = [
  '真实 AI 证据已通过：证据文件脱敏，应用不在交付包中保存 API Key',
  '不会提交 Amazon Listing：建议、草案和复制都停留在本地',
  '广告执行不做批量自动写入：每个动作必须绑定具体店铺/站点/campaign/ad group/对象，并独立审批、截图和回读',
];

const PRODUCT_EVIDENCE_ITEMS = [
  {
    name: '最终就绪聚合（manifest 驱动）',
    status: 'APP_READY',
    detail: 'manifest: output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json -> final: output\\codex-evidence\\final-readiness-2026-06-10.json；final JSON 必须记录 evidenceSelection.mode=manifest',
  },
  {
    name: '交付证据包',
    status: '待刷新 READY 包',
    detail: 'output\\delivery-bundles\\v15-delivery-bundle-2026-06-10；需在最终节点重新导出',
  },
  {
    name: '8 报表验收',
    status: '通过',
    detail: 'desktop-live-full-8-e2e-2026-06-09.json / batch_20260609045655853_ft8uda',
  },
  {
    name: 'Listing 详情读取',
    status: '通过',
    detail: 'source-listing-read-detail-probe-2026-06-09-merged-detail.json',
  },
  {
    name: 'DeepSeek / AI live',
    status: '通过',
    detail: 'deepseek-live-1781066552798.json',
  },
  {
    name: '广告建议 AI 解释',
    status: '通过',
    detail: 'installed-ad-ai-explanation-user-key-2026-06-10.json',
  },
  {
    name: 'Listing AI 草案',
    status: '通过',
    detail: 'installed-listing-ai-draft-user-key-2026-06-10.json',
  },
  {
    name: '真实广告 readback',
    status: '通过',
    detail: 'real-ad-execution-readback-candidate-rec-1.json；暂停 target 1.20 -> 1.08，reload 回读 1.08',
  },
];

const PRODUCT_NEXT_ACTIONS = [
  '把广告 readback 前端从单一样例改成通用目标录入，避免绑定一个 ASIN 或广告组',
  '刷新 product smoke 和 READY 证据包，淘汰旧 APP_NEEDS_WORK 文案',
  '最终节点再跑全量测试、typecheck、Windows 打包、安装包 hash 和最终验收矩阵',
];

const AI_ACCEPTANCE_COMMANDS = [
  '$env:DEEPSEEK_API_KEY="<your-deepseek-key>"',
  'pnpm run verify:ai-live',
  'pnpm run run:v15-installed-live -- --mode ad-ai-explanation --out output\\codex-evidence\\installed-ad-ai-explanation-manual.json',
  'pnpm run verify:ad-ai-explanation -- output\\codex-evidence\\installed-ad-ai-explanation-manual.json',
  'pnpm run run:v15-installed-live -- --mode listing-ai-draft --source-app --out output\\codex-evidence\\installed-listing-ai-draft-manual.json',
  'pnpm run verify:listing-ai-draft -- output\\codex-evidence\\installed-listing-ai-draft-manual.json',
];

const FINAL_ACCEPTANCE_COMMANDS = [
  'pnpm run write:v15-evidence-manifest -- --out output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json',
  'pnpm run verify:v15-final-readiness -- --evidence-manifest output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json --out output\\codex-evidence\\final-readiness-2026-06-10.json',
  'pnpm run export:v15-delivery-bundle -- --final-readiness output\\codex-evidence\\final-readiness-2026-06-10.json --out output\\delivery-bundles\\v15-delivery-bundle-2026-06-10',
];

const AD_READBACK_ACCEPTANCE_COMMANDS = [
  'pnpm run create:ad-readback-template -- --out output\\codex-evidence\\real-ad-execution-readback-manual.json --md-out output\\codex-evidence\\real-ad-execution-readback-manual.md',
  'pnpm run verify:ad-readback -- output\\codex-evidence\\real-ad-execution-readback-candidate-rec-1.json',
  'pnpm run write:v15-evidence-manifest -- --ad-readback output\\codex-evidence\\real-ad-execution-readback-candidate-rec-1.json --out output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json',
  'pnpm run verify:v15-final-readiness -- --evidence-manifest output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json --out output\\codex-evidence\\final-readiness-2026-06-10.json',
];

const AD_READBACK_RUNBOOK_PATH = 'docs\\REAL_AD_READBACK_RUNBOOK.md';

const AD_READBACK_RUNBOOK_CLIPBOARD = [
  'Real Ad Readback Runbook',
  `Runbook: ${AD_READBACK_RUNBOOK_PATH}`,
  '',
  'Verified sample: FT-US-US / US / B0GTTJFQTM / D6-自动-低价探索 - 5/18/2026 / D6-自动-卧室室内-挖词 - 5/18/2026 / editable target=紧密匹配 / lower_bid / 1.20 -> 1.08 / PASS.',
  'Generic rule: do not execute if the exact editable target row cannot be found, approval proof is missing, or the action increases budget/bid/traffic.',
  'Before execution: fill dynamic target fields, approval, approver, approval artifact, before.value, before screenshot, live bid source, and allowedByPolicy.',
  'After execution: fill manual_ads_ui execution proof, after.value, after screenshot, readback.actualValue, readback evidence, and ordered timestamps.',
  'Timestamp order: approval <= before <= execution <= after <= readback.',
  'Final gate: pnpm run verify:ad-readback -- output\\codex-evidence\\real-ad-execution-readback-candidate-rec-1.json',
].join('\n');

const AD_READBACK_CANDIDATE_SCOPE = [
  { label: '候选包', value: 'real-ad-execution-readback-candidate-rec-1.json / .md' },
  { label: '状态', value: 'PASS / 真实审批 + before/after/reload 回读已验证' },
  { label: '店铺 / 站点', value: 'FT-US-US / US' },
  { label: 'ASIN', value: 'B0GTTJFQTM' },
  { label: '广告活动', value: 'D6-自动-低价探索 - 5/18/2026' },
  { label: '广告组', value: 'D6-自动-卧室室内-挖词 - 5/18/2026' },
  { label: '可执行对象', value: 'editable target=紧密匹配；不是只读 search term 行' },
  { label: '动作', value: 'lower_bid；现场 live bid 1.20 -> 1.08' },
  { label: '来源建议', value: 'source search_term: 2.40 -> 2.16；仅作建议来源，不是现场 bid' },
];

const AD_READBACK_GENERALIZATION_RULES = [
  '样例只证明一条暂停 target 可被安全执行和回读，不代表后续动作可以复用同一 campaign/ad group。',
  '每个待执行建议都必须从推荐行或现场 Ads UI 带入自己的店铺、站点、广告组合、campaign、ad group、ASIN、对象类型、对象名和动作。',
  '支持的低风险动作必须保持在 lower_bid、pause_target、add_negative_exact/phrase/broad；不支持提高出价、增加预算、创建活动或扩大流量。',
  'before/after/readback 永远以现场 Ads UI 或等价只读回读为准，报表 CPC/建议值只能作为 source，不允许直接当 live bid。',
];

const DEFAULT_AD_READBACK_FORM: AdReadbackFormState = {
  targetStoreName: '',
  targetMarketplaceCode: '',
  targetPortfolioName: '',
  targetAsin: '',
  targetMetricDate: '',
  targetCampaignName: '',
  targetAdGroupName: '',
  targetEntityType: 'target',
  targetEntityName: '',
  targetActionType: 'lower_bid',
  sourceRecommendationId: '',
  sourceEvidencePath: '',
  sourceEntityType: '',
  sourceCurrentValue: '',
  sourceRecommendedValue: '',
  operatorConfirmed: false,
  realWriteApproved: false,
  allowedByPolicy: false,
  executionSuccess: false,
  executionVerified: false,
  readbackVerified: false,
  approverName: '',
  approvalArtifactPath: '',
  approvalConfirmedAt: '',
  executedBy: '',
  liveBidSourceNote: '',
  beforeValue: '',
  beforeCapturedAt: '',
  afterValue: '',
  afterCapturedAt: '',
  beforeScreenshotPath: '',
  afterScreenshotPath: '',
  readbackActualValue: '',
  readbackMethod: 'Ads UI reload',
  readbackReadAt: '',
  readbackEvidencePath: '',
  executionId: '',
  executionExecutedAt: '',
  riskRationale: '低风险广告动作；不增加预算、不提高出价、不创建活动、不扩大流量；需人工确认可回滚。',
};

const AD_READBACK_LIVE_FIELDS = [
  'live campaign matched',
  'live ad group matched',
  'live editable target row found',
  'bid input/save control visible',
  'before.value from Ads UI',
  'after.value from Ads UI',
  'readback.actualValue equals after.value',
  'executionId + success + verified',
];

const AD_READBACK_CANDIDATE_WARNINGS = [
  '该样例已通过 verifier，但只能作为验收样例，不能硬编码为唯一可执行对象。',
  '后续任意品、广告组或投放对象都必须重新绑定动态目标字段，并生成自己的审批、before、after 和 readback 证据。',
  'before.value 和 after.value 必须来自现场 Ads UI 回读，不能直接使用来源 CPC 或历史报表建议值。',
  '如果现场只有只读搜索词行、没有 bid 输入或保存控件，该建议不允许按广告写入处理。',
];

const AD_READBACK_TEMPLATE_FIELDS = [
  'realWriteApproved=true + operator approval scope + approver artifact',
  'target campaign/ad group/entity/action',
  'risk.allowedByPolicy=true',
  'before/after live values and screenshots',
  'readback.verified=true with actualValue + evidencePath',
  'execution.success=true + verified=true + manual_ads_ui',
];

const AD_READBACK_WORKFLOW_STEPS: DeliveryGateItem[] = [
  {
    name: '审批建议',
    status: 'passed',
    detail: '已完成一次用户明确审批；后续每条建议仍需自己的审批范围',
  },
  {
    name: '限定低风险动作',
    status: 'passed',
    detail: '当前 PASS 样例为暂停活动 lower_bid；通用合同只允许降低出价、暂停投放或添加否定词',
  },
  {
    name: '真实写入 + 前后截图',
    status: 'passed',
    detail: '已保存 before/after 截图和值快照；后续对象必须逐条重复该证据链',
  },
  {
    name: '回读验收',
    status: 'passed',
    detail: 'reload 后回读 1.08 并通过 verify:ad-readback；最终聚合已可接受该证据',
  },
];

const AD_READBACK_REQUIRED_EVIDENCE = [
  'operatorConfirmed + scope + approver + artifact + confirmedAt',
  'store/site/campaign/ad group/entity/action',
  'low-risk action + allowedByPolicy',
  'before/after value changed + screenshots',
  'readback.actualValue equals after.value + evidencePath',
  'execution.success=true + verified=true + performedBy + appExecutorUsed=false',
  'approval <= before <= execution <= after <= readback',
];

function hasReadbackText(value: string): boolean {
  return value.trim().length > 0;
}

function isParseableTimestamp(value: string): boolean {
  return hasReadbackText(value) && !Number.isNaN(Date.parse(value));
}

function getAdReadbackPrecheck(form: AdReadbackFormState): { blockers: string[]; ready: boolean } {
  const blockers: string[] = [];
  const requireFlag = (ok: boolean, label: string) => {
    if (!ok) blockers.push(label);
  };
  const requireText = (value: string, label: string) => {
    if (!hasReadbackText(value)) blockers.push(label);
  };

  requireFlag(form.operatorConfirmed, '缺审批人确认范围');
  requireFlag(form.realWriteApproved, '缺外部审批允许人工 Ads UI 动作');
  requireFlag(form.allowedByPolicy, '缺低风险策略允许');
  requireFlag(form.executionSuccess, '缺人工 Ads UI 执行确认');
  requireFlag(form.executionVerified, '缺执行核验');
  requireFlag(form.readbackVerified, '缺回读核验');
  requireText(form.targetStoreName, '缺执行目标店铺');
  requireText(form.targetMarketplaceCode, '缺执行目标站点');
  requireText(form.targetCampaignName, '缺 campaign');
  requireText(form.targetAdGroupName, '缺 ad group');
  requireText(form.targetEntityType, '缺对象类型');
  requireText(form.targetEntityName, '缺对象名称');
  requireText(form.targetActionType, '缺动作类型');
  requireText(form.approverName, '缺审批人');
  requireText(form.approvalArtifactPath, '缺审批凭证路径/编号');
  requireText(form.executedBy, '缺执行人');
  requireText(form.beforeValue, '缺 before live bid');
  requireText(form.afterValue, '缺 after live bid');
  requireText(form.readbackActualValue, '缺 readback actual');
  requireText(form.beforeScreenshotPath, '缺 before screenshot path');
  requireText(form.afterScreenshotPath, '缺 after screenshot path');
  requireText(form.readbackEvidencePath, '缺 readback evidence path');
  requireText(form.liveBidSourceNote, '缺 live bid row proof');
  requireText(form.executionId, '缺 execution id');
  requireText(form.riskRationale, '缺低风险说明');

  if (hasReadbackText(form.beforeValue) && hasReadbackText(form.afterValue) && form.beforeValue === form.afterValue) {
    blockers.push('before 和 after 不能相同');
  }
  if (hasReadbackText(form.readbackActualValue) && hasReadbackText(form.afterValue) && form.readbackActualValue !== form.afterValue) {
    blockers.push('readback actual 必须等于 after');
  }
  if (hasReadbackText(form.targetActionType) && !['lower_bid', 'pause_target', 'add_negative_exact', 'add_negative_phrase', 'add_negative_broad'].includes(form.targetActionType)) {
    blockers.push('动作类型不在低风险白名单');
  }

  const timestampFields = [
    ['Approval time', form.approvalConfirmedAt],
    ['Before captured at', form.beforeCapturedAt],
    ['Execution time', form.executionExecutedAt],
    ['After captured at', form.afterCapturedAt],
    ['Readback time', form.readbackReadAt],
  ] as const;
  for (const [label, value] of timestampFields) {
    if (!isParseableTimestamp(value)) blockers.push(`${label} 不是可解析时间`);
  }
  const timestamps = timestampFields.map(([, value]) => Date.parse(value));
  if (timestamps.every((value) => !Number.isNaN(value))) {
    for (let index = 1; index < timestamps.length; index += 1) {
      if (timestamps[index] < timestamps[index - 1]) {
        blockers.push('时间顺序必须 approval <= before <= execution <= after <= readback');
        break;
      }
    }
  }

  return { blockers, ready: blockers.length === 0 };
}

const LINGXING_REPORT_OPTIONS = [
  { type: 'campaign', label: '广告活动报告' },
  { type: 'ad_group', label: '广告组报告' },
  { type: 'placement', label: '广告位报告' },
  { type: 'advertised_product', label: '广告（推广的商品）报告' },
  { type: 'auto_targeting', label: '自动投放报告' },
  { type: 'keyword', label: '关键词报告' },
  { type: 'product_targeting', label: '商品投放报告' },
  { type: 'user_search_term', label: '用户搜索词报告' },
];

const LINGXING_REPORT_TYPE_LABELS = new Map(
  LINGXING_REPORT_OPTIONS.map((item) => [item.type, item.label]),
);

function normalized(value?: string): string {
  return (value || '').trim();
}

function sameScope(
  item: any,
  scope: { start: string; end: string; storeName: string; marketplaceCode: string },
): boolean {
  if (!item) return false;
  return normalized(item.dateStart || item.start) === scope.start
    && normalized(item.dateEnd || item.end) === scope.end
    && normalized(item.storeName) === scope.storeName
    && normalized(item.marketplaceCode) === scope.marketplaceCode;
}

function stableJson(value: any): string {
  return value ? JSON.stringify(value) : '';
}

function reportTypeLabel(type?: string): string {
  if (!type) return '未知报表';
  return LINGXING_REPORT_TYPE_LABELS.get(type) || type;
}

function fileReportType(file: any): string {
  return normalized(file?.reportType || file?.type || file?.report_type || file?.kind);
}

function summarizeReportTypes(types: string[], max = 3): string {
  if (types.length === 0) return '暂无';
  const labels = types.map(reportTypeLabel);
  const visible = labels.slice(0, max).join('、');
  return labels.length > max ? `${visible} 等 ${labels.length} 类` : visible;
}

function userFacingPageModelReason(reason?: string, missing?: string[]): string {
  const raw = normalized(reason);
  const missingList = (missing || []).filter(Boolean);
  if (/requires manual verification/i.test(raw)) {
    return '页面模型仍在人工复核状态；需完成 8 类单报表验证和启用审计后再放行完整采集';
  }
  if (/missing/i.test(raw) && missingList.length > 0) {
    return `页面模型缺少必要配置：${missingList.join('、')}`;
  }
  if (missingList.length > 0) {
    return `页面模型缺少必要配置：${missingList.join('、')}`;
  }
  return raw || '尚未读取到可用页面模型';
}

function userFacingPreflightCheckName(name: string): string {
  const names: Record<string, string> = {
    browser_session_ready: '浏览器会话',
    page_model_ready: '页面模型',
    diagnostic_evidence_ready: '同范围诊断',
    diagnostic_evidence_files_ready: '截图与 DOM 证据',
  };
  return names[name] || name;
}

function v15SectionTitle(section: V15Section): string {
  const titles: Record<V15Section, string> = {
    delivery: '交付验收',
    reports: '广告报表采集',
    keywords: '关键词机会',
    listing: 'Listing 优化',
  };
  return titles[section];
}

const V15_SECTION_META: Record<V15Section, {
  kicker: string;
  description: string;
  primaryTask: string;
  proof: string;
}> = {
  delivery: {
    kicker: '交付与审计',
    description: '只汇总最终可交付状态、缺失证据和验收命令，不承载日常业务操作。',
    primaryTask: '确认 APP_READY 证据闭环',
    proof: 'manifest 驱动最终聚合 + 真实 readback',
  },
  reports: {
    kicker: '广告数据',
    description: '围绕店铺、站点和日期范围完成领星广告报表验证、采集、重试和审计导出。',
    primaryTask: '拿到当前范围 8 类报表',
    proof: '下载批次 + 诊断证据 + 验收审计',
  },
  keywords: {
    kicker: '增长机会',
    description: '把搜索词、关键词或 SQP 文件清洗成可筛选的关键词机会，供 Listing 和广告优化使用。',
    primaryTask: '生成可用关键词机会池',
    proof: '去重策略 + 解析诊断 + 风险标记',
  },
  listing: {
    kicker: '内容优化',
    description: '读取或导入 Listing 内容，结合关键词机会生成建议和草案；真实 AI 草案需要单独验收。',
    primaryTask: '产出可导出的 Listing 建议',
    proof: '只读读取证据 + source=ai 草案证据',
  },
};

function userFacingOperationDetail(value?: string): string {
  return toUserFacingError(new Error(value || ''), value || '需要继续验证当前操作');
}

function userFacingFileError(value?: string): string {
  if (!value) return '未知错误';
  return userFacingOperationDetail(value);
}

function opportunityLevelLabel(level?: string): string {
  if (level === 'high') return '高';
  if (level === 'medium') return '中';
  if (level === 'low') return '低';
  return level || '-';
}

function listingSectionLabel(section?: string): string {
  const labels: Record<string, string> = {
    title: '标题',
    bullet: '五点',
    a_plus: 'A+',
    image_copy: '图片文案',
    backend_terms: 'Search Terms',
  };
  return labels[section || ''] || section || '-';
}

function parseOpportunityEvidence(evidence?: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (evidence || '').split(',')) {
    const [rawKey, ...rawValue] = part.split('=');
    const key = rawKey?.trim();
    const value = rawValue.join('=').trim();
    if (key && value) result[key] = value;
  }
  return result;
}

function formatOpportunitySourceTrace(evidence: Record<string, string>): string {
  const source = evidence.source || '';
  const file = evidence.source_file || '';
  const row = evidence.source_row || '';
  const fileName = file.split(/[\\/]/).filter(Boolean).pop() || file;
  return [source, fileName, row ? `row ${row}` : ''].filter(Boolean).join(' / ');
}

function describeLoginSession(session?: LoginSessionInfo | null): string {
  if (!session) return 'ERP/Ads 会话：待确认';
  const erp = session.erpSessionReused ? 'ERP 已复用登录态' : 'ERP 已完成登录';
  const ads = session.adsTitle || session.adsUrl ? `Ads 已进入：${session.adsTitle || session.adsUrl}` : 'Ads 会话待确认';
  return `${erp}；${ads}`;
}

// Zustand store
const useStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),
  setLoginState: (isLoggedIn, store = '', loginSession = null) => set({ isLoggedIn, currentStore: store, loginSession }),
}));

// Login Component
function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setLoginState = useStore((s) => s.setLoginState);

  const handleLogin = async () => {
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const session = await (window as any).electronAPI.browserLogin(username, password);
      setLoginState(true, username, session);
    } catch (e: any) {
      setError(toUserFacingError(e, '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.loginContainer}>
      <div style={styles.loginCard}>
        <h1 style={styles.loginTitle}>Amazon AI Ops Agent</h1>
        <p style={styles.loginSubtitle}>v1.5.0</p>
        <div style={styles.loginForm}>
          <input
            type="text"
            placeholder="领星用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={styles.input}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          <input
            type="password"
            placeholder="领星密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          <div style={styles.loginFlowHint}>
            登录流程：ERP 登录 {'->'} ERP 广告入口 {'->'} Ads 会话确认。不会从 Ads URL 直接开始。
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button onClick={handleLogin} disabled={loading} style={styles.loginButton}>
            {loading ? '正在确认 ERP 和 Ads 会话...' : '登录并进入 Ads'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Dashboard Component
function Dashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = await (window as any).electronAPI.getMetricsSummary(today);
      setMetrics(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.dashboard}>
      <h2 style={styles.sectionTitle}>今日概览</h2>
      {loading ? (
        <div style={styles.loading}>加载中...</div>
      ) : (
        <div style={styles.metricsGrid}>
          <MetricCard label="广告销售" value={`¥${((metrics?.totalSales) || 0).toFixed(2)}`} color="#1890ff" />
          <MetricCard label="广告花费" value={`¥${((metrics?.totalCost) || 0).toFixed(2)}`} color="#f5222d" />
          <MetricCard label="ACOS" value={`${((metrics?.avgAcos) || 0).toFixed(1)}%`} color="#faad14" />
          <MetricCard label="总点击" value={(metrics?.totalClicks || 0).toString()} color="#52c41a" />
          <MetricCard label="总订单" value={(metrics?.totalOrders || 0).toString()} color="#722ed1" />
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ ...styles.metricCard, borderLeft: `4px solid ${color}` }}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color }}>{value}</div>
    </div>
  );
}

// Recommendations Component
function Recommendations() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'executed'>('pending');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [storeName, setStoreName] = useState('');
  const [marketplaceCode, setMarketplaceCode] = useState('');
  const [asin, setAsin] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [readbackForm, setReadbackForm] = useState<AdReadbackFormState>(DEFAULT_AD_READBACK_FORM);
  const [readbackExport, setReadbackExport] = useState<{ jsonPath: string; markdownPath: string; status: string; readyForVerifier?: boolean } | null>(null);
  const readbackPrecheck = getAdReadbackPrecheck(readbackForm);

  const applyScopePreset = (presetId: string) => {
    const preset = SCOPE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setDateFrom(preset.start);
    setDateTo(preset.end);
    setStoreName(preset.storeName);
    setMarketplaceCode(preset.marketplaceCode);
    setActionMessage(`已套用范围：${preset.description}`);
  };

  useEffect(() => {
    loadRecommendations();
  }, [filter]);

  const loadRecommendations = async () => {
    setLoading(true);
    try {
      const data = await (window as any).electronAPI.getRecommendations({
        status: filter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        storeName: storeName || undefined,
        marketplaceCode: marketplaceCode || undefined,
        asin: asin || undefined,
        limit: 50,
      });
      setRecommendations(data);
    } catch (e) {
      setActionMessage(toUserFacingError(e, '加载优化建议失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!dateFrom || !dateTo || !storeName || !marketplaceCode) {
      setActionMessage('生成优化建议前请先填写开始日期、结束日期、店铺和站点；系统不会用登录账号名代替店铺范围。');
      return;
    }
    setGenerating(true);
    try {
      const result = await (window as any).electronAPI.generateRecommendations({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        storeName: storeName || undefined,
        marketplaceCode: marketplaceCode || undefined,
        asin: asin || undefined,
        limit: 300,
      });
      const skipped = result?.skippedDuplicates ? `，跳过 ${result.skippedDuplicates} 条重复建议` : '';
      setActionMessage(`已按当前范围生成优化建议：处理 ${result?.metrics ?? 0} 条广告指标，生成 ${result?.generated ?? 0} 条建议${skipped}。`);
      await loadRecommendations();
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '生成优化建议失败'));
    } finally {
      setGenerating(false);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await (window as any).electronAPI.approveRecommendation(id);
      setActionMessage('建议已批准；真实广告写操作仍保持锁定，除非接入可验证回读。');
      loadRecommendations();
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '批准建议失败'));
    }
  };

  const handleReject = async (id: number) => {
    try {
      await (window as any).electronAPI.rejectRecommendation(id);
      setActionMessage('建议已拒绝。');
      loadRecommendations();
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '拒绝建议失败'));
    }
  };

  const copyAdReadbackCommands = async () => {
    try {
      await navigator.clipboard.writeText(AD_READBACK_ACCEPTANCE_COMMANDS.join('\n'));
      setActionMessage('已复制广告 readback 审批包和验收命令；模板默认 NEEDS_WORK，必须填入真实审批、前后截图和值回读后才能通过。');
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '复制广告 readback 验收命令失败'));
    }
  };

  const copyAdReadbackRunbook = async () => {
    try {
      await navigator.clipboard.writeText(AD_READBACK_RUNBOOK_CLIPBOARD);
      setActionMessage('已复制广告 readback 操作手册摘要；真实写入仍需外部审批、现场截图和值回读。');
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '复制广告 readback 操作手册失败'));
    }
  };

  const updateReadbackForm = (patch: Partial<AdReadbackFormState>) => {
    setReadbackForm((current) => ({ ...current, ...patch }));
  };

  const exportAdReadbackEvidence = async () => {
    try {
      const target = {
        storeName: readbackForm.targetStoreName,
        marketplaceCode: readbackForm.targetMarketplaceCode,
        portfolioName: readbackForm.targetPortfolioName,
        asin: readbackForm.targetAsin,
        metricDate: readbackForm.targetMetricDate,
        campaignName: readbackForm.targetCampaignName,
        adGroupName: readbackForm.targetAdGroupName,
        entityType: readbackForm.targetEntityType,
        entityName: readbackForm.targetEntityName,
        actionType: readbackForm.targetActionType,
      };
      const source = {
        recommendationId: readbackForm.sourceRecommendationId,
        evidencePath: readbackForm.sourceEvidencePath,
        entityType: readbackForm.sourceEntityType,
        currentValue: readbackForm.sourceCurrentValue,
        recommendedValue: readbackForm.sourceRecommendedValue,
      };
      const scope = [
        target.storeName,
        target.marketplaceCode,
        target.asin,
        target.campaignName,
        target.adGroupName,
        `${target.entityType}=${target.entityName}`,
        target.actionType,
      ].join(' / ');
      const result = await (window as any).electronAPI.exportAdReadbackEvidence({
        target,
        source,
        approval: {
          operatorConfirmed: readbackForm.operatorConfirmed,
          realWriteApproved: readbackForm.realWriteApproved,
          scope,
          confirmedAt: readbackForm.approvalConfirmedAt,
          approverName: readbackForm.approverName,
          approvalArtifactPath: readbackForm.approvalArtifactPath,
        },
        risk: {
          allowedByPolicy: readbackForm.allowedByPolicy,
          rationale: readbackForm.riskRationale,
        },
        before: {
          value: readbackForm.beforeValue,
          capturedAt: readbackForm.beforeCapturedAt,
          screenshotPath: readbackForm.beforeScreenshotPath,
          liveBidSourceNote: readbackForm.liveBidSourceNote,
        },
        after: {
          value: readbackForm.afterValue,
          capturedAt: readbackForm.afterCapturedAt,
          screenshotPath: readbackForm.afterScreenshotPath,
        },
        readback: {
          verified: readbackForm.readbackVerified,
          method: readbackForm.readbackMethod,
          readAt: readbackForm.readbackReadAt,
          actualValue: readbackForm.readbackActualValue,
          evidencePath: readbackForm.readbackEvidencePath,
        },
        execution: {
          success: readbackForm.executionSuccess,
          verified: readbackForm.executionVerified,
          executionId: readbackForm.executionId,
          executedAt: readbackForm.executionExecutedAt,
          channel: 'manual_ads_ui',
          executedBy: readbackForm.executedBy,
          appExecutorUsed: false,
        },
      });
      setReadbackExport(result);
      setActionMessage(result.readyForVerifier
        ? '已导出广告读回证据：表单字段完整，但仍需运行 verify:ad-readback；导出动作不会修改广告账户。'
        : `已导出广告读回证据：${result.status}。缺动态目标、真实审批、截图或回读字段前不能作为 READY 证据。`);
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '导出广告读回证据失败'));
    }
  };

  const openReadbackExport = async () => {
    const targetPath = readbackExport?.jsonPath || readbackExport?.markdownPath;
    if (!targetPath) {
      setActionMessage('请先导出广告读回证据。');
      return;
    }
    try {
      await (window as any).electronAPI.openReportPath(targetPath);
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '打开广告读回证据失败'));
    }
  };

  const handleExecute = async (rec: Recommendation) => {
    const target = `${rec.entityType || '广告对象'} / ${rec.entityName || '-'}`;
    const change = `${rec.currentValue || '当前值未记录'} -> ${rec.recommendedValue || rec.actionType}`;
    if (!window.confirm(`当前真实广告执行器未接入可验证回读，本操作只会生成 fail-closed 审计记录，不会修改广告账户。\n对象：${target}\n变更：${change}\n证据：${rec.reason || '无说明'}\n\n是否生成阻断审计？`)) {
      setActionMessage('已取消阻断审计，广告账户未被修改。');
      return;
    }
    try {
      await (window as any).electronAPI.executeRecommendation(rec.id);
      setActionMessage('阻断审计请求已返回；请以 action log 和 verify:ad-readback 证据作为是否执行成功的唯一口径。');
      loadRecommendations();
    } catch (e: any) {
      setActionMessage(toUserFacingError(e, '广告执行保持锁定，已按 fail-closed 策略阻断'));
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h2 style={styles.sectionTitle}>优化建议</h2>
        <div style={styles.filterTabs}>
          {(['pending', 'approved', 'rejected', 'executed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{ ...styles.tab, ...(filter === f ? styles.tabActive : {}) }}
            >
              {f === 'pending' ? '待审批' : f === 'approved' ? '已批准' : f === 'rejected' ? '已拒绝' : '已执行'}
            </button>
          ))}
        </div>
      </div>
      <div style={styles.noticeLine}>广告建议支持审批和审计；当前已完成一条人工 Ads UI readback 样例，应用内执行按钮仍保持 fail-closed，避免未绑定动态目标时批量写入。</div>
      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>建议筛选与生成</h3>
        <div style={styles.scopePresetRow}>
          <div>
            <strong>常用范围</strong>
            <div style={styles.mutedSmall}>优先使用已验证 full-8 范围，避免店铺/站点/日期手填错误。</div>
          </div>
          <select aria-label="优化建议范围预设" onChange={(e) => applyScopePreset(e.target.value)} defaultValue="" style={styles.scopePresetSelect}>
            <option value="" disabled>选择已验证范围</option>
            {SCOPE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}：{preset.description}</option>
            ))}
          </select>
        </div>
        <div style={styles.scopeGrid}>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>开始日期</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={styles.input} />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>结束日期</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={styles.input} />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>店铺</label>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="例如 FT-US-US" style={styles.input} />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>站点</label>
            <input value={marketplaceCode} onChange={(e) => setMarketplaceCode(e.target.value)} placeholder="例如 US" style={styles.input} />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>ASIN</label>
            <input value={asin} onChange={(e) => setAsin(e.target.value)} placeholder="可选" style={styles.input} />
          </div>
        </div>
        <div style={{ ...styles.buttonRow, marginTop: '10px' }}>
          <button onClick={loadRecommendations} disabled={loading} style={styles.btnSecondary}>
            {loading ? '刷新中...' : '刷新列表'}
          </button>
          <button onClick={handleGenerate} disabled={generating} style={styles.btnPrimary}>
            {generating ? '生成中...' : '生成优化建议'}
          </button>
        </div>
      </div>
      <div style={styles.workflowStrip}>
        {AD_READBACK_WORKFLOW_STEPS.map((step, index) => (
          <div key={step.name} style={styles.workflowStep}>
            <div style={styles.workflowStepHeader}>
              <span style={styles.nextActionIndex}>{index + 1}</span>
              <strong>{step.name}</strong>
              <span style={styles.deliveryGateBadge(step.status)}>{DELIVERY_GATE_LABELS[step.status]}</span>
            </div>
            <div style={styles.workflowStepDetail}>{step.detail}</div>
          </div>
        ))}
      </div>
      <div style={styles.evidencePanel}>
        <div style={styles.readinessColumnHeader}>
          <strong>广告执行 readback 验收证据</strong>
          <div style={styles.inlineActions}>
            <button onClick={copyAdReadbackRunbook} style={styles.btnTiny}>复制 Readback 操作手册</button>
            <button onClick={copyAdReadbackCommands} style={styles.btnTiny}>复制广告 readback 验收命令</button>
          </div>
        </div>
        <div>当前已完成一条暂停广告 target 的真实写入和回读样例；后续任意广告动作都必须重新绑定动态目标、审批、截图和 readback，不能复用样例目标。</div>
        <div style={styles.mutedSmall}>操作手册：{AD_READBACK_RUNBOOK_PATH}。手册约束人工验收和通用执行合同；本页面导出证据文件，不批量自动写入广告账户。</div>
        <div style={styles.candidatePanel}>
          <div style={styles.readinessColumnHeader}>
            <strong>已验证 readback 样例</strong>
            <span style={styles.deliveryGateBadge('passed')}>PASS</span>
          </div>
          <div style={styles.candidateGrid}>
            {AD_READBACK_CANDIDATE_SCOPE.map((item) => (
              <div key={item.label} style={styles.candidateCell}>
                <span style={styles.mutedText}>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div>
            <div style={styles.mutedText}>通用执行合同</div>
            <div style={styles.checkList}>
              {AD_READBACK_GENERALIZATION_RULES.map((item) => (
                <span key={item} style={styles.checkItem}>{item}</span>
              ))}
            </div>
          </div>
          <div>
            <div style={styles.mutedText}>每个新对象执行前/后必须补齐</div>
            <div style={styles.checkList}>
              {AD_READBACK_LIVE_FIELDS.map((item) => (
                <span key={item} style={styles.checkItem}>{item}</span>
              ))}
            </div>
          </div>
          <div style={styles.warningList}>
            {AD_READBACK_CANDIDATE_WARNINGS.map((item) => (
              <div key={item}>- {item}</div>
            ))}
          </div>
        </div>
        <div style={styles.readbackEntryPanel}>
          <div style={styles.readinessColumnHeader}>
            <strong>真实读回证据录入与导出</strong>
            <span style={styles.deliveryGateBadge(readbackExport?.readyForVerifier ? 'warning' : 'blocked')}>
              {readbackExport?.readyForVerifier ? '待 verifier 确认' : readbackExport?.status || '未导出'}
            </span>
          </div>
          <div style={styles.mutedSmall}>该表单只写本地证据文件，不执行广告动作。目标字段必须来自当前建议行或现场 Ads UI；source 仅是建议来源，before/after 必须来自 Ads UI 现场截图和回读。</div>
          <div style={readbackPrecheck.ready ? styles.precheckPanelReady : styles.precheckPanelBlocked}>
            <div style={styles.readinessColumnHeader}>
              <strong>本地预检</strong>
              <span style={styles.deliveryGateBadge(readbackPrecheck.ready ? 'warning' : 'blocked')}>
                {readbackPrecheck.ready ? '字段完整，待 verifier' : `未满足 ${readbackPrecheck.blockers.length} 项`}
              </span>
            </div>
            <div style={styles.mutedSmall}>预检只检查页面可判断的字段、值一致性和时间顺序；文件存在性和最终证据仍以 `verify:ad-readback` 为准。</div>
            <div style={styles.precheckList}>
              {(readbackPrecheck.ready ? ['本地字段预检通过；仍需运行 verify:ad-readback。'] : readbackPrecheck.blockers).map((item) => (
                <span key={item} style={readbackPrecheck.ready ? styles.precheckItemReady : styles.precheckItemBlocked}>{item}</span>
              ))}
            </div>
          </div>
          <div style={styles.formSectionTitle}>执行目标</div>
          <div style={styles.readbackEntryGrid}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>目标店铺</label>
              <input value={readbackForm.targetStoreName} onChange={(e) => updateReadbackForm({ targetStoreName: e.target.value })} placeholder="例如 FT-US-US" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>目标站点</label>
              <input value={readbackForm.targetMarketplaceCode} onChange={(e) => updateReadbackForm({ targetMarketplaceCode: e.target.value })} placeholder="例如 US" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>广告组合</label>
              <input value={readbackForm.targetPortfolioName} onChange={(e) => updateReadbackForm({ targetPortfolioName: e.target.value })} placeholder="可选：portfolio" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ASIN</label>
              <input value={readbackForm.targetAsin} onChange={(e) => updateReadbackForm({ targetAsin: e.target.value })} placeholder="建议来源 ASIN，可选" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>指标日期</label>
              <input value={readbackForm.targetMetricDate} onChange={(e) => updateReadbackForm({ targetMetricDate: e.target.value })} placeholder="2026-05-23，可选" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>广告活动</label>
              <input value={readbackForm.targetCampaignName} onChange={(e) => updateReadbackForm({ targetCampaignName: e.target.value })} placeholder="当前建议对应 campaign" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>广告组</label>
              <input value={readbackForm.targetAdGroupName} onChange={(e) => updateReadbackForm({ targetAdGroupName: e.target.value })} placeholder="当前建议对应 ad group" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>对象类型</label>
              <select value={readbackForm.targetEntityType} onChange={(e) => updateReadbackForm({ targetEntityType: e.target.value })} style={styles.input}>
                <option value="target">target</option>
                <option value="keyword">keyword</option>
                <option value="search_term">search_term</option>
                <option value="product_targeting">product_targeting</option>
                <option value="auto_targeting">auto_targeting</option>
              </select>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>对象名称</label>
              <input value={readbackForm.targetEntityName} onChange={(e) => updateReadbackForm({ targetEntityName: e.target.value })} placeholder="关键词/搜索词/投放对象" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>动作类型</label>
              <select value={readbackForm.targetActionType} onChange={(e) => updateReadbackForm({ targetActionType: e.target.value })} style={styles.input}>
                <option value="lower_bid">lower_bid</option>
                <option value="pause_target">pause_target</option>
                <option value="add_negative_exact">add_negative_exact</option>
                <option value="add_negative_phrase">add_negative_phrase</option>
                <option value="add_negative_broad">add_negative_broad</option>
              </select>
            </div>
          </div>
          <div style={styles.formSectionTitle}>建议来源</div>
          <div style={styles.readbackEntryGrid}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Recommendation id</label>
              <input value={readbackForm.sourceRecommendationId} onChange={(e) => updateReadbackForm({ sourceRecommendationId: e.target.value })} placeholder="建议 ID，可选" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Source evidence path</label>
              <input value={readbackForm.sourceEvidencePath} onChange={(e) => updateReadbackForm({ sourceEvidencePath: e.target.value })} placeholder="建议/AI 解释证据路径，可选" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Source entity type</label>
              <input value={readbackForm.sourceEntityType} onChange={(e) => updateReadbackForm({ sourceEntityType: e.target.value })} placeholder="search_term / keyword / target" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Source current</label>
              <input value={readbackForm.sourceCurrentValue} onChange={(e) => updateReadbackForm({ sourceCurrentValue: e.target.value })} placeholder="建议来源当前值，不是 live bid" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Source recommended</label>
              <input value={readbackForm.sourceRecommendedValue} onChange={(e) => updateReadbackForm({ sourceRecommendedValue: e.target.value })} placeholder="建议来源推荐值，不是 live bid" style={styles.input} />
            </div>
          </div>
          <div style={styles.readbackSwitchGrid}>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={readbackForm.operatorConfirmed} onChange={(e) => updateReadbackForm({ operatorConfirmed: e.target.checked })} />
              审批人确认范围
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={readbackForm.realWriteApproved} onChange={(e) => updateReadbackForm({ realWriteApproved: e.target.checked })} />
              已有外部审批，允许人工在 Ads UI 执行一次低风险动作
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={readbackForm.allowedByPolicy} onChange={(e) => updateReadbackForm({ allowedByPolicy: e.target.checked })} />
              低风险策略允许
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={readbackForm.executionSuccess} onChange={(e) => updateReadbackForm({ executionSuccess: e.target.checked })} />
              操作员确认已在 Ads UI 人工执行，不是本应用执行
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={readbackForm.executionVerified} onChange={(e) => updateReadbackForm({ executionVerified: e.target.checked })} />
              执行已核验
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={readbackForm.readbackVerified} onChange={(e) => updateReadbackForm({ readbackVerified: e.target.checked })} />
              回读已核验
            </label>
          </div>
          <div style={styles.readbackEntryGrid}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>审批人</label>
              <input value={readbackForm.approverName} onChange={(e) => updateReadbackForm({ approverName: e.target.value })} placeholder="外部审批人/负责人" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>审批凭证路径/编号</label>
              <input value={readbackForm.approvalArtifactPath} onChange={(e) => updateReadbackForm({ approvalArtifactPath: e.target.value })} placeholder="审批截图/工单/聊天记录路径" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Approval time</label>
              <input value={readbackForm.approvalConfirmedAt} onChange={(e) => updateReadbackForm({ approvalConfirmedAt: e.target.value })} placeholder="2026-06-10T10:00:00.000Z" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>执行人</label>
              <input value={readbackForm.executedBy} onChange={(e) => updateReadbackForm({ executedBy: e.target.value })} placeholder="人工操作 Ads UI 的人员" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Before live bid</label>
              <input value={readbackForm.beforeValue} onChange={(e) => updateReadbackForm({ beforeValue: e.target.value })} placeholder="从 Ads UI 读取" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Before captured at</label>
              <input value={readbackForm.beforeCapturedAt} onChange={(e) => updateReadbackForm({ beforeCapturedAt: e.target.value })} placeholder="2026-06-10T10:02:00.000Z" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>After live bid</label>
              <input value={readbackForm.afterValue} onChange={(e) => updateReadbackForm({ afterValue: e.target.value })} placeholder="执行后从 Ads UI 读取" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Execution time</label>
              <input value={readbackForm.executionExecutedAt} onChange={(e) => updateReadbackForm({ executionExecutedAt: e.target.value })} placeholder="2026-06-10T10:03:00.000Z" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>After captured at</label>
              <input value={readbackForm.afterCapturedAt} onChange={(e) => updateReadbackForm({ afterCapturedAt: e.target.value })} placeholder="2026-06-10T10:04:00.000Z" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Readback actual</label>
              <input value={readbackForm.readbackActualValue} onChange={(e) => updateReadbackForm({ readbackActualValue: e.target.value })} placeholder="必须等于 after" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>回读方式</label>
              <input value={readbackForm.readbackMethod} onChange={(e) => updateReadbackForm({ readbackMethod: e.target.value })} placeholder="Ads UI reload / API" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Readback time</label>
              <input value={readbackForm.readbackReadAt} onChange={(e) => updateReadbackForm({ readbackReadAt: e.target.value })} placeholder="2026-06-10T10:05:00.000Z" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Readback evidence path</label>
              <input value={readbackForm.readbackEvidencePath} onChange={(e) => updateReadbackForm({ readbackEvidencePath: e.target.value })} placeholder="回读截图/trace 本地路径" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Before screenshot path</label>
              <input value={readbackForm.beforeScreenshotPath} onChange={(e) => updateReadbackForm({ beforeScreenshotPath: e.target.value })} placeholder="本地 .png/.jpg/.webp 路径" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>After screenshot path</label>
              <input value={readbackForm.afterScreenshotPath} onChange={(e) => updateReadbackForm({ afterScreenshotPath: e.target.value })} placeholder="本地 .png/.jpg/.webp 路径" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Execution id</label>
              <input value={readbackForm.executionId} onChange={(e) => updateReadbackForm({ executionId: e.target.value })} placeholder="本地 action log id 或 Ads 操作 id" style={styles.input} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Live bid row proof</label>
              <input value={readbackForm.liveBidSourceNote} onChange={(e) => updateReadbackForm({ liveBidSourceNote: e.target.value })} placeholder="说明截图中可编辑 bid 行如何证明 before/after" style={styles.input} />
            </div>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>低风险说明</label>
            <textarea value={readbackForm.riskRationale} onChange={(e) => updateReadbackForm({ riskRationale: e.target.value })} style={{ ...styles.textarea, minHeight: '56px' }} />
          </div>
          <div style={styles.buttonRow}>
            <button onClick={exportAdReadbackEvidence} style={styles.btnSecondaryStrong}>导出读回证据 JSON</button>
            <button onClick={openReadbackExport} style={readbackExport ? styles.btnSecondary : styles.btnDisabled}>打开导出文件</button>
            {readbackExport && <span style={styles.pathLine}>{readbackExport.jsonPath}</span>}
          </div>
        </div>
        <div style={styles.checkList}>
          {AD_READBACK_REQUIRED_EVIDENCE.map((item) => (
            <span key={item} style={styles.checkItem}>{item}</span>
          ))}
        </div>
        <div style={styles.readbackTemplateGrid}>
          {AD_READBACK_TEMPLATE_FIELDS.map((item) => (
            <span key={item} style={styles.templateField}>{item}</span>
          ))}
        </div>
        <div style={styles.pathLine}>{AD_READBACK_ACCEPTANCE_COMMANDS.join('\n')}</div>
      </div>
      {actionMessage && <div style={styles.noticeLine}>{actionMessage}</div>}
      {loading ? (
        <div style={styles.loading}>加载中...</div>
      ) : recommendations.length === 0 ? (
        <div style={styles.empty}>暂无数据</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>动作</th>
              <th style={styles.th}>对象</th>
              <th style={styles.th}>当前/建议</th>
              <th style={styles.th}>ACOS</th>
              <th style={styles.th}>花费</th>
              <th style={styles.th}>证据</th>
              <th style={styles.th}>置信度</th>
              <th style={styles.th}>风险</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((rec) => (
              <tr key={rec.id} style={styles.tr}>
                <td style={styles.td}><span style={styles.actionBadge}>{rec.actionType}</span></td>
                <td style={styles.td}>
                  <div>{rec.entityName}</div>
                  <div style={styles.mutedText}>{rec.entityType || '-'}</div>
                </td>
                <td style={styles.td}>{rec.currentValue || '-'} {'->'} {rec.recommendedValue || '-'}</td>
                <td style={styles.td}>{((rec.evidence?.acos || 0) * 100).toFixed(1)}%</td>
                <td style={styles.td}>¥{(rec.evidence?.cost || 0).toFixed(2)}</td>
                <td style={styles.td}>
                  <div>{rec.reason || '-'}</div>
                  <div style={styles.mutedSmall}>
                    {[rec.evidence?.date, rec.evidence?.campaignName, rec.evidence?.adGroupName, rec.evidence?.asin].filter(Boolean).join(' / ') || '广告结构上下文未记录'}
                  </div>
                  {(rec.evidence?.searchTerm || rec.evidence?.targeting || rec.evidence?.matchType) && (
                    <div style={styles.mutedSmall}>
                      {[rec.evidence?.searchTerm || rec.evidence?.targeting, rec.evidence?.matchType].filter(Boolean).join(' / ')}
                    </div>
                  )}
                  <div style={styles.mutedSmall}>
                    解释来源：{rec.evidence?.explanationSource === 'ai' ? 'AI' : '规则'}
                    {rec.evidence?.aiFallbackReason ? `；${rec.evidence.aiFallbackReason}` : ''}
                  </div>
                </td>
                <td style={styles.td}>{((rec.confidence || 0) * 100).toFixed(0)}%</td>
                <td style={styles.td}><span style={styles.riskBadge(rec.riskLevel)}>{rec.riskLevel}</span></td>
                <td style={styles.td}>
                  {filter === 'pending' && (
                    <>
                      <button onClick={() => handleApprove(rec.id)} style={styles.btnApprove}>批准</button>
                      <button onClick={() => handleReject(rec.id)} style={styles.btnReject}>拒绝</button>
                    </>
                  )}
                  {filter === 'approved' && (
                    <button onClick={() => handleExecute(rec)} style={styles.btnExecute}>生成阻断审计</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Settings Component
function Settings() {
  const [config, setConfig] = useState<RuleConfig>({
    targetAcos: 0.25,
    maxCpc: 5.0,
    noOrderClickThreshold: 30,
    highAcosThreshold: 0.4,
    enableAutoLowerBid: true,
    enableAutoAddNegative: true,
  });
  const [aiConfig, setAiConfig] = useState({
    aiApiKey: '',
    aiBaseUrl: 'https://api.deepseek.com',
    aiModel: 'deepseek-v4-flash',
    aiTemperature: '0.3',
    aiMaxTokens: '700',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [aiLastTestPassed, setAiLastTestPassed] = useState<boolean | null>(null);

  useEffect(() => {
    loadConfig();
    loadAiConfig();
  }, []);

  const loadConfig = async () => {
    const data = await (window as any).electronAPI.getRuleConfig();
    if (data) setConfig(data);
  };

  const loadAiConfig = async () => {
    const settings = await (window as any).electronAPI.getSettings();
    if (!settings) return;
    setAiConfig({
      aiApiKey: settings.aiApiKey || settings.ai_api_key || '',
      aiBaseUrl: settings.aiBaseUrl || settings.ai_base_url || 'https://api.deepseek.com',
      aiModel: settings.aiModel || settings.ai_model || 'deepseek-v4-flash',
      aiTemperature: settings.aiTemperature || settings.ai_temperature || '0.3',
      aiMaxTokens: settings.aiMaxTokens || settings.ai_max_tokens || '700',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    await (window as any).electronAPI.saveRuleConfig(config);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveAi = async () => {
    setAiSaving(true);
    setAiMessage('');
    try {
      await (window as any).electronAPI.saveSettings(aiConfig);
      setAiMessage('AI 设置已保存。');
    } catch (e: any) {
      setAiMessage(toUserFacingError(e, '保存 AI 设置失败'));
    } finally {
      setAiSaving(false);
    }
  };

  const handleTestAi = async () => {
    setAiTesting(true);
    setAiMessage('正在测试 AI 连接...');
    try {
      const result = await (window as any).electronAPI.testAiSettings(aiConfig);
      setAiLastTestPassed(Boolean(result?.success));
      setAiMessage(result?.message || (result?.success ? 'AI 连接测试通过。' : 'AI 连接测试失败。'));
    } catch (e: any) {
      setAiLastTestPassed(false);
      setAiMessage(toUserFacingError(e, 'AI 连接测试失败'));
    } finally {
      setAiTesting(false);
    }
  };

  const copyAiEvidenceCommands = async () => {
    try {
      await navigator.clipboard.writeText(AI_ACCEPTANCE_COMMANDS.join('\n'));
      setAiMessage('已复制 AI 验收命令；请先把模板里的 <your-deepseek-key> 替换为真实 Key。');
    } catch (e: any) {
      setAiMessage(toUserFacingError(e, '复制 AI 验收命令失败'));
    }
  };

  const aiKeyConfigured = Boolean(aiConfig.aiApiKey.trim());
  const aiEvidenceSteps: Array<{ name: string; status: DeliveryGateStatus; detail: string }> = [
    {
      name: '保存真实 Key',
      status: aiKeyConfigured ? 'passed' : 'blocked',
      detail: aiKeyConfigured ? '本地设置中已填写 Key' : '先填写 DeepSeek 或 OpenAI 兼容 API Key',
    },
    {
      name: '测试 AI 连接',
      status: aiLastTestPassed === true ? 'passed' : (aiKeyConfigured ? 'pending' : 'blocked'),
      detail: aiLastTestPassed === true ? '连接测试已通过' : '点击测试 AI 连接，确认 auth/network/quota 可用',
    },
    {
      name: '生成广告 AI 解释',
      status: aiLastTestPassed === true ? 'pending' : 'blocked',
      detail: '生成优化建议后导出 ad-ai-explanation 证据，要求 explanationSource=ai',
    },
    {
      name: '生成 Listing AI 草案',
      status: aiLastTestPassed === true ? 'pending' : 'blocked',
      detail: '运行 installed live 草案证据，要求 source=ai 且无 fallback',
    },
    {
      name: '刷新最终验收',
      status: 'pending',
      detail: 'AI 证据通过后重写 evidence manifest 并跑 final readiness',
    },
  ];

  return (
    <div style={styles.page}>
      <h2 style={styles.sectionTitle}>设置</h2>
      <div style={styles.settingsForm}>
        <h3 style={styles.panelTitle}>广告规则阈值</h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>目标 ACOS</label>
          <input
            type="number"
            step="0.01"
            value={config.targetAcos}
            onChange={(e) => setConfig({ ...config, targetAcos: parseFloat(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>最高 CPC (¥)</label>
          <input
            type="number"
            step="0.01"
            value={config.maxCpc}
            onChange={(e) => setConfig({ ...config, maxCpc: parseFloat(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>无转化点击阈值</label>
          <input
            type="number"
            value={config.noOrderClickThreshold}
            onChange={(e) => setConfig({ ...config, noOrderClickThreshold: parseInt(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>高 ACOS 阈值</label>
          <input
            type="number"
            step="0.01"
            value={config.highAcosThreshold}
            onChange={(e) => setConfig({ ...config, highAcosThreshold: parseFloat(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>
            <input
              type="checkbox"
              checked={config.enableAutoLowerBid}
              onChange={(e) => setConfig({ ...config, enableAutoLowerBid: e.target.checked })}
            />
            自动降 bid
          </label>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>
            <input
              type="checkbox"
              checked={config.enableAutoAddNegative}
              onChange={(e) => setConfig({ ...config, enableAutoAddNegative: e.target.checked })}
            />
            自动否词
          </label>
        </div>
        <button onClick={handleSave} disabled={saving} style={styles.saveButton}>
          {saving ? '保存中...' : saved ? '已保存!' : '保存配置'}
        </button>
      </div>
      <div style={styles.settingsForm}>
        <h3 style={styles.panelTitle}>AI / DeepSeek 配置</h3>
        <div style={styles.noticeLine}>用于广告建议解释和 Listing 草案改写。未配置或测试失败时，系统会使用规则草案并记录 AI 回退原因。</div>
        <div style={styles.workflowStrip}>
          {aiEvidenceSteps.map((step, index) => (
            <div key={step.name} style={styles.workflowStep}>
              <div style={styles.workflowStepHeader}>
                <span style={styles.nextActionIndex}>{index + 1}</span>
                <strong>{step.name}</strong>
                <span style={styles.deliveryGateBadge(step.status)}>{DELIVERY_GATE_LABELS[step.status]}</span>
              </div>
              <div style={styles.workflowStepDetail}>{step.detail}</div>
            </div>
          ))}
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>API Key</label>
          <input
            type="password"
            value={aiConfig.aiApiKey}
            onChange={(e) => {
              setAiConfig({ ...aiConfig, aiApiKey: e.target.value });
              setAiLastTestPassed(null);
            }}
            placeholder="DeepSeek 或 OpenAI 兼容 API Key"
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Base URL</label>
          <input
            value={aiConfig.aiBaseUrl}
            onChange={(e) => setAiConfig({ ...aiConfig, aiBaseUrl: e.target.value })}
            placeholder="https://api.deepseek.com"
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>模型</label>
          <input
            value={aiConfig.aiModel}
            onChange={(e) => setAiConfig({ ...aiConfig, aiModel: e.target.value })}
            placeholder="deepseek-v4-flash"
            style={styles.input}
          />
        </div>
        <div style={styles.inlineForm}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Temperature</label>
            <input
              type="number"
              step="0.1"
              value={aiConfig.aiTemperature}
              onChange={(e) => setAiConfig({ ...aiConfig, aiTemperature: e.target.value })}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Max Tokens</label>
            <input
              type="number"
              value={aiConfig.aiMaxTokens}
              onChange={(e) => setAiConfig({ ...aiConfig, aiMaxTokens: e.target.value })}
              style={styles.input}
            />
          </div>
        </div>
        <div style={styles.buttonRow}>
          <button onClick={handleSaveAi} disabled={aiSaving} style={styles.saveButton}>
            {aiSaving ? '保存中...' : '保存 AI 设置'}
          </button>
          <button onClick={handleTestAi} disabled={aiTesting} style={styles.btnSecondary}>
            {aiTesting ? '测试中...' : '测试 AI 连接'}
          </button>
        </div>
        {aiMessage && <div style={styles.noticeLine}>{aiMessage}</div>}
        <div style={styles.evidencePanel}>
          <div style={styles.readinessColumnHeader}>
            <strong>AI 交付证据</strong>
            <button onClick={copyAiEvidenceCommands} style={styles.btnTiny}>复制 AI 验收命令</button>
          </div>
          <div>真实交付需要三份证据：`verify:ai-live` 证明 provider 可用，`verify:ad-ai-explanation` 证明广告建议解释来自 AI，`verify:listing-ai-draft` 证明 Listing 草案来自 AI 且没有 fallback。</div>
          <div style={styles.pathLine}>{AI_ACCEPTANCE_COMMANDS.join('\n')}</div>
        </div>
      </div>
    </div>
  );
}

// Scheduler Component
function Scheduler() {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadTasks = async () => {
    const data = await (window as any).electronAPI.getScheduledTasks();
    setTasks(data);
  };

  const toggleTask = async (name: string, enabled: boolean) => {
    await (window as any).electronAPI.setTaskEnabled(name, enabled);
    loadTasks();
  };

  const runNow = async (name: string) => {
    await (window as any).electronAPI.runTaskNow(name);
  };

  return (
    <div style={styles.page}>
      <h2 style={styles.sectionTitle}>定时任务</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>任务</th>
            <th style={styles.th}>Cron</th>
            <th style={styles.th}>状态</th>
            <th style={styles.th}>下次执行</th>
            <th style={styles.th}>操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.name} style={styles.tr}>
              <td style={styles.td}>{task.name}</td>
              <td style={styles.td}>{task.cron}</td>
              <td style={styles.td}>
                <span style={styles.statusBadge(task.enabled)}>
                  {task.enabled ? '启用' : '禁用'}
                </span>
              </td>
              <td style={styles.td}>{task.nextRun ? new Date(task.nextRun).toLocaleString() : '-'}</td>
              <td style={styles.td}>
                <button onClick={() => toggleTask(task.name, !task.enabled)} style={styles.btnSmall}>
                  {task.enabled ? '禁用' : '启用'}
                </button>
                <button onClick={() => runNow(task.name)} style={styles.btnSmall}>立即执行</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function V15Workspace({ section }: { section: V15Section }) {
  const [dateStart, setDateStart] = useState('2026-05-01');
  const [dateEnd, setDateEnd] = useState('2026-05-25');
  const [collectionStoreName, setCollectionStoreName] = useState('FT-US-US');
  const [collectionMarketplaceCode, setCollectionMarketplaceCode] = useState('US');
  const [canaryReportType, setCanaryReportType] = useState('keyword');
  const [message, setMessage] = useState('');
  const [selectedReportFile, setSelectedReportFile] = useState('');
  const [keywordSource, setKeywordSource] = useState('search_term');
  const [keywordDuplicateStrategy, setKeywordDuplicateStrategy] = useState<'overwrite' | 'merge' | 'skip'>('merge');
  const [keywordAsinFilter, setKeywordAsinFilter] = useState('');
  const [keywordLevelFilter, setKeywordLevelFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [keywordRiskFilter, setKeywordRiskFilter] = useState<'all' | 'safe' | 'risk'>('all');
  const [keywordMetrics, setKeywordMetrics] = useState<any[]>([]);
  const [keywordDiagnostics, setKeywordDiagnostics] = useState<any>(null);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [reportBatchResult, setReportBatchResult] = useState<any>(null);
  const [downloadCenterDiagnostic, setDownloadCenterDiagnostic] = useState<any>(null);
  const [collectionPreflight, setCollectionPreflight] = useState<any>(null);
  const [downloadCenterPageModelInfo, setDownloadCenterPageModelInfo] = useState<any>(null);
  const [downloadCenterPageModelText, setDownloadCenterPageModelText] = useState('');
  const [showDownloadDiagnostics, setShowDownloadDiagnostics] = useState(false);
  const [listing, setListing] = useState({
    asin: '',
    title: '',
    bulletsText: '',
    aPlus: '',
    imageCopy: '',
    backendTerms: '',
  });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [lastListingDraftExportPath, setLastListingDraftExportPath] = useState('');
  const [listingReadLoading, setListingReadLoading] = useState(false);
  const [lastListingReadEvidence, setLastListingReadEvidence] = useState<any>(null);
  const [listingReadUrl, setListingReadUrl] = useState('https://erp.lingxing.com/erp/listing');

  useEffect(() => {
    loadDownloadCenterPageModel();
  }, []);

  const clearLiveCollectionEvidence = () => {
    setDownloadCenterDiagnostic(null);
    setCollectionPreflight(null);
    setReportBatchResult(null);
  };

  const collectionRequest = () => ({
    start: dateStart,
    end: dateEnd,
    storeName: collectionStoreName.trim(),
    marketplaceCode: collectionMarketplaceCode.trim(),
  });

  const collectReports = async () => {
    if (collectionStartGate) {
      setMessage(`完整 8 报表采集暂未放行：${collectionStartGate.name} - ${collectionStartGate.detail}`);
      return;
    }
    if (!window.confirm('将开始在领星真实生成并下载 8 类广告报表。请确认当前店铺、站点和日期范围无误。')) {
      setMessage('已取消完整 8 报表采集');
      return;
    }
    setMessage('正在启动领星报告采集...');
    try {
      const result = await (window as any).electronAPI.collectLingxingReports(collectionRequest());
      setReportBatchResult(result);
      const failed = result.files.filter((file: any) => file.status === 'failed');
      setMessage(
        result.batch.status === 'failed'
          ? `采集失败：${failed.length} 个报告未完成。首个错误：${userFacingFileError(failed[0]?.errorMessage)}`
          : `采集批次 ${result.batch.id} 已记录，成功 ${result.files.length - failed.length} 个，失败 ${failed.length} 个，文件夹：${result.batch.downloadDir}`,
      );
    } catch (e: any) {
      setMessage(toUserFacingError(e, '采集失败'));
    }
  };

  const preflightCollection = async () => {
    setMessage('正在执行领星采集预检...');
    try {
      const result = await (window as any).electronAPI.preflightLingxingCollection(collectionRequest());
      setCollectionPreflight(result);
      setMessage(result.ready
        ? '采集预检通过：页面模型、近期诊断证据和浏览器登录状态均满足启动条件'
        : `采集预检未通过：${result.checks.filter((check: any) => check.status !== 'passed').map((check: any) => `${userFacingPreflightCheckName(check.name)}：${userFacingOperationDetail(check.detail)}`).join('；')}`);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '采集预检失败'));
    }
  };

  const exportCollectionPreflight = async () => {
    setMessage('正在导出采集预检证据...');
    try {
      const exportPath = await (window as any).electronAPI.exportLingxingCollectionPreflight(collectionRequest());
      setMessage(`采集预检证据已导出：${exportPath}`);
      await openReportPath(exportPath);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '导出采集预检证据失败'));
    }
  };

  const retryReport = async (file: any) => {
    setMessage(`正在重试 ${file.displayName}...`);
    try {
      const result = await (window as any).electronAPI.retryLingxingReport(
        collectionRequest(),
        file.reportType,
      );
      setReportBatchResult(result);
      const retryFile = result.files[0];
      setMessage(
        retryFile?.status === 'downloaded'
          ? `单项重试成功：${retryFile.displayName}，文件：${retryFile.filePath}`
          : `单项重试失败：${userFacingFileError(retryFile?.errorMessage)}`,
      );
    } catch (e: any) {
      setMessage(toUserFacingError(e, '单项重试失败'));
    }
  };

  const runCanaryReport = async () => {
    const selected = LINGXING_REPORT_OPTIONS.find((item) => item.type === canaryReportType);
    if (!diagnosticPassedForCurrentScope) {
      setMessage('单报表验证暂未放行：请先点击“验证页面”，生成当前范围的页面诊断和截图/DOM 证据。');
      return;
    }
    if (!window.confirm(`单报表验证会在领星真实生成并下载 1 个报表：${selected?.label || canaryReportType}。完整 8 报表采集仍会保持关闭。是否继续？`)) {
      setMessage('已取消单报表验证');
      return;
    }
    setMessage(`正在执行单报表验证：${selected?.label || canaryReportType}...`);
    try {
      const result = await (window as any).electronAPI.runLingxingCanaryReport(
        collectionRequest(),
        canaryReportType,
      );
      setReportBatchResult(result);
      const file = result.files?.[0];
      setMessage(
        file?.status === 'downloaded'
          ? `单报表验证成功：${file.displayName}，文件：${file.filePath}。这只证明 1 类报表，完整交付仍需 8/8 单报表、启用审计和最终验收审计。`
          : `单报表验证未通过：${userFacingFileError(file?.errorMessage || '未下载文件')}`,
      );
    } catch (e: any) {
      setMessage(toUserFacingError(e, '单报表验证失败'));
    }
  };

  const openReportPath = async (targetPath: string) => {
    try {
      await (window as any).electronAPI.openReportPath(targetPath);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '打开路径失败'));
    }
  };

  const exportLingxingAcceptanceAudit = async () => {
    if (!reportBatchResult) {
      setMessage('请先完成一次完整 8 报表领星报告采集；单项重试批次可导出但不会通过完整验收审计');
      return;
    }
    try {
      const auditPath = await (window as any).electronAPI.exportLingxingAcceptanceAudit(reportBatchResult.batch.id);
      setMessage(`领星验收审计已导出：${auditPath}`);
      await openReportPath(auditPath);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '导出领星验收审计失败'));
    }
  };

  const diagnoseDownloadCenter = async () => {
    setMessage('正在只读验证领星下载中心页面模型...');
    try {
      const result = await (window as any).electronAPI.diagnoseLingxingDownloadCenter(collectionRequest());
      setDownloadCenterDiagnostic(result);
      setMessage(result.ready
        ? '下载中心只读识别通过，仍需人工确认后才能打开自动下载。'
        : `下载中心只读识别未通过：${result.errorMessage ? toUserFacingError(new Error(result.errorMessage), '缺少页面文本或关键选择器') : '缺少页面文本或关键选择器'}`);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '下载中心页面模型诊断失败'));
    }
  };

  const exportDownloadCenterDiagnosticBundle = async () => {
    if (!downloadCenterDiagnostic?.id) {
      setMessage('请先运行“验证页面”生成诊断证据');
      return;
    }
    try {
      const bundlePath = await (window as any).electronAPI.exportDownloadCenterDiagnosticBundle(downloadCenterDiagnostic.id);
      setMessage(`下载中心诊断证据包已导出：${bundlePath}`);
      await openReportPath(bundlePath);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '导出下载中心诊断证据包失败'));
    }
  };

  const exportDownloadCenterPageModelDraft = async () => {
    if (!downloadCenterDiagnostic?.id) {
      setMessage('请先运行“验证页面”生成诊断证据');
      return;
    }
    try {
      const result = await (window as any).electronAPI.exportDownloadCenterPageModelDraft(downloadCenterDiagnostic.id);
      setDownloadCenterPageModelText(JSON.stringify(result.draft, null, 2));
      setMessage(`页面模型草稿已生成并填入编辑框：${result.exportPath}`);
      await openReportPath(result.exportPath);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '生成页面模型草稿失败'));
    }
  };

  const exportDownloadCenterPageModelEnablementAudit = async () => {
    try {
      const result = await (window as any).electronAPI.exportDownloadCenterPageModelEnablementAudit(
        collectionRequest(),
      );
      setMessage(result.canDisableManualVerification
        ? `页面模型启用审计通过：${result.exportPath}`
        : `页面模型启用审计未通过：${result.missing?.join(', ') || '缺少诊断证据'}；证据已导出：${result.exportPath}`);
      await openReportPath(result.exportPath);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '导出页面模型启用审计失败'));
    }
  };

  const loadDownloadCenterPageModel = async () => {
    try {
      const result = await (window as any).electronAPI.getDownloadCenterPageModel();
      setDownloadCenterPageModelInfo(result);
      setDownloadCenterPageModelText(JSON.stringify(result.model, null, 2));
    } catch (e: any) {
      setMessage(toUserFacingError(e, '读取下载中心页面模型失败'));
    }
  };

  const saveDownloadCenterPageModel = async () => {
    try {
      const model = JSON.parse(downloadCenterPageModelText);
      const result = await (window as any).electronAPI.saveDownloadCenterPageModel(model);
      setDownloadCenterPageModelInfo(result);
      setDownloadCenterPageModelText(JSON.stringify(result.model, null, 2));
      clearLiveCollectionEvidence();
      const backupNote = result.overrideSaveMetadata?.backupPath ? `，旧 override 已备份：${result.overrideSaveMetadata.backupPath}` : '';
      const metadataNote = result.overrideSaveMetadata?.overridePath ? `，保存元数据：${result.overrideMetadataPath}` : '';
      const postSaveDiagnosticNote = result.overrideSaveMetadata?.postSaveDiagnosticRequired
        ? '；已关闭人工验证，必须立刻重新运行“验证页面”生成 enabled snapshot 诊断证据，之后再采集'
        : '';
      setMessage(result.readiness?.ready
        ? `页面模型 override 已保存，结构校验通过${postSaveDiagnosticNote}：${result.path}${backupNote}${metadataNote}`
        : `页面模型 override 已保存，但自动化仍未就绪：${result.readiness?.reason || result.readiness?.missing?.join(', ') || '需要继续验证'}${postSaveDiagnosticNote}${backupNote}${metadataNote}`);
    } catch (e: any) {
      setMessage(toUserFacingError(e, '保存下载中心页面模型失败'));
    }
  };

  const resetDownloadCenterPageModel = async () => {
    try {
      const result = await (window as any).electronAPI.resetDownloadCenterPageModel();
      setDownloadCenterPageModelInfo(result);
      setDownloadCenterPageModelText(JSON.stringify(result.model, null, 2));
      clearLiveCollectionEvidence();
      setMessage(result.resetBackupPath ? `已恢复使用打包内置页面模型，旧 override 已备份：${result.resetBackupPath}` : '已恢复使用打包内置页面模型');
    } catch (e: any) {
      setMessage(toUserFacingError(e, '重置下载中心页面模型失败'));
    }
  };

  const selectKeywordReport = async () => {
    const filePath = await (window as any).electronAPI.selectReportFile();
    if (filePath) {
      setSelectedReportFile(filePath);
      setKeywordDiagnostics(null);
      setMessage(`已选择报表：${filePath}`);
    }
  };

  const importKeywordReport = async () => {
    if (!selectedReportFile) {
      setMessage('请先选择搜索词、SQP 或关键词报表');
      return;
    }

    try {
      setKeywordDiagnostics(null);
      const result = await (window as any).electronAPI.importKeywordReport(selectedReportFile, keywordSource, keywordDuplicateStrategy);
      setKeywordMetrics(result.metrics);
      setKeywordDiagnostics(result.diagnostics || null);
      setOpportunities(result.opportunities);
      setSuggestions([]);
      setDrafts([]);
      if (result.skipped) {
        setMessage(`已跳过重复报表：库中已有 ${result.existingRows || 0} 行来自该文件`);
        return;
      }
      const warningCount = result.diagnostics?.warnings?.length || 0;
      const duplicateNote = result.duplicate
        ? (result.duplicateStrategy === 'overwrite' ? `，已覆盖旧 ${result.existingRows || 0} 行` : `，已与旧 ${result.existingRows || 0} 行合并`)
        : '';
      setMessage(`已导入 ${result.metricsCount} 行关键词指标，生成 ${result.opportunities.length} 条机会${duplicateNote}${warningCount ? `，解析警告 ${warningCount} 条` : ''}`);
    } catch (e: any) {
      setKeywordDiagnostics(null);
      setMessage(toUserFacingError(e, '关键词报表导入失败'));
    }
  };

  const buildListing = () => ({
    asin: listing.asin.trim(),
    title: listing.title.trim(),
    bullets: listing.bulletsText.split('\n').map((line) => line.trim()).filter(Boolean),
    aPlus: listing.aPlus.trim(),
    imageCopy: listing.imageCopy.trim(),
    backendTerms: listing.backendTerms.trim(),
  });

  const describeListingReadStatus = (evidence: any) => {
    if (!evidence) return '未读取';
    if (evidence.fullContentReady) return '详情页完整读取成功';
    if (evidence.partialReady || (evidence.completeness?.asin && evidence.completeness?.title)) {
      return '列表页/当前页部分读取成功，仍缺完整字段';
    }
    return '读取未通过';
  };

  const listingReadCompletionMessage = (asin: string, evidence: any) => {
    if (evidence?.fullContentReady) {
      return `已完整读取领星 Listing：${asin}`;
    }
    return `已读取领星基础字段：${asin}；五点或后台词未完整，需进入详情/编辑页补证据`;
  };

  const importListingContent = async () => {
    const filePath = await (window as any).electronAPI.selectReportFile();
    if (!filePath) return;

    try {
      const data = await (window as any).electronAPI.importListingContent(filePath);
      setListing({
        asin: data.asin || '',
        title: data.title || '',
        bulletsText: (data.bullets || []).join('\n'),
        aPlus: data.aPlus || '',
        imageCopy: data.imageCopy || '',
        backendTerms: data.backendTerms || '',
      });
      setSuggestions([]);
      setDrafts([]);
      setLastListingReadEvidence(null);
      setMessage(`已导入 Listing 文案：${filePath}`);
    } catch (e: any) {
      setMessage(toUserFacingError(e, 'Listing 文案导入失败'));
    }
  };

  const extractListingFromLingxing = async () => {
    setListingReadLoading(true);
    try {
      const result = await (window as any).electronAPI.extractListingFromLingxing();
      setLastListingReadEvidence(result?.evidence || null);
      if (!result?.ready || !result?.listing) {
        setMessage(result?.reason || '当前领星页面未识别到可用 Listing 字段');
        return;
      }
      const data = result.listing;
      setListing({
        asin: data.asin || '',
        title: data.title || '',
        bulletsText: (data.bullets || []).join('\n'),
        aPlus: data.aPlus || '',
        imageCopy: data.imageCopy || '',
        backendTerms: data.backendTerms || '',
      });
      setSuggestions([]);
      setDrafts([]);
      setMessage(listingReadCompletionMessage(data.asin, result.evidence));
    } catch (e: any) {
      setMessage(toUserFacingError(e, '从领星读取 Listing 失败'));
    } finally {
      setListingReadLoading(false);
    }
  };

  const openLingxingListingAndExtract = async () => {
    if (!listingReadUrl.trim()) {
      setMessage('请输入领星 Listing 页面 URL');
      return;
    }
    setListingReadLoading(true);
    try {
      const result = await (window as any).electronAPI.openLingxingListingAndExtract(listingReadUrl.trim());
      setLastListingReadEvidence(result?.evidence || null);
      if (!result?.ready || !result?.listing) {
        setMessage(result?.reason || '打开的领星页面未识别到可用 Listing 字段');
        return;
      }
      const data = result.listing;
      setListing({
        asin: data.asin || '',
        title: data.title || '',
        bulletsText: (data.bullets || []).join('\n'),
        aPlus: data.aPlus || '',
        imageCopy: data.imageCopy || '',
        backendTerms: data.backendTerms || '',
      });
      setSuggestions([]);
      setDrafts([]);
      setMessage(listingReadCompletionMessage(data.asin, result.evidence));
    } catch (e: any) {
      setMessage(toUserFacingError(e, '打开并读取领星 Listing 失败'));
    } finally {
      setListingReadLoading(false);
    }
  };

  const probeLingxingListingDetailAndExtract = async () => {
    setListingReadLoading(true);
    try {
      const url = listingReadUrl.trim() || undefined;
      const result = await (window as any).electronAPI.probeLingxingListingDetailAndExtract(url);
      setLastListingReadEvidence(result?.evidence || null);
      if (!result?.ready || !result?.listing) {
        setMessage(result?.reason || result?.evidence?.detailProbe?.reason || '详情页只读探测未读取到可用 Listing 字段');
        return;
      }
      const data = result.listing;
      setListing({
        asin: data.asin || '',
        title: data.title || '',
        bulletsText: (data.bullets || []).join('\n'),
        aPlus: data.aPlus || '',
        imageCopy: data.imageCopy || '',
        backendTerms: data.backendTerms || '',
      });
      setSuggestions([]);
      setDrafts([]);
      setMessage(listingReadCompletionMessage(data.asin, result.evidence));
    } catch (e: any) {
      setMessage(toUserFacingError(e, '只读探测领星 Listing 详情页失败'));
    } finally {
      setListingReadLoading(false);
    }
  };

  const runListingAnalysis = async () => {
    const listingContent = buildListing();
    if (!listingContent.asin || !listingContent.title) {
      setMessage('请填写 ASIN 和标题后再生成 Listing 建议');
      return;
    }
    if (opportunities.length === 0) {
      setMessage('请先导入关键词报表生成机会');
      return;
    }

    const scopedOpportunities = opportunities.filter((item) => !item.asin || item.asin === listingContent.asin);
    if (scopedOpportunities.length === 0) {
      setMessage('当前 ASIN 没有可用于生成 Listing 建议的关键词机会');
      return;
    }

    const coverage = await (window as any).electronAPI.analyzeListingCoverage(
      listingContent,
      scopedOpportunities.map((item) => item.normalizedKeyword),
    );
    const coverageByKeyword = Object.fromEntries(
      coverage
        .filter((item: any) => item.covered)
        .map((item: any) => [item.normalizedKeyword, item.sections]),
    );
    const scopedMetrics = keywordMetrics.filter((item) => !item.asin || item.asin === listingContent.asin);
    const rankedOpportunities = scopedMetrics.length > 0
      ? await (window as any).electronAPI.buildKeywordOpportunities(scopedMetrics, { coverageByKeyword })
      : scopedOpportunities;
    setOpportunities(rankedOpportunities);
    const data = await (window as any).electronAPI.buildListingSuggestions(listingContent, rankedOpportunities);
    setSuggestions(data);
    setDrafts([]);
    setMessage(`覆盖分析 ${coverage.length} 条，Listing 建议 ${data.length} 条`);
  };

  const updateSuggestionStatus = async (suggestion: any, status: 'accepted' | 'ignored') => {
    if (!suggestion.id) {
      setSuggestions((items) => items.map((item) => item === suggestion ? { ...item, status } : item));
      setMessage(status === 'accepted' ? '已在本地标记采纳；不会自动提交到 Amazon。' : '已在本地标记忽略；不会修改 Amazon Listing。');
      return;
    }
    await (window as any).electronAPI.updateListingSuggestionStatus(suggestion.id, status);
    setSuggestions((items) => items.map((item) => item.id === suggestion.id ? { ...item, status } : item));
    setMessage(status === 'accepted' ? '已在本地标记采纳；不会自动提交到 Amazon。' : '已在本地标记忽略；不会修改 Amazon Listing。');
  };

  const exportSuggestions = async (format: 'csv' | 'xlsx' | 'markdown') => {
    const filePath = await (window as any).electronAPI.exportListingSuggestions(suggestions, format);
    setMessage(`已导出：${filePath}`);
  };

  const exportDrafts = async (format: 'csv' | 'xlsx' | 'markdown') => {
    if (drafts.length === 0) {
      setMessage('当前没有可导出的 Listing 草案');
      return;
    }
    const filePath = await (window as any).electronAPI.exportListingDrafts(drafts, format);
    setLastListingDraftExportPath(filePath);
    setMessage(`Listing 草案已导出：${filePath}`);
  };

  const copyDraftText = async (draft: any) => {
    const text = [
      `ASIN: ${draft.asin || listing.asin || '-'}`,
      `位置: ${listingSectionLabel(draft.section)}`,
      `关键词: ${draft.keywords?.join(', ') || '-'}`,
      '',
      draft.draftedText || '',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setMessage('已复制 Listing 草案文案；不会自动提交到 Amazon。');
    } catch (e: any) {
      setMessage(toUserFacingError(e, '复制 Listing 草案失败'));
    }
  };

  const exportKeywordDiagnostics = async () => {
    if (!keywordDiagnostics || ((keywordDiagnostics.errors?.length || 0) + (keywordDiagnostics.warnings?.length || 0)) === 0) {
      setMessage('当前没有可导出的解析诊断');
      return;
    }
    const filePath = await (window as any).electronAPI.exportKeywordDiagnostics(keywordDiagnostics);
    setMessage(`解析诊断已导出：${filePath}`);
  };

  const generateDrafts = async () => {
    const acceptedSuggestions = suggestions.filter((item) => item.status === 'accepted');
    if (acceptedSuggestions.length === 0) {
      setMessage('请先标记采纳至少 1 条 Listing 建议，再生成草案');
      return;
    }
    const data = await (window as any).electronAPI.generateListingDrafts(acceptedSuggestions);
    setDrafts(data);
    setLastListingDraftExportPath('');
    const fallbackCount = data.filter((item: any) => item.aiFallbackReason).length;
    setMessage(`已基于 ${acceptedSuggestions.length} 条已采纳建议生成 ${data.length} 条 Listing 修改草案${fallbackCount ? `，${fallbackCount} 条使用规则草案并记录 AI 回退原因` : ''}`);
  };

  const currentScope = {
    start: normalized(dateStart),
    end: normalized(dateEnd),
    storeName: normalized(collectionStoreName),
    marketplaceCode: normalized(collectionMarketplaceCode),
  };
  const pageModelReady = Boolean(downloadCenterPageModelInfo?.readiness?.ready);
  const preflightMatchesCurrentScope = collectionPreflight
    && normalized(collectionPreflight.dateRange?.start) === currentScope.start
    && normalized(collectionPreflight.dateRange?.end) === currentScope.end
    && normalized(collectionPreflight.target?.storeName) === currentScope.storeName
    && normalized(collectionPreflight.target?.marketplaceCode) === currentScope.marketplaceCode;
  const diagnosticPreflightCheck = collectionPreflight?.checks?.find((check: any) => check.name === 'diagnostic_evidence_ready');
  const diagnosticMatchesCurrentScope = sameScope(downloadCenterDiagnostic, currentScope);
  const diagnosticMatchesCurrentModel = stableJson(downloadCenterDiagnostic?.pageModelSnapshot)
    === stableJson(downloadCenterPageModelInfo?.model);
  const diagnosticPassedForCurrentScope = (preflightMatchesCurrentScope && diagnosticPreflightCheck?.status === 'passed')
    || (Boolean(downloadCenterDiagnostic?.ready) && diagnosticMatchesCurrentScope && diagnosticMatchesCurrentModel);
  const batchMatchesCurrentScope = sameScope(reportBatchResult?.batch, currentScope);
  const currentBatchFiles = batchMatchesCurrentScope ? (reportBatchResult?.files || []) : [];
  const downloadedReportCount = currentBatchFiles.filter((file: any) => file.status === 'downloaded').length;
  const failedReportCount = currentBatchFiles.filter((file: any) => file.status === 'failed').length;
  const successfulReportTypes: string[] = Array.from(new Set<string>(
    currentBatchFiles
      .filter((file: any) => file.status === 'downloaded')
      .map(fileReportType)
      .filter((type: string) => LINGXING_REPORT_TYPE_LABELS.has(type)),
  ));
  const missingReportTypes = LINGXING_REPORT_OPTIONS
    .map((item) => item.type)
    .filter((type) => !successfulReportTypes.includes(type));
  const canaryCoverageLabel = `${successfulReportTypes.length}/8`;
  const staleBatchResult = Boolean(reportBatchResult) && !batchMatchesCurrentScope;
  const staleBatchScope = reportBatchResult?.batch
    ? `${reportBatchResult.batch.dateStart || '-'} ~ ${reportBatchResult.batch.dateEnd || '-'} / ${reportBatchResult.batch.storeName || '-'} / ${reportBatchResult.batch.marketplaceCode || '-'}`
    : '';
  const fullBatchDownloaded = batchMatchesCurrentScope
    && reportBatchResult?.batch?.status === 'completed'
    && downloadedReportCount === 8
    && (reportBatchResult?.files?.length || 0) === 8;
  const fullCollectionDownloadedCount = batchMatchesCurrentScope && (reportBatchResult?.files?.length || 0) === 8
    ? downloadedReportCount
    : 0;
  const scopeLabel = `${currentScope.start || '未选日期'} ~ ${currentScope.end || '未选日期'} / ${currentScope.storeName || '未选店铺'} / ${currentScope.marketplaceCode || '未选站点'}`;
  const pageModelReason = pageModelReady
    ? '页面模型自动下载结构已具备'
    : userFacingPageModelReason(
      downloadCenterPageModelInfo?.readiness?.reason,
      downloadCenterPageModelInfo?.readiness?.missing,
    );
  const deliveryGates: DeliveryGateItem[] = [
    {
      name: '采集范围',
      status: currentScope.start && currentScope.end && currentScope.storeName && currentScope.marketplaceCode ? 'passed' : 'blocked',
      detail: scopeLabel,
    },
    {
      name: '页面模型',
      status: pageModelReady ? 'passed' : 'blocked',
      detail: pageModelReason,
    },
    {
      name: '同范围诊断',
      status: diagnosticPassedForCurrentScope ? 'passed' : (downloadCenterDiagnostic ? 'warning' : 'pending'),
      detail: diagnosticPassedForCurrentScope
        ? `诊断 ${downloadCenterDiagnostic?.id || collectionPreflight?.diagnosticEvidenceReadiness?.diagnosticId || '-'} 匹配当前范围`
        : (!preflightMatchesCurrentScope && collectionPreflight
          ? '预检范围已变化，需要重新预检或验证页面'
          : (!diagnosticMatchesCurrentModel && downloadCenterDiagnostic
            ? '页面模型已变化，需要重新运行验证页面'
            : (diagnosticPreflightCheck?.detail || '需要当前范围的验证页面证据'))),
    },
    {
      name: '单报表覆盖',
      status: successfulReportTypes.length === 8 ? 'passed' : (successfulReportTypes.length > 0 ? 'warning' : 'pending'),
      detail: successfulReportTypes.length === 8
        ? '8 类单报表均有成功验证'
        : `已验证 ${canaryCoverageLabel}：${summarizeReportTypes(successfulReportTypes)}；缺 ${summarizeReportTypes(missingReportTypes, 8)}`,
    },
    {
      name: '8 报表采集',
      status: fullBatchDownloaded ? 'passed' : 'pending',
      detail: reportBatchResult && batchMatchesCurrentScope && (reportBatchResult.files?.length || 0) < 8
        ? `当前批次 ${reportBatchResult.batch?.id || '-'} 是单报表验证，不计入完整 8 报表采集`
        : (reportBatchResult
          ? `${fullCollectionDownloadedCount}/8 已下载，${failedReportCount} 失败，批次 ${reportBatchResult.batch?.id || '-'}`
          : '尚无当前范围完整批次'),
    },
    {
      name: '验收审计',
      status: fullBatchDownloaded ? 'pending' : 'blocked',
      detail: fullBatchDownloaded ? '可导出并检查审计包' : '需先完成当前范围 8 报表下载',
    },
  ];
  const activeGate = deliveryGates.find((gate) => gate.status !== 'passed');
  const collectionStartGate = deliveryGates
    .filter((gate) => ['采集范围', '页面模型', '同范围诊断'].includes(gate.name))
    .find((gate) => gate.status !== 'passed');
  const operatorNextStep = !currentScope.start || !currentScope.end || !currentScope.storeName || !currentScope.marketplaceCode
    ? '先补齐日期、店铺和站点范围。'
    : (!diagnosticPassedForCurrentScope
      ? '点击“验证页面”，刷新当前范围的页面诊断和截图/DOM 证据。'
      : (!pageModelReady
        ? (successfulReportTypes.length < 8
          ? `继续做单报表验证，当前还缺：${summarizeReportTypes(missingReportTypes, 8)}。`
          : '导出启用审计，通过后再保存已启用的页面模型。')
        : (fullBatchDownloaded
          ? '导出验收审计，检查完整 8 报表批次是否可以进入交付证据。'
          : '当前范围已满足启动条件，可以执行完整 8 报表采集。')));
  const reportFilesTable = reportBatchResult?.files?.length > 0 && (
    <table style={{ ...styles.table, marginBottom: '16px' }}>
      <thead>
        <tr>
          <th style={styles.th}>报告</th>
          <th style={styles.th}>类型</th>
          <th style={styles.th}>状态</th>
          <th style={styles.th}>自动重试</th>
          <th style={styles.th}>文件</th>
          <th style={styles.th}>失败原因</th>
          <th style={styles.th}>失败证据</th>
          <th style={styles.th}>操作</th>
        </tr>
      </thead>
      <tbody>
        {reportBatchResult.files.map((file: any) => (
          <tr key={file.id} style={styles.tr}>
            <td style={styles.td}>{file.displayName}</td>
            <td style={styles.td}>{reportTypeLabel(fileReportType(file))}</td>
            <td style={styles.td}>{file.status === 'downloaded' ? '已下载' : file.status === 'failed' ? '失败' : file.status}</td>
            <td style={styles.td}>{file.autoRetryCount ?? 0}/{file.maxAutoRetries ?? 2}</td>
            <td style={styles.td}><span style={styles.pathLine}>{file.filePath || '-'}</span></td>
            <td style={styles.td}>{file.errorMessage ? userFacingFileError(file.errorMessage) : '-'}</td>
            <td style={styles.td}>
              <div style={styles.buttonRow}>
                {file.failureScreenshotPath && <button onClick={() => openReportPath(file.failureScreenshotPath)} style={styles.btnSmall}>截图</button>}
                {file.failureDomSnapshotPath && <button onClick={() => openReportPath(file.failureDomSnapshotPath)} style={styles.btnSmall}>DOM</button>}
                {file.failureTracePath && <button onClick={() => openReportPath(file.failureTracePath)} style={styles.btnSmall}>Trace</button>}
              </div>
              {!file.failureTracePath && file.traceUnavailableReason && (
                <span style={styles.pathLine}>{file.traceUnavailableReason}</span>
              )}
            </td>
            <td style={styles.td}>
              {file.filePath && <button onClick={() => openReportPath(file.filePath)} style={styles.btnSmall}>打开</button>}
              {file.status === 'failed' && <button onClick={() => retryReport(file)} style={styles.btnSmall}>重试</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const keywordAsinOptions = Array.from(new Set(
    opportunities
      .map((item) => normalized(item.asin))
      .filter(Boolean),
  )).sort();
  const filteredOpportunities = opportunities.filter((item) => {
    const riskCount = item.riskFlags?.length || 0;
    return (keywordAsinFilter === '' || normalized(item.asin) === keywordAsinFilter)
      && (keywordLevelFilter === 'all' || item.opportunityLevel === keywordLevelFilter)
      && (keywordRiskFilter === 'all' || (keywordRiskFilter === 'safe' ? riskCount === 0 : riskCount > 0));
  });
  const highOpportunityCount = opportunities.filter((item) => item.opportunityLevel === 'high').length;
  const riskyOpportunityCount = opportunities.filter((item) => (item.riskFlags?.length || 0) > 0).length;
  const listingUsableOpportunityCount = opportunities.filter((item) => (item.riskFlags?.length || 0) === 0).length;
  const currentListingOpportunityCount = listing.asin
    ? opportunities.filter((item) => !item.asin || item.asin === listing.asin.trim()).length
    : 0;
  const acceptedSuggestionCount = suggestions.filter((item) => item.status === 'accepted').length;
  const listingWorkflowSteps: Array<{ name: string; status: DeliveryGateStatus; detail: string }> = [
    {
      name: '读取 Listing',
      status: lastListingReadEvidence ? 'passed' : (listing.asin || listing.title ? 'warning' : 'pending'),
      detail: lastListingReadEvidence
        ? describeListingReadStatus(lastListingReadEvidence)
        : (listing.asin || listing.title ? '已有手工/导入内容' : '等待领星只读读取或导入'),
    },
    {
      name: '生成建议',
      status: suggestions.length > 0 ? 'passed' : 'pending',
      detail: suggestions.length > 0 ? `${suggestions.length} 条建议` : '先准备 Listing 和关键词机会',
    },
    {
      name: '采纳建议',
      status: acceptedSuggestionCount > 0 ? 'passed' : (suggestions.length > 0 ? 'warning' : 'pending'),
      detail: acceptedSuggestionCount > 0 ? `${acceptedSuggestionCount} 条已采纳` : '草案只使用已采纳建议',
    },
    {
      name: '生成草案',
      status: drafts.length > 0 ? 'passed' : (acceptedSuggestionCount > 0 ? 'pending' : 'blocked'),
      detail: drafts.length > 0 ? `${drafts.length} 条草案` : '真实 AI 草案需 source=ai 证据',
    },
    {
      name: '导出交付',
      status: lastListingDraftExportPath ? 'passed' : (drafts.length > 0 ? 'pending' : 'blocked'),
      detail: lastListingDraftExportPath ? '已有最近草案导出' : '等待草案导出文件',
    },
  ];
  const sectionMeta = V15_SECTION_META[section];
  const applyReportScopePreset = (presetId: string) => {
    const preset = SCOPE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setDateStart(preset.start);
    setDateEnd(preset.end);
    setCollectionStoreName(preset.storeName);
    setCollectionMarketplaceCode(preset.marketplaceCode);
    setMessage(`已套用采集范围：${preset.description}`);
  };
  const copyAcceptanceCommands = async (label: string, commands: string[]) => {
    try {
      await navigator.clipboard.writeText(commands.join('\n'));
      setMessage(`已复制${label}命令；请在 PowerShell 项目根目录执行。`);
    } catch (e: any) {
      setMessage(toUserFacingError(e, `复制${label}命令失败`));
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.v15PageHeader}>
        <div style={styles.v15PageHeaderMain}>
          <div style={styles.pageKicker}>{sectionMeta.kicker}</div>
          <h2 style={styles.sectionTitle}>{v15SectionTitle(section)}</h2>
          <div style={styles.sectionDescription}>{sectionMeta.description}</div>
        </div>
        <div style={styles.sectionMetaRail}>
          <div style={styles.sectionMetaItem}>
            <span style={styles.sectionMetaLabel}>主任务</span>
            <strong style={styles.sectionMetaValue}>{sectionMeta.primaryTask}</strong>
          </div>
          <div style={styles.sectionMetaItem}>
            <span style={styles.sectionMetaLabel}>验收口径</span>
            <strong style={styles.sectionMetaValue}>{sectionMeta.proof}</strong>
          </div>
        </div>
      </div>
      {section === 'delivery' && (
      <div style={styles.deliveryOverview}>
        <div style={styles.deliveryOverviewHeader}>
          <div>
            <div style={styles.deliveryOverviewTitle}>交付状态：APP_READY 证据已闭环</div>
            <div style={styles.deliveryOverviewSubtitle}>报表采集、Listing 详情读取、真实 AI、广告建议解释、Listing AI 草案和一次真实广告 readback 均已进入 manifest 聚合；最终发布前还需刷新 READY 交付包和安装包。</div>
          </div>
          <div style={styles.statusPills}>
            <span style={styles.statusPillPassed}>APP_READY</span>
            <span style={styles.statusPillPassed}>广告 readback 已通过</span>
          </div>
        </div>
        <div style={styles.snapshotPanel}>
          <div style={styles.snapshotHeader}>
            <strong>{VERIFIED_DELIVERY_SNAPSHOT.title}</strong>
            <span style={styles.pathLine}>{VERIFIED_DELIVERY_SNAPSHOT.batchId}</span>
          </div>
          <div style={styles.snapshotGrid}>
            <div><span style={styles.deliveryStatLabel}>范围</span><strong>{VERIFIED_DELIVERY_SNAPSHOT.scope}</strong></div>
            <div><span style={styles.deliveryStatLabel}>报表</span><strong>{VERIFIED_DELIVERY_SNAPSHOT.reportCount}</strong></div>
            <div><span style={styles.deliveryStatLabel}>Listing</span><strong>{VERIFIED_DELIVERY_SNAPSHOT.listing}</strong></div>
          </div>
        </div>
        <div style={styles.deliveryGateGrid}>
          {PRODUCT_DELIVERY_GATES.map((gate) => (
            <div key={gate.name} style={styles.deliveryGateItem}>
              <div style={styles.deliveryGateItemHeader}>
                <span>{gate.name}</span>
                <span style={styles.deliveryGateBadge(gate.status)}>{DELIVERY_GATE_LABELS[gate.status]}</span>
              </div>
              <div style={styles.deliveryGateDetail}>{gate.detail}</div>
            </div>
          ))}
        </div>
        <div style={styles.readinessBoard}>
          <div style={styles.readinessColumn}>
            <div style={styles.readinessColumnTitle}>当前安全模式</div>
            <div style={styles.nextActionList}>
              {CURRENT_SAFE_MODE_ITEMS.map((item, index) => (
                <div key={item} style={styles.nextActionItem}>
                  <span style={styles.nextActionIndex}>{index + 1}</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={styles.readinessColumn}>
            <div style={styles.readinessColumnTitle}>后续验收动作</div>
            <div style={styles.nextActionList}>
              {PRODUCT_NEXT_ACTIONS.map((item, index) => (
                <div key={item} style={styles.nextActionItem}>
                  <span style={styles.nextActionIndex}>{index + 1}</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <details style={styles.technicalDetails}>
          <summary style={styles.technicalSummary}>技术验收详情</summary>
          <div style={styles.readinessBoard}>
            <div style={styles.readinessColumn}>
              <div style={styles.readinessColumnTitle}>交付证据</div>
              {PRODUCT_EVIDENCE_ITEMS.map((item) => (
                <div key={item.name} style={styles.evidenceRow}>
                  <div style={styles.evidenceMeta}>
                    <span style={styles.evidenceName}>{item.name}</span>
                    <span style={styles.pathLine}>{item.detail}</span>
                  </div>
                  <span style={styles.evidenceStatus}>{item.status}</span>
                </div>
              ))}
            </div>
            <div style={styles.readinessColumn}>
              <div style={styles.readinessColumnHeader}>
                <div style={styles.readinessColumnTitle}>验收命令</div>
                <div style={styles.buttonRow}>
                  <button onClick={() => copyAcceptanceCommands('AI 验收', AI_ACCEPTANCE_COMMANDS)} style={styles.btnTiny}>复制 AI 验收命令</button>
                  <button onClick={() => copyAcceptanceCommands('最终聚合', FINAL_ACCEPTANCE_COMMANDS)} style={styles.btnTiny}>复制最终聚合命令</button>
                </div>
              </div>
              <div style={styles.pathLine}>{[...AI_ACCEPTANCE_COMMANDS, ...FINAL_ACCEPTANCE_COMMANDS].join('\n')}</div>
            </div>
          </div>
        </details>
      </div>
      )}
      <div style={styles.panelGrid}>
        {section === 'reports' && (
        <div style={{ ...styles.panel, gridColumn: '1 / -1' }}>
          <h3 style={styles.panelTitle}>广告报告采集</h3>
          <div style={styles.noticeLine}>本区只证明当前日期、店铺、站点下的领星广告报表采集和审计证据；不等于 DeepSeek AI 草案或广告写操作已通过验收。</div>
          <div style={styles.deliveryGate}>
            <div style={styles.deliveryGateHeader}>
              <div>
                <div style={styles.deliveryGateTitle}>当前采集作业</div>
                <div style={styles.deliveryGateScope}>{scopeLabel}</div>
              </div>
              <div style={styles.deliveryGateFocus}>
                <div style={styles.nextStepLabel}>下一步</div>
                <div>{operatorNextStep}</div>
              </div>
            </div>
            <div style={styles.deliveryStats}>
              <div style={styles.deliveryStat}>
                <span style={styles.deliveryStatLabel}>页面诊断</span>
                <strong>{diagnosticPassedForCurrentScope ? '已匹配' : '待刷新'}</strong>
              </div>
              <div style={styles.deliveryStat}>
                <span style={styles.deliveryStatLabel}>单报表验证</span>
                <strong>{canaryCoverageLabel}</strong>
              </div>
              <div style={styles.deliveryStat}>
                <span style={styles.deliveryStatLabel}>完整采集</span>
                <strong>{fullBatchDownloaded ? '8/8' : `${fullCollectionDownloadedCount}/8`}</strong>
              </div>
            </div>
            <div style={styles.deliveryGateGrid}>
              {deliveryGates.map((gate) => (
                <div key={gate.name} style={styles.deliveryGateItem}>
                  <div style={styles.deliveryGateItemHeader}>
                    <span>{gate.name}</span>
                    <span style={styles.deliveryGateBadge(gate.status)}>{DELIVERY_GATE_LABELS[gate.status]}</span>
                  </div>
                  <div style={styles.deliveryGateDetail}>{gate.detail}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={styles.collectionWorkbench}>
            <div style={styles.scopePresetRow}>
              <div>
                <strong>常用范围</strong>
                <div style={styles.mutedSmall}>一键套用已验证 full-8 范围；切换后需重新验证页面，避免误用旧诊断。</div>
              </div>
              <select aria-label="广告报表范围预设" onChange={(e) => applyReportScopePreset(e.target.value)} defaultValue="" style={styles.scopePresetSelect}>
                <option value="" disabled>选择已验证范围</option>
                {SCOPE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}：{preset.description}</option>
                ))}
              </select>
            </div>
            <div style={styles.scopeGrid}>
              <label style={styles.fieldGroup}>
                <span style={styles.fieldLabel}>开始日期</span>
                <input value={dateStart} onChange={(e) => setDateStart(e.target.value)} style={styles.input} />
              </label>
              <label style={styles.fieldGroup}>
                <span style={styles.fieldLabel}>结束日期</span>
                <input value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} style={styles.input} />
              </label>
              <label style={styles.fieldGroup}>
                <span style={styles.fieldLabel}>店铺</span>
                <input
                  value={collectionStoreName}
                  onChange={(e) => setCollectionStoreName(e.target.value)}
                  placeholder="FT-US-US"
                  style={styles.input}
                />
              </label>
              <label style={styles.fieldGroup}>
                <span style={styles.fieldLabel}>站点</span>
                <input
                  value={collectionMarketplaceCode}
                  onChange={(e) => setCollectionMarketplaceCode(e.target.value)}
                  placeholder="US"
                  style={styles.input}
                />
              </label>
            </div>
            <div style={styles.actionRail}>
              <button onClick={diagnoseDownloadCenter} style={styles.btnSecondary}>验证页面</button>
              <button onClick={preflightCollection} style={styles.btnSecondary}>采集预检</button>
              <div style={styles.canaryControl}>
                <select aria-label="单报表验证类型" value={canaryReportType} onChange={(e) => setCanaryReportType(e.target.value)} style={styles.input}>
                  {LINGXING_REPORT_OPTIONS.map((item) => (
                    <option key={item.type} value={item.type}>{item.label}</option>
                  ))}
                </select>
                <button onClick={runCanaryReport} style={styles.btnSecondaryStrong}>单报表验证</button>
              </div>
              <button
                onClick={collectReports}
                disabled={Boolean(collectionStartGate)}
                title={collectionStartGate ? `${collectionStartGate.name}：${collectionStartGate.detail}` : '采集预检已满足，可以启动 8 报表采集'}
                style={collectionStartGate ? styles.btnDisabledLarge : styles.btnPrimary}
              >
                启动 8 报表采集
              </button>
            </div>
            <div style={styles.canaryPanel}>
            <div style={styles.canaryHeader}>
                <strong>单报表验证进度：{canaryCoverageLabel}</strong>
                <span>{staleBatchResult ? '上次批次不属于当前范围，未计入进度' : (successfulReportTypes.length === 8 ? '已满足启用审计前置条件' : '完整采集仍保持关闭')}</span>
              </div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${Math.min(100, (successfulReportTypes.length / 8) * 100)}%` }} />
              </div>
              <div style={styles.reportChipRow}>
                {LINGXING_REPORT_OPTIONS.map((item) => {
                  const covered = successfulReportTypes.includes(item.type);
                  return (
                    <span key={item.type} style={covered ? styles.reportChipDone : styles.reportChipMissing}>
                      {item.label}
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={styles.buttonRow}>
              <button onClick={() => setShowDownloadDiagnostics(!showDownloadDiagnostics)} style={styles.btnGhost}>
                {showDownloadDiagnostics ? '收起高级诊断' : '展开高级诊断'}
              </button>
              <button onClick={exportCollectionPreflight} style={styles.btnGhost}>导出预检</button>
              <button onClick={exportDownloadCenterDiagnosticBundle} style={styles.btnGhost}>导出证据包</button>
              <button onClick={exportDownloadCenterPageModelEnablementAudit} style={styles.btnGhost}>导出启用审计</button>
            </div>
          </div>
          {collectionStartGate && (
            <div style={styles.noticeLine}>完整采集暂未放行：{operatorNextStep}</div>
          )}
          {staleBatchResult && (
            <div style={styles.noticeLine}>上次批次范围为 {staleBatchScope}，不计入当前采集范围验收。请重新验证页面并执行当前范围单报表验证。</div>
          )}
          {collectionPreflight && (
            <div style={styles.businessSummary}>
              <div>采集预检：{collectionPreflight.ready ? '通过' : '未通过'}</div>
              <div>生成时间：{collectionPreflight.generatedAt}</div>
              <div style={styles.checkList}>
                {collectionPreflight.checks.map((check: any) => (
                  <div key={check.name} style={styles.checkItem}>
                    <span style={styles.deliveryGateBadge(check.status === 'passed' ? 'passed' : check.status === 'blocked' ? 'blocked' : 'warning')}>
                      {check.status === 'passed' ? '通过' : check.status === 'blocked' ? '阻塞' : '复核'}
                    </span>
                    <span>{userFacingPreflightCheckName(check.name)}</span>
                    {check.missing?.length ? <span style={styles.mutedText}>缺少 {check.missing.length} 项</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}
          {reportBatchResult && (
            <>
              <div style={styles.businessSummary}>
                <div>批次：{reportBatchResult.batch.id}</div>
                <div>状态：{reportBatchResult.batch.status}</div>
                <div>文件：{staleBatchResult ? '非当前范围' : `${downloadedReportCount}/8 已下载，${failedReportCount} 失败`}</div>
                <div style={styles.buttonRow}>
                  <button onClick={() => openReportPath(reportBatchResult.batch.downloadDir)} style={styles.btnSmall}>打开文件夹</button>
                  {reportBatchResult.batch.manifestPath && (
                    <button onClick={() => openReportPath(reportBatchResult.batch.manifestPath)} style={styles.btnSmall}>打开 Manifest</button>
                  )}
                  <button onClick={exportLingxingAcceptanceAudit} style={styles.btnSmall}>导出验收审计</button>
                </div>
              </div>
              {reportFilesTable && (
                <div style={styles.resultPanel}>
                  <div style={styles.resultPanelHeader}>
                    <strong>本次采集结果</strong>
                    <span>{staleBatchResult ? '非当前范围，仅供追溯' : '当前范围报表状态、文件和重试入口'}</span>
                  </div>
                  {reportFilesTable}
                </div>
              )}
            </>
          )}
          {showDownloadDiagnostics && (
            <div style={styles.diagnosticPanel}>
              <div style={styles.diagnosticPanelHeader}>
                <strong>高级诊断</strong>
                <span>页面模型、selector、证据路径和导出工具仅用于验收排障</span>
              </div>
              {downloadCenterPageModelInfo && (
                <div style={styles.summaryLine}>
                  <div>页面模型：{downloadCenterPageModelInfo.source}</div>
                  <div>自动下载结构：{downloadCenterPageModelInfo.readiness?.ready ? '已具备' : pageModelReason}</div>
                  {downloadCenterPageModelInfo.readiness?.missing?.length > 0 && (
                    <div>缺失：{downloadCenterPageModelInfo.readiness.missing.join(', ')}</div>
                  )}
                  {downloadCenterPageModelInfo.overrideError && (
                    <div style={styles.error}>本地 override 无效，当前已回退内置模型：{downloadCenterPageModelInfo.overrideError}</div>
                  )}
                  <div style={styles.pathLine}>{downloadCenterPageModelInfo.path}</div>
                </div>
              )}
              <textarea
                value={downloadCenterPageModelText}
                onChange={(e) => setDownloadCenterPageModelText(e.target.value)}
                spellCheck={false}
                style={{ ...styles.textarea, minHeight: '180px', fontFamily: 'Consolas, monospace' }}
              />
              <div style={styles.buttonRow}>
                <button onClick={exportDownloadCenterPageModelDraft} style={styles.btnSmall}>生成模型草稿</button>
                <button onClick={saveDownloadCenterPageModel} style={styles.btnSmall}>保存页面模型</button>
                <button onClick={loadDownloadCenterPageModel} style={styles.btnSmall}>重新读取</button>
                <button onClick={resetDownloadCenterPageModel} style={styles.btnSmall}>恢复内置模型</button>
              </div>
            </div>
          )}
        </div>
        )}
        {section === 'keywords' && (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>关键词机会</h3>
          <div style={styles.noticeLine}>机会表默认按 ASIN + 标准化关键词聚合，优先使用用户搜索词口径；campaign/ad_group/placement/推广商品报表只用于上下文或对账，不参与机会 KPI 叠加。</div>
          <div style={styles.stackedForm}>
            <select value={keywordSource} onChange={(e) => setKeywordSource(e.target.value)} style={styles.input}>
              <option value="search_term">搜索词报表</option>
              <option value="sqp">SQP 报表</option>
              <option value="keyword_report">关键词报表</option>
            </select>
            <select value={keywordDuplicateStrategy} onChange={(e) => setKeywordDuplicateStrategy(e.target.value as 'overwrite' | 'merge' | 'skip')} style={styles.input}>
              <option value="merge">重复文件：合并</option>
              <option value="overwrite">重复文件：覆盖</option>
              <option value="skip">重复文件：跳过</option>
            </select>
            <button onClick={selectKeywordReport} style={styles.btnSmall}>选择报表</button>
            <button onClick={importKeywordReport} style={styles.btnExecute}>导入并生成机会</button>
          </div>
          <div style={styles.summaryLine}>{selectedReportFile || '未选择文件'}</div>
          {keywordDiagnostics && (
            <div style={styles.summaryLine}>
              解析：{keywordDiagnostics.parsedRows}/{keywordDiagnostics.totalRows} 行，
              错误行 {keywordDiagnostics.invalidRows}，
              警告 {keywordDiagnostics.warnings?.length || 0}
              {((keywordDiagnostics.errors?.length || 0) + (keywordDiagnostics.warnings?.length || 0)) > 0 && (
                <button onClick={exportKeywordDiagnostics} style={{ ...styles.btnSmall, marginLeft: '8px' }}>导出诊断</button>
              )}
            </div>
          )}
          <div style={styles.keywordSummaryGrid}>
            <div style={styles.keywordSummaryItem}>
              <span>机会总数</span>
              <strong>{opportunities.length}</strong>
            </div>
            <div style={styles.keywordSummaryItem}>
              <span>高机会</span>
              <strong>{highOpportunityCount}</strong>
            </div>
            <div style={styles.keywordSummaryItem}>
              <span>含风险</span>
              <strong>{riskyOpportunityCount}</strong>
            </div>
            <div style={styles.keywordSummaryItem}>
              <span>可用于 Listing</span>
              <strong>{listingUsableOpportunityCount}</strong>
            </div>
          </div>
          {opportunities.length > 0 && (
            <>
              <div style={styles.filterRow}>
                <select value={keywordAsinFilter} onChange={(e) => setKeywordAsinFilter(e.target.value)} style={styles.input}>
                  <option value="">全部 ASIN</option>
                  {keywordAsinOptions.map((asin) => <option key={asin} value={asin}>{asin}</option>)}
                </select>
                <select value={keywordLevelFilter} onChange={(e) => setKeywordLevelFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')} style={styles.input}>
                  <option value="all">全部等级</option>
                  <option value="high">高机会</option>
                  <option value="medium">中机会</option>
                  <option value="low">低机会</option>
                </select>
                <select value={keywordRiskFilter} onChange={(e) => setKeywordRiskFilter(e.target.value as 'all' | 'safe' | 'risk')} style={styles.input}>
                  <option value="all">全部风险</option>
                  <option value="safe">无风险标记</option>
                  <option value="risk">仅看风险项</option>
                </select>
              </div>
              <div style={styles.noticeLine}>
                下一步：填写或导入 Listing ASIN 后生成 Listing 建议。
                {listing.asin ? ` 当前 ASIN 可用机会 ${currentListingOpportunityCount} 条。` : ' 当前未填写 ASIN。'}
              </div>
            </>
          )}
        </div>
        )}
        {section === 'listing' && (
        <div style={{ ...styles.panel, gridColumn: '1 / -1' }}>
          <h3 style={styles.panelTitle}>Listing 建议</h3>
          <div style={styles.noticeLine}>Listing 建议支持 Excel/手工内容导入，也支持从当前领星 Listing 页面只读读取；读取成功会保留 URL、截图和字段命中证据。未通过 AI 连接测试时会生成规则草案并记录回退原因。</div>
          <div style={styles.workflowStrip}>
            {listingWorkflowSteps.map((step, index) => (
              <div key={step.name} style={styles.workflowStep}>
                <div style={styles.workflowStepHeader}>
                  <span style={styles.nextActionIndex}>{index + 1}</span>
                  <strong>{step.name}</strong>
                  <span style={styles.deliveryGateBadge(step.status)}>{DELIVERY_GATE_LABELS[step.status]}</span>
                </div>
                <div style={styles.workflowStepDetail}>{step.detail}</div>
              </div>
            ))}
          </div>
          <div style={styles.inlineForm}>
            <input
              value={listingReadUrl}
              onChange={(e) => setListingReadUrl(e.target.value)}
              placeholder="领星 Listing URL"
              style={styles.input}
            />
            <button onClick={openLingxingListingAndExtract} disabled={listingReadLoading} style={styles.btnExecute}>
              {listingReadLoading ? '正在读取' : '打开 URL 并读取'}
            </button>
          </div>
          <div style={styles.listingGrid}>
            <input
              value={listing.asin}
              onChange={(e) => setListing({ ...listing, asin: e.target.value })}
              placeholder="ASIN"
              style={styles.input}
            />
            <input
              value={listing.title}
              onChange={(e) => setListing({ ...listing, title: e.target.value })}
              placeholder="标题"
              style={styles.input}
            />
            <textarea
              value={listing.bulletsText}
              onChange={(e) => setListing({ ...listing, bulletsText: e.target.value })}
              placeholder="五点描述，每行一条"
              style={styles.textarea}
            />
            <textarea
              value={listing.backendTerms}
              onChange={(e) => setListing({ ...listing, backendTerms: e.target.value })}
              placeholder="Search Terms / Backend Terms"
              style={styles.textarea}
            />
            <textarea
              value={listing.aPlus}
              onChange={(e) => setListing({ ...listing, aPlus: e.target.value })}
              placeholder="A+ 文案"
              style={styles.textarea}
            />
            <textarea
              value={listing.imageCopy}
              onChange={(e) => setListing({ ...listing, imageCopy: e.target.value })}
              placeholder="图片文案"
              style={styles.textarea}
            />
          </div>
          <div style={styles.buttonRow}>
            <button onClick={importListingContent} style={styles.btnSmall}>导入 Listing Excel</button>
            <button onClick={extractListingFromLingxing} disabled={listingReadLoading} style={styles.btnExecute}>
              {listingReadLoading ? '正在读取领星页面' : '从当前领星页面读取'}
            </button>
            <button onClick={probeLingxingListingDetailAndExtract} disabled={listingReadLoading} style={styles.btnExecute}>
              {listingReadLoading ? '正在探测详情页' : '只读探测详情页'}
            </button>
            <button onClick={runListingAnalysis} style={styles.btnExecute}>生成建议</button>
            <button onClick={generateDrafts} disabled={acceptedSuggestionCount === 0} style={styles.btnExecute}>用已采纳建议生成草案</button>
            <button onClick={() => exportSuggestions('csv')} disabled={suggestions.length === 0} style={styles.btnSmall}>导出 CSV</button>
            <button onClick={() => exportSuggestions('xlsx')} disabled={suggestions.length === 0} style={styles.btnSmall}>导出 Excel</button>
            <button onClick={() => exportSuggestions('markdown')} disabled={suggestions.length === 0} style={styles.btnSmall}>导出 Markdown</button>
            <button onClick={() => exportDrafts('csv')} disabled={drafts.length === 0} style={styles.btnSmall}>导出草案 CSV</button>
            <button onClick={() => exportDrafts('xlsx')} disabled={drafts.length === 0} style={styles.btnSmall}>导出草案 Excel</button>
            <button onClick={() => exportDrafts('markdown')} disabled={drafts.length === 0} style={styles.btnSmall}>导出草案 Markdown</button>
            <button onClick={() => openReportPath(lastListingDraftExportPath)} disabled={!lastListingDraftExportPath} style={styles.btnSmall}>打开最近草案导出</button>
          </div>
          <div style={styles.summaryLine}>建议数：{suggestions.length}；已采纳：{acceptedSuggestionCount}</div>
          {lastListingDraftExportPath && (
            <div style={styles.pathLine}>最近草案导出：{lastListingDraftExportPath}</div>
          )}
          {lastListingReadEvidence && (
            <div style={styles.evidencePanel}>
              <div>领星读取证据：{lastListingReadEvidence.pageTitle || '-'}</div>
              <div>读取状态：{describeListingReadStatus(lastListingReadEvidence)}</div>
              {lastListingReadEvidence.detailProbe && (
                <div>
                  详情探测：{lastListingReadEvidence.detailProbe.status || '-'}；
                  点击 {lastListingReadEvidence.detailProbe.clicked ? '是' : '否'}；
                  ASIN 校验 {lastListingReadEvidence.detailProbe.asinMatched ? '通过' : '未通过/未尝试'}
                  {lastListingReadEvidence.detailProbe.reason ? `；${lastListingReadEvidence.detailProbe.reason}` : ''}
                </div>
              )}
              <div style={styles.pathLine}>URL：{lastListingReadEvidence.pageUrl || '-'}</div>
              <div>字段完整性：ASIN {lastListingReadEvidence.completeness?.asin ? '通过' : '缺失'}；标题 {lastListingReadEvidence.completeness?.title ? '通过' : '缺失'}；五点 {lastListingReadEvidence.completeness?.bullets ? '通过' : '缺失'}；后台词 {lastListingReadEvidence.completeness?.backendTerms ? '通过' : '缺失'}</div>
              {Array.isArray(lastListingReadEvidence.detailCandidates) && lastListingReadEvidence.detailCandidates.length > 0 && (
                <div style={styles.mutedSmall}>
                  只读发现详情入口候选 {lastListingReadEvidence.detailCandidates.length} 个：
                  {lastListingReadEvidence.detailCandidates.slice(0, 3).map((candidate: any) => candidate.text || candidate.href || candidate.selectorHint).filter(Boolean).join('；')}
                </div>
              )}
              {lastListingReadEvidence.screenshotPath && (
                <button onClick={() => openReportPath(lastListingReadEvidence.screenshotPath)} style={styles.btnSmall}>打开读取截图</button>
              )}
            </div>
          )}
        </div>
        )}
      </div>
      {message && <div style={styles.notice}>{message}</div>}
      {section === 'reports' && showDownloadDiagnostics && (
        <>
          {downloadCenterDiagnostic && (
            <table style={{ ...styles.table, marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th style={styles.th}>页面模型</th>
                  <th style={styles.th}>URL</th>
                  <th style={styles.th}>只读识别</th>
                  <th style={styles.th}>截图</th>
                  <th style={styles.th}>DOM</th>
                  <th style={styles.th}>命中文本</th>
                  <th style={styles.th}>命中报告</th>
                  <th style={styles.th}>缺失必需选择器</th>
                  <th style={styles.th}>候选选择器</th>
                  <th style={styles.th}>动作选择器</th>
                </tr>
              </thead>
              <tbody>
                <tr style={styles.tr}>
                  <td style={styles.td}>{downloadCenterDiagnostic.pageModel}</td>
                  <td style={styles.td}><span style={styles.pathLine}>{downloadCenterDiagnostic.url}</span></td>
                  <td style={styles.td}>{downloadCenterDiagnostic.ready ? '通过' : '未通过'}</td>
                  <td style={styles.td}>
                    {downloadCenterDiagnostic.screenshotPath
                      ? <button onClick={() => openReportPath(downloadCenterDiagnostic.screenshotPath)} style={styles.btnSmall}>打开截图</button>
                      : '-'}
                  </td>
                  <td style={styles.td}>
                    {downloadCenterDiagnostic.domSnapshotPath
                      ? <button onClick={() => openReportPath(downloadCenterDiagnostic.domSnapshotPath)} style={styles.btnSmall}>打开 DOM</button>
                      : '-'}
                  </td>
                  <td style={styles.td}>{downloadCenterDiagnostic.matchedEntryHints?.join(', ') || '-'}</td>
                  <td style={styles.td}>{downloadCenterDiagnostic.matchedReportNames?.join(', ') || '-'}</td>
                  <td style={styles.td}>{downloadCenterDiagnostic.missingRequiredSelectors?.join(', ') || '-'}</td>
                  <td style={styles.td}>{downloadCenterDiagnostic.selectorCandidates?.length || 0}</td>
                  <td style={styles.td}>
                    {(downloadCenterDiagnostic.actionSelectorChecks || []).filter((check: any) => check.usable).length}
                    /
                    {downloadCenterDiagnostic.actionSelectorChecks?.length || 0}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          {downloadCenterDiagnostic?.actionSelectorChecks?.length > 0 && (
            <table style={{ ...styles.table, marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th style={styles.th}>动作</th>
                  <th style={styles.th}>报告</th>
                  <th style={styles.th}>必需</th>
                  <th style={styles.th}>命中数</th>
                  <th style={styles.th}>可用</th>
                  <th style={styles.th}>selector</th>
                  <th style={styles.th}>错误</th>
                </tr>
              </thead>
              <tbody>
                {downloadCenterDiagnostic.actionSelectorChecks.map((check: any, index: number) => (
                  <tr key={`${check.name}-${check.reportType || 'global'}-${index}`} style={styles.tr}>
                    <td style={styles.td}>{check.name}</td>
                    <td style={styles.td}>{check.reportDisplayName || '-'}</td>
                    <td style={styles.td}>{check.required ? '是' : '否'}</td>
                    <td style={styles.td}>{check.matchCount}</td>
                    <td style={styles.td}>{check.usable ? '可用' : check.ambiguous ? '过宽' : '不可用'}</td>
                    <td style={styles.td}><span style={styles.pathLine}>{check.renderedSelector || check.selector}</span></td>
                    <td style={styles.td}>{check.errorMessage || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {downloadCenterDiagnostic?.selectorCandidates?.length > 0 && (
            <table style={{ ...styles.table, marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th style={styles.th}>用途</th>
                  <th style={styles.th}>文本</th>
                  <th style={styles.th}>标签</th>
                  <th style={styles.th}>唯一</th>
                  <th style={styles.th}>候选 selector</th>
                </tr>
              </thead>
              <tbody>
                {downloadCenterDiagnostic.selectorCandidates.slice(0, 20).map((candidate: any, index: number) => (
                  <tr key={`${candidate.selector}-${index}`} style={styles.tr}>
                    <td style={styles.td}>{candidate.role}</td>
                    <td style={styles.td}>{candidate.text}</td>
                    <td style={styles.td}>{candidate.tagName}</td>
                    <td style={styles.td}>{candidate.unique ? '是' : `否 (${candidate.matchCount ?? '-'})`}</td>
                    <td style={styles.td}><span style={styles.pathLine}>{candidate.selector}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {section === 'keywords' && opportunities.length > 0 && (
        <table style={{ ...styles.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>ASIN</th>
              <th style={styles.th}>关键词</th>
              <th style={styles.th}>等级</th>
              <th style={styles.th}>分数</th>
              <th style={styles.th}>点击/订单</th>
              <th style={styles.th}>花费/销售</th>
              <th style={styles.th}>ACOS</th>
              <th style={styles.th}>建议位置</th>
              <th style={styles.th}>风险</th>
            </tr>
          </thead>
          <tbody>
            {filteredOpportunities.slice(0, 50).map((item, index) => {
              const evidence = parseOpportunityEvidence(item.evidence);
              return (
                <tr key={`${item.asin || 'all'}-${item.normalizedKeyword}-${index}`} style={styles.tr}>
                  <td style={styles.td}>{item.asin || '-'}</td>
                  <td style={styles.td}>{item.normalizedKeyword}</td>
                  <td style={styles.td}>{opportunityLevelLabel(item.opportunityLevel)}</td>
                  <td style={styles.td}>{Number(item.score || 0).toFixed(1)}</td>
                  <td style={styles.td}>
                    <div>{evidence.clicks || '-'} / {evidence.orders || '-'}</div>
                    <div style={styles.mutedSmall}>曝光 {evidence.impressions || '-'}；CVR {evidence.cvr || '-'}</div>
                  </td>
                  <td style={styles.td}>
                    <div>{evidence.cost || '-'} / {evidence.sales || '-'}</div>
                    <div style={styles.mutedSmall}>{formatOpportunitySourceTrace(evidence) || '来源未记录'}</div>
                  </td>
                  <td style={styles.td}>{evidence.acos || '-'}</td>
                  <td style={styles.td}>{(item.recommendedSections || []).map(listingSectionLabel).join('、') || '-'}</td>
                  <td style={styles.td}>{item.riskFlags?.join(', ') || '无'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {section === 'listing' && suggestions.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>关键词</th>
              <th style={styles.th}>位置</th>
              <th style={styles.th}>当前文案</th>
              <th style={styles.th}>建议文案</th>
              <th style={styles.th}>风险</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((item, index) => (
              <tr key={`${item.keyword}-${index}`} style={styles.tr}>
                <td style={styles.td}>{item.keyword}</td>
                <td style={styles.td}>{item.section}</td>
                <td style={styles.td}>{item.currentText || '-'}</td>
                <td style={styles.td}>{item.suggestedText}</td>
                <td style={styles.td}>{item.riskWarnings?.join(', ') || '-'}</td>
                <td style={styles.td}>{item.status}</td>
                <td style={styles.td}>
                  <button onClick={() => updateSuggestionStatus(item, 'accepted')} style={styles.btnApprove}>标记采纳</button>
                  <button onClick={() => updateSuggestionStatus(item, 'ignored')} style={styles.btnReject}>标记忽略</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {section === 'listing' && drafts.length > 0 && (
        <table style={{ ...styles.table, marginTop: '16px' }}>
          <thead>
            <tr>
              <th style={styles.th}>位置</th>
              <th style={styles.th}>关键词</th>
              <th style={styles.th}>原文 / 草案</th>
              <th style={styles.th}>证据 / AI 回退</th>
              <th style={styles.th}>来源 / 风险</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((item, index) => (
              <tr key={`${item.section}-${index}`} style={styles.tr}>
                <td style={styles.td}>{listingSectionLabel(item.section)}</td>
                <td style={styles.td}>{item.keywords?.join(', ')}</td>
                <td style={styles.td}>
                  <div style={styles.mutedSmall}>当前原文</div>
                  <div>{item.currentText || '-'}</div>
                  <div style={{ ...styles.mutedSmall, marginTop: '8px' }}>修改草案</div>
                  <div>{item.draftedText}</div>
                </td>
                <td style={styles.td}>
                  <div>{item.evidence || '-'}</div>
                  <div style={styles.mutedSmall}>AI 回退：{item.aiFallbackReason || '无'}</div>
                </td>
                <td style={styles.td}>
                  <div>{item.source === 'ai' ? 'AI' : '规则'}</div>
                  <div style={styles.mutedSmall}>{item.riskWarnings?.join(', ') || '无风险提示'}</div>
                </td>
                <td style={styles.td}>
                  <button onClick={() => copyDraftText(item)} style={styles.btnSmall}>复制草案</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Main App Shell
export default function App() {
  const { isLoggedIn, currentStore, loginSession, activeTab, setActiveTab, setLoginState } = useStore();

  useEffect(() => {
    checkLoginState();
  }, []);

  const checkLoginState = async () => {
    const state = await (window as any).electronAPI.getState();
    setLoginState(state.isLoggedIn, state.currentStore, state.loginSession || null);
  };

  const handleLogout = async () => {
    await (window as any).electronAPI.browserLogout();
    setLoginState(false);
  };

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  const navGroups = [
    {
      label: '运营总览',
      items: [
        { id: 'dashboard', label: '仪表盘' },
      ],
    },
    {
      label: '广告运营',
      items: [
        { id: 'v15-reports', label: '广告报表' },
        { id: 'recommendations', label: '优化建议' },
      ],
    },
    {
      label: '关键词与 Listing',
      items: [
        { id: 'v15-keywords', label: '关键词机会' },
        { id: 'v15-listing', label: 'Listing 优化' },
      ],
    },
    {
      label: '交付与系统',
      items: [
        { id: 'v15-delivery', label: '交付验收' },
        { id: 'scheduler', label: '定时任务' },
        { id: 'settings', label: '设置' },
      ],
    },
  ];
  const v15SectionByTab: Record<string, V15Section> = {
    v15: 'delivery',
    'v15-delivery': 'delivery',
    'v15-reports': 'reports',
    'v15-keywords': 'keywords',
    'v15-listing': 'listing',
  };
  const activeV15Section = v15SectionByTab[activeTab];

  return (
    <div style={styles.appShell}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>Amazon AI Ops</span>
          <span style={styles.version}>v1.5.0</span>
          <span style={styles.headerStatusPill}>APP_READY</span>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.storeName}>{currentStore}</span>
          <span style={styles.sessionStatus}>{describeLoginSession(loginSession)}</span>
          <button onClick={handleLogout} style={styles.logoutButton}>退出登录</button>
        </div>
      </header>

      {/* Body */}
      <div style={styles.body}>
        {/* Sidebar */}
        <nav style={styles.sidebar}>
          {navGroups.map((group) => (
            <div key={group.label} style={styles.navGroup}>
              <div style={styles.navGroupLabel}>{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  style={{ ...styles.navItem, ...(activeTab === item.id ? styles.navItemActive : {}) }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Content */}
        <main style={styles.content}>
          {activeTab === 'dashboard' && <Dashboard />}
          {activeV15Section && <V15Workspace section={activeV15Section} />}
          {activeTab === 'recommendations' && <Recommendations />}
          {activeTab === 'scheduler' && <Scheduler />}
          {activeTab === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}

// Styles
const styles: any = {
  appShell: { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f5f5f5' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '12px 24px', background: '#001529', color: '#fff', flexWrap: 'wrap' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  logo: { fontSize: '18px', fontWeight: 'bold' },
  version: { fontSize: '12px', color: '#ffffff99' },
  headerStatusPill: { border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', fontWeight: 700, letterSpacing: 0 },
  storeName: { fontSize: '14px' },
  sessionStatus: { maxWidth: '520px', color: '#ffffffcc', fontSize: '12px', lineHeight: 1.35, overflowWrap: 'anywhere' },
  logoutButton: { padding: '6px 16px', background: '#ff4d4f', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '13px' },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: { width: '216px', background: '#fff', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', padding: '8px 0', overflowY: 'auto' },
  navGroup: { padding: '6px 0 8px', borderBottom: '1px solid #f3f4f6' },
  navGroupLabel: { padding: '8px 24px 6px', color: '#8c8c8c', fontSize: '11px', fontWeight: 800, letterSpacing: 0 },
  navItem: {
    padding: '10px 24px',
    background: 'none',
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#333',
    width: '100%',
  },
  navItemActive: { background: '#e6f7ff', color: '#1890ff', borderRightWidth: '3px', borderRightColor: '#1890ff' },
  content: { flex: 1, overflow: 'auto', padding: '24px' },
  loginContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#001529' },
  loginCard: { background: '#fff', padding: '48px', borderRadius: '8px', width: '400px', textAlign: 'center' },
  loginTitle: { margin: '0 0 8px', fontSize: '24px', color: '#333' },
  loginSubtitle: { margin: '0 0 32px', color: '#999', fontSize: '14px' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: '16px' },
  loginFlowHint: { color: '#666', fontSize: '12px', lineHeight: 1.45, textAlign: 'left' },
  input: { padding: '12px 16px', borderRadius: '4px', border: '1px solid #d9d9d9', fontSize: '14px', width: '100%', boxSizing: 'border-box' },
  loginButton: { padding: '12px', background: '#1890ff', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '16px', cursor: 'pointer' },
  error: { color: '#ff4d4f', fontSize: '14px', textAlign: 'left' },
  dashboard: { padding: '0 8px' },
  page: { padding: '0 8px' },
  v15PageHeader: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', alignItems: 'stretch', marginBottom: '16px' },
  v15PageHeaderMain: { minWidth: 0 },
  pageKicker: { color: '#52606d', fontSize: '12px', fontWeight: 800, marginBottom: '5px' },
  sectionTitle: { fontSize: '20px', fontWeight: 'bold', margin: '0', color: '#333' },
  sectionDescription: { marginTop: '8px', color: '#52606d', fontSize: '13px', lineHeight: 1.5, maxWidth: '780px' },
  sectionMetaRail: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' },
  sectionMetaItem: { minWidth: 0, border: '1px solid #e8edf3', borderRadius: '6px', background: '#fff', padding: '10px 12px', display: 'grid', gap: '5px' },
  sectionMetaLabel: { color: '#64748b', fontSize: '11px', fontWeight: 700 },
  sectionMetaValue: { color: '#1f2937', fontSize: '12px', lineHeight: 1.35, overflowWrap: 'anywhere' },
  panelGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' },
  panel: { background: '#fff', border: '1px solid #eee', borderRadius: '6px', padding: '16px', minWidth: 0 },
  panelTitle: { fontSize: '15px', fontWeight: 700, margin: '0 0 12px', color: '#333' },
  deliveryOverview: { background: '#fff', border: '1px solid #d9e2ec', borderRadius: '6px', padding: '14px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' },
  deliveryOverviewHeader: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '12px' },
  deliveryOverviewTitle: { fontSize: '15px', fontWeight: 800, color: '#1f2933' },
  deliveryOverviewSubtitle: { marginTop: '4px', color: '#52606d', fontSize: '12px', lineHeight: 1.45 },
  statusPills: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  statusPillPassed: { border: '1px solid #95de64', background: '#f6ffed', color: '#237804', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', fontWeight: 700 },
  statusPillBlocked: { border: '1px solid #ffa39e', background: '#fff1f0', color: '#a8071a', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', fontWeight: 700 },
  snapshotPanel: { border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: '6px', padding: '10px 12px', marginBottom: '10px' },
  snapshotHeader: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', color: '#1f2937', fontSize: '13px', marginBottom: '8px' },
  snapshotGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px', color: '#334155', fontSize: '12px' },
  deliveryGate: { border: '1px solid #e8e8e8', borderRadius: '6px', padding: '12px', marginBottom: '12px', background: '#fafafa' },
  deliveryGateHeader: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap' },
  deliveryGateTitle: { fontSize: '14px', fontWeight: 700, color: '#333' },
  deliveryGateScope: { marginTop: '4px', color: '#666', fontSize: '12px', wordBreak: 'break-word' },
  deliveryGateFocus: { maxWidth: '520px', color: '#333', fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-word' },
  nextStepLabel: { color: '#666', fontSize: '12px', marginBottom: '2px' },
  deliveryStats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', marginBottom: '10px' },
  deliveryStat: { background: '#fff', border: '1px solid #ededed', borderRadius: '6px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' },
  deliveryStatLabel: { color: '#666', fontSize: '12px' },
  deliveryGateGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' },
  deliveryGateItem: { minWidth: 0, minHeight: '74px', padding: '10px', border: '1px solid #eee', borderRadius: '6px', background: '#fff' },
  deliveryGateItemHeader: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', color: '#333', fontSize: '13px', fontWeight: 600 },
  deliveryGateDetail: { marginTop: '6px', color: '#666', fontSize: '12px', lineHeight: 1.45, wordBreak: 'break-word' },
  deliveryGateBadge: (status: DeliveryGateStatus) => {
    const palette: Record<DeliveryGateStatus, { background: string; color: string }> = {
      passed: { background: '#f6ffed', color: '#389e0d' },
      blocked: { background: '#fff1f0', color: '#cf1322' },
      pending: { background: '#e6f7ff', color: '#0958d9' },
      warning: { background: '#fffbe6', color: '#ad6800' },
    };
    return { display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', whiteSpace: 'nowrap', ...palette[status] };
  },
  readinessBoard: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginTop: '10px' },
  readinessColumn: { minWidth: 0, border: '1px solid #e8edf3', borderRadius: '6px', background: '#fbfdff', padding: '10px' },
  readinessColumnTitle: { color: '#334155', fontSize: '12px', fontWeight: 800, marginBottom: '8px' },
  readinessColumnHeader: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '8px' },
  inlineActions: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  evidenceRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '10px', alignItems: 'center', borderTop: '1px solid #eef2f7', padding: '8px 0' },
  evidenceMeta: { minWidth: 0, display: 'grid', gap: '3px' },
  evidenceName: { color: '#1f2937', fontSize: '12px', fontWeight: 700 },
  evidenceStatus: { border: '1px solid #d9e2ec', background: '#fff', color: '#334155', borderRadius: '4px', padding: '3px 6px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' },
  nextActionList: { display: 'grid', gap: '7px' },
  nextActionItem: { display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: '8px', color: '#475569', fontSize: '12px', lineHeight: 1.45 },
  nextActionIndex: { width: '18px', height: '18px', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#334155', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 },
  technicalDetails: { marginTop: '10px', borderTop: '1px solid #e5e7eb', paddingTop: '8px' },
  technicalSummary: { cursor: 'pointer', color: '#334155', fontSize: '12px', fontWeight: 700 },
  inlineForm: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', alignItems: 'center', minWidth: 0 },
  collectionWorkbench: { display: 'grid', gap: '12px', marginBottom: '12px' },
  scopeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' },
  scopePresetRow: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(260px, 420px)', gap: '12px', alignItems: 'center', padding: '10px 0 14px', borderBottom: '1px solid #eef1f4', marginBottom: '12px' },
  scopePresetSelect: { width: '100%', height: '40px', padding: '0 10px', border: '1px solid #d9d9d9', borderRadius: '4px', fontSize: '14px', background: '#fff', boxSizing: 'border-box' },
  fieldGroup: { display: 'grid', gap: '5px', minWidth: 0 },
  fieldLabel: { color: '#555', fontSize: '12px', fontWeight: 600 },
  actionRail: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', alignItems: 'stretch' },
  canaryControl: { display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(110px, auto)', gap: '8px', alignItems: 'center', minWidth: 0 },
  canaryPanel: { border: '1px solid #e8e8e8', borderRadius: '6px', padding: '12px', background: '#fff' },
  canaryHeader: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', color: '#333', fontSize: '13px', marginBottom: '8px', flexWrap: 'wrap' },
  progressTrack: { height: '8px', background: '#f0f0f0', borderRadius: '999px', overflow: 'hidden', marginBottom: '10px' },
  progressFill: { height: '100%', background: '#1890ff', borderRadius: '999px' },
  reportChipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  reportChipDone: { border: '1px solid #b7eb8f', background: '#f6ffed', color: '#237804', borderRadius: '4px', padding: '3px 7px', fontSize: '12px' },
  reportChipMissing: { border: '1px solid #e8e8e8', background: '#fafafa', color: '#666', borderRadius: '4px', padding: '3px 7px', fontSize: '12px' },
  noticeLine: { margin: '8px 0 12px', color: '#8c6d1f', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '4px', padding: '8px 10px', fontSize: '12px', lineHeight: 1.45 },
  workflowStrip: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '12px' },
  workflowStep: { minWidth: 0, border: '1px solid #e8edf3', borderRadius: '6px', background: '#fbfdff', padding: '10px' },
  workflowStepHeader: { display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap', color: '#1f2937', fontSize: '12px' },
  workflowStepDetail: { marginTop: '6px', color: '#64748b', fontSize: '12px', lineHeight: 1.4, overflowWrap: 'anywhere' },
  evidencePanel: { marginTop: '10px', color: '#31415f', background: '#f7fbff', border: '1px solid #b7d8ff', borderRadius: '4px', padding: '8px 10px', fontSize: '12px', lineHeight: 1.5, display: 'grid', gap: '6px' },
  stackedForm: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', alignItems: 'center', minWidth: 0 },
  listingGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: '10px', marginBottom: '12px' },
  textarea: { padding: '12px 16px', borderRadius: '4px', border: '1px solid #d9d9d9', fontSize: '14px', width: '100%', minHeight: '88px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' },
  buttonRow: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  summaryLine: { marginTop: '12px', color: '#666', fontSize: '13px' },
  businessSummary: { marginTop: '12px', color: '#333', fontSize: '13px', background: '#fafafa', border: '1px solid #eee', borderRadius: '6px', padding: '10px 12px', display: 'grid', gap: '6px' },
  checkList: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px' },
  checkItem: { display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid #eee', background: '#fff', borderRadius: '4px', padding: '4px 7px' },
  readbackTemplateGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px', marginTop: '4px' },
  candidatePanel: { border: '1px solid #d8e3f5', background: '#ffffff', borderRadius: '4px', padding: '8px', display: 'grid', gap: '8px' },
  candidateGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' },
  candidateCell: { display: 'grid', gap: '2px', padding: '7px 9px', border: '1px solid #e4e9f2', borderRadius: '4px', background: '#f8fafc', color: '#1f2937', fontSize: '12px', lineHeight: 1.35 },
  readbackEntryPanel: { border: '1px solid #d8e3f5', background: '#fff', borderRadius: '4px', padding: '8px', display: 'grid', gap: '9px' },
  formSectionTitle: { marginTop: '2px', paddingTop: '4px', borderTop: '1px solid #eef2f7', color: '#334155', fontSize: '12px', fontWeight: 800 },
  precheckPanelBlocked: { border: '1px solid #fecaca', background: '#fff7f7', borderRadius: '4px', padding: '8px', display: 'grid', gap: '6px' },
  precheckPanelReady: { border: '1px solid #fde68a', background: '#fffdf2', borderRadius: '4px', padding: '8px', display: 'grid', gap: '6px' },
  precheckList: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  precheckItemBlocked: { border: '1px solid #fecaca', background: '#fff', color: '#991b1b', borderRadius: '4px', padding: '4px 7px', fontSize: '12px', lineHeight: 1.35 },
  precheckItemReady: { border: '1px solid #fde68a', background: '#fff', color: '#92400e', borderRadius: '4px', padding: '4px 7px', fontSize: '12px', lineHeight: 1.35 },
  readbackSwitchGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '7px' },
  readbackEntryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '6px', minHeight: '30px', border: '1px solid #eef2f7', borderRadius: '4px', padding: '5px 7px', background: '#f8fafc', color: '#334155', fontSize: '12px' },
  warningList: { display: 'grid', gap: '3px', color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '4px', padding: '7px 9px', fontSize: '12px', lineHeight: 1.4 },
  templateField: { padding: '7px 9px', border: '1px solid #eee3bf', borderRadius: '4px', background: '#fffaf0', color: '#6b5200', fontSize: '12px', lineHeight: 1.35 },
  mutedText: { color: '#888' },
  mutedSmall: { color: '#888', fontSize: '12px', lineHeight: 1.4, marginTop: '2px' },
  diagnosticPanel: { marginTop: '12px', border: '1px solid #d9d9d9', borderRadius: '6px', padding: '12px', background: '#fcfcfc' },
  diagnosticPanelHeader: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', color: '#555', fontSize: '12px' },
  resultPanel: { marginTop: '12px', borderTop: '1px solid #e8e8e8', paddingTop: '12px' },
  resultPanelHeader: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px', color: '#555', fontSize: '12px' },
  keywordSummaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(90px, 1fr))', gap: '8px', marginTop: '12px' },
  keywordSummaryItem: { border: '1px solid #e8e8e8', borderRadius: '6px', padding: '8px', background: '#fff', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#555' },
  filterRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: '8px', marginTop: '12px' },
  pathLine: { wordBreak: 'break-all', fontFamily: 'Consolas, monospace', fontSize: '12px' },
  notice: { padding: '12px 16px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '6px', marginBottom: '16px' },
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  metricCard: { background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  metricLabel: { fontSize: '14px', color: '#666', marginBottom: '8px' },
  metricValue: { fontSize: '28px', fontWeight: 'bold' },
  loading: { textAlign: 'center', color: '#999', padding: '40px' },
  empty: { textAlign: 'center', color: '#999', padding: '40px' },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  th: { padding: '12px 16px', textAlign: 'left', background: '#fafafa', borderBottom: '1px solid #e8e8e8', fontSize: '13px', color: '#666' },
  td: { padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '14px' },
  tr: { transition: 'background 0.2s' },
  actionBadge: { display: 'inline-block', padding: '2px 8px', background: '#e6f7ff', color: '#1890ff', borderRadius: '4px', fontSize: '12px' },
  riskBadge: (level: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', background: level === 'FORBIDDEN' ? '#fff1f0' : level === 'APPROVAL' ? '#fffbe6' : '#f6ffed', color: level === 'FORBIDDEN' ? '#cf1322' : level === 'APPROVAL' ? '#d46b08' : '#389e0d' }),
  btnApprove: { marginRight: '8px', padding: '4px 12px', background: '#52c41a', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  btnReject: { marginRight: '8px', padding: '4px 12px', background: '#ff4d4f', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  btnExecute: { padding: '4px 12px', background: '#1890ff', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' },
  btnSmall: { padding: '4px 12px', background: '#f0f0f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  btnPrimary: { padding: '10px 18px', background: '#1677ff', border: '1px solid #1677ff', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 600 },
  btnSecondary: { padding: '10px 14px', background: '#fff', border: '1px solid #d9d9d9', borderRadius: '4px', color: '#333', cursor: 'pointer', fontSize: '14px' },
  btnSecondaryStrong: { padding: '10px 14px', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: '4px', color: '#0958d9', cursor: 'pointer', fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap' },
  btnGhost: { padding: '6px 12px', background: 'transparent', border: '1px solid #d9d9d9', borderRadius: '4px', color: '#333', cursor: 'pointer', fontSize: '12px' },
  btnTiny: { padding: '4px 7px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#334155', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' },
  btnDisabled: { padding: '8px 12px', background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: '4px', color: '#999', cursor: 'not-allowed', fontSize: '12px' },
  btnDisabledLarge: { padding: '10px 18px', background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: '4px', color: '#999', cursor: 'not-allowed', fontSize: '14px', fontWeight: 600 },
  filterTabs: { display: 'flex', gap: '8px', marginBottom: '16px' },
  tab: { padding: '6px 16px', background: '#f0f0f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  tabActive: { background: '#1890ff', color: '#fff' },
  pageHeader: { marginBottom: '16px' },
  settingsForm: { background: '#fff', padding: '24px', borderRadius: '8px', maxWidth: '500px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  formGroup: { marginBottom: '16px' },
  label: { display: 'block', marginBottom: '8px', fontSize: '14px', color: '#333' },
  saveButton: { padding: '10px 24px', background: '#1890ff', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '14px' },
  statusBadge: (enabled: boolean) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', background: enabled ? '#f6ffed' : '#fff1f0', color: enabled ? '#52c41a' : '#ff4d4f' }),
};
