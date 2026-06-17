export type CollectionActionSummaryTone = 'ready' | 'pending' | 'warning' | 'blocked';
export type CollectionActionSummaryMode = 'download-existing' | 'recreate-selected' | 'recreate-full' | 'import';

export interface CollectionActionSummaryInput {
  mode: CollectionActionSummaryMode;
  tone: 'default' | 'success' | 'warning' | 'blocked';
  currentRealReportCount: number;
  actionRealFileCount: number;
  parsedFiles: number;
  insertedRows: number;
  currentImportedRows: number;
  failedCount: number;
  downloadDir?: string;
  manifestPath?: string;
}

export interface CollectionActionSummary {
  statusLabel: string;
  tone: CollectionActionSummaryTone;
  headline: string;
  facts: string[];
  blockers: string[];
  nextAction: string;
  primaryPathLabel: string;
  primaryPath?: string;
}

export function buildCollectionActionSummary(input: CollectionActionSummaryInput): CollectionActionSummary {
  const facts = [
    `当前范围覆盖 ${input.currentRealReportCount}/8 类`,
    `本次新增真实文件 ${input.actionRealFileCount} 个`,
    `本次解析 ${input.parsedFiles} 表`,
    `本次写入 ${input.insertedRows} 行`,
    `当前 DB 指标 ${input.currentImportedRows} 行`,
  ];
  const blockers = [
    ...(input.currentRealReportCount <= 0 ? ['没有真实报表文件'] : []),
    ...(input.currentRealReportCount > 0 && input.currentImportedRows <= 0 ? ['真实报表尚未写入 DB 指标'] : []),
    ...(input.failedCount > 0 ? [`有 ${input.failedCount} 个失败项`] : []),
  ];

  if (input.currentImportedRows > 0 || input.insertedRows > 0) {
    return {
      statusLabel: '可进入量化',
      tone: 'ready',
      headline: `真实报表已经入库，当前范围有 ${input.currentImportedRows || input.insertedRows} 行日级广告指标。`,
      facts,
      blockers: [],
      nextAction: '进入广告量化，复核花费、订单、ACOS 和产品阶段。',
      primaryPathLabel: input.downloadDir ? actionDirectoryLabel(input.mode) : '打开本次 Manifest',
      primaryPath: input.downloadDir || input.manifestPath,
    };
  }

  if (input.currentRealReportCount > 0 || input.actionRealFileCount > 0) {
    const hasNewActionFiles = input.actionRealFileCount > 0;
    return {
      statusLabel: '已下载，待导入',
      tone: 'warning',
      headline: hasNewActionFiles
        ? `本次拿到了 ${input.actionRealFileCount} 个真实报表文件，但还没有写入 DB 指标。`
        : `当前范围已有 ${input.currentRealReportCount}/8 类真实报表覆盖，但本次动作没有新增下载，且还没有写入 DB 指标。`,
      facts,
      blockers,
      nextAction: hasNewActionFiles
        ? '点击“导入已下载表格”，把 xlsx/xls/csv 写入日级广告指标。'
        : '打开真实报表目录确认 xlsx/xls/csv 后，点击“导入已下载表格”。',
      primaryPathLabel: input.downloadDir ? actionDirectoryLabel(input.mode) : '打开本次 Manifest',
      primaryPath: input.downloadDir || input.manifestPath,
    };
  }

  return {
    statusLabel: '未拿到真实报表',
    tone: 'blocked',
    headline: '本次动作没有产生可用于量化的 xlsx/xls/csv 报表。',
    facts,
    blockers,
    nextAction: '打开 Manifest 和失败原因，确认领星 ready 行、页面模型、日期、店铺和站点后重试。',
    primaryPathLabel: input.manifestPath ? '打开本次 Manifest' : '查看失败原因',
    primaryPath: input.manifestPath,
  };
}

function actionDirectoryLabel(mode: CollectionActionSummaryMode): string {
  return mode === 'import' ? '打开本次导入目录' : '打开本次下载目录';
}
