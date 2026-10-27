import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  assertLingxingAdsSelectedStoreTags,
  bindPendingLingxingAdsNewPageAdoption,
  bindPendingLingxingAdsPageCloseOnlyLiveness,
  dismissLingxingAdsChangeAnnouncements,
  discoverLingxingAdsKeywordTarget,
  ensureLingxingErpAuthenticated,
  ensureLingxingAdsHeaderStore,
  findTrustedLingxingProviderReplacementPage,
  isLingxingProviderExplicitlyLoggedOutPage,
  isTrustedLingxingProviderUrl,
  navigateToLingxingAdsCampaignKeywordTarget,
  findTrustedLingxingProviderPageAfterPendingNavigation,
  resolveLingxingStableIdentityFromAdsProfile,
  resolveLingxingStableIdentityFromVerifiedContinuation,
  openLingxingAdsFromErp,
  readLingxingAdsPageStateAfterNavigation,
  readLingxingAdsProfileEvidence,
  resolveLingxingKeywordTargetRows,
  restoreAuthenticatedLingxingErpPage,
  selectOnlyLingxingAdsStore,
  selectLingxingAdsProfileEvidence,
} from './lingxing-ads-sso';

describe('selectOnlyLingxingAdsStore', () => {
  it('uses the visible only-this-store action and reads back a single exact tag', async () => {
    let tags = ['FT-CA', '+1'];
    const onlyClick = vi.fn(async () => { tags = ['JF-US']; });
    const targetRow = {
      hover: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        getByText: vi.fn(() => ({
          isVisible: vi.fn(async () => true),
          click: onlyClick,
        })),
      })),
    };
    const rows = {
      evaluateAll: vi.fn(async () => ['FT-CA', 'JF-US']),
      nth: vi.fn(() => targetRow),
    };
    const dropdown = {
      waitFor: vi.fn(async () => undefined),
      locator: vi.fn(() => rows),
    };
    const dropdowns = {
      count: vi.fn(async () => 1),
      first: vi.fn(() => dropdown),
      nth: vi.fn(() => dropdown),
    };
    const storeSelect = {
      click: vi.fn(async () => undefined),
      locator: vi.fn(() => ({ allTextContents: vi.fn(async () => tags) })),
    };
    const selects = {
      count: vi.fn(async () => 1),
      nth: vi.fn(() => storeSelect),
    };
    const page = {
      keyboard: { press: vi.fn(async () => undefined) },
      locator: vi.fn((selector: string) => (
        selector === '.el-select-dropdown:visible' ? dropdowns : selects
      )),
      waitForTimeout: vi.fn(async () => undefined),
    };

    await selectOnlyLingxingAdsStore(page as never, 'JF-US');

    expect(storeSelect.click).toHaveBeenCalledTimes(2);
    expect(targetRow.hover).toHaveBeenCalledOnce();
    expect(onlyClick).toHaveBeenCalledOnce();
    expect(tags).toEqual(['JF-US']);
  });

  it('ignores a hidden legacy selector mirror when locking an arbitrary exact store alias', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(750);
    try {
      await page.setContent(`
        <style>
          .el-select-dropdown { display: none; }
          .el-select-dropdown.open { display: block; }
          .hidden-route-mirror { display: none; }
        </style>
        <div id="visible-store-select" class="el-select is-multiple">
          <div class="el-select__tags"></div>
          <span>搜索店铺</span>
        </div>
        <div id="visible-store-dropdown" class="el-select-dropdown">
          <ul>
            <li class="el-select-dropdown__item" title="NOVA-US">
              <span>NOVA-US</span>
              <button type="button" class="select-tag">仅筛选此项</button>
            </li>
          </ul>
        </div>
        <div class="hidden-route-mirror">
          <div class="el-select is-multiple"><div class="el-select__tags"></div></div>
          <div class="el-select-dropdown">
            <ul><li class="el-select-dropdown__item" title="NOVA-US">NOVA-US</li></ul>
          </div>
        </div>
      `);
      await page.evaluate(() => {
        const select = document.querySelector<HTMLElement>('#visible-store-select')!;
        const dropdown = document.querySelector<HTMLElement>('#visible-store-dropdown')!;
        select.addEventListener('click', () => dropdown.classList.add('open'));
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') dropdown.classList.remove('open');
        });
        dropdown.querySelector<HTMLButtonElement>('.select-tag')!.addEventListener('click', (event) => {
          event.stopPropagation();
          select.querySelector<HTMLElement>('.el-select__tags')!.innerHTML =
            '<span class="el-select__tags-text">NOVA-US</span>';
          dropdown.classList.remove('open');
        });
      });

      await selectOnlyLingxingAdsStore(page, 'NOVA-US');

      expect(await page.locator('#visible-store-select .el-select__tags-text').allTextContents())
        .toEqual(['NOVA-US']);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('binds a legacy store dropdown to the control that opened it when another filter leaves it visible', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          .el-select-dropdown { display: none; }
          .el-select-dropdown.open { display: block; }
        </style>
        <div id="store-select" class="el-select is-multiple">
          <div class="el-select__tags"></div>
          <span>全部店铺</span>
        </div>
        <div id="owner-select" class="el-select is-multiple">
          <div class="el-select__tags"></div>
          <span>Listing 负责人</span>
        </div>
        <div id="store-dropdown" class="el-select-dropdown">
          <ul>
            <li class="el-select-dropdown__item" title="ORBIT-US">
              <span>ORBIT-US</span>
              <button type="button" class="select-tag">仅筛选此项</button>
            </li>
          </ul>
        </div>
        <div id="owner-dropdown" class="el-select-dropdown">
          <ul><li class="el-select-dropdown__item" title="运营甲">运营甲</li></ul>
        </div>
      `);
      await page.evaluate(() => {
        const storeSelect = document.querySelector<HTMLElement>('#store-select')!;
        const ownerSelect = document.querySelector<HTMLElement>('#owner-select')!;
        const storeDropdown = document.querySelector<HTMLElement>('#store-dropdown')!;
        const ownerDropdown = document.querySelector<HTMLElement>('#owner-dropdown')!;
        storeSelect.addEventListener('click', () => storeDropdown.classList.add('open'));
        ownerSelect.addEventListener('click', () => {
          ownerSelect.setAttribute(
            'data-open-count',
            String(Number(ownerSelect.getAttribute('data-open-count') ?? '0') + 1),
          );
          ownerDropdown.classList.add('open');
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') ownerDropdown.classList.remove('open');
        });
        storeDropdown.querySelector<HTMLButtonElement>('.select-tag')!
          .addEventListener('click', (event) => {
            event.stopPropagation();
            storeSelect.querySelector<HTMLElement>('.el-select__tags')!.innerHTML =
              '<span class="el-select__tags-text">ORBIT-US</span>';
            storeDropdown.classList.remove('open');
          });
      });

      await selectOnlyLingxingAdsStore(page, 'ORBIT-US');

      expect(await page.locator('#store-select .el-select__tags-text').allTextContents())
        .toEqual(['ORBIT-US']);
      expect(await page.locator('#owner-select').getAttribute('data-open-count')).toBe('1');
      expect(await page.locator('#owner-select .el-select__tags-text').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('selects an arbitrary exact store alias in the current Lingxing FilterSelect DOM', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          .fs-dropdown { display: none; }
          .fs-dropdown.visible { display: block; }
        </style>
        <div class="fs-wrap multiple" data-filter="report-type">
          <div class="fs-label-wrap"><div class="fs-label placeholder">报告类型</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="daily"><div class="fs-option-label"><span class="fs-option-label-detail">每日明细</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
        <div class="fs-wrap multiple" data-filter="store">
          <div class="fs-label-wrap"><div class="fs-label">FT-US 美国</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option selected" data-value="store-ft-us"><span class="fs-checkbox"><i></i></span><div class="fs-option-label oneLine"><span class="fs-option-label-detail">FT-US 美国</span></div></div>
            <div class="fs-option" data-value="store-ft-us-us"><span class="fs-checkbox"><i></i></span><div class="fs-option-label oneLine"><span class="fs-option-label-detail">FT-US-US 美国</span></div></div>
            <div class="fs-option" data-value="store-jf-us"><span class="fs-checkbox"><i></i></span><div class="fs-option-label oneLine"><span class="fs-option-label-detail">JF-US 美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.fs-wrap.multiple').forEach((root) => {
          const dropdown = root.querySelector<HTMLElement>('.fs-dropdown');
          root.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown?.classList.add('visible'));
          root.querySelectorAll('.fs-option').forEach((option) => {
            option.addEventListener('click', () => option.classList.toggle('selected'));
          });
          root.querySelector('.fs-save')?.addEventListener('click', () => {
            root.setAttribute('data-save-count', String(Number(root.getAttribute('data-save-count') ?? '0') + 1));
            const selected = [...root.querySelectorAll<HTMLElement>('.fs-option.selected')];
            const label = root.querySelector<HTMLElement>('.fs-label');
            if (label) label.textContent = selected.map((option) => option.textContent?.trim()).join('、');
            dropdown?.classList.remove('visible');
          });
        });
      });

      await selectOnlyLingxingAdsStore(page, 'FT-US-US');

      const result = await page.locator('[data-filter="store"]').evaluate((root) => ({
        label: root.querySelector('.fs-label')?.textContent?.trim(),
        saveCount: root.getAttribute('data-save-count'),
        selected: [...root.querySelectorAll<HTMLElement>('.fs-option.selected')]
          .map((option) => option.querySelector('.fs-option-label-detail')?.textContent?.trim()),
      }));
      expect(result).toEqual({
        label: 'FT-US-US 美国',
        saveCount: '1',
        selected: ['FT-US-US 美国'],
      });
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('waits for a delayed current FilterSelect before matching an arbitrary store alias', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent('<main data-loading="stores">店铺列表加载中</main>');
      await page.evaluate(() => {
        window.setTimeout(() => {
          document.body.innerHTML = `
            <style>.fs-dropdown { display: none; }.fs-dropdown.visible { display: block; }</style>
            <div class="fs-wrap multiple" data-filter="store">
              <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
              <div class="fs-dropdown"><div class="fs-options">
                <div class="fs-option" data-value="store-bravo"><div class="fs-option-label"><span class="fs-option-label-detail">BRAVO-US 美国</span></div></div>
              </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
            </div>`;
          const root = document.querySelector<HTMLElement>('.fs-wrap.multiple')!;
          const dropdown = root.querySelector<HTMLElement>('.fs-dropdown')!;
          root.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown.classList.add('visible'));
          root.querySelector('.fs-option')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLElement).classList.toggle('selected');
          });
          root.querySelector('.fs-save')?.addEventListener('click', () => {
            const label = root.querySelector<HTMLElement>('.fs-label')!;
            label.textContent = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail')?.textContent ?? '';
            dropdown.classList.remove('visible');
          });
        }, 250);
      });

      await selectOnlyLingxingAdsStore(page, 'BRAVO-US');

      expect((await page.locator('.fs-label').textContent())?.trim()).toBe('BRAVO-US 美国');
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('opens a current FilterSelect whose arbitrary store options mount only after interaction', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>.fs-dropdown { display: none; }.fs-dropdown.visible { display: block; }</style>
        <div class="fs-wrap multiple" data-filter="report-type">
          <div class="fs-label-wrap"><div class="fs-label placeholder">报告类型</div></div>
          <div class="fs-dropdown"><div class="fs-options"></div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
        <div class="fs-wrap multiple" data-filter="store">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options"></div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.fs-wrap.multiple').forEach((root) => {
          const dropdown = root.querySelector<HTMLElement>('.fs-dropdown')!;
          const options = root.querySelector<HTMLElement>('.fs-options')!;
          root.querySelector('.fs-label-wrap')?.addEventListener('click', () => {
            if (!options.childElementCount) {
              const isStore = root.getAttribute('data-filter') === 'store';
              options.innerHTML = isStore
                ? '<div class="fs-option" data-value="store-orbit"><div class="fs-option-label"><span class="fs-option-label-detail">ORBIT-US 美国</span></div></div>'
                : '<div class="fs-option" data-value="daily"><div class="fs-option-label"><span class="fs-option-label-detail">每日明细</span></div></div>';
              options.querySelector('.fs-option')?.addEventListener('click', (event) => {
                (event.currentTarget as HTMLElement).classList.toggle('selected');
              });
            }
            dropdown.classList.add('visible');
          });
          root.querySelector('.fs-save')?.addEventListener('click', () => {
            const selected = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail');
            const label = root.querySelector<HTMLElement>('.fs-label');
            if (label) label.textContent = selected?.textContent ?? '';
            dropdown.classList.remove('visible');
          });
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            document.querySelectorAll<HTMLElement>('.fs-dropdown.visible')
              .forEach((dropdown) => dropdown.classList.remove('visible'));
          }
        });
      });

      await selectOnlyLingxingAdsStore(page, 'ORBIT-US');

      expect((await page.locator('[data-filter="store"] .fs-label').textContent())?.trim())
        .toBe('ORBIT-US 美国');
      expect(await page.locator('[data-filter="store"] .fs-option.selected').count()).toBe(1);
      expect(await page.locator('[data-filter="report-type"] .fs-option.selected').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('clears a persistent non-modal success toast before opening the current store FilterSelect', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          .fs-dropdown { display: none; }
          .fs-dropdown.visible { display: block; }
          #toast-container { position: fixed; inset: 0; z-index: 99; }
          .toast-success { display: block; pointer-events: auto; }
        </style>
        <div class="fs-wrap multiple" data-filter="store">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="store-orbit"><div class="fs-option-label"><span class="fs-option-label-detail">ORBIT-US 美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
        <div id="toast-container"><div aria-live="polite" class="export-info toast-success">导出成功</div></div>
      `);
      await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.fs-wrap.multiple')!;
        const dropdown = root.querySelector<HTMLElement>('.fs-dropdown')!;
        root.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown.classList.add('visible'));
        root.querySelector('.fs-option')?.addEventListener('click', (event) => {
          (event.currentTarget as HTMLElement).classList.toggle('selected');
        });
        root.querySelector('.fs-save')?.addEventListener('click', () => {
          const selected = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail');
          root.querySelector<HTMLElement>('.fs-label')!.textContent = selected?.textContent ?? '';
          dropdown.classList.remove('visible');
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            document.querySelector<HTMLElement>('.toast-success')!.style.display = 'none';
            document.querySelector<HTMLElement>('#toast-container')!.style.pointerEvents = 'none';
          }
        });
      });

      await selectOnlyLingxingAdsStore(page, 'ORBIT-US');

      expect((await page.locator('.fs-label').textContent())?.trim()).toBe('ORBIT-US 美国');
      expect(await page.locator('.toast-success:visible').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('blocks duplicate exact aliases in the current Lingxing FilterSelect DOM', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div class="fs-wrap multiple">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="one"><div class="fs-option-label"><span class="fs-option-label-detail">NORTH-US 美国</span></div></div>
            <div class="fs-option" data-value="two"><div class="fs-option-label"><span class="fs-option-label-detail">NORTH-US 美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);

      await expect(selectOnlyLingxingAdsStore(page, 'NORTH-US'))
        .rejects.toThrow('存在重复的 NORTH-US');
      expect(await page.locator('.fs-option.selected').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('collapses production label whitespace before exact FilterSelect matching', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>.fs-dropdown { display: none; }.fs-dropdown.visible { display: block; }</style>
        <div class="fs-wrap multiple">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="alpha"><div class="fs-option-label"><span class="fs-option-label-detail">ALPHA-US  美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);
      await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.fs-wrap.multiple');
        const dropdown = root?.querySelector<HTMLElement>('.fs-dropdown');
        root?.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown?.classList.add('visible'));
        root?.querySelector('.fs-option')?.addEventListener('click', (event) => {
          (event.currentTarget as HTMLElement).classList.toggle('selected');
        });
        root?.querySelector('.fs-save')?.addEventListener('click', () => {
          const label = root.querySelector<HTMLElement>('.fs-label');
          const optionLabel = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail');
          if (label) label.textContent = optionLabel?.textContent ?? '';
          dropdown?.classList.remove('visible');
        });
      });

      await selectOnlyLingxingAdsStore(page, 'ALPHA-US');

      expect(await page.locator('.fs-option.selected').count()).toBe(1);
      expect((await page.locator('.fs-label').textContent())?.replace(/\s+/g, ' ').trim())
        .toBe('ALPHA-US 美国');
    } finally {
      await page.close();
      await browser.close();
    }
  });
});
