/**
 * Real-report artifact lifecycle used by the data-import validation
 * table and the data-collection monitor. The states intentionally go
 * from missing → ready → downloaded → imported, with import_failed
 * and failed as terminal failure paths the operator must surface.
 */
export type ReportStatusToken =
  | 'missing'
  | 'ready'
  | 'downloaded'
  | 'imported'
  | 'import_failed'
  | 'failed';

const REPORT_STATUS_LABELS: Readonly<Record<ReportStatusToken, string>> = Object.freeze({
  missing: '缺少真实文件',
  ready: '可下载',
  downloaded: '已下载待入库',
  imported: '已入库',
  import_failed: '导入失败',
  failed: '失败',
});

/**
 * Localize a real-report lifecycle token to its Chinese label.
 *
 * Unknown / empty inputs return `状态待同步` so cells stay non-blank
 * when an upstream pipeline omits a status row.
 */
export function localizeReportStatus(value: unknown): string {
  if (value == null || value === '') return '状态待同步';
  const token = String(value).trim().toLowerCase() as ReportStatusToken;
  return REPORT_STATUS_LABELS[token] ?? '状态待同步';
}

export const REPORT_STATUS_LABEL_TABLE: Readonly<Record<ReportStatusToken, string>>
  = REPORT_STATUS_LABELS;
