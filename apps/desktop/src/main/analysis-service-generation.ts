import {
  type CapturedAnalysisGenerationAuthority, type AnalysisRecommendationGenerationScope, type RecommendationGenerationResultForAnalysis,
} from './analysis-service-contracts';

export const DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS = 120_000;

export const MAX_ANALYSIS_GENERATION_TIMEOUT_MS = 15 * 60_000;

export class AnalysisGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `AI 分析在 ${formatAnalysisTimeout(timeoutMs)} 内未完成，已安全停止且未生成建议；`
      + '请检查网络、AI Key 与模型设置后重试。',
    );
    this.name = 'AnalysisGenerationTimeoutError';
  }
}

export function validatedAnalysisGenerationTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ANALYSIS_GENERATION_TIMEOUT_MS) {
    throw new RangeError(
      `generationTimeoutMs must be an integer between 1 and ${MAX_ANALYSIS_GENERATION_TIMEOUT_MS}`,
    );
  }
  return value;
}

export async function generateRecommendationsWithinDeadline(
  generateRecommendations: CapturedAnalysisGenerationAuthority['generateRecommendations'],
  scope: Omit<AnalysisRecommendationGenerationScope, 'signal'>,
  timeoutMs: number,
): Promise<RecommendationGenerationResultForAnalysis> {
  const controller = new AbortController();
  const timeoutError = new AnalysisGenerationTimeoutError(timeoutMs);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  const generation = Promise.resolve().then(() => generateRecommendations({
    ...scope,
    signal: controller.signal,
  }));
  try {
    return await Promise.race([generation, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export function formatAnalysisTimeout(timeoutMs: number): string {
  if (timeoutMs >= 1_000 && timeoutMs % 1_000 === 0) return `${timeoutMs / 1_000} 秒`;
  return `${timeoutMs} 毫秒`;
}
