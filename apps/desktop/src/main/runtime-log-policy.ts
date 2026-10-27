export interface RuntimeLogRetentionPolicy {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
  readonly retainDays: number;
}

export const DEFAULT_RUNTIME_LOG_RETENTION: RuntimeLogRetentionPolicy = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFiles: 64,
  retainDays: 14,
});

export function captureRuntimeLogRetention(policy: RuntimeLogRetentionPolicy): RuntimeLogRetentionPolicy {
  for (const value of [policy.maxFileBytes, policy.maxTotalBytes, policy.maxFiles, policy.retainDays]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('日志保留配置必须为正整数。');
  }
  if (policy.maxFileBytes > policy.maxTotalBytes) throw new TypeError('日志单文件上限不能超过总量上限。');
  return Object.freeze({
    maxFileBytes: policy.maxFileBytes, maxTotalBytes: policy.maxTotalBytes,
    maxFiles: policy.maxFiles, retainDays: policy.retainDays,
  });
}
