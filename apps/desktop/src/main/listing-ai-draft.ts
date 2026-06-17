import type { ListingDraft } from '@amazon-ai-ops/shared-types';
import * as crypto from 'crypto';

export interface ParsedListingAiDraft {
  suggestedText: string;
  reason: string;
  riskWarnings: string[];
}

export interface ListingAiCallLogInput {
  promptKey: string;
  promptVersion: string;
  model: string;
  inputHash: string;
  outputJson: string;
  success: boolean;
  errorMessage?: string;
  schemaVersion: string;
  evidencePackSummary: {
    total: number;
    listingDraft: number;
    keywordCount: number;
    section: string;
    asin: string;
  };
}

export function buildListingRewritePrompt(
  promptTemplate: string,
  draft: ListingDraft,
  settings: Record<string, string>,
): string {
  const outputLanguage = settings.aiOutputLanguage || settings.ai_output_language || '简体中文';
  const persona = settings.aiPersona || settings.ai_persona || '你是中文亚马逊 Listing 优化助手。';
  return `${persona}

输出语言：${outputLanguage}
输出格式：只返回 JSON，不要 Markdown、解释段落或代码块。
金额必须使用 USD，不得使用人民币、RMB、CNY、¥ 或“元”。
所有 reason 和 riskWarnings 必须使用${outputLanguage}；suggestedText 可以保持目标站点 Listing 语言。

必须返回这个 JSON schema：
{
  "schemaVersion": "listing_rewrite_v1",
  "suggestedText": "改写后的 Listing 文案",
  "reason": "${outputLanguage}说明为什么这样改，必须引用关键词和证据",
  "riskWarnings": ["${outputLanguage}风险或人工复核点"]
}

${promptTemplate}

当前模块：${draft.section}
当前文案：
${draft.currentText || ''}

目标关键词：
${draft.keywords.join(', ')}

数据证据：
${draft.evidence}

当前规则草案：
${draft.draftedText}
`;
}

export function parseAiDraftResponse(content: string): ParsedListingAiDraft | null {
  const jsonText = extractJsonObject(content);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as {
      schemaVersion?: unknown;
      suggestedText?: unknown;
      reason?: unknown;
      riskWarnings?: unknown;
    };
    if (parsed.schemaVersion !== 'listing_rewrite_v1') return null;
    if (typeof parsed.suggestedText !== 'string' || !parsed.suggestedText.trim()) return null;
    if (typeof parsed.reason !== 'string' || !containsCjk(parsed.reason)) return null;
    const riskWarnings = Array.isArray(parsed.riskWarnings)
      ? parsed.riskWarnings.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (!riskWarnings.length || riskWarnings.some((item) => !containsCjk(item))) return null;

    return {
      suggestedText: parsed.suggestedText.trim(),
      reason: parsed.reason.trim(),
      riskWarnings,
    };
  } catch {
    return null;
  }
}

export function buildListingAiCallLogInput(input: {
  draft: ListingDraft;
  model: string;
  outputJson: string;
  success: boolean;
  errorMessage?: string;
}): ListingAiCallLogInput {
  const evidencePackSummary = {
    total: 1,
    listingDraft: 1,
    keywordCount: input.draft.keywords.length,
    section: input.draft.section,
    asin: input.draft.asin,
  };
  const inputHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      asin: input.draft.asin,
      section: input.draft.section,
      keywordCount: input.draft.keywords.length,
      currentTextLength: input.draft.currentText?.length || 0,
      draftedTextLength: input.draft.draftedText.length,
      evidenceLength: input.draft.evidence.length,
      riskWarningCount: input.draft.riskWarnings.length,
      evidencePackSummary,
    }))
    .digest('hex');

  return {
    promptKey: 'listing_rewrite',
    promptVersion: 'listing_rewrite_v1',
    model: input.model,
    inputHash,
    outputJson: input.outputJson,
    success: input.success,
    errorMessage: input.errorMessage,
    schemaVersion: 'listing_rewrite_v1',
    evidencePackSummary,
  };
}

function extractJsonObject(content: string): string | null {
  const trimmed = String(content || '').trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return withoutFence.match(/\{[\s\S]*\}/)?.[0] ?? (withoutFence.startsWith('{') ? withoutFence : null);
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}
