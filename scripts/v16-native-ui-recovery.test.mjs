import { afterEach, describe, expect, it } from 'vitest';
import recovery from './v16-native-ui-recovery.js';
import { nativeFixture, pngBytes } from './v16-native-test-fixture.mjs';
const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()));
function fixture() {
  const f = nativeFixture(); fixtures.push(f);
  const scope = { storeId: 'fixture-shop', sessionGeneration: 1 }, runId = 'fixture-run', correlationId = 'fixture-recovery';
  const events = recovery.RECOVERY_EVENTS.map((event, i) => ({ event, observedAt: new Date(Date.parse(f.execution.startedAt) + i * 100).toISOString(), correlationId, storeContext: scope,
    ...(event === 'ipc.failed' ? { channel: 'settings:save-rule-config' } : {}), ...(event === 'ui.retry-invoked' ? { accessibleName: '重试保存' } : {}) }));
  const telemetry = { kind: 'v16-ui-recovery-telemetry', runId, storeContext: scope, events };
  const failed = { kind: 'v16-ui-recovery-snapshot', observedAt: events[2].observedAt, storeContext: scope, state: 'error', errorText: '规则配置无效，请修改后重试。', retry: { enabled: true, name: '重试保存' }, screenshot: f.write('failure.png', pngBytes()) };
  const recovered = { kind: failed.kind, observedAt: events[5].observedAt, storeContext: scope, state: 'ready', errorText: null, busy: false, confirmation: { role: 'status', text: '规则已保存' }, screenshot: f.write('recovered.png', pngBytes(10)) };
  const raw = { kind: 'v16-ui-recovery', schemaVersion: 1, runId, correlationId, packageIdentity: f.current.packageIdentity, storeContext: scope,
    telemetry: f.json('telemetry.json', telemetry), errorSnapshot: f.json('error.json', failed), recoveredSnapshot: f.json('recovered.json', recovered),
    runtimeLog: f.write('failure.jsonl', JSON.stringify({ timestamp: events[1].observedAt, level: 'error', event: 'ipc.handler_failed', context: { channel: events[1].channel } })),
  };
  const refresh = () => { raw.telemetry = f.json('telemetry.json', telemetry); raw.errorSnapshot = f.json('error.json', failed); raw.recoveredSnapshot = f.json('recovered.json', recovered); };
  return { ...f, raw, telemetry, failed, recovered, refresh, verify: () => recovery.verifyUiRecovery(raw, { runId }, { root: f.root, current: f.current, execution: f.execution }) };
}
describe('真实应用中文失败恢复协议', () => {
  it('核对IPC异常日志、中文可见错误、重试、独立截图和恢复状态', () => { expect(fixture().verify()).toBe(true); });
  it.each([
    ['缺少中文错误', f => { f.failed.errorText = 'unhandled exception'; }, 'CHINESE_ERROR'],
    ['重试控件不可用', f => { f.failed.retry.enabled = false; }, 'VISIBLE_RETRY'],
    ['上下文切换', f => { f.telemetry.events[3].storeContext = { storeId: 'other-store', sessionGeneration: 2 }; }, 'CONTEXT_CHANGED'],
    ['恢复仍在运行', f => { f.recovered.busy = true; }, 'READY_CONFIRMATION'],
    ['重复使用失败截图', f => { f.recovered.screenshot = f.failed.screenshot; }, 'SCREENSHOTS_NOT_INDEPENDENT'],
    ['删除实际重试步骤', f => { f.telemetry.events.splice(3, 1); }, 'EVENT_SEQUENCE'],
  ])('拒绝%s', (_label, mutate, reason) => { const f = fixture(); mutate(f); f.refresh(); expect(() => f.verify()).toThrow(new RegExp(reason)); });
});
