import type { DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';

export interface DiagnosticRowDatabase {
  prepare: (sql: string) => {
    get: (...params: any[]) => unknown;
  };
}

export function getLatestDownloadCenterDiagnosticRowForModel(
  db: DiagnosticRowDatabase,
  model: DownloadCenterPageModel,
  dateStart: string,
  dateEnd: string,
): unknown {
  return db.prepare(`
    SELECT * FROM download_center_diagnostics
    WHERE page_model = ?
      AND page_model_snapshot_json = ?
      AND date_start = ?
      AND date_end = ?
    ORDER BY checked_at DESC, id DESC
    LIMIT 1
  `).get(model.name, JSON.stringify(model), dateStart, dateEnd);
}
