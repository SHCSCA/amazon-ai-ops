import { describe, expect, it } from 'vitest';
import type { DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { evaluateDownloadCenterPageModel, getDownloadCenterAutomationReadiness } from './page-model-diagnostic';

const model: DownloadCenterPageModel = {
  name: 'lingxing-download-center',
  description: 'download center',
  candidateUrls: ['https://erp.lingxing.com/download-center'],
  entryHints: ['下载中心', '广告报告'],
  reportNames: ['广告活动报告', '用户搜索词报告'],
  verifySelectors: [
    { name: 'table', selector: '.ant-table-tbody', required: true },
    { name: 'date-picker', selector: '.ant-picker' },
  ],
  requiresManualVerification: true,
};

describe('evaluateDownloadCenterPageModel', () => {
  it('reports matched hints, report names, and required selector readiness', () => {
    const result = evaluateDownloadCenterPageModel(model, {
      url: 'https://erp.lingxing.com/download-center',
      title: '下载中心',
      bodyText: '下载中心 广告活动报告 用户搜索词报告',
      selectorMatches: {
        '.ant-table-tbody': true,
        '.ant-picker': false,
      },
    });

    expect(result.ready).toBe(true);
    expect(result.matchedEntryHints).toEqual(['下载中心']);
    expect(result.matchedReportNames).toEqual(['广告活动报告', '用户搜索词报告']);
    expect(result.missingRequiredSelectors).toEqual([]);
    expect(result.selectorChecks.find((item) => item.name === 'date-picker')?.found).toBe(false);
  });

  it('keeps automation disabled while manual verification is required', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      actionSelectors: {
        dateStartInput: 'input[placeholder="开始日期"]',
        dateEndInput: 'input[placeholder="结束日期"]',
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}")',
        statusTextSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}") .status',
        downloadButton: 'tr:has-text("{reportName}"):has-text("{dateRange}") button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain('requires manual verification');
  });

  it('requires executable action selectors after manual verification', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      requiresManualVerification: false,
      actionSelectors: {
        dateStartInput: 'input[placeholder="开始日期"]',
        dateEndInput: 'input[placeholder="结束日期"]',
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}")',
        downloadButton: 'tr:has-text("{reportName}"):has-text("{dateRange}") button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
  });

  it('validates optional status text selector scope when present', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      requiresManualVerification: false,
      actionSelectors: {
        dateStartInput: 'input[placeholder="开始日期"]',
        dateEndInput: 'input[placeholder="结束日期"]',
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}")',
        statusTextSelector: 'tr:has-text("{reportName}") .status',
        downloadButton: 'tr:has-text("{reportName}"):has-text("{dateRange}") button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(['statusTextSelector:dateScope']);
  });

  it('requires date selectors before enabling automation', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      requiresManualVerification: false,
      actionSelectors: {
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}")',
        downloadButton: 'tr:has-text("{reportName}") button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      'dateStartInput',
      'dateEndInput',
      'readyReportSelector:dateScope',
      'downloadButton:dateScope',
    ]);
  });

  it('requires report and date scoped ready and download selectors', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      requiresManualVerification: false,
      actionSelectors: {
        dateStartInput: 'input[placeholder="开始日期"]',
        dateEndInput: 'input[placeholder="结束日期"]',
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}")',
        downloadButton: 'button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      'readyReportSelector:dateScope',
      'downloadButton:reportScope',
      'downloadButton:dateScope',
    ]);
  });

  it('reports only missing date inputs when scoped selectors are otherwise safe', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      requiresManualVerification: false,
      actionSelectors: {
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}")',
        downloadButton: 'tr:has-text("{reportName}"):has-text("{dateRange}") button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(['dateStartInput', 'dateEndInput']);
  });

  it('reports only missing date scope when report scope exists', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      requiresManualVerification: false,
      actionSelectors: {
        dateStartInput: 'input[placeholder="开始日期"]',
        dateEndInput: 'input[placeholder="结束日期"]',
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}")',
        downloadButton: 'tr:has-text("{reportName}") button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(['readyReportSelector:dateScope', 'downloadButton:dateScope']);
  });

  it('reports download report scope independently from date scope', () => {
    const readiness = getDownloadCenterAutomationReadiness({
      ...model,
      requiresManualVerification: false,
      actionSelectors: {
        dateStartInput: 'input[placeholder="开始日期"]',
        dateEndInput: 'input[placeholder="结束日期"]',
        createReportButton: 'button:has-text("创建")',
        readyReportSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}")',
        downloadButton: 'tr:has-text("{dateRange}") button:has-text("下载")',
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(['downloadButton:reportScope']);
  });
});
