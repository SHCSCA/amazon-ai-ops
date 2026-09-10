// L3: real XLSX parsing, control-total scan and canonical SQLite/services. Collection/AI/Ads ports are isolated fixtures, not L6/L7 proof.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { LingxingImportRepository, StoreRepository } from '@amazon-ai-ops/local-db';
import { ReportParser, LINGXING_TEMPLATE_MANIFEST } from '@amazon-ai-ops/report-parser';
import { ANALYSIS_REQUIRED_REPORT_TYPES, type LingxingReportFile, type LingxingReportBatch } from '@amazon-ai-ops/shared-types';
import { importLingxingDownloadedReportMetrics } from './lingxing-report-import';
import { createHarness, NOW } from './analysis-authority.test-support';
import { workflow, success, approveHumanBatch } from './v16-production.test-support';
const XLSX = createRequire(new URL('../../../../packages/report-parser/package.json', import.meta.url))('xlsx');

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function reportFiles(database: Database.Database, directory: string, invalid?: 'seven' | 'unknown-template' | 'bad-date' | 'duplicate-column', observationBatch?: LingxingReportBatch) {
  const repository = new LingxingImportRepository(database);
  const stores = new StoreRepository(database);
  const original = repository.getCollectionSnapshotForStore('store-one' as never, 'batch-1')!;
  const batch = observationBatch ?? original.batch;
  const reportDir = path.join(directory, 'reports', batch.id); fs.mkdirSync(reportDir, { recursive: true });
  const paths: Record<string, string> = {};
  const files: LingxingReportFile[] = [];
  const row = (targeting: string, cost = 40, clicks = 30) => ({
    '店铺名称': 'US Store One', '国家': 'US', 'ASIN': 'B0TEST', 'MSKU': 'MSKU-1', '广告活动': 'Campaign A', '广告组': 'Ad Group A',
    '关键词': targeting, '匹配方式': '精准匹配', '日期': batch.dateEnd, '曝光量': 1000, '点击': clicks,
    '花费-本币': observationBatch ? cost / 2 : cost, '广告订单': 1, '广告销售额-本币': 60, '有效状态': 'enabled',
  });
  for (const reportType of ANALYSIS_REQUIRED_REPORT_TYPES.filter(type => invalid !== 'seven' || type !== 'placement')) {
    const workbook = XLSX.utils.book_new();
    const rows: Record<string, unknown>[] = reportType === 'keyword'
      ? [...Array.from({ length: 5 }, (_, i) => ({ ...row(`paused-${i}`, 0, 0), '日期': '', '有效状态': 'paused', '曝光量': 0, '广告订单': 0, '广告销售额-本币': 0 })), row('door lock'), row('door lock 2', 30, 20)]
      : [row('door lock')];
    for (const record of rows) {
      if (reportType !== 'keyword' && reportType !== 'user_search_term') {
        delete record['关键词']; delete record['匹配方式'];
      }
      if (reportType !== 'keyword' && reportType !== 'advertised_product' && reportType !== 'user_search_term') {
        delete record['ASIN']; delete record['MSKU'];
      }
      if (reportType === 'campaign') delete record['广告组'];
      if (reportType === 'placement') record['广告位'] = 'Top of search';
      if (reportType === 'auto_targeting') record['投放'] = '紧密匹配';
      if (reportType === 'product_targeting') record['投放'] = '商品:"B0TARGET"';
      if (reportType === 'user_search_term') record['用户搜索词'] = 'door lock';
    }
    if (invalid === 'bad-date' && reportType === 'keyword') rows[5]['日期'] = '2026-08-01';
    if (invalid === 'duplicate-column' && reportType === 'keyword') rows.forEach(record => { record['花费'] = 999; });
    const template = LINGXING_TEMPLATE_MANIFEST.find(item => item.reportType === reportType)!;
    const headers = [...template.headers, ...(invalid === 'duplicate-column' && reportType === 'keyword' ? ['花费'] : [])];
    const sheet = invalid === 'unknown-template' && reportType === 'keyword'
      ? XLSX.utils.json_to_sheet([{ '无法识别的字段': 'untrusted' }])
      : XLSX.utils.aoa_to_sheet([headers, ...rows.map(record => headers.map(header => record[header] ?? ''))]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
    const filePath = path.join(reportDir, `AAO_${batch.dateStart.replaceAll('-', '')}_${batch.dateEnd.replaceAll('-', '')}_${reportType}.xlsx`);
    XLSX.writeFile(workbook, filePath); paths[reportType] = filePath;
    files.push({ id: `${batch.id}-file-${reportType}`, batchId: batch.id, reportType, displayName: reportType, status: 'downloaded', filePath,
      fileSizeBytes: fs.statSync(filePath).size, maxAutoRetries: 2, autoRetryCount: 0, attemptErrors: [], createdAt: NOW, updatedAt: NOW });
  }
  const result = { batch, files };
  repository.saveCollectionSnapshotForStore('store-one' as never, result);
  return { repository, stores, result, paths };
}

function importEight(database: Database.Database, directory: string) {
  const fixture = reportFiles(database, directory);
  // Download metadata may be stale; the immutable receipt must describe the actual bytes.
  fixture.result.files.forEach(file => { file.fileSizeBytes = 1; });
  const imported = importLingxingDownloadedReportMetrics(fixture.result, fixture);
  expect(imported, JSON.stringify(imported)).toMatchObject({ parsedFiles: 8, inserted: 9, deduplicated: false, errors: [] });
  expect(fixture.repository.listImportRunsForStore('store-one' as never)).toHaveLength(1);
  const sizes = database.prepare('SELECT file_size_bytes AS size, file_path AS path FROM report_import_file_snapshots').all() as Array<{ size: number; path: string }>;
  expect(sizes).toHaveLength(8);
  for (const file of sizes) expect(file.size).toBe(fs.statSync(file.path).size);
  expect(database.prepare('SELECT COUNT(*) AS count FROM report_import_metric_evidence').get()).toEqual({ count: 1 });
  const repeated = importLingxingDownloadedReportMetrics(fixture.result, fixture);
  expect(repeated).toMatchObject({ deduplicated: true, importRunId: imported.importRunId, inserted: 9 });
  return fixture.paths;
}

describe('Eight workbook import into the production business services', () => {
  it('rejects a workbook replaced during parsing even when its row count and cost remain equal', () => {
    const autoParse = ReportParser.prototype.autoParse;
    vi.spyOn(ReportParser.prototype, 'autoParse').mockImplementation(function(this: ReportParser, ...args) {
      const parsed = autoParse.apply(this, args);
      if (args[0].includes('_keyword.xlsx')) {
        const workbook = XLSX.readFile(args[0]);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Report);
        rows[5]['关键词'] = 'different-object-with-identical-control-totals';
        workbook.Sheets.Report = XLSX.utils.json_to_sheet(rows);
        XLSX.writeFile(workbook, args[0]);
      }
      return parsed;
    });
    expect(() => createHarness({ importReports(database, directory) {
      const fixture = reportFiles(database, directory);
      const imported = importLingxingDownloadedReportMetrics(fixture.result, fixture);
      expect(imported).toMatchObject({ inserted: 0, errors: [expect.objectContaining({ reportType: 'keyword' })] });
      expect(database.prepare('SELECT COUNT(*) AS count FROM report_import_runs').get()).toEqual({ count: 0 });
      throw new Error('EXPECTED_REJECTED_IMPORT');
    } })).toThrow('EXPECTED_REJECTED_IMPORT');
  });
  it.each(['seven', 'unknown-template', 'bad-date', 'duplicate-column'] as const)('rejects %s without a partial completed import', invalid => {
    expect(() => createHarness({ importReports(database, directory) {
      const fixture = reportFiles(database, directory, invalid);
      if (invalid === 'seven') expect(() => importLingxingDownloadedReportMetrics(fixture.result, fixture)).toThrow('RECONCILIATION_EVIDENCE_MISSING');
      else expect(importLingxingDownloadedReportMetrics(fixture.result, fixture)).toMatchObject({ inserted: 0, errors: [expect.any(Object)] });
      for (const table of ['report_import_runs', 'report_import_file_snapshots', 'ad_daily_metrics', 'mission_grants']) {
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      }
      throw new Error('EXPECTED_REJECTED_IMPORT');
    } })).toThrow('EXPECTED_REJECTED_IMPORT');
  });

  it.each(['manual_approval', 'policy_auto'] as const)('%s persists eight files through analysis, execution, experiment baseline and memory', async mode => {
    let now = new Date(NOW);
    const h = workflow(mode, 1, importEight, { reportDateEnd: '2026-07-21', now: () => now });
    const analysis = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    expect(analysis.proposals).toHaveLength(1);
    if (mode === 'manual_approval') await approveHumanBatch(h);
    const grant = (mode === 'manual_approval'
      ? success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) })))
      : analysis.automaticAuthorization!).grant!;
    success(await h.api.executionResolveIdentity(h.request({ grantId: grant.id, adEntityId: grant.allowedAdEntityIds[0] })));
    const batch = success(await h.api.executionCreateBatch(h.request({ grantId: grant.id })));
    const executed = success(await h.api.executionStart(h.request({ batchId: batch.projection.batch.id })));
    expect(executed.batch.status).toBe('succeeded'); expect(h.page.clickCount).toBe(1);
    const experiment = success(await h.api.experimentCreate(h.request({ id: 'experiment-from-files', missionId: h.missionId,
      name: 'Workbook-backed keyword experiment', hypothesis: 'Lowering the bid improves ACOS', primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'], guardrailCriteria: ['广告订单 >= 95%'], productId: 'B0TEST', adEntityId: grant.allowedAdEntityIds[0],
      baseline: { untrustedRendererBaseline: true }, variant: { onlyVariable: 'keyword_bid', bidUsd: 1.35 },
      observationStartsAt: '2026-07-23T07:00:00.000Z', observationEndsAt: '2026-07-30T07:00:00.000Z' })));
    const started = await h.api.experimentTransition(h.request({ id: experiment.id, expectedRevision: experiment.revision, status: 'running' }));
    const running = success(started);
    expect(running.baseline).toMatchObject({ source: 'verified_ads_readback', dataBatchId: 'batch-1', appliedBidUsd: 1.35 });
    expect(running.baseline).not.toHaveProperty('untrustedRendererBaseline');
    expect(success(await h.api.experimentGet(h.request({ id: experiment.id })))).toMatchObject({ status: 'running', baseline: running.baseline });
    expect(await h.api.experimentEvaluate(h.request({ id: running.id, expectedRevision: running.revision }))).toMatchObject({ success: false });
    const events = success(await h.api.memoryList(h.request({ missionId: h.missionId })));
    expect(events.some(event => event.stage === 'READBACK')).toBe(true);
    expect(events.some(event => event.stage === 'EFFECT')).toBe(false);

    now = new Date('2026-07-30T12:00:00.000Z'); vi.setSystemTime(now);
    Object.assign(h.context, { businessDate: '2026-07-30' });
    const source = new LingxingImportRepository(h.database).getCollectionSnapshotForStore(h.context.storeId, 'batch-1')!;
    const observation = reportFiles(h.database, h.directory, undefined, { ...source.batch,
      id: 'observation-batch', requestId: 'observation-request', dateStart: '2026-07-23', dateEnd: '2026-07-29',
      businessDate: h.context.businessDate, createdAt: now.toISOString(), completedAt: now.toISOString() });
    const imported = importLingxingDownloadedReportMetrics(observation.result, observation);
    expect(imported, JSON.stringify(imported)).toMatchObject({ parsedFiles: 8, inserted: 9, errors: [] });
    // Collection transport is a declared fixture; all file import and domain writes below are production code.
    const jobRow = h.database.prepare('SELECT * FROM lingxing_collection_jobs WHERE job_id=?').get('batch-1') as Record<string, unknown>;
    const job = JSON.parse(String(jobRow.snapshot_json));
    Object.assign(job, { jobId: observation.result.batch.id, createdAt: now.toISOString(), updatedAt: now.toISOString(), completedAt: now.toISOString(), importCompletedAt: now.toISOString() });
    job.request = { ...job.request, requestId: 'observation-request', storeContext: h.context, dateStart: '2026-07-23', dateEnd: '2026-07-29' };
    job.lineage = { ...job.lineage, lineageId: job.jobId, rootJobId: job.jobId };
    const row = { ...jobRow, job_id: job.jobId, request_id: 'observation-request', business_date: h.context.businessDate,
      date_start: '2026-07-23', date_end: '2026-07-29', snapshot_json: JSON.stringify(job),
      created_at: now.toISOString(), updated_at: now.toISOString(), completed_at: now.toISOString() };
    const columns = Object.keys(row);
    h.database.prepare(`INSERT INTO lingxing_collection_jobs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(row));
    h.database.prepare(`INSERT INTO lingxing_collection_report_checkpoints(store_id,job_id,report_type,state,attempt_index,auto_retry_count,updated_at)
      SELECT store_id,?,report_type,state,attempt_index,auto_retry_count,? FROM lingxing_collection_report_checkpoints WHERE job_id='batch-1'`).run(job.jobId, now.toISOString());
    const observationMission = success(await h.api.missionCreate(h.request({ id: 'observation-mission', dataBatchId: job.jobId,
      policyVersionId: h.policyVersionId, productId: 'B0TEST', title: 'Observation data', objective: 'Measure the completed observation window',
      observationStartsAt: '2026-07-30T12:00:00.000Z', observationEndsAt: '2026-08-06T12:00:00.000Z', successCriteria: ['Measure'], guardrails: ['Read only'], actorId: 'operator' })));
    const evidence = h.analysisRepository.sealEvidencePackage(h.context, { missionId: observationMission.id, dateFrom: '2026-07-23', dateTo: '2026-07-29',
      asin: 'B0TEST', freshnessWindowHours: 48, ruleRevision: h.ruleRevision.value, modelRevision: h.modelRevision.value });
    const keyword = observation.repository.listFileSnapshotsForStore(h.context.storeId, evidence.importRunId).find(file => file.reportType === 'keyword')!;
    h.analysisRepository.registerVerifiedAdEntity(h.context, { authorityId: 'observation-object', evidencePackageId: evidence.id,
      adEntityId: grant.allowedAdEntityIds[0], entityType: 'keyword', entityName: 'door lock', campaignName: 'Campaign A', adGroupName: 'Ad Group A',
      sourceReportType: 'keyword', sourceFileHash: keyword.fileHash, sourceRow: 7, identitySource: 'ads_ui',
      proofSha256: 'a'.repeat(64), verifiedBy: 'isolated-browser-fixture', verifiedAt: now.toISOString() });
    const completed = success(await h.api.experimentEvaluate(h.request({ id: running.id, expectedRevision: running.revision })));
    expect(completed).toMatchObject({ status: 'completed', conclusion: expect.stringContaining('0.6667 → 0.3333') });
    expect(success(await h.api.experimentGet(h.request({ id: running.id })))).toMatchObject({ status: 'completed', conclusion: completed.conclusion });
    expect(success(await h.api.missionGet(h.request({ id: h.missionId })))).toMatchObject({ status: 'completed', phase: 'effect' });
    expect(h.missionRepository.listAnalysisCausalMemory(h.context, { productId: 'B0TEST', limit: 40 })).toEqual([
      expect.objectContaining({ eventType: 'experiment_completed', proofs: [expect.objectContaining({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })] })]);
    expect(h.page.clickCount).toBe(1);
  });
});
