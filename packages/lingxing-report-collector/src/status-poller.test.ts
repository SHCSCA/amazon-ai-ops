import { describe, expect, it } from 'vitest';
import {
  ReportGenerationTerminalError,
  classifyReportStatus,
  classifyReportGenerationStatus,
  isTerminalReportGenerationStatus,
  pollReportGenerationStatus,
} from './status-poller';

describe('report generation status poller', () => {
  it('classifies Lingxing-style terminal and non-terminal report statuses', () => {
    expect(classifyReportGenerationStatus('')).toBe('unknown');
    expect(classifyReportGenerationStatus('待创建')).toBe('pending');
    expect(classifyReportGenerationStatus('已创建，等待生成')).toBe('generating');
    expect(classifyReportGenerationStatus('生成中')).toBe('generating');
    expect(classifyReportGenerationStatus('生成成功，可下载')).toBe('ready');
    expect(classifyReportGenerationStatus('已过期')).toBe('expired');
    expect(classifyReportGenerationStatus('生成失败')).toBe('failed');
    expect(classifyReportGenerationStatus('下载中')).toBe('generating');
    expect(classifyReportGenerationStatus('下载失败')).toBe('failed');
    expect(classifyReportGenerationStatus('下载')).toBe('unknown');
    expect(classifyReportGenerationStatus('不可下载')).toBe('skipped');
    expect(classifyReportGenerationStatus('已取消')).toBe('skipped');
    expect(classifyReportGenerationStatus('產生中')).toBe('generating');
    expect(classifyReportGenerationStatus('失敗')).toBe('failed');
    expect(classifyReportGenerationStatus('Processing')).toBe('generating');
    expect(classifyReportGenerationStatus('Available for download')).toBe('ready');
  });

  it('returns structured status classification with failure precedence', () => {
    expect(classifyReportStatus('已过期，可下载')).toMatchObject({
      state: 'expired',
      phase: 'terminal_failure',
    });
    expect(classifyReportStatus('已创建，等待生成')).toMatchObject({
      state: 'generating',
      phase: 'pending',
    });
    expect(classifyReportStatus('下载中')).toMatchObject({
      state: 'generating',
      phase: 'pending',
    });
    expect(classifyReportStatus('下载失败')).toMatchObject({
      state: 'failed',
      phase: 'terminal_failure',
    });
  });

  it('treats ready, failed, and expired as terminal report states', () => {
    expect(isTerminalReportGenerationStatus('ready')).toBe(true);
    expect(isTerminalReportGenerationStatus('failed')).toBe(true);
    expect(isTerminalReportGenerationStatus('expired')).toBe(true);
    expect(isTerminalReportGenerationStatus('skipped')).toBe(true);
    expect(isTerminalReportGenerationStatus('generating')).toBe(false);
    expect(isTerminalReportGenerationStatus('unknown')).toBe(false);
  });

  it('polls until a report becomes ready', async () => {
    const statuses = ['生成中', '生成成功，可下载'];

    const result = await pollReportGenerationStatus(async () => statuses.shift() ?? '', {
      intervalMs: 1,
      timeoutMs: 5000,
    });

    expect(result.status).toBe('ready');
    expect(result.attempt).toBe(2);
  });

  it('fails fast when a report reaches failed or expired state', async () => {
    await expect(pollReportGenerationStatus(async () => '生成失败', {
      intervalMs: 1,
      timeoutMs: 100,
    })).rejects.toMatchObject({
      name: 'ReportGenerationTerminalError',
      snapshot: expect.objectContaining({ status: 'failed', text: '生成失败' }),
    } satisfies Partial<ReportGenerationTerminalError>);

    await expect(pollReportGenerationStatus(async () => '已过期', {
      intervalMs: 1,
      timeoutMs: 100,
    })).rejects.toMatchObject({
      name: 'ReportGenerationTerminalError',
      snapshot: expect.objectContaining({ status: 'expired', text: '已过期' }),
    } satisfies Partial<ReportGenerationTerminalError>);

    await expect(pollReportGenerationStatus(async () => '已取消', {
      intervalMs: 1,
      timeoutMs: 100,
    })).rejects.toMatchObject({
      name: 'ReportGenerationTerminalError',
      snapshot: expect.objectContaining({ status: 'skipped', text: '已取消' }),
    } satisfies Partial<ReportGenerationTerminalError>);
  });

  it('keeps non-terminal unknown and pending statuses waiting until timeout', async () => {
    await expect(pollReportGenerationStatus(async () => '识别不到的状态', {
      intervalMs: 1,
      timeoutMs: 3,
    })).rejects.toThrow('等待报告生成状态超时');

    await expect(pollReportGenerationStatus(async () => '已创建，等待生成', {
      intervalMs: 1,
      timeoutMs: 3,
    })).rejects.toThrow('等待报告生成状态超时');
  });
});
