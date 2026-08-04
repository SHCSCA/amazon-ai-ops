import { describe, expect, it } from 'vitest';
import type { OperationEvent } from '@amazon-ai-ops/shared-types';
import { assertRendererPayloadIsPathFree } from './main-artifact-registry';
import { projectBusinessOperationEventForRenderer } from './business-operation-event-projection';

describe('projectBusinessOperationEventForRenderer', () => {
  it('keeps business context while removing a legacy absolute evidence path', () => {
    const projected = projectBusinessOperationEventForRenderer({
      id: 18,
      eventDate: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      eventType: 'coupon',
      title: '10% Coupon',
      notes: 'Prime Day window',
      evidencePath: 'D:\\private\\store-a\\coupon.png',
      createdAt: '2026-07-22T01:00:00.000Z',
      updatedAt: '2026-07-22T01:00:00.000Z',
    } as OperationEvent);

    expect(projected).toMatchObject({
      id: 18,
      storeName: 'SHC001-US',
      asin: 'B0GTTJFQTM',
      title: '10% Coupon',
    });
    expect(projected).not.toHaveProperty('evidencePath');
    expect(JSON.stringify(projected)).not.toContain('D:\\private');
  });

  it('redacts a drive-absolute path from business text while preserving the surrounding context', () => {
    const projected = projectBusinessOperationEventForRenderer({
      id: 19,
      eventDate: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      eventType: 'manual_note',
      title: '请复核 C:\\Users\\operator\\Desktop\\coupon.png 后继续跟踪',
      createdAt: '2026-07-22T01:00:00.000Z',
      updatedAt: '2026-07-22T01:00:00.000Z',
    } as OperationEvent);

    expect(projected.title).toBe('请复核 [本地文件] 后继续跟踪');
    expect(JSON.stringify(projected)).not.toContain('C:\\Users\\operator');
    expect(() => assertRendererPayloadIsPathFree(projected)).not.toThrow();
  });

  it('redacts a UNC path from notes without removing the business conclusion', () => {
    const projected = projectBusinessOperationEventForRenderer({
      id: 20,
      eventDate: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      eventType: 'manual_note',
      title: '共享证据复核',
      notes: '共享文件 \\\\fileserver\\ads\\proof.xlsx，指标已核对。',
      createdAt: '2026-07-22T01:00:00.000Z',
      updatedAt: '2026-07-22T01:00:00.000Z',
    } as OperationEvent);

    expect(projected.notes).toBe('共享文件 [本地文件]，指标已核对。');
    expect(JSON.stringify(projected)).not.toContain('fileserver');
    expect(() => assertRendererPayloadIsPathFree(projected)).not.toThrow();
  });

  it('redacts file URLs in legacy detail fields without altering normal web links', () => {
    const projected = projectBusinessOperationEventForRenderer({
      id: 21,
      eventDate: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      eventType: 'manual_note',
      title: '文件回读',
      notes: '操作说明仍见 https://sellercentral.amazon.com/help',
      details: '导出位置 file:///C:/Users/operator/Exports/result.csv；已完成人工核对。',
      createdAt: '2026-07-22T01:00:00.000Z',
      updatedAt: '2026-07-22T01:00:00.000Z',
    } as OperationEvent & { details: string });

    expect((projected as unknown as { details: string }).details)
      .toBe('导出位置 [本地文件]；已完成人工核对。');
    expect(projected.notes).toContain('https://sellercentral.amazon.com/help');
    expect(JSON.stringify(projected)).not.toContain('file:///');
    expect(JSON.stringify(projected)).not.toContain('/Users/operator/Exports');
  });

  it('redacts a quoted local path containing spaces and preserves text after the quote', () => {
    const projected = projectBusinessOperationEventForRenderer({
      id: 22,
      eventDate: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      eventType: 'manual_note',
      title: '已核对 "C:\\Users\\operator\\My Documents\\coupon proof.png"，保留原结论。',
      createdAt: '2026-07-22T01:00:00.000Z',
      updatedAt: '2026-07-22T01:00:00.000Z',
    } as OperationEvent);

    expect(projected.title).toBe('已核对 "[本地文件]"，保留原结论。');
    expect(JSON.stringify(projected)).not.toMatch(/operator|Documents|coupon proof/i);
    expect(() => assertRendererPayloadIsPathFree(projected)).not.toThrow();
  });
});
