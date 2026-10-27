import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BootstrapPaths } from './bootstrap-configuration';
import {
  deliveryReadinessAllowsExport,
  type DeliveryReadinessView,
} from './delivery-readiness-view';
import type { RuntimeLogPort } from './runtime-logger';

export interface DeliveryDataReconciliation {
  success: boolean;
  canonicalSource?: unknown;
  canonical?: unknown;
  blockers?: unknown;
  jsonPath?: string;
  markdownPath?: string;
}

export interface DeliveryBundleExportOptions {
  readonly paths: Pick<BootstrapPaths, 'deliveryBundlesDir'>;
  readonly getReadiness: () => DeliveryReadinessView;
  readonly getOperationScope: () => unknown;
  readonly exportDataReconciliation: (scope: unknown) => DeliveryDataReconciliation;
  readonly logger: Pick<RuntimeLogPort, 'error'>;
}

function copyBundleFile(sourcePath: string | undefined, targetDir: string, targetName: string): string | undefined {
  if (!sourcePath || !fs.existsSync(sourcePath)) return undefined;
  const targetPath = path.join(targetDir, targetName);
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

export function createLegacyDeliveryBundleExporter(options: DeliveryBundleExportOptions) {
  return function exportDeliveryBundle(input?: unknown) {
    const readiness = options.getReadiness();
    if (!readiness.available || !readiness.path) {
      return {
        success: false,
        status: 'APP_NEEDS_WORK',
        message: readiness.message || '最终验收 manifest 尚未生成，无法导出交付包。',
        missing: readiness.missing,
        actionItems: readiness.actionItems,
      };
    }
    if (!readiness.manifestDriven) {
      return {
        success: false,
        status: 'APP_NEEDS_WORK',
        message: '最终就绪结果不是 manifest 驱动，请先重新生成 evidence manifest 并运行最终验收。',
        finalReadinessPath: readiness.path,
        missing: ['最终验收结果不是 manifest 驱动'],
        actionItems: ['先运行 write:v15-evidence-manifest，再用该 manifest 运行 verify:v15-final-readiness。'],
      };
    }
    if (!deliveryReadinessAllowsExport(readiness)) {
      return {
        success: false,
        status: readiness.status,
        message: '最终就绪 manifest 未通过，不能导出 READY 交付包。',
        finalReadinessPath: readiness.path,
        gates: readiness.gates,
        missing: readiness.missing,
        actionItems: readiness.actionItems,
      };
    }
    const finalReadiness = JSON.parse(fs.readFileSync(readiness.path, 'utf8'));
    const evidenceManifestPath = typeof finalReadiness?.evidenceSelection?.manifestPath === 'string'
      ? path.resolve(finalReadiness.evidenceSelection.manifestPath)
      : '';
    if (!evidenceManifestPath || !fs.existsSync(evidenceManifestPath)) {
      return {
        success: false,
        status: 'APP_NEEDS_WORK',
        message: '最终就绪 evidence manifest 缺失，不能导出 READY 交付包。',
        finalReadinessPath: readiness.path,
        missing: ['最终就绪 evidence manifest 缺失'],
        actionItems: ['重新运行 write:v15-evidence-manifest 和 verify:v15-final-readiness，确认 evidenceSelection.manifestPath 存在。'],
      };
    }
    fs.mkdirSync(options.paths.deliveryBundlesDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bundleDir = path.join(options.paths.deliveryBundlesDir, `v15-delivery-bundle-${stamp}`);
    fs.mkdirSync(bundleDir, { recursive: true });
    const manifestPath = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const finalReadinessCopyPath = path.join(bundleDir, path.basename(readiness.path));
    fs.copyFileSync(readiness.path, finalReadinessCopyPath);
    let dataReconciliation: DeliveryDataReconciliation = {
      success: false,
      blockers: ['未生成数据口径核对报告：交付包导出时没有收到当前运营范围。'],
    };
    let dataReconciliationJsonCopy: string | undefined;
    let dataReconciliationMarkdownCopy: string | undefined;
    try {
      const reconciliationScope = input || options.getOperationScope() || finalReadiness.scope;
      if (reconciliationScope) {
        dataReconciliation = options.exportDataReconciliation(reconciliationScope);
        dataReconciliationJsonCopy = copyBundleFile(dataReconciliation.jsonPath, bundleDir, 'data-reconciliation.json');
        dataReconciliationMarkdownCopy = copyBundleFile(dataReconciliation.markdownPath, bundleDir, 'data-reconciliation.md');
      }
    } catch (error) {
      options.logger.error('delivery.data_reconciliation_failed', { error, finalReadinessPath: readiness.path });
      dataReconciliation = {
        success: false,
        blockers: [`数据口径核对报告生成失败：${error instanceof Error ? error.message : String(error)}`],
      };
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: readiness.status,
      appReady: readiness.appReady,
      finalReadinessPath: readiness.path,
      finalReadinessCopy: path.basename(finalReadinessCopyPath),
      dataReconciliation: {
        canonicalSource: dataReconciliation.canonicalSource,
        canonical: dataReconciliation.canonical,
        blockers: dataReconciliation.blockers,
        sourceJsonPath: dataReconciliation.jsonPath,
        sourceMarkdownPath: dataReconciliation.markdownPath,
        bundleJson: dataReconciliationJsonCopy ? path.basename(dataReconciliationJsonCopy) : undefined,
        bundleMarkdown: dataReconciliationMarkdownCopy ? path.basename(dataReconciliationMarkdownCopy) : undefined,
      },
      gates: readiness.gates,
      gatesSummary: readiness.gatesSummary,
      note: 'Renderer-triggered delivery bundle marker created from the final readiness manifest. Includes current-scope data reconciliation; full evidence export can be refreshed with export-v15-delivery-bundle.js.',
    }, null, 2)}\n`, 'utf8');
    return {
      success: true,
      status: readiness.status,
      bundleDir,
      manifestPath,
      dataReconciliation: {
        jsonPath: dataReconciliationJsonCopy,
        markdownPath: dataReconciliationMarkdownCopy,
        canonical: dataReconciliation.canonical,
        canonicalSource: dataReconciliation.canonicalSource,
        blockers: dataReconciliation.blockers,
      },
    };
  };
}
