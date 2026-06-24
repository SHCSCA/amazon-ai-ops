import type { Page } from 'playwright';

export const LINGXING_DATE_RANGE_PICKER_SELECTOR = '.el-picker-panel:visible, .el-date-range-picker:visible';

export interface LingxingDateRangeFillOptions {
  startInputSelector: string;
  endInputSelector: string;
  dateRange: { start: string; end: string };
}

type LingxingDateRangePage = Pick<Page, 'locator' | 'keyboard'> & Partial<Pick<Page, 'mouse'>>;

async function waitForDateRangePickerToClose(page: LingxingDateRangePage, timeout: number): Promise<boolean> {
  try {
    await page.locator(LINGXING_DATE_RANGE_PICKER_SELECTOR).first().waitFor({ state: 'hidden', timeout });
    return true;
  } catch {
    return false;
  }
}

export async function fillAndCommitLingxingDateRange(
  page: LingxingDateRangePage,
  options: LingxingDateRangeFillOptions,
): Promise<void> {
  await page.locator(options.startInputSelector).fill(options.dateRange.start);
  await page.locator(options.endInputSelector).fill(options.dateRange.end);

  await page.keyboard.press('Enter');
  if (await waitForDateRangePickerToClose(page, 1200)) return;

  await page.keyboard.press('Tab').catch(() => undefined);
  if (await waitForDateRangePickerToClose(page, 1200)) return;

  await page.mouse?.click(8, 8).catch(() => undefined);
  if (await waitForDateRangePickerToClose(page, 2000)) return;

  throw new Error('领星日期范围弹层未关闭，无法继续创建报告；请重新验证下载中心页面模型或手动检查日期控件。');
}
