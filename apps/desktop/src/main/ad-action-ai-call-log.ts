import * as crypto from 'crypto';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';

export interface AdActionExplanationForLog {
  explanation?: string;
  riskWarnings?: string[];
  alternativeSuggestions?: string[];
  source?: 'ai' | 'rule';
  aiFallbackReason?: string;
}

export function buildAdActionReasonAiCallLogInput(input: {
  recommendation: ActionRecommendation;
  explanation: AdActionExplanationForLog;
  model: string;
}) {
  const evidence = input.recommendation.evidence || ({} as ActionRecommendation['evidence']);
  const sourceFiles = uniqueStrings(evidence.sourceFiles);
  const aiEvidenceRefs = uniqueStrings(evidence.aiEvidenceRefs);
  const output = {
    schemaVersion: 'ad_action_reason_v1',
    source: input.explanation.source || 'rule',
    explanation: input.explanation.explanation || '',
    riskWarnings: input.explanation.riskWarnings || [],
    alternativeSuggestions: input.explanation.alternativeSuggestions || [],
    aiFallbackReason: input.explanation.aiFallbackReason,
  };
  const success = output.source === 'ai' && !output.aiFallbackReason;

  return {
    promptKey: 'ad_action_reason',
    promptVersion: 'ad_action_reason_v1',
    model: input.model,
    inputHash: hashStableJson({
      actionType: input.recommendation.actionType,
      entityType: input.recommendation.entityType,
      entityName: input.recommendation.entityName,
      currentValue: input.recommendation.currentValue,
      recommendedValue: input.recommendation.recommendedValue,
      batchId: evidence.batchId,
      metricDate: evidence.date,
      sourceFileCount: sourceFiles.length,
      sourceRow: evidence.sourceRow,
      aiEvidenceRefCount: aiEvidenceRefs.length,
    }),
    outputJson: JSON.stringify(output),
    success,
    errorMessage: success
      ? undefined
      : output.aiFallbackReason || 'AI action explanation fell back to rule output',
    schemaVersion: 'ad_action_reason_v1',
    evidencePackSummary: {
      total: sourceFiles.length + aiEvidenceRefs.length,
      sourceFileCount: sourceFiles.length,
      aiEvidenceRefCount: aiEvidenceRefs.length,
      actionType: input.recommendation.actionType,
      entityType: input.recommendation.entityType,
      hasSourceRow: Number.isFinite(Number(evidence.sourceRow)),
      batchId: evidence.batchId,
      metricDate: evidence.date,
    },
  };
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

function hashStableJson(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
