import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_FOCUSABLE_SELECTOR,
  trapOverlayTab,
  type OverlayFocusTarget,
} from '../components/workspace/overlay-focus-scope';

const viewSource = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../components/workspace/responsive-inspector.tsx', import.meta.url), 'utf8');
const focusStyles = readFileSync(new URL('../styles/foundations.css', import.meta.url), 'utf8');

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('readback-accessibility.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elements(source: string, predicate: (node: ts.JsxElement) => boolean): ts.JsxElement[] {
  const found: ts.JsxElement[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) && predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parse(source));
  return found;
}

function attribute(node: ts.JsxElement, name: string): ts.JsxAttribute | undefined {
  return node.openingElement.attributes.properties.find((item): item is ts.JsxAttribute => (
    ts.isJsxAttribute(item) && item.name.getText() === name
  ));
}

function textAttribute(node: ts.JsxElement, name: string): string | undefined {
  const value = attribute(node, name)?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}

function safetyList(source = viewSource): ts.JsxElement {
  const found = elements(source, (node) => (
    node.openingElement.tagName.getText() === 'ul'
    && textAttribute(node, 'className') === 'readback-safety-gates'
  ));
  if (found.length !== 1) throw new Error('READBACK_SAFETY_LIST_NOT_UNIQUE');
  return found[0];
}

function zeroTabIndex(node: ts.JsxElement): boolean {
  const value = attribute(node, 'tabIndex')?.initializer;
  return Boolean(value && ts.isJsxExpression(value) && value.expression
    && ts.isNumericLiteral(value.expression) && value.expression.text === '0');
}

function hasAncestor(node: ts.Node, tag: string): boolean {
  let parent = node.parent;
  while (parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === tag) return true;
    parent = parent.parent;
  }
  return false;
}

function originalListSource(): string {
  const list = safetyList();
  const tabIndex = attribute(list, 'tabIndex');
  if (!tabIndex) return viewSource;
  return viewSource.slice(0, tabIndex.getFullStart()) + viewSource.slice(tabIndex.getEnd());
}

function diagnosticFocusModel(source = viewSource) {
  const list = safetyList(source);
  const closeNodes = elements(inspectorSource, (node) => (
    node.openingElement.tagName.getText() === 'button'
    && textAttribute(node, 'className') === 'responsive-inspector__close'
  ));
  if (closeNodes.length !== 1) throw new Error('INSPECTOR_CLOSE_NOT_UNIQUE');
  const close = { name: textAttribute(closeNodes[0], 'aria-label'), focus: vi.fn() };
  const rules = { name: textAttribute(list, 'aria-label'), focus: vi.fn() };
  const focusable: OverlayFocusTarget[] = [close];
  if (zeroTabIndex(list)) focusable.push(rules);
  const surface = {
    focus: vi.fn(),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector !== OVERLAY_FOCUSABLE_SELECTOR) throw new Error('FOCUS_SELECTOR_MISMATCH');
      return focusable;
    }),
  };
  return { surface, close, rules, focusable };
}

function tab(shiftKey: boolean) {
  return { key: 'Tab', shiftKey, preventDefault: vi.fn() };
}

describe('回读技术检查器键盘说明入口（空证据纯模型）', () => {
  it('从实际 TSX 读取唯一安全说明列表，保留名称并允许键盘聚焦', () => {
    const list = safetyList();
    expect(textAttribute(list, 'aria-label')).toBe('最终校验安全门');
    expect(zeroTabIndex(list)).toBe(true);
  });

  it('说明列表继续位于实际检查器和页面框架内', () => {
    const list = safetyList();
    expect(hasAncestor(list, 'ResponsiveInspector')).toBe(true);
    expect(hasAncestor(list, 'PageFrame')).toBe(true);
  });

  it('保留三条安全规则，不给说明列表添加业务事件', () => {
    const list = safetyList();
    const lines = list.children.filter(ts.isJsxElement).map((item) => (
      item.children.filter(ts.isJsxText).map((part) => part.text.trim()).join('')
    ));
    expect(lines).toEqual([
      '仅 Main 可从 approved recommendation、revision、scope 与 batch 派生权威身份。',
      '审批、执行前、执行后与回读截图必须独立，时间顺序必须可追溯。',
      '只有 verifier 返回 ready=true 且 status=PASS 才广播回读已验证。',
    ]);
    expect(list.openingElement.attributes.properties.map((item) => (
      ts.isJsxAttribute(item) ? item.name.getText() : 'spread'
    )).sort()).toEqual(['aria-label', 'className', 'tabIndex']);
  });

  it('复用统一页面框架的可见焦点样式', () => {
    expect(focusStyles).toMatch(/\.workspace-page-frame \[tabindex\]:focus-visible\s*\{\s*outline:\s*2px solid var\(--workspace-focus\);\s*outline-offset:\s*2px;/);
    expect(OVERLAY_FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it('移除唯一新增属性后，原空证据模型确实只剩关闭入口', () => {
    const model = diagnosticFocusModel(originalListSource());
    expect(zeroTabIndex(safetyList(originalListSource()))).toBe(false);
    expect(model.focusable).toEqual([model.close]);
    expect(trapOverlayTab(tab(false), model.surface, model.surface)).toBe(true);
    expect(trapOverlayTab(tab(true), model.surface, model.close)).toBe(true);
    expect(model.close.focus).toHaveBeenCalledTimes(2);
    expect(model.rules.focus).not.toHaveBeenCalled();
  });

  it('按实际属性生成两个焦点，说明入口名称可读', () => {
    const model = diagnosticFocusModel();
    expect(model.close.name).toBe('关闭详情检查器');
    expect(model.rules.name).toBe('最终校验安全门');
    expect(model.focusable).toEqual([model.close, model.rules]);
  });

  it('容器首次 Tab 进入关闭按钮，反向 Tab 能离开关闭按钮进入说明', () => {
    const model = diagnosticFocusModel();
    const forward = tab(false);
    const backward = tab(true);
    expect(trapOverlayTab(forward, model.surface, model.surface)).toBe(true);
    expect(model.close.focus).toHaveBeenCalledTimes(1);
    expect(trapOverlayTab(backward, model.surface, model.close)).toBe(true);
    expect(model.rules.focus).toHaveBeenCalledTimes(1);
    expect(model.close.focus).toHaveBeenCalledTimes(1);
    expect(forward.preventDefault).toHaveBeenCalledTimes(1);
    expect(backward.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('说明入口正向 Tab 使用真实焦点约束回到关闭按钮', () => {
    const model = diagnosticFocusModel();
    const event = tab(false);
    expect(trapOverlayTab(event, model.surface, model.rules)).toBe(true);
    expect(model.close.focus).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('两个入口之间的非回绕方向继续交给浏览器原生 Tab', () => {
    const model = diagnosticFocusModel();
    const fromClose = tab(false);
    const fromRules = tab(true);
    expect(trapOverlayTab(fromClose, model.surface, model.close)).toBe(false);
    expect(trapOverlayTab(fromRules, model.surface, model.rules)).toBe(false);
    expect(fromClose.preventDefault).not.toHaveBeenCalled();
    expect(fromRules.preventDefault).not.toHaveBeenCalled();
  });

  it('隐藏或断开的说明入口仍会被现有焦点可见性检查排除', () => {
    const model = diagnosticFocusModel();
    Object.assign(model.rules, { isConnected: false });
    expect(trapOverlayTab(tab(true), model.surface, model.close)).toBe(true);
    expect(model.close.focus).toHaveBeenCalledTimes(1);
    expect(model.rules.focus).not.toHaveBeenCalled();
  });
});
