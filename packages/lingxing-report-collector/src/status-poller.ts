export async function pollUntil<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 120000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const value = await read();
    if (isDone(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`等待报告状态超时：${timeoutMs}ms`);
}

export type ReportGenerationStatus =
  | 'pending'
  | 'created'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'skipped'
  | 'unknown';

export type ReportStatusPhase = 'pending' | 'terminal_success' | 'terminal_failure';

export interface ReportStatusSnapshot {
  status: ReportGenerationStatus;
  text: string;
  checkedAt: string;
  attempt: number;
}

export interface ReportStatusClassification {
  state: ReportGenerationStatus;
  phase: ReportStatusPhase;
  rawText: string;
  reason: string;
  matchedToken?: string;
}

export interface PollReportGenerationStatusOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onPendingSnapshot?: (snapshot: ReportStatusSnapshot) => Promise<void> | void;
}

export interface ExpectedLingxingGeneratedReportNameInput {
  dateStart: string;
  dateEnd: string;
  reportToken: string;
}

export function parseExpectedLingxingGeneratedReportName(
  detail: string,
  input: ExpectedLingxingGeneratedReportNameInput,
): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateStart)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateEnd)
    || !/^[A-Za-z0-9_-]+$/.test(input.reportToken)) {
    return undefined;
  }

  const prefix = `AAO_${input.dateStart.replaceAll('-', '')}_${input.dateEnd.replaceAll('-', '')}_${input.reportToken}_`;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...detail.matchAll(new RegExp(`${escapedPrefix}\\d{6}`, 'g'))]
    .map((match) => match[0]);
  const uniqueMatches = [...new Set(matches)];
  return uniqueMatches.length === 1 ? uniqueMatches[0] : undefined;
}

export type LingxingCreatedReportRowReconciliation =
  | { outcome: 'found'; status: ReportGenerationStatus; rowText: string }
  | { outcome: 'confirmed_absent' }
  | { outcome: 'ambiguous' };

export function reconcileLingxingCreatedReportRows(
  rowTexts: readonly string[],
  input: {
    expectedReportName: string;
    dateStart: string;
    dateEnd: string;
    exactSearchApplied?: boolean;
  },
): LingxingCreatedReportRowReconciliation {
  const compactStart = input.dateStart.replaceAll('-', '');
  const compactEnd = input.dateEnd.replaceAll('-', '');
  const expectedPrefix = `AAO_${compactStart}_${compactEnd}_`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateStart)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateEnd)
    || !input.expectedReportName.startsWith(expectedPrefix)) {
    return { outcome: 'ambiguous' };
  }

  const dateDisplay = `${input.dateStart} - ${input.dateEnd}`;
  const rows = [...new Set(rowTexts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const scopedRows = rows.filter((text) => text.includes(expectedPrefix) && text.includes(dateDisplay));
  const exactRows = scopedRows.filter((text) => text.includes(input.expectedReportName));
  if (exactRows.length !== 1) {
    return exactRows.length === 0 && input.exactSearchApplied === true
      ? { outcome: 'confirmed_absent' }
      : { outcome: 'ambiguous' };
  }

  const status = classifyReportGenerationStatus(exactRows[0]);
  return status === 'unknown'
    ? { outcome: 'ambiguous' }
    : { outcome: 'found', status, rowText: exactRows[0] };
}

export class ReportGenerationTerminalError extends Error {
  constructor(
    message: string,
    readonly snapshot: ReportStatusSnapshot,
  ) {
    super(message);
    this.name = 'ReportGenerationTerminalError';
  }
}

function normalizeStatusText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchToken(text: string, tokens: RegExp[]): string | undefined {
  return tokens.find((token) => token.test(text))?.source;
}

export function classifyReportStatus(text: string): ReportStatusClassification {
  const normalized = normalizeStatusText(text);
  if (!normalized) {
    return {
      state: 'unknown',
      phase: 'pending',
      rawText: text,
      reason: 'empty status text',
    };
  }

  const failedToken = matchToken(normalized, [/生成失败/i, /下載失敗/i, /下载失败/i, /创建失败/i, /處理失敗/i, /处理失败/i, /失败/i, /失敗/i, /异常/i, /異常/i, /错误/i, /錯誤/i, /error/i, /failed/i, /failure/i]);
  if (failedToken) {
    return {
      state: 'failed',
      phase: 'terminal_failure',
      rawText: text,
      reason: 'matched failure status text',
      matchedToken: failedToken,
    };
  }
  const expiredToken = matchToken(normalized, [/已过期/i, /已過期/i, /过期/i, /過期/i, /expired/i, /expire/i]);
  if (expiredToken) {
    return {
      state: 'expired',
      phase: 'terminal_failure',
      rawText: text,
      reason: 'matched expired status text',
      matchedToken: expiredToken,
    };
  }
  const skippedToken = matchToken(normalized, [/已取消/i, /取消/i, /不可用/i, /不可下载/i, /不可下載/i, /無法下載/i, /无法下载/i, /canceled/i, /cancelled/i, /skipped/i, /unavailable/i]);
  if (skippedToken) {
    return {
      state: 'skipped',
      phase: 'terminal_failure',
      rawText: text,
      reason: 'matched skipped or unavailable status text',
      matchedToken: skippedToken,
    };
  }
  const generatingToken = matchToken(normalized, [/生成中/i, /產生中/i, /处理中/i, /處理中/i, /正在生成/i, /正在處理/i, /正在处理/i, /等待生成/i, /下载中/i, /下載中/i, /正在下载/i, /正在下載/i, /排队/i, /排隊/i, /queued/i, /processing/i, /generating/i, /downloading/i, /in progress/i]);
  if (generatingToken) {
    return {
      state: 'generating',
      phase: 'pending',
      rawText: text,
      reason: 'matched in-progress status text',
      matchedToken: generatingToken,
    };
  }
  const pendingToken = matchToken(normalized, [/待创建/i, /待建立/i, /待生成/i, /pending/i, /waiting/i]);
  if (pendingToken) {
    return {
      state: 'pending',
      phase: 'pending',
      rawText: text,
      reason: 'matched pending status text',
      matchedToken: pendingToken,
    };
  }
  const createdToken = matchToken(normalized, [/已创建/i, /已建立/i, /created/i]);
  if (createdToken) {
    return {
      state: 'created',
      phase: 'pending',
      rawText: text,
      reason: 'matched created status text',
      matchedToken: createdToken,
    };
  }
  const readyToken = matchToken(normalized, [/生成成功/i, /產生成功/i, /可下载/i, /可下載/i, /已生成/i, /已產生/i, /已完成/i, /完成/i, /成功/i, /ready/i, /completed/i, /available/i]);
  if (readyToken) {
    return {
      state: 'ready',
      phase: 'terminal_success',
      rawText: text,
      reason: 'matched ready status text',
      matchedToken: readyToken,
    };
  }

  return {
    state: 'unknown',
    phase: 'pending',
    rawText: text,
    reason: 'status text did not match known tokens',
  };
}

export function classifyReportGenerationStatus(text: string): ReportGenerationStatus {
  return classifyReportStatus(text).state;
}

export function isTerminalReportGenerationStatus(status: ReportGenerationStatus): boolean {
  return status === 'ready' || status === 'failed' || status === 'expired' || status === 'skipped';
}

export async function pollReportGenerationStatus(
  readStatusText: () => Promise<string>,
  options: PollReportGenerationStatusOptions = {},
): Promise<ReportStatusSnapshot> {
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 300000;
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    attempt += 1;
    const text = await readStatusText();
    const classification = classifyReportStatus(text);
    const snapshot: ReportStatusSnapshot = {
      status: classification.state,
      text,
      checkedAt: new Date().toISOString(),
      attempt,
    };

    if (classification.phase === 'terminal_success') {
      return snapshot;
    }
    if (classification.phase === 'terminal_failure') {
      throw new ReportGenerationTerminalError(`报告生成状态终止：${classification.state}（${text || '空状态'}）`, snapshot);
    }

    await options.onPendingSnapshot?.(snapshot);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`等待报告生成状态超时：${timeoutMs}ms`);
}
