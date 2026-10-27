import { validateArray, validateListing, validateOpportunity, validateSuggestion, validateListingDraft } from './main-input-contract';
import { parseIntegerSetting } from './main-value-coercion';
import * as path from 'path';
import * as fs from 'fs';
import { buildListingSuggestions as buildSafeListingSuggestions, buildRuleBasedListingDrafts, draftsToCsv, draftsToMarkdown, draftsToXlsxBuffer, suggestionsToCsv, suggestionsToMarkdown, suggestionsToXlsxBuffer } from '@amazon-ai-ops/listing-analyzer';
import type { KeywordOpportunity, ListingContent, ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { buildListingAiCallLogInput, buildListingRewritePrompt, parseAiDraftResponse } from './listing-ai-draft';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { buildAiProviderConfig, governedAiProvider, readAiSettingsForMain } from './main-ai-settings-runtime';
import { readCurrentOperationScopeValue } from './main-listing-extraction-runtime';
import { getBundledResourcesPath } from './main-store-access-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function handleBuildListingSuggestions(listing: ListingContent, opportunities: KeywordOpportunity[]): ListingSuggestion[] {
  const mainRuntimeContext = getMainRuntimeContext();
  validateListing(listing);
  validateArray(opportunities, 'opportunities', 10000);
  for (const opportunity of opportunities) {
    validateOpportunity(opportunity);
  }
  const suggestions = buildSafeListingSuggestions(listing, opportunities, { appVersion: mainRuntimeContext.APP_VERSION });

  if (mainRuntimeContext.state.db) {
    const persistedSuggestions: ListingSuggestion[] = [];
    const save = mainRuntimeContext.state.db.transaction(() => {
      const insert = mainRuntimeContext.state.db!.prepare(`
        INSERT INTO listing_suggestions
          (asin, keyword, section, current_text, suggested_text, evidence, risk_warnings_json, status, created_at)
        VALUES
          (@asin, @keyword, @section, @currentText, @suggestedText, @evidence, @riskWarningsJson, @status, @createdAt)
      `);
      for (const suggestion of suggestions) {
        const createdAt = suggestion.createdAt ?? new Date().toISOString();
        const result = insert.run({
          ...suggestion,
          currentText: suggestion.currentText ?? null,
          createdAt,
          riskWarningsJson: JSON.stringify(suggestion.riskWarnings),
        });
        persistedSuggestions.push({
          ...suggestion,
          id: Number(result.lastInsertRowid),
          createdAt,
        });
      }
    });
    save();
    return persistedSuggestions;
  }

  return suggestions;
}

export function handleUpdateListingSuggestionStatus(id: number, status: ListingSuggestion['status']): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Listing 建议 ID 无效');
  }
  if (!['pending', 'accepted', 'ignored'].includes(status)) {
    throw new Error('Listing 建议状态无效');
  }
  mainRuntimeContext.state.db?.prepare(`
    UPDATE listing_suggestions
    SET status = @status, updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, status });
}

export async function handleGenerateListingDrafts(suggestions: ListingSuggestion[]): Promise<ListingDraft[]> {
  const mainRuntimeContext = getMainRuntimeContext();
  const { context: capturedStoreContext } = resolveBusinessStoreAuthority();
  validateArray(suggestions, 'suggestions', 20000);
  for (const suggestion of suggestions) {
    validateSuggestion(suggestion);
  }

  let drafts = buildRuleBasedListingDrafts(suggestions, { appVersion: mainRuntimeContext.APP_VERSION });
  const settings = readAiSettingsForMain();
  const aiApiKey = settings.aiApiKey;

  if (aiApiKey) {
    drafts = await generateAiListingDrafts(drafts, settings, capturedStoreContext);
  } else {
    drafts = drafts.map((draft) => ({
      ...draft,
      aiFallbackReason: '未配置 AI Key，使用规则草案',
    }));
  }

  mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(capturedStoreContext);
  return persistListingDrafts(drafts);
}

export async function generateAiListingDrafts(
  drafts: ListingDraft[],
  settings: Record<string, string>,
  capturedContext: StoreContextEnvelope,
): Promise<ListingDraft[]> {
  const capturedStoreId = capturedContext.storeId;
  const provider = governedAiProvider(buildAiProviderConfig(settings), capturedContext, 'listing_draft');
  const promptTemplate = readPromptTemplate('listing-rewrite.md');
  const model = settings.aiModel || settings.ai_model || 'deepseek-v4-flash';

  const enhanced: ListingDraft[] = [];
  for (const draft of drafts) {
    let response;
    try {
      response = await provider.complete(buildListingRewritePrompt(promptTemplate, draft, settings), {
        temperature: 0.3,
        maxTokens: parseIntegerSetting(settings.aiMaxTokens || settings.ai_max_tokens, 8192),
        responseFormat: 'json_object',
      });
    } catch (error) {
      recordListingAiCallLog({
        draft,
        model,
        outputJson: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }, capturedStoreId);
      enhanced.push({
        ...draft,
        aiFallbackReason: `AI 调用异常：${error instanceof Error ? error.message : String(error)}，使用规则草案`,
      });
      continue;
    }
    if (!response.success || !response.content) {
      response.reportOutput?.('invalid');
      recordListingAiCallLog({
        draft,
        model,
        outputJson: response.content || JSON.stringify({ error: response.error || 'empty_content' }),
        success: false,
        errorMessage: response.error || 'AI 未返回草案内容',
      }, capturedStoreId);
      enhanced.push({
        ...draft,
        aiFallbackReason: response.error ? `AI 生成失败：${response.error}` : 'AI 未返回草案内容，使用规则草案',
      });
      continue;
    }

    const parsed = parseAiDraftResponse(response.content);
    response.reportOutput?.(parsed ? 'accepted' : 'invalid');
    recordListingAiCallLog({
      draft,
      model,
      outputJson: response.content,
      success: Boolean(parsed),
      errorMessage: parsed ? undefined : 'AI 响应无法解析为 listing_rewrite_v1 JSON 或中文理由校验失败',
    }, capturedStoreId);
    enhanced.push(parsed
      ? {
          ...draft,
          draftedText: parsed.suggestedText,
          riskWarnings: Array.from(new Set([...draft.riskWarnings, ...parsed.riskWarnings])),
          evidence: `${draft.evidence}\nAI 理由：${parsed.reason}`,
          source: 'ai',
          aiFallbackReason: undefined,
        }
      : {
          ...draft,
          aiFallbackReason: 'AI 响应无法解析为 Listing 草案，使用规则草案',
        });
  }

  return enhanced;
}

export function recordListingAiCallLog(input: {
  draft: ListingDraft;
  model: string;
  outputJson: string;
  success: boolean;
  errorMessage?: string;
}, capturedStoreId: StoreContextEnvelope['storeId']): void {
  const mainRuntimeContext = getMainRuntimeContext();
  try {
    mainRuntimeContext.state.aiCallLogRepo?.insertForStore(capturedStoreId, buildListingAiCallLogInput(input));
  } catch (error) {
    runtimeLog.warn('[AI] Failed to write Listing AI call log', error);
  }
}

export function persistListingDrafts(drafts: ListingDraft[]): ListingDraft[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db || drafts.length === 0) return drafts;

  const persisted: ListingDraft[] = [];
  const storeName = readCurrentOperationScopeValue('storeName') || null;
  const marketplaceCode = readCurrentOperationScopeValue('marketplaceCode') || null;
  const save = mainRuntimeContext.state.db.transaction(() => {
    const insert = mainRuntimeContext.state.db!.prepare(`
      INSERT INTO listing_drafts
        (asin, store_name, marketplace_code, section, current_text, drafted_text, keywords_json, evidence, risk_warnings_json, source, ai_fallback_reason, status, created_at)
      VALUES
        (@asin, @storeName, @marketplaceCode, @section, @currentText, @draftedText, @keywordsJson, @evidence, @riskWarningsJson, @source, @aiFallbackReason, @status, @createdAt)
    `);
    for (const draft of drafts) {
      const createdAt = draft.createdAt ?? new Date().toISOString();
      const result = insert.run({
        ...draft,
        storeName,
        marketplaceCode,
        currentText: draft.currentText ?? null,
        keywordsJson: JSON.stringify(draft.keywords),
        riskWarningsJson: JSON.stringify(draft.riskWarnings),
        aiFallbackReason: draft.aiFallbackReason ?? null,
        createdAt,
      });
      persisted.push({
        ...draft,
        id: Number(result.lastInsertRowid),
        createdAt,
      });
    }
  });
  save();
  return persisted;
}

export function readPromptTemplate(filename: string): string {
  const promptPath = path.join(getBundledResourcesPath(), 'prompts', filename);
  if (!fs.existsSync(promptPath)) {
    return '';
  }
  return fs.readFileSync(promptPath, 'utf8');
}

export async function handleExportListingSuggestions(suggestions: ListingSuggestion[], format: 'csv' | 'markdown' | 'xlsx'): Promise<string> {
  const mainRuntimeContext = getMainRuntimeContext();
  validateArray(suggestions, 'suggestions', 20000);
  if (!['csv', 'markdown', 'xlsx'].includes(format)) {
    throw new Error('导出格式只支持 csv、xlsx 或 markdown');
  }

  const extension = format === 'markdown' ? 'md' : format;
  const output = format === 'markdown'
    ? suggestionsToMarkdown(suggestions)
    : format === 'xlsx'
      ? suggestionsToXlsxBuffer(suggestions)
      : suggestionsToCsv(suggestions);
  const exportDir = mainRuntimeContext.EXPORTS_DIR;
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  const filePath = path.join(exportDir, `listing_suggestions_${Date.now()}.${extension}`);
  fs.writeFileSync(filePath, output, typeof output === 'string' ? 'utf8' : undefined);
  return filePath;
}

export async function handleExportListingDrafts(drafts: ListingDraft[], format: 'csv' | 'markdown' | 'xlsx'): Promise<string> {
  const mainRuntimeContext = getMainRuntimeContext();
  validateArray(drafts, 'drafts', 20000);
  if (!['csv', 'markdown', 'xlsx'].includes(format)) {
    throw new Error('导出格式只支持 csv、xlsx 或 markdown');
  }
  for (const draft of drafts) {
    validateListingDraft(draft);
  }

  const extension = format === 'markdown' ? 'md' : format;
  const output = format === 'markdown'
    ? draftsToMarkdown(drafts)
    : format === 'xlsx'
      ? draftsToXlsxBuffer(drafts)
      : draftsToCsv(drafts);
  if (!fs.existsSync(mainRuntimeContext.EXPORTS_DIR)) {
    fs.mkdirSync(mainRuntimeContext.EXPORTS_DIR, { recursive: true });
  }
  const filePath = path.join(mainRuntimeContext.EXPORTS_DIR, `listing_drafts_${Date.now()}.${extension}`);
  fs.writeFileSync(filePath, output, typeof output === 'string' ? 'utf8' : undefined);
  return filePath;
}
