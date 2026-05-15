import type { ElementLocator } from '@amazon-ai-ops/shared-types';

export const BUTTON = {
  CLICK: (text: string): ElementLocator => ({
    id: `btn-${text.replace(/\s+/g, '-').toLowerCase()}`,
    strategies: [
      { type: 'text', value: text, timeout: 5000 },
      { type: 'role', value: 'button', index: 0 },
    ],
    description: `Button: ${text}`,
  }),
  PRIMARY: (): ElementLocator => ({
    id: 'btn-primary',
    strategies: [
      { type: 'css', value: 'button.btn-primary', timeout: 5000 },
      { type: 'css', value: '.ant-btn-primary', timeout: 5000 },
      { type: 'role', value: 'button', index: 0 },
    ],
  }),
};

export const INPUT = {
  SEARCH: (): ElementLocator => ({
    id: 'input-search',
    strategies: [
      { type: 'css', value: 'input[placeholder*="搜索"]', timeout: 5000 },
      { type: 'css', value: 'input[type="search"]', timeout: 5000 },
      { type: 'label', value: '搜索', timeout: 5000 },
    ],
  }),
  TEXT: (placeholder = ''): ElementLocator => ({
    id: `input-text-${placeholder || 'generic'}`,
    strategies: [
      ...(placeholder ? [{ type: 'css' as const, value: `input[placeholder="${placeholder}"]`, timeout: 5000 }] : []),
      { type: 'role', value: 'textbox', index: 0 },
    ],
  }),
};

export const TABLE = {
  BODY: (): ElementLocator => ({
    id: 'table-body',
    strategies: [
      { type: 'css', value: '.ant-table-tbody', timeout: 5000 },
      { type: 'css', value: 'table tbody', timeout: 5000 },
    ],
  }),
  ROW: (index = 0): ElementLocator => ({
    id: `table-row-${index}`,
    strategies: [
      { type: 'css', value: `.ant-table-tbody tr:nth-child(${index + 1})`, timeout: 5000 },
      { type: 'xpath', value: `//table/tbody/tr[${index + 1}]`, timeout: 5000 },
    ],
  }),
  CELL: (row: number, col: number): ElementLocator => ({
    id: `table-cell-${row}-${col}`,
    strategies: [
      { type: 'css', value: `.ant-table-tbody tr:nth-child(${row}) td:nth-child(${col})`, timeout: 5000 },
    ],
  }),
};

export const SELECT = {
  DROPDOWN: (): ElementLocator => ({
    id: 'select-dropdown',
    strategies: [
      { type: 'css', value: '.ant-select-dropdown', timeout: 5000 },
      { type: 'css', value: '[class*="select-dropdown"]', timeout: 5000 },
    ],
  }),
  OPTION: (text: string): ElementLocator => ({
    id: `select-option-${text.replace(/\s+/g, '-').toLowerCase()}`,
    strategies: [
      { type: 'text', value: text, timeout: 5000 },
    ],
  }),
};

export const DATE_PICKER = {
  INPUT: (): ElementLocator => ({
    id: 'date-picker-input',
    strategies: [
      { type: 'css', value: '.ant-picker-input input', timeout: 5000 },
      { type: 'css', value: 'input.ant-picker', timeout: 5000 },
    ],
  }),
  PANEL: (): ElementLocator => ({
    id: 'date-picker-panel',
    strategies: [
      { type: 'css', value: '.ant-picker-panel', timeout: 5000 },
    ],
  }),
};
