import { describe, expect, it } from 'vitest';
import { fillAndCommitLingxingDateRange } from './download-center-date-range';

class FakeLocator {
  constructor(
    private readonly selector: string,
    private readonly actions: string[],
    private readonly overlay: { visible: boolean },
  ) {}

  async fill(value: string): Promise<void> {
    this.actions.push(`fill:${this.selector}:${value}`);
    if (this.selector === '#end') {
      this.overlay.visible = true;
    }
  }

  first(): FakeLocator {
    return this;
  }

  async isVisible(): Promise<boolean> {
    return this.overlay.visible;
  }

  async waitFor(options: { state: 'hidden'; timeout: number }): Promise<void> {
    this.actions.push(`wait:${this.selector}:${options.state}:${options.timeout}`);
    if (this.overlay.visible) {
      throw new Error('date picker is still open');
    }
  }
}

function fakePage() {
  const actions: string[] = [];
  const overlay = { visible: false };
  return {
    actions,
    page: {
      locator(selector: string) {
        return new FakeLocator(selector, actions, overlay);
      },
      keyboard: {
        async press(key: string) {
          actions.push(`press:${key}`);
          if (key === 'Enter') {
            overlay.visible = false;
          }
        },
      },
    },
  };
}

describe('fillAndCommitLingxingDateRange', () => {
  it('submits the Element date-range picker after filling the end date', async () => {
    const { page, actions } = fakePage();

    await fillAndCommitLingxingDateRange(page as any, {
      startInputSelector: '#start',
      endInputSelector: '#end',
      dateRange: { start: '2026-05-21', end: '2026-06-23' },
    });

    expect(actions).toEqual([
      'fill:#start:2026-05-21',
      'fill:#end:2026-06-23',
      'press:Enter',
      'wait:.el-picker-panel:visible, .el-date-range-picker:visible:hidden:1200',
    ]);
  });
});
