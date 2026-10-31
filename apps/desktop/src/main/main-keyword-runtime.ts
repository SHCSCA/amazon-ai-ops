import { validateArray, validateListing, normalizeKeywordSource } from './main-input-contract';
import * as path from 'path';
import * as fs from 'fs';
import { keywordMetricDiagnosticsToCsv } from '@amazon-ai-ops/report-parser';
import { loadFixedReportFieldMapping } from './report-parser-field-mapping';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { buildKeywordOpportunities } from '@amazon-ai-ops/keyword-opportunity';
import { analyzeKeywordCoverage } from '@amazon-ai-ops/listing-analyzer';
import type { KeywordMetric, KeywordOpportunity, ListingContent } from '@amazon-ai-ops/shared-types';
import { canonicalizeExistingPath, getBundledResourcesPath } from './main-store-access-runtime';
import { persistListingContent, readCurrentOperationScopeValue } from './main-listing-extraction-runtime';
import type { KeywordImportDuplicateStrategy } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function countKeywordMetricsBySourceFile(source: KeywordMetric['source'], sourceFile: string): number {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return 0;
  const row = mainRuntimeContext.state.db
    .prepare('SELECT COUNT(*) AS count FROM keyword_metrics WHERE source = ? AND source_file = ?')
    .get(source, sourceFile) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

export function deleteKeywordMetricsBySourceFile(source: KeywordMetric['source'], sourceFile: string): void {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.state.db?.prepare('DELETE FROM keyword_metrics WHERE source = ? AND source_file = ?').run(source, sourceFile);
}

export function loadPersistedKeywordMetrics(): KeywordMetric[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return [];
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT
      normalized_keyword AS normalizedKeyword,
      raw_keyword AS rawKeyword,
      source,
      asin,
      impressions,
      clicks,
      cost,
      orders,
      sales,
      acos,
      cvr,
      source_file AS sourceFile,
      source_row AS sourceRow
    FROM keyword_metrics
    ORDER BY id ASC
  `).all() as Array<KeywordMetric & { sourceRow?: number | null }>;

  return rows.map((row) => ({
    ...row,
    asin: row.asin ?? undefined,
    sourceFile: row.sourceFile ?? undefined,
    sourceRow: row.sourceRow ?? undefined,
  }));
}

export function persistKeywordMetrics(
  metrics: KeywordMetric[],
  duplicateStrategy: KeywordImportDuplicateStrategy = 'merge',
): { existingRows: number; skipped: boolean; insertedRows: number } {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db || metrics.length === 0) return { existingRows: 0, skipped: false, insertedRows: 0 };
  const source = metrics[0].source;
  const sourceFile = metrics[0]?.sourceFile ? canonicalizeExistingPath(metrics[0].sourceFile) : undefined;
  const existingRows = sourceFile ? countKeywordMetricsBySourceFile(source, sourceFile) : 0;
  if (existingRows > 0 && duplicateStrategy === 'skip') {
    return { existingRows, skipped: true, insertedRows: 0 };
  }

  let insertedRows = 0;
  const save = mainRuntimeContext.state.db.transaction(() => {
    if (sourceFile && existingRows > 0 && duplicateStrategy === 'overwrite') {
      deleteKeywordMetricsBySourceFile(source, sourceFile);
    }
    const exists = mainRuntimeContext.state.db!.prepare(`
      SELECT id
      FROM keyword_metrics
      WHERE source = @source
        AND source_file = @sourceFile
        AND source_row = @sourceRow
      LIMIT 1
    `);
    const insert = mainRuntimeContext.state.db!.prepare(`
      INSERT INTO keyword_metrics
        (normalized_keyword, raw_keyword, source, asin, impressions, clicks, cost, orders, sales, acos, cvr, source_file, source_row)
      VALUES
        (@normalizedKeyword, @rawKeyword, @source, @asin, @impressions, @clicks, @cost, @orders, @sales, @acos, @cvr, @sourceFile, @sourceRow)
    `);

    for (const metric of metrics) {
      const sourceFileValue = metric.sourceFile ? canonicalizeExistingPath(metric.sourceFile) : null;
      const sourceRowValue = metric.sourceRow ?? null;
      if (duplicateStrategy === 'merge' && sourceFileValue && sourceRowValue !== null) {
        const existing = exists.get({
          source: metric.source,
          sourceFile: sourceFileValue,
          sourceRow: sourceRowValue,
        });
        if (existing) {
          continue;
        }
      }

      insert.run({
        ...metric,
        asin: metric.asin ?? null,
        sourceFile: sourceFileValue,
        sourceRow: sourceRowValue,
      });
      insertedRows += 1;
    }
  });
  save();
  return { existingRows, skipped: false, insertedRows };
}

export function persistKeywordOpportunities(opportunities: KeywordOpportunity[]): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db || opportunities.length === 0) return;

  const save = mainRuntimeContext.state.db.transaction(() => {
    const findExisting = mainRuntimeContext.state.db!.prepare(`
      SELECT id, status
      FROM keyword_opportunities
      WHERE COALESCE(asin, '') = @asinKey
        AND normalized_keyword = @normalizedKeyword
      LIMIT 1
    `);
    const update = mainRuntimeContext.state.db!.prepare(`
      UPDATE keyword_opportunities
      SET
        opportunity_level = @opportunityLevel,
        score = @score,
        evidence = @evidence,
        risk_flags_json = @riskFlagsJson,
        recommended_sections_json = @recommendedSectionsJson,
        updated_at = datetime('now')
      WHERE id = @id
    `);
    const insert = mainRuntimeContext.state.db!.prepare(`
      INSERT INTO keyword_opportunities
        (asin, normalized_keyword, opportunity_level, score, evidence, risk_flags_json, recommended_sections_json, status)
      VALUES
        (@asin, @normalizedKeyword, @opportunityLevel, @score, @evidence, @riskFlagsJson, @recommendedSectionsJson, @status)
    `);
    for (const opportunity of opportunities) {
      const row = {
        ...opportunity,
        asin: opportunity.asin ?? null,
        asinKey: opportunity.asin ?? '',
        riskFlagsJson: JSON.stringify(opportunity.riskFlags),
        recommendedSectionsJson: JSON.stringify(opportunity.recommendedSections),
      };
      const existing = findExisting.get(row) as { id: number; status: KeywordOpportunity['status'] } | undefined;
      if (existing) {
        update.run({ ...row, id: existing.id });
      } else {
        insert.run(row);
      }
    }
  });
  save();
}

export function pruneKeywordOpportunitiesTo(opportunities: KeywordOpportunity[]): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return;
  const allowedKeys = new Set(opportunities.map((opportunity) => `${opportunity.asin ?? ''}\u0000${opportunity.normalizedKeyword}`));
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT id, asin, normalized_keyword AS normalizedKeyword
    FROM keyword_opportunities
  `).all() as Array<{ id: number; asin?: string | null; normalizedKeyword: string }>;
  const staleIds = rows
    .filter((row) => !allowedKeys.has(`${row.asin ?? ''}\u0000${row.normalizedKeyword}`))
    .map((row) => row.id);
  if (staleIds.length === 0) return;

  const remove = mainRuntimeContext.state.db.transaction(() => {
    const deleteRow = mainRuntimeContext.state.db!.prepare('DELETE FROM keyword_opportunities WHERE id = ?');
    for (const id of staleIds) {
      deleteRow.run(id);
    }
  });
  remove();
}

export async function handleImportKeywordMetrics(
  filePath: string,
  source?: string,
  duplicateStrategy: KeywordImportDuplicateStrategy = 'merge',
) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('请选择关键词报表文件');
  }
  if (!['overwrite', 'merge', 'skip'].includes(duplicateStrategy)) {
    throw new Error('重复导入策略只支持 overwrite、merge 或 skip');
  }

  const resolvedFilePath = canonicalizeExistingPath(filePath);
  const mainRuntimeContext = getMainRuntimeContext();
  const context = resolveBusinessStoreAuthority().context;
  const database = mainRuntimeContext.state.db;
  if (!database) throw new Error('REPORT_IMPORT_DATABASE_REQUIRED');
  const parser = mainRuntimeContext.reportParserRuntime.createSession();
  const snapshot = parser.read(filePath);
  try {
  if (snapshot.path !== resolvedFilePath) throw new Error('REPORT_SOURCE_CHANGED_BEFORE_COMMIT');
  const metricSource = normalizeKeywordSource(source) ?? 'manual';
  const parseResult = await parser.keyword(snapshot, {
    source: metricSource, fieldMapping: loadFixedReportFieldMapping(metricSource),
  });
  const { metrics, diagnostics } = parseResult;
  if (metrics.length === 0) {
    throw new Error('未在报表中识别到关键词指标，请检查字段映射');
  }

  return database.transaction(() => {
  if (mainRuntimeContext.state.db !== database) throw new Error('REPORT_IMPORT_RUNTIME_CHANGED');
  mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context);
  parser.assertCurrent(snapshot);
  const metricsForPersistence = metrics.map((metric) => ({ ...metric, sourceFile: resolvedFilePath }));
  const importResult = persistKeywordMetrics(metricsForPersistence, duplicateStrategy);
  if (importResult.skipped) {
    const persistedMetrics = loadPersistedKeywordMetrics();
    const opportunities = buildKeywordOpportunities(persistedMetrics);
    return {
      filePath: resolvedFilePath,
      metricsCount: 0,
      metrics: persistedMetrics,
      diagnostics,
      opportunities,
      duplicate: true,
      duplicateStrategy,
      existingRows: importResult.existingRows,
      skipped: true,
    };
  }

  const persistedMetrics = loadPersistedKeywordMetrics();
  const opportunities = buildKeywordOpportunities(persistedMetrics);
  persistKeywordOpportunities(opportunities);
  pruneKeywordOpportunitiesTo(opportunities);

  return {
    filePath: resolvedFilePath,
    metricsCount: importResult.insertedRows,
    metrics: persistedMetrics,
    diagnostics,
    opportunities,
    duplicate: importResult.existingRows > 0,
    duplicateStrategy,
    existingRows: importResult.existingRows,
    skipped: false,
  };
  }).immediate();
  } finally { parser.release(snapshot); }
}

export function handleBuildKeywordOpportunities(metrics: KeywordMetric[], options: { brandWhitelist?: string[] } = {}) {
  validateArray(metrics, 'metrics', 20000);
  const opportunities = buildKeywordOpportunities(metrics, options);
  persistKeywordOpportunities(opportunities);
  return opportunities;
}

export function handleExportKeywordDiagnostics(diagnostics: unknown): string {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!diagnostics || typeof diagnostics !== 'object') {
    throw new Error('解析诊断数据无效');
  }
  const value = diagnostics as {
    errors?: unknown;
    warnings?: unknown;
    totalRows?: unknown;
    parsedRows?: unknown;
    invalidRows?: unknown;
    invalidRowRatio?: unknown;
  };
  if (!Array.isArray(value.errors) || !Array.isArray(value.warnings)) {
    throw new Error('解析诊断数据缺少 errors 或 warnings');
  }
  const output = keywordMetricDiagnosticsToCsv({
    totalRows: Number(value.totalRows) || 0,
    parsedRows: Number(value.parsedRows) || 0,
    invalidRows: Number(value.invalidRows) || 0,
    invalidRowRatio: Number(value.invalidRowRatio) || 0,
    errors: value.errors as any[],
    warnings: value.warnings as any[],
  });
  if (!fs.existsSync(mainRuntimeContext.EXPORTS_DIR)) {
    fs.mkdirSync(mainRuntimeContext.EXPORTS_DIR, { recursive: true });
  }
  const filePath = path.join(mainRuntimeContext.EXPORTS_DIR, `keyword_parse_diagnostics_${Date.now()}.csv`);
  fs.writeFileSync(filePath, output, 'utf8');
  return filePath;
}

export function handleAnalyzeListingCoverage(listing: ListingContent, keywords: string[]) {
  const mainRuntimeContext = getMainRuntimeContext();
  validateListing(listing);
  validateArray(keywords, 'keywords', 10000);
  const coverage = analyzeKeywordCoverage(listing, keywords);

  if (mainRuntimeContext.state.db) {
    const save = mainRuntimeContext.state.db.transaction(() => {
      persistListingContent(listing, {
        storeName: readCurrentOperationScopeValue('storeName'),
        marketplaceCode: readCurrentOperationScopeValue('marketplaceCode'),
      });

      const insertCoverage = mainRuntimeContext.state.db!.prepare(`
        INSERT INTO keyword_coverage (asin, normalized_keyword, covered, sections_json, strength)
        VALUES (@asin, @normalizedKeyword, @covered, @sectionsJson, @strength)
      `);
      for (const item of coverage) {
        insertCoverage.run({
          asin: listing.asin,
          normalizedKeyword: item.normalizedKeyword,
          covered: item.covered ? 1 : 0,
          sectionsJson: JSON.stringify(item.sections),
          strength: item.strength,
        });
      }
    });
    save();
  }

  return coverage;
}
