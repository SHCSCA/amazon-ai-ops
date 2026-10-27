import {
  HASH_A,
  describe,
  expect,
  it,
  path,
  validateObjectInspectorEvidence,
} from './package-ui-test-context.mjs';

describe('read-only object inspector evidence', () => {
  function validInspectorEvidence(overrides = {}) {
    return {
      escape: { closed: true, focusRestored: true, focusedRowKey: 'row-1' },
      expectedMode: 'drawer',
      inspector: {
        ariaModal: 'true',
        description: 'B0TEST / SKU-1 · 当前仅查看',
        mode: 'drawer',
        role: 'dialog',
        title: '测试产品',
        visible: true,
      },
      operationScope: {
        after: { asin: 'B0LOCKED', batchId: 'batch-1', marketplaceCode: 'US', storeName: 'demo' },
        before: { asin: 'B0LOCKED', batchId: 'batch-1', marketplaceCode: 'US', storeName: 'demo' },
      },
      row: {
        ariaLabel: '测试产品，ASIN B0TEST；按 Enter 或空格查看详情',
        key: 'row-1',
        selectedAfterClick: true,
        title: '测试产品',
      },
      screenshot: { path: 'product-row-inspector.png', sha256: HASH_A },
      workspace: 'product',
      ...overrides,
    };
  }

  it('accepts a drawer only when selection is read-only, identity-bound, captured, dismissed and focus-restored', () => {
    const input = validInspectorEvidence();
    expect(validateObjectInspectorEvidence(input)).toEqual({
      ...input,
      identityMatched: true,
      modeMatched: true,
      operationScopeUnchanged: true,
      passed: true,
      violations: [],
    });
  });

  it('accepts a wide inline inspector only when it is non-modal', () => {
    const result = validateObjectInspectorEvidence(validInspectorEvidence({
      expectedMode: 'inline',
      inspector: {
        ariaModal: null,
        description: 'Campaign / Ad group / B0TEST',
        mode: 'inline',
        role: 'complementary',
        title: 'keyword-one',
        visible: true,
      },
      operationScope: undefined,
      row: {
        ariaLabel: '复核 keyword-one，高 ACOS，ACOS 61%',
        key: 'diagnosis-row-1',
        selectedAfterClick: true,
        title: 'keyword-one',
      },
      escape: { closed: true, focusRestored: true, focusedRowKey: 'diagnosis-row-1' },
      workspace: 'diagnosis',
    }));
    expect(result.passed).toBe(true);
    expect(result.modeMatched).toBe(true);
  });

  it.each([
    ['row/inspector identity drift', { inspector: { ...validInspectorEvidence().inspector, title: '其他产品' } }, 'OBJECT_INSPECTOR_IDENTITY_MISMATCH'],
    ['product scope mutation', { operationScope: { before: { asin: 'B0LOCKED' }, after: { asin: 'B0TEST' } } }, 'PRODUCT_VIEW_MUTATED_OPERATION_SCOPE'],
    ['modal wide inspector', { expectedMode: 'inline', inspector: { ...validInspectorEvidence().inspector, mode: 'inline', role: 'complementary', ariaModal: 'true' } }, 'OBJECT_INSPECTOR_MODALITY_MISMATCH'],
    ['lost focus after Escape', { escape: { closed: true, focusRestored: false, focusedRowKey: null } }, 'OBJECT_INSPECTOR_FOCUS_NOT_RESTORED'],
  ])('fails closed for %s', (_label, override, code) => {
    const result = validateObjectInspectorEvidence(validInspectorEvidence(override));
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});
