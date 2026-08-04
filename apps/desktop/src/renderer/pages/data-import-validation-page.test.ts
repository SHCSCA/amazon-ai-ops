import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  dataImportActionButtonView,
  dataImportBusyLabel,
  dataImportExportButtonView,
  dataImportFileLabel,
  dataImportOpenArtifactButtonView,
  buildDataImportTableFeedback,
  dataImportTableFeedbackClass,
  dataImportTableRefreshRowClass,
  dataImportTableSortHandler,
  nextDataImportSort,
  sortDataImportReportRows,
  type DataImportReportRow,
  buildDataImportTaskState,
} from './data-import-validation-page';

function row(overrides: Partial<DataImportReportRow>): DataImportReportRow {
  return {
    type: 'campaign',
    label: '广告活动报告',
    fileName: '',
    artifactId: '',
    fileExtension: '',
    fileHash: '',
    fileSizeBytes: 0,
    importedRows: 0,
    status: 'missing',
    importError: '',
    statusDisplay: {
      label: '缺少真实文件',
      detail: '当前范围还没有这类 Lingxing 原始报表文件。',
      tone: 'blocked',
    },
    ...overrides,
  };
}

describe('data import report table sorting', () => {
  it('does not expose diagnosis when imported rows do not cover every required report type', () => {
    const state = buildDataImportTaskState({
      realReportCount: 8,
      importedRows: 96,
      reportFolderArtifactId: 'artifact:v1:reports',
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'import' },
    });

    expect(state.primaryActionLabel).toBe('导入已下载表格');
    expect(state.detail).not.toContain('已写入 SQLite');
  });

  it('presents a fully proven zero-row import as a valid zero-data state', () => {
    const state = buildDataImportTaskState({
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 0,
      reportFolderArtifactId: 'artifact:v1:reports',
      readiness: { status: 'ready', canEnterDiagnosis: true, nextStep: 'diagnose' },
    });

    expect(state.primaryActionLabel).toBe('查看广告表现');
    expect(state.detail).toContain('真实零数据状态');
    expect(state.detail).not.toContain('未入库');
  });

  it('wires the import task model and ledger gate into one first-screen task banner', () => {
    const source = readFileSync(new URL('./data-import-validation-page.tsx', import.meta.url), 'utf8');
    const header = source.slice(source.indexOf('<PageHeader'), source.indexOf('/>', source.indexOf('<PageHeader')) + 2);
    const primaryPanel = source.slice(source.indexOf('className="data-import-primary-panel"'), source.indexOf('</Panel>', source.indexOf('className="data-import-primary-panel"')));

    expect(source).toContain('const computedTaskState = buildDataImportTaskState({');
    expect(source).toContain('const taskState: DataImportTaskState = collectionJobsLoading');
    expect(source).toContain('buildProductionCollectionLineageReadiness({');
    expect(source.match(/<TaskBanner/g)).toHaveLength(1);
    expect(source).toContain('title={taskState.title}');
    expect(source).toContain('description={taskState.detail}');
    expect(source).toContain('label: taskState.primaryActionLabel');
    expect(header).not.toContain('primaryAction=');
    expect(primaryPanel).not.toContain("className={runningImport ? 'primary-button button-loading' : 'primary-button'}");
  });

  it('keeps report file cells readable by showing a short file name', () => {
    expect(dataImportFileLabel(row({
      fileName: 'campaign.xlsx',
    }))).toBe('campaign.xlsx');

    expect(dataImportFileLabel(row({
      artifactId: 'artifact:v1:user-search-term',
    }))).toBe('缺少真实文件');

    expect(dataImportFileLabel(row({}))).toBe('缺少真实文件');
  });

  it('uses opaque artifacts for report, manifest, diagnostic, and reconciliation access', () => {
    const source = readFileSync(new URL('./data-import-validation-page.tsx', import.meta.url), 'utf8');

    for (const forbidden of ['filePath', 'folderPath', 'downloadDir', 'manifestPath', 'jsonPath', 'markdownPath']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('openReportArtifact');
    expect(source).toContain('exportDataReconciliationArtifacts');
    expect(source).toContain('jsonArtifactId');
  });

  it('accepts a schema-valid zero-row receipt without treating row count as an import error', () => {
    const source = readFileSync(new URL('./data-import-validation-page.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('inserted <= 0');
    expect(source).toContain('parsedFiles <= 0 || errors > 0');
    expect(source).toContain('零行回执已登记');
  });

  it('keeps production readiness bound to store task lineage instead of aggregate same-date files', () => {
    const source = readFileSync(new URL('./data-import-validation-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('listLingxingCollectionJobs({');
    expect(source).toContain('limit: 100');
    expect(source).toContain('file.batchId === binding.expectedBatchId');
    expect(source).toContain('dataLedger.canEnterDiagnosis && lineageReadiness.canEnterDiagnosis');
    expect(source).toContain('聚合检测到');
    expect(source).toContain('其他批次不参与放行');
    expect(source).toContain('DEV 预览不会注入伪造任务、lineage 或入库成功');
  });

  it('sorts report rows without mutating the original order', () => {
    const rows = [
      row({ label: '关键词报告', importedRows: 300, fileSizeBytes: 1200, status: 'imported' }),
      row({ label: '广告活动报告', importedRows: 120, fileSizeBytes: 500, status: 'downloaded' }),
      row({ label: '用户搜索词报告', importedRows: 700, fileSizeBytes: 2000, status: 'imported' }),
    ];

    expect(sortDataImportReportRows(rows, { key: 'rows', direction: 'desc' }).map((item) => item.label)).toEqual([
      '用户搜索词报告',
      '关键词报告',
      '广告活动报告',
    ]);
    expect(rows.map((item) => item.label)).toEqual(['关键词报告', '广告活动报告', '用户搜索词报告']);
  });

  it('uses ascending order for text columns and descending order for numeric columns when switching headers', () => {
    expect(nextDataImportSort(null, 'label')).toEqual({ key: 'label', direction: 'asc' });
    expect(nextDataImportSort(null, 'hash')).toEqual({ key: 'hash', direction: 'asc' });
    expect(nextDataImportSort({ key: 'label', direction: 'asc' }, 'label')).toEqual({ key: 'label', direction: 'desc' });
    expect(nextDataImportSort({ key: 'label', direction: 'desc' }, 'rows')).toEqual({ key: 'rows', direction: 'desc' });
    expect(nextDataImportSort({ key: 'rows', direction: 'desc' }, 'size')).toEqual({ key: 'size', direction: 'desc' });
    expect(nextDataImportSort({ key: 'size', direction: 'desc' }, 'status')).toEqual({ key: 'status', direction: 'asc' });
  });

  it('sorts local SHA-256 checksums as a first-class verification column', () => {
    const rows = [
      row({ label: '关键词报告', fileHash: 'ff00deadcafe' }),
      row({ label: '广告活动报告', fileHash: '11aa99887766' }),
      row({ label: '用户搜索词报告', fileHash: '' }),
    ];

    expect(sortDataImportReportRows(rows, { key: 'hash', direction: 'asc' }).map((item) => item.label)).toEqual([
      '用户搜索词报告',
      '广告活动报告',
      '关键词报告',
    ]);
  });
});

describe('data import table micro-feedback', () => {
  it('keeps the first screen table-first instead of duplicating import status in KPI cards', () => {
    const source = readFileSync(new URL('./data-import-validation-page.tsx', import.meta.url), 'utf8');
    const firstPanelStart = source.indexOf('className="data-import-primary-panel"');
    const firstPanelEnd = source.indexOf('className={importFeedback.className}', firstPanelStart);
    const firstPanel = source.slice(firstPanelStart, firstPanelEnd);

    expect(source).not.toContain('data-import-prototype-status-grid');
    expect(source).not.toContain('KpiCard');
    expect(firstPanel).toContain('data-import-title-pills');
    expect(firstPanel).toContain('data-import-prototype-table');
    expect(firstPanel).toContain('只以 Lingxing xlsx/xls/csv 原始表格入库');
    expect(firstPanel).not.toContain('row.statusDisplay.detail');
    expect(source).toContain('data-import-feedback-strip');
    expect(source).toContain('data-import-report-folder-panel');
  });

  it('summarizes the active sort and current import coverage', () => {
    expect(buildDataImportTableFeedback({
      importedRows: 2416,
      realReportCount: 8,
      sortDirection: 'desc',
      sortLabel: '入库行数',
      totalCount: 8,
    })).toBe('按入库行数降序展示 8 类报表；真实报表 8/8，已入库 2416 行。');

    expect(buildDataImportTableFeedback({
      importedRows: 0,
      realReportCount: 2,
      sortDirection: null,
      sortLabel: '',
      totalCount: 8,
    })).toBe('按默认报表顺序展示 8 类报表；真实报表 2/8，已入库 0 行。');
  });

  it('marks the table shell and rows during the 200ms sort refresh', () => {
    expect(dataImportTableFeedbackClass({ refreshing: false, locked: false })).toBe('data-import-table-shell');
    expect(dataImportTableFeedbackClass({ refreshing: true, locked: false })).toContain('data-import-table-refreshing');
    expect(dataImportTableFeedbackClass({ refreshing: false, locked: true })).toContain('data-import-table-locked');
    expect(dataImportTableRefreshRowClass(false)).toBeUndefined();
    expect(dataImportTableRefreshRowClass(true)).toBe('data-import-table-row-refresh');
  });

  it('locks sorting while an import is writing metrics into SQLite', () => {
    const sortSpy = vi.fn();

    expect(dataImportTableSortHandler({ locked: true, onSort: sortSpy })).toBeUndefined();

    const handler = dataImportTableSortHandler({ locked: false, onSort: sortSpy });
    expect(handler).toBeTypeOf('function');
    handler?.('hash');
    expect(sortSpy).toHaveBeenCalledWith('hash');
  });

  it('keeps the 200ms sorting feedback and aria-live contract wired', () => {
    const source = readFileSync(new URL('./data-import-validation-page.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('data-import-table-feedback');
    expect(source).toContain('dataImportTableSortHandler');
    expect(source).toContain('data-import-table-lock');
    expect(source).toContain("header: 'SHA-256'");
    expect(source).toContain('shortDataImportHash');
    expect(source).toContain('setTableRefreshing');
    expect(source).toContain('dataImportTableRefreshRowClass(tableRefreshing)');
    expect(source).toContain('dataImportFileLabel(row)');
    expect(source).not.toContain('title={row.filePath}');
    expect(source).toContain('row.artifactId');
    expect(source).toContain('openReportArtifact');
    expect(source).not.toContain('openReportPath');
    expect(source).toContain('}, 200)');
    expect(styles).toContain('.data-import-table-refreshing');
    expect(styles).toContain('.data-import-table-locked');
    expect(styles).toContain('@keyframes data-import-table-refresh');
    expect(styles).toMatch(/animation:\s*data-import-table-refresh 200ms/);
    expect(styles).toContain('filter: blur(1px)');
    expect(styles).toContain('.data-import-table-refreshing .virtual-table-wrap::after');
    expect(styles).toMatch(/\.data-import-table-refreshing \.virtual-table-wrap::after[\s\S]*pointer-events:\s*none/);
    expect(styles).toMatch(/\.data-import-table-refreshing \.virtual-table-wrap::after[\s\S]*backdrop-filter:\s*blur\(2px\)/);
    expect(styles).toContain('@keyframes data-import-table-refresh-sweep');
    expect(styles).toContain('.data-import-table-row-refresh');
    expect(styles).toContain('@keyframes data-import-row-fade-in');
    expect(styles).toMatch(/\.data-import-table-row-refresh[\s\S]*animation:\s*data-import-row-fade-in 200ms/);
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.data-import-table-row-refresh[\s\S]*animation:\s*none/);
  });
});

describe('data import action micro-feedback', () => {
  it('keeps first-screen task buttons on the same processing copy', () => {
    expect(dataImportBusyLabel('current')).toBe('处理中...');
    expect(dataImportBusyLabel('local')).toBe('处理中...');
    expect(dataImportBusyLabel(null)).toBeUndefined();
  });

  it('uses the shared busy contract for the active import action', () => {
    const active = dataImportActionButtonView({
      mode: 'current',
      runningImport: 'current',
      hasRealFiles: true,
    });
    const lockedPeer = dataImportActionButtonView({
      mode: 'local',
      runningImport: 'current',
      hasRealFiles: true,
    });

    expect(active.label).toBe('处理中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.className).toContain('button-loading');
    expect(lockedPeer.label).toBe('导入本地报表');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });

  it('uses the shared busy contract while exporting reconciliation data', () => {
    const active = dataImportExportButtonView({
      exportingReconciliation: true,
      hasImportedMetrics: true,
    });

    expect(active.label).toBe('处理中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.className).toContain('button-loading');
  });

  it('uses the shared busy contract while opening store-bound report artifacts', () => {
    const active = dataImportOpenArtifactButtonView({
      activeArtifactKey: '打开报表目录:artifact:v1:reports',
      idleLabel: '打开报表目录',
      artifactKey: '打开报表目录:artifact:v1:reports',
    });
    const lockedPeer = dataImportOpenArtifactButtonView({
      activeArtifactKey: '打开报表目录:artifact:v1:reports',
      idleLabel: '打开对账说明文件',
      artifactKey: '打开对账说明文件:artifact:v1:reconcile',
    });

    expect(active.label).toBe('打开中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');
    expect(lockedPeer.label).toBe('打开对账说明文件');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });
});
