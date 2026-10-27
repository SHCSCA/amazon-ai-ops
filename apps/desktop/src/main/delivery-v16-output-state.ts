import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DeliveryV16Request } from './delivery-v16-contracts';
import { assertDirectDirectory } from './delivery-v16-frozen-build';

const { replacePublicationJson } = require('../../../../scripts/v16-publication-files');
const { invalidatePublicationRun } = require('../../../../scripts/v16-publication-state');

export async function invalidateV16Outputs(request: DeliveryV16Request, error: unknown): Promise<void> {
  const output = path.join(request.paths.outputRoot, request.binding.nonce);
  if (!fs.existsSync(output)) return;
  assertDirectDirectory(request.paths.outputRoot);
  assertDirectDirectory(output);
  // 只失效 Main 为该 nonce 分配的私有目录，不触碰工作包原件或正式库。
  const paths = {
    root: output, readmePath: path.join(output, 'README.md'),
    readinessPath: path.join(output, 'readiness.json'),
  };
  const failures: unknown[] = [];
  const attempt = (operation: () => void) => { try { operation(); } catch (failure) { failures.push(failure); } };
  attempt(() => {
    if (!fs.existsSync(paths.readmePath)) fs.writeFileSync(paths.readmePath, '**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.** 校验已取消。\n', { flag: 'wx' });
    invalidatePublicationRun(paths, error);
  });
  for (const name of ['publication-closure.json', path.join('delivery-bundle', 'delivery-bundle-manifest.json')]) attempt(() => {
    const file = path.join(output, name);
    if (!fs.existsSync(file)) return;
    assertDirectDirectory(path.dirname(file));
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('V16_INVALIDATION_TARGET_NOT_DIRECT');
    replacePublicationJson(file, {
      schemaVersion: 'v16.invalidated-publication/1', status: 'APP_NEEDS_WORK',
      phase: 'ABORTED', binding: request.binding, timestamp: new Date().toISOString(),
      issues: ['DELIVERY_AUTHORITY_OR_WORKER_CHANGED'],
    });
  });
  if (failures.length) throw new AggregateError(failures, 'V16_PRIVATE_OUTPUT_INVALIDATION_INCOMPLETE');
}
