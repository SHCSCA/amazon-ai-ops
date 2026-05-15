import type { AdActionType, RiskLevel } from '@amazon-ai-ops/shared-types';
import type { RuleConfig, RuleResult } from './types';

// 高风险动作列表 - 一期禁止自动执行
const FORBIDDEN_ACTIONS: AdActionType[] = [
  'create_campaign',
  'adjust_campaign_budget',  // 大幅调整预算算高风险
  'archive_campaign',
];

// 中等风险动作 - 需要审批
const APPROVAL_REQUIRED_ACTIONS: AdActionType[] = [
  'raise_bid',
  'adjust_campaign_budget',
];

// 低风险动作 - 可自动执行
const AUTO_ALLOWED_ACTIONS: AdActionType[] = [
  'add_negative_exact',
  'add_negative_phrase',
  'add_negative_broad',
  'lower_bid',
  'pause_target',
  'resume_target',
];

export interface RiskAssessment {
  riskLevel: RiskLevel;
  canAutoExecute: boolean;
  requiresApproval: boolean;
  reason: string;
  warnings: string[];
}

export class RiskEvaluator {
  constructor(private config: RuleConfig) {}

  /**
   * 评估单条规则结果的风险等级
   */
  evaluate(result: RuleResult, currentBid: number): RiskAssessment {
    const action = result.actionType!;
    const warnings: string[] = [];
    
    // 检查是否在禁止列表
    if (FORBIDDEN_ACTIONS.includes(action)) {
      return {
        riskLevel: 'FORBIDDEN',
        canAutoExecute: false,
        requiresApproval: false,
        reason: `动作 ${action} 属于高风险操作，一期禁止自动执行`,
        warnings: ['此操作可能导致重大账户变化'],
      };
    }

    // 检查 bid 调整幅度
    if (action === 'lower_bid' || action === 'raise_bid') {
      const current = parseFloat(currentBid.toString());
      const recommended = parseFloat(result.recommendedValue || '0');
      const changePercent = Math.abs((recommended - current) / current);
      
      if (changePercent > this.config.bidAdjustPercent * 2) {
        warnings.push(`bid 调整幅度 ${(changePercent * 100).toFixed(0)}% 超过默认阈值`);
      }
      
      if (recommended < this.config.minCpc) {
        warnings.push(`建议 bid ¥${recommended.toFixed(2)} 低于最低出价 ¥${this.config.minCpc.toFixed(2)}`);
      }
    }

    // 检查是否需要审批
    if (APPROVAL_REQUIRED_ACTIONS.includes(action) || warnings.length > 0) {
      return {
        riskLevel: 'APPROVAL',
        canAutoExecute: false,
        requiresApproval: true,
        reason: `动作 ${action} 需要人工审批确认`,
        warnings,
      };
    }

    // 检查是否在自动允许列表
    if (AUTO_ALLOWED_ACTIONS.includes(action)) {
      return {
        riskLevel: 'AUTO',
        canAutoExecute: true,
        requiresApproval: false,
        reason: '低风险动作，可自动执行',
        warnings,
      };
    }

    // 兜底：默认需要审批
    return {
      riskLevel: 'APPROVAL',
      canAutoExecute: false,
      requiresApproval: true,
      reason: `动作 ${action} 默认需要审批`,
      warnings,
    };
  }

  /**
   * 批量评估，决定整体风险等级
   */
  evaluateBatch(results: RuleResult[], currentBid: number): RiskAssessment {
    if (results.length === 0) {
      return {
        riskLevel: 'FORBIDDEN',
        canAutoExecute: false,
        requiresApproval: false,
        reason: '无匹配规则',
        warnings: [],
      };
    }

    // 如果有任何 FORBIDDEN，整体为 FORBIDDEN
    for (const r of results) {
      const assessment = this.evaluate(r, currentBid);
      if (assessment.riskLevel === 'FORBIDDEN') {
        return assessment;
      }
    }

    // 如果有任何 APPROVAL，整体为 APPROVAL
    for (const r of results) {
      const assessment = this.evaluate(r, currentBid);
      if (assessment.riskLevel === 'APPROVAL') {
        return assessment;
      }
    }

    // 全部为 AUTO
    return {
      riskLevel: 'AUTO',
      canAutoExecute: true,
      requiresApproval: false,
      reason: '所有动作均为低风险',
      warnings: [],
    };
  }
}
