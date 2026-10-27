import { parentPort, workerData } from 'node:worker_threads';
import { verifyV16DeliveryRequest } from './delivery-v16-verification';
const { createRuntimeLogRecord } = require('../../../../packages/shared-types/src/runtime-log-format.cjs');

if (!parentPort) throw new Error('V16_DELIVERY_WORKER_CHANNEL_REQUIRED');
try {
  parentPort.postMessage({ ...verifyV16DeliveryRequest(workerData), nativeAbi: process.versions.modules });
} catch (error) {
  parentPort.postMessage({
    nativeAbi: process.versions.modules,
    diagnostics: [createRuntimeLogRecord('error', 'delivery.v16_worker_failed', { error, nonce: workerData?.binding?.nonce })],
    error: { code: 'V16_DELIVERY_VERIFICATION_FAILED', message: error instanceof Error ? error.message : String(error) },
  });
} finally { parentPort.close(); }
