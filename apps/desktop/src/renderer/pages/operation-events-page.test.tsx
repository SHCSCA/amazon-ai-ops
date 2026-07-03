import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  OPERATION_EVENT_PAGE_COPY,
  buildOperationEventTaskState,
  buildOperationEventDraftForScope,
  defaultOperationEventViewMode,
  filterOperationEventsForView,
  operationEventCardClassName,
  operationEventFormClassName,
  operationEventInlineSaveButtonView,
  operationEventInlineSaveLabel,
  operationEventRefreshButtonView,
  operationEventRowDeleteButtonView,
  operationEventScopeLabel,
  operationEventTimelineCardView,
} from './operation-events-page';
import type { OperationEventView, OperationScope } from '../types';

describe('operation events page product/global views', () => {
  const scope: OperationScope = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    currency: 'USD',
  };

  it('filters global view to global events only', () => {
    const rows = filterOperationEventsForView([
      event({ id: 1, asin: undefined, title: 'Prime event' }),
      event({ id: 2, asin: 'B001', title: 'Product coupon' }),
    ], 'global', scope.asin);

    expect(rows.map((item) => item.title)).toEqual(['Prime event']);
  });

  it('filters product view to selected product events plus global events', () => {
    const rows = filterOperationEventsForView([
      event({ id: 1, asin: undefined, title: 'Prime event' }),
      event({ id: 2, asin: 'B001', title: 'Product coupon' }),
      event({ id: 3, asin: 'B002', title: 'Other product coupon' }),
    ], 'product', scope.asin);

    expect(rows.map((item) => item.title)).toEqual(['Prime event', 'Product coupon']);
  });

  it('defaults to all events when no product is selected', () => {
    expect(defaultOperationEventViewMode('B001')).toBe('product');
    expect(defaultOperationEventViewMode(undefined)).toBe('all');
  });

  it('defaults new event drafts to current product scope when ASIN is selected', () => {
    expect(buildOperationEventDraftForScope(scope, 'product')).toMatchObject({
      asin: 'B001',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });
    expect(buildOperationEventDraftForScope(scope, 'global')).toMatchObject({
      asin: '',
      campaignName: '',
      adGroupName: '',
    });
  });

  it('labels event scopes for operator UI', () => {
    expect(operationEventScopeLabel(event({ asin: undefined }), 'B001')).toBe('全局');
    expect(operationEventScopeLabel(event({ asin: 'B001' }), 'B001')).toBe('产品');
    expect(operationEventScopeLabel(event({ asin: 'B001', campaignName: 'SP exact' }), 'B001')).toBe('广告对象');
  });

  it('builds a first-screen operator task for recording operation events', () => {
    const task = buildOperationEventTaskState({
      visibleEventCount: 0,
      totalEventCount: 0,
      specificEventCount: 0,
      viewMode: 'product',
      selectedAsin: 'B001',
      canSave: true,
      saving: false,
    });

    expect(task.title).toContain('当前产品');
    expect(task.detail).toContain('B001');
    expect(task.primaryActionLabel).toBe('记录事件');
    expect(task.primaryActionDisabled).toBe(false);
    expect(task.primaryActionBusy).toBe(false);
    expect(task.secondaryActionLabel).toBe('进入广告量化');
  });

  it('anchors the page copy on the operation-event timeline marking job', () => {
    expect(OPERATION_EVENT_PAGE_COPY.title).toBe('运营事件标记');
    expect(OPERATION_EVENT_PAGE_COPY.primaryTask).toBe('把关键运营动作标记进 LLM 上下文');
    expect(OPERATION_EVENT_PAGE_COPY.description).toContain('LLM 推理上下文');
    expect(OPERATION_EVENT_PAGE_COPY.timelinePanelTitle).toBe('运营事件时间轴');
    expect(OPERATION_EVENT_PAGE_COPY.newEventPanelTitle).toBe('新增运营事件标记');
  });

  it('marks the newest saved event card for transient feedback', () => {
    expect(operationEventCardClassName(42, 42)).toContain('event-card-just-saved');
    expect(operationEventCardClassName(41, 42)).toBe('event-card');
  });

  it('reads back how a timeline event enters AI context', () => {
    const view = operationEventTimelineCardView(
      event({
        id: 42,
        asin: 'B001',
        eventType: 'coupon',
        impactExpectation: 'conversion_up',
        title: 'Coupon started',
      }),
      'B001',
      42,
    );

    expect(view.className).toContain('event-card');
    expect(view.className).toContain('event-card-just-saved');
    expect(view.className).toContain('event-card-ai-context-ready');
    expect(view.ariaLabel).toBe('Coupon started，产品事件，预期转化上升，将进入 AI 上下文');
    expect(view.contextLabel).toBe('AI 上下文');
    expect(view.contextDetail).toContain('产品 B001');
    expect(view.contextDetail).toContain('预期转化上升');
  });

  it('keeps the inline save button distinct from the first-screen primary action', () => {
    expect(operationEventInlineSaveLabel(false)).toBe('保存到上下文');
    expect(operationEventInlineSaveLabel(true)).toBe('正在保存...');
  });

  it('gives the inline save button an explicit busy contract', () => {
    const saving = operationEventInlineSaveButtonView({
      saving: true,
      canSave: true,
      baseClassName: 'primary-button',
    });

    expect(saving.label).toBe('保存中...');
    expect(saving.className).toContain('button-loading');
    expect(saving.disabled).toBe(true);
    expect(saving.ariaBusy).toBe(true);
    expect(saving.showSpinner).toBe(true);

    const unavailable = operationEventInlineSaveButtonView({
      saving: false,
      canSave: false,
      baseClassName: 'primary-button',
    });

    expect(unavailable.label).toBe('保存到上下文');
    expect(unavailable.disabled).toBe(true);
    expect(unavailable.ariaBusy).toBeUndefined();
    expect(unavailable.className).not.toContain('button-loading');
    expect(unavailable.showSpinner).toBe(false);
  });

  it('gives refresh and delete actions explicit busy feedback', () => {
    const refreshing = operationEventRefreshButtonView(true);
    expect(refreshing.label).toBe('刷新中...');
    expect(refreshing.className).toContain('button-loading');
    expect(refreshing.disabled).toBe(true);
    expect(refreshing.ariaBusy).toBe(true);
    expect(refreshing.showSpinner).toBe(true);

    const idleRefresh = operationEventRefreshButtonView(false);
    expect(idleRefresh.label).toBe('刷新');
    expect(idleRefresh.className).not.toContain('button-loading');
    expect(idleRefresh.ariaBusy).toBeUndefined();

    const deleting = operationEventRowDeleteButtonView({ eventId: 42, deletingEventId: 42 });
    expect(deleting.label).toBe('删除中...');
    expect(deleting.className).toContain('button-loading');
    expect(deleting.disabled).toBe(true);
    expect(deleting.ariaBusy).toBe(true);
    expect(deleting.showSpinner).toBe(true);

    const lockedPeer = operationEventRowDeleteButtonView({ eventId: 41, deletingEventId: 42 });
    expect(lockedPeer.label).toBe('删除');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.className).not.toContain('button-loading');
  });

  it('marks the event form as cleared for a short optimistic rebound response', () => {
    expect(operationEventFormClassName(false)).toBe('operation-event-form');
    expect(operationEventFormClassName(true)).toBe('operation-event-form operation-event-form-cleared');
  });

  it('clears the draft immediately before the save IPC and restores it on failure', () => {
    const source = readFileSync(new URL('./operation-events-page.tsx', import.meta.url), 'utf8');
    const clearIndex = source.indexOf('setDraft(resetDraft);');
    const ipcIndex = source.indexOf('electronAPI.createOperationEvent');

    expect(clearIndex).toBeGreaterThan(-1);
    expect(ipcIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(ipcIndex);
    expect(source).toContain('事件已提交，表单已清空，正在写入本地上下文...');
    expect(source).toContain('setDraft(submittedDraft);');
    expect(source).toContain('保存失败，已恢复刚才填写的事件。');
  });

  it('keeps the cleared form rebound animation scoped and non-layout shifting', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.operation-event-form');
    expect(css).toContain('contain: layout style');
    expect(css).toContain('.operation-event-form-cleared');
    expect(css).toContain('@keyframes operation-event-form-rebound');
  });

  it('visually isolates timeline cards on hover and keyboard focus', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.event-card:hover');
    expect(css).toContain('.event-card:focus-visible');
    expect(css).toContain('.event-card:active');
    expect(css).toContain('.event-card-context');
    expect(css).toContain('event-card-focus-pop');
  });
});

function event(patch: Partial<OperationEventView>): OperationEventView {
  return {
    id: patch.id || 1,
    eventDate: '2026-06-01',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: 'coupon',
    title: patch.title || 'Event',
    impactExpectation: patch.impactExpectation || 'unknown',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
