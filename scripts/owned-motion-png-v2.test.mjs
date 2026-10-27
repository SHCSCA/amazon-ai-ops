import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { buildOwnedMotionV2Model } from './owned-motion-geometry-v2.test-support.mjs';
import { pngBytes } from './v16-native-test-fixture.mjs';

const require = createRequire(import.meta.url);
const { inspectNativeOwnedMotionPngEvidenceBytes: inspectV2, inspectPngEvidenceBytes } = require('./canary-png-evidence.js');

describe('motion v2专用PNG的完整性与固定尺寸合同', () => {
  it.each([1, 1.25])('隔离DSF=%s两种模型均按独立contentDIP与可信DSF精确验图', deviceScaleFactor => {
    for (const kind of ['125-percent', 'minimum-window']) {
      const { witness, expected } = buildOwnedMotionV2Model({ deviceScaleFactor, kind });
      const { width, height } = witness.nativeSize;
      expect(inspectV2(pngBytes(1, width, height), witness, expected)).toMatchObject({ width, height });
    }
  });
  it('专用1x minimum成功不改变通用1200x700门，也不开放自由最小尺寸', () => {
    const { witness, expected } = buildOwnedMotionV2Model({ deviceScaleFactor: 1 });
    const bytes = pngBytes(1, witness.nativeSize.width, witness.nativeSize.height);
    expect(inspectV2(bytes, witness, expected)).toMatchObject({ width: 1184, height: 633 });
    expect(() => inspectPngEvidenceBytes(bytes)).toThrow(/1200x700/);
    expect(() => inspectPngEvidenceBytes(bytes, { minWidth: 1, minHeight: 1 })).toThrow(/1200x700/);
    expect(() => inspectV2(bytes, witness, { ...expected, minWidth: 1, minHeight: 1 })).toThrow(/owned motion geometry/);
  });
  it.each(['width', 'height'])('PNG逐轴%s少1像素仍拒绝', axis => {
    const { witness, expected } = buildOwnedMotionV2Model(), size = { ...witness.nativeSize };
    size[axis] -= 1;
    expect(() => inspectV2(pngBytes(1, size.width, size.height), witness, expected)).toThrow(/dimensions/);
  });
  it('新入口继续检查CRC，不接受完整外观的坏图', () => {
    const { witness, expected } = buildOwnedMotionV2Model(), bytes = pngBytes(1, witness.nativeSize.width, witness.nativeSize.height);
    bytes[bytes.length - 1] ^= 1;
    expect(() => inspectV2(bytes, witness, expected)).toThrow(/CRC/);
  });
  it('旧v1见证不能直接进入正式v2入口', () => {
    const { witness, expected } = buildOwnedMotionV2Model(), bytes = pngBytes(1, witness.nativeSize.width, witness.nativeSize.height);
    witness.schemaVersion = 'v16.owned-motion-geometry/1';
    expect(() => inspectV2(bytes, witness, expected)).toThrow(/owned motion geometry/);
  });
});

it.each(['125-percent', 'minimum-window'])('125%%的%s截图不能把原生交集以外像素授为可见', kind => {
  const { witness, expected } = buildOwnedMotionV2Model({ deviceScaleFactor: 1.25, kind });
  const result = inspectV2(pngBytes(1, witness.nativeSize.width, witness.nativeSize.height), witness, expected);
  const raw = witness.nativeBefore.native.native, client = raw.primaryBefore.clientRectScreenPhysicalPx;
  const widget = raw.children.find(row => row.hwnd === raw.childInventoryVerdict.selectedWidgetHwnd)
    .beforeQueries.windowRect.outRectScreenPhysicalPx;
  expect(result.visibleViewport).toEqual({ width: Math.min(client.right, widget.right) - Math.max(client.left, widget.left),
    height: Math.min(client.bottom, widget.bottom) - Math.max(client.top, widget.top) });
  expect(result.visibleViewport.width).toBeLessThan(result.width);
  expect(result.visibleViewport.height).toBeLessThan(result.height);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.visibleViewport)).toBe(true);
});
