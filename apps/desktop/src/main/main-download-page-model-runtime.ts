import * as path from 'path';
import * as fs from 'fs';
import { getDownloadCenterAutomationReadiness } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { validateDownloadCenterPageModel } from './download-center-page-model-validation';
import { backupExistingDownloadCenterPageModelOverride, getDownloadCenterPageModelOverrideMetadataPath, saveDownloadCenterPageModelOverride } from './download-center-page-model-override-store';
import { withTrustedDownloadCenterReportSearchSelector } from './main-download-diagnostics-runtime';
import { getBundledResourcesPath } from './main-store-access-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function readDownloadCenterPageModel(): DownloadCenterPageModel {
  const overridePath = getDownloadCenterPageModelOverridePath();
  if (fs.existsSync(overridePath)) {
    try {
      return withTrustedDownloadCenterReportSearchSelector(
        readAndValidateDownloadCenterPageModel(overridePath),
      );
    } catch {
      return withTrustedDownloadCenterReportSearchSelector(
        readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath()),
      );
    }
  }
  return withTrustedDownloadCenterReportSearchSelector(
    readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath()),
  );
}

export function getBundledDownloadCenterPageModelPath(): string {
  const mainRuntimeContext = getMainRuntimeContext();
  return path.join(getBundledResourcesPath(), 'page-models', mainRuntimeContext.DOWNLOAD_CENTER_PAGE_MODEL_FILENAME);
}

export function getDownloadCenterPageModelOverridePath(): string {
  const mainRuntimeContext = getMainRuntimeContext();
  return path.join(mainRuntimeContext.PAGE_MODELS_DIR, mainRuntimeContext.DOWNLOAD_CENTER_PAGE_MODEL_OVERRIDE_FILENAME);
}

export function readAndValidateDownloadCenterPageModel(modelPath: string): DownloadCenterPageModel {
  const parsed = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as unknown;
  validateDownloadCenterPageModel(parsed);
  return parsed;
}

export function handleGetDownloadCenterPageModel() {
  const overridePath = getDownloadCenterPageModelOverridePath();
  const source = fs.existsSync(overridePath) ? 'override' : 'bundled';
  const pathInUse = source === 'override' ? overridePath : getBundledDownloadCenterPageModelPath();
  let model: DownloadCenterPageModel;
  let overrideError: string | undefined;

  if (source === 'override') {
    try {
      model = readAndValidateDownloadCenterPageModel(overridePath);
    } catch (error) {
      overrideError = error instanceof Error ? error.message : String(error);
      model = readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath());
    }
  } else {
    model = readAndValidateDownloadCenterPageModel(pathInUse);
  }
  model = withTrustedDownloadCenterReportSearchSelector(model);

  return {
    model,
    source: overrideError ? 'bundled' : source,
    path: overrideError ? getBundledDownloadCenterPageModelPath() : pathInUse,
    overridePath,
    overrideMetadataPath: getDownloadCenterPageModelOverrideMetadataPath(overridePath),
    overrideError,
    readiness: getDownloadCenterAutomationReadiness(model),
  };
}

export function handleSaveDownloadCenterPageModel(model: DownloadCenterPageModel) {
  const mainRuntimeContext = getMainRuntimeContext();
  validateDownloadCenterPageModel(model);
  const overridePath = getDownloadCenterPageModelOverridePath();
  const readiness = getDownloadCenterAutomationReadiness(model);
  const metadata = saveDownloadCenterPageModelOverride({
    model,
    overridePath,
    appVersion: mainRuntimeContext.APP_VERSION,
    readiness,
  });
  return {
    ...handleGetDownloadCenterPageModel(),
    overrideSaveMetadata: metadata,
  };
}

export function handleResetDownloadCenterPageModel() {
  const overridePath = getDownloadCenterPageModelOverridePath();
  const backupPath = backupExistingDownloadCenterPageModelOverride(overridePath);
  if (fs.existsSync(overridePath)) {
    fs.unlinkSync(overridePath);
  }
  const metadataPath = getDownloadCenterPageModelOverrideMetadataPath(overridePath);
  if (fs.existsSync(metadataPath)) {
    fs.unlinkSync(metadataPath);
  }
  return {
    ...handleGetDownloadCenterPageModel(),
    resetBackupPath: backupPath,
  };
}
