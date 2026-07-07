import { describe, expect, it } from 'vitest';
import {
  containsTechnicalTerm,
  deliveryStatusCopy,
  operatorStatusLabel,
  primaryActionForDataState,
} from './operator-ux';
import type { DataStateInput } from './operator-ux';

describe('operator UX copy helpers', () => {
  it('detects technical terms that should not appear in the main operator UI', () => {
    expect(containsTechnicalTerm('APP_READY manifest gate')).toBe(true);
  });

  it.each([
    'APP_NEEDS_WORK',
    'READY',
    'manifest',
    'gate',
    'readback',
    'json',
    'sha-256',
  ])('detects the technical term "%s"', (term) => {
    expect(containsTechnicalTerm(term)).toBe(true);
  });

  it.each([
    'NEEDS_WORK',
    'REPORT_COLLECTION_NEEDS_WORK',
    'APP_SOMETHING_READY',
    'APP_DATA_IMPORT_NEEDS_WORK',
    'APP_INTERNAL_STATUS',
    'REPORT_COLLECTION_READY',
    'DELIVERY_READY',
    'APP_V15_READY',
    'V15_NEEDS_WORK',
    'REPORT_2026_READY',
  ])('detects leaked status code "%s"', (term) => {
    expect(containsTechnicalTerm(term)).toBe(true);
  });

  it('keeps ordinary Chinese operator copy readable', () => {
    expect(containsTechnicalTerm('最终验收已通过，可以导出交付包')).toBe(false);
  });

  it('summarizes delivery readiness with short operator-facing copy', () => {
    expect(deliveryStatusCopy({ appReady: true, manifestDriven: true })).toEqual({
      label: '可以交付',
      tone: 'ready',
      detail: '最终验收和安装包证据已通过。保留交付包、安装包路径和校验码。',
    });
  });

  it('blocks delivery copy when final readiness is incomplete', () => {
    expect(deliveryStatusCopy({ appReady: false, manifestDriven: false })).toEqual({
      label: '还不能交付',
      tone: 'blocked',
      detail: '还有验收项未通过。先补齐下方最关键缺口，再刷新最终验收。',
    });
  });

  it('uses blocked delivery copy before readiness data is loaded', () => {
    expect(deliveryStatusCopy(null)).toEqual({
      label: '还不能交付',
      tone: 'blocked',
      detail: '还有验收项未通过。先补齐下方最关键缺口，再刷新最终验收。',
    });

    expect(deliveryStatusCopy(undefined)).toEqual({
      label: '还不能交付',
      tone: 'blocked',
      detail: '还有验收项未通过。先补齐下方最关键缺口，再刷新最终验收。',
    });

    expect(deliveryStatusCopy({ appReady: true })).toEqual({
      label: '还不能交付',
      tone: 'blocked',
      detail: '还有验收项未通过。先补齐下方最关键缺口，再刷新最终验收。',
    });
  });

  it('routes missing report data to real report collection', () => {
    const input: DataStateInput = {
      realReportCount: 0,
      importedRows: 0,
      actionableRows: 0,
    };

    expect(primaryActionForDataState(input)).toMatchObject({
      label: '获取真实报表',
      route: 'data-collection',
    });
  });

  it('routes downloaded reports without rows to metric import', () => {
    expect(primaryActionForDataState({
      realReportCount: 8,
      importedRows: 0,
      actionableRows: 0,
    })).toMatchObject({
      label: '导入广告指标',
      route: 'data-import-validation',
    });
  });

  it('routes actionable imported rows to ad quant review', () => {
    expect(primaryActionForDataState({
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
    })).toMatchObject({
      label: '查看广告表现',
      route: 'ad-quant',
    });
  });

  it('routes imported rows without actionable rows to conservative data review', () => {
    expect(primaryActionForDataState({
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 0,
    })).toMatchObject({
      label: '复核数据缺口',
      route: 'data-import-validation',
    });
  });

  it('treats NaN report counts as missing reports before imported or actionable rows', () => {
    expect(primaryActionForDataState({
      realReportCount: Number.NaN,
      importedRows: 96,
      actionableRows: 12,
    })).toMatchObject({
      label: '获取真实报表',
      route: 'data-collection',
    });
  });

  it('normalizes negative and infinite data counts instead of advancing to ad quant', () => {
    expect(primaryActionForDataState({
      realReportCount: 8,
      importedRows: Number.POSITIVE_INFINITY,
      actionableRows: -1,
    })).toMatchObject({
      label: '导入广告指标',
      route: 'data-import-validation',
    });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
  ])('routes abnormal actionableRows value %s to conservative data review', (actionableRows) => {
    expect(primaryActionForDataState({
      realReportCount: 8,
      importedRows: 96,
      actionableRows,
    })).toMatchObject({
      label: '复核数据缺口',
      route: 'data-import-validation',
    });
  });

  it('maps status tones to compact operator labels', () => {
    expect(operatorStatusLabel('blocked')).toBe('需处理');
    expect(operatorStatusLabel('warning')).toBe('需复核');
    expect(operatorStatusLabel('ready')).toBe('已完成');
    expect(operatorStatusLabel('pending')).toBe('待开始');
  });
});
