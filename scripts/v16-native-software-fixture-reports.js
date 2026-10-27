const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { insist, fileRecord } = require('./v16-performance-artifacts');

function csvCell(value) { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
function providerRow(store, date, index, type) {
  return { '店铺名称': store.displayName, '国家': 'US', '类型': 'SP', '广告组合': '隔离软件组合', '广告活动': `隔离软件活动 ${index}`,
    '广告组': `隔离软件广告组 ${index}`, '广告组投放类型': '手动', '有效状态': 'enabled', '日期': date,
    '广告位': '搜索结果顶部', '广告名称': '隔离软件商品', 'ASIN': 'B0SOFT0001', 'MSKU': 'SOFTWARE-ONLY',
    '关键词': `隔离关键词 ${index}`, '匹配方式': '精准匹配', '用户搜索词': `隔离搜索词 ${index}`,
    '投放': type === 'auto_targeting' ? '紧密匹配' : '商品:"B0SOFT0001"', '备注': '仅软件验收，不是真实店铺事实',
    '曝光量': 100, '点击': 10, 'CTR': '10%', 'CPC-本币': .1, '花费-本币': 1, '广告销售额-本币': 5,
    '广告订单': 1, 'ACoS': '20%', 'ROAS': 5, 'CVR': '10%' };
}
function createReportBatch(runtime, directory, store, date, options = {}) {
  const templates = runtime.LINGXING_TEMPLATE_MANIFEST;
  insist(Array.isArray(templates) && templates.length === 8 && runtime.ReportParser && runtime.verifyDownloadedFile,
    'SOFTWARE_PRODUCTION_REPORT_CONTRACT_REQUIRED');
  const rowsPerReport = options.rowsPerReport ?? 1;
  insist(Number.isSafeInteger(rowsPerReport) && rowsPerReport >= 1 && rowsPerReport <= 100000, 'SOFTWARE_REPORT_ROW_COUNT_INVALID');
  const id = options.id ?? `software-eight-${store.storeId}-${randomUUID()}`, now = new Date().toISOString();
  const downloadDir = path.join(directory, id); fs.mkdirSync(downloadDir, { recursive: false });
  const originals = [], files = [];
  for (const template of templates) {
    const filePath = path.join(downloadDir, `${template.reportType}_${date}_${date}.csv`);
    const lines = [template.headers.map(csvCell).join(',')];
    for (let index=0;index<rowsPerReport;index++) {
      const values = providerRow(store, date, index, template.reportType);
      lines.push(template.headers.map(header => csvCell(values[header] ?? '')).join(','));
    }
    fs.writeFileSync(filePath, '\ufeff' + lines.join('\n') + '\n', { flag: 'wx' });
    const original = fileRecord(filePath), parsed = new runtime.ReportParser().autoParse(filePath,
      { reportType: template.reportType, requireRegisteredTemplate: true });
    const verification = runtime.verifyDownloadedFile(filePath, { expectedDownloadDir: downloadDir,
      expectedDateRange: { start: date, end: date }, expectedReportType: template.reportType });
    insist(verification.valid && parsed.success && parsed.schemaValid && parsed.data.length === rowsPerReport,
      `SOFTWARE_PRODUCTION_REPORT_REJECTED:${template.reportType}:${parsed.error ?? verification.errorMessage ?? JSON.stringify(parsed.validation)}`);
    originals.push(original);
    files.push({ id: id + '-' + template.reportType, batchId: id, reportType: template.reportType, displayName: template.reportType,
      status: 'downloaded', filePath, fileSizeBytes: original.sizeBytes, createdAt: now, updatedAt: now });
  }
  const batch = { id, storeId: store.storeId, browserProfileId: store.browserProfileId,
    businessDate: options.context?.businessDate ?? date, sessionGeneration: options.context?.sessionGeneration ?? 0,
    ...(options.requestId ? { requestId: options.requestId } : {}), dateStart: date, dateEnd: date,
    storeName: store.displayName, marketplaceCode: 'US', status: 'completed', downloadDir,
    manifestPath: path.join(downloadDir, 'manifest.json'), createdAt: now, completedAt: now };
  fs.writeFileSync(batch.manifestPath, JSON.stringify({ batch, files, classification: 'isolated-software-fixture' }, null, 2), { flag: 'wx' });
  originals.push(fileRecord(batch.manifestPath));
  return { batch, files, originals };
}
function seedSoftwareRecoveryInputs(runtime, database, root, store, date, count = 3, options = {}) {
  insist(Number.isSafeInteger(count) && count >= 3 && count <= 100, 'SOFTWARE_DISTINCT_IMPORT_COUNT_REQUIRED');
  const repository = new runtime.LingxingImportRepository(database), importBatchIds = [], originals = [];
  const directory = path.join(root, 'unimported-eight', store.storeId); fs.mkdirSync(directory, { recursive: true });
  for (let index=0;index<count;index++) {
    const result = createReportBatch(runtime, directory, store, date, { ...options, id: `software-import-${store.storeId}-${index}` });
    repository.saveCollectionSnapshotForStore(store.storeId, result);
    importBatchIds.push(result.batch.id); originals.push(...result.originals);
  }
  // 任务在实际 EXE 启动后另行安装，防止启动恢复先行消费测量前置状态。
  return { importBatchIds, collectionJobs: [], originals };
}
module.exports = { csvCell, providerRow, createReportBatch, seedSoftwareRecoveryInputs };
