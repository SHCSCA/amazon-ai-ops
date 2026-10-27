import React, { useEffect, useRef, useState } from 'react';
import { missionControlContextKey } from '@amazon-ai-ops/shared-types';
import type { StoreCollectionAutomationProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { WorkspaceActionButton, createWorkspaceActionAdmission } from '../../components/workspace/action-feedback';
import { rendererRuntimeLog } from '../../runtime-log';
import { toUserFacingError } from '../../user-facing-error';
import { WorkbenchPanel } from '../../components/workspace';
import { assertStoreCollectionAutomationProjection, readStoreCollectionAutomationApi, type StoreCollectionAutomationRendererApi } from './store-collection-automation-model';

type View = { key: string; epoch: number; projection: StoreCollectionAutomationProjection | null; loading: boolean; pending: boolean; error: string | null; notice: string | null };

export function StoreCollectionAutomationControl({ storeContext, api: explicitApi }: {
  storeContext: StoreContextEnvelope;
  api?: StoreCollectionAutomationRendererApi | null;
}) {
  const api = explicitApi === undefined ? readStoreCollectionAutomationApi(window) : explicitApi;
  const key = missionControlContextKey(storeContext);
  const binding = useRef({ key, api, epoch: 0 });
  const sequence = useRef(0);
  const admission = useRef(createWorkspaceActionAdmission());
  if (binding.current.key !== key || binding.current.api !== api) binding.current = { key, api, epoch: binding.current.epoch + 1 };
  admission.current.update(`${key}|${binding.current.epoch}`);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<View>({ key, epoch: -1, projection: null, loading: true, pending: false, error: null, notice: null });
  const visible = state.key === key && state.epoch === binding.current.epoch;
  const projection = visible ? state.projection : null;
  const loading = !visible || state.loading;
  const pending = visible && state.pending;
  useEffect(() => () => { binding.current.epoch += 1; }, []);

  useEffect(() => {
    const ticket = ++sequence.current, epoch = binding.current.epoch;
    const context = { ...storeContext };
    const current = () => ticket === sequence.current && epoch === binding.current.epoch;
    setState({ key, epoch, projection: null, loading: true, pending: false, error: null, notice: null });
    void Promise.resolve().then(() => {
      if (!api) throw new Error('当前自动采集配置服务尚未接入，请重新打开应用。');
      return api.getStoreCollectionAutomation(context);
    }).then(next => {
      if (!current()) return;
      assertStoreCollectionAutomationProjection(next, context);
      setState(value => ({ ...value, projection: next }));
    }).catch(error => {
      rendererRuntimeLog.error('renderer.store_collection_automation_load_failed', { error });
      if (current()) setState(value => ({ ...value, error: toUserFacingError(error, '自动采集状态读取失败，请重试。') }));
    }).finally(() => { if (current()) setState(value => ({ ...value, loading: false })); });
    return () => { sequence.current += 1; };
  }, [api, key, reload]);

  const toggle = async () => {
    if (!api || !projection || loading || pending) return;
    const release = admission.current.tryEnter();
    if (!release) return;
    const epoch = binding.current.epoch, context = { ...storeContext };
    const target = !projection.automaticCollectionEnabled;
    const current = () => epoch === binding.current.epoch;
    setState(value => ({ ...value, pending: true, error: null, notice: null }));
    try {
      const next = await api.setStoreCollectionAutomation(context, { expectedRevision: projection.revision, automaticCollectionEnabled: target });
      if (!current()) return;
      assertStoreCollectionAutomationProjection(next, context);
      if (next.source !== 'explicit-override' || next.automaticCollectionEnabled !== target || next.revision <= projection.revision) {
        throw new Error('自动采集开关尚未得到本机确认，请重新读取。');
      }
      setState(value => ({ ...value, projection: next, notice: target ? '当前店铺自动采集已启用。' : '当前店铺自动采集已关闭。' }));
    } catch (error) {
      rendererRuntimeLog.error('renderer.store_collection_automation_set_failed', { error });
      if (current()) setState(value => ({ ...value, projection: null, error: toUserFacingError(error, '自动采集结果尚未确认，请重新读取后重试。') }));
    } finally {
      release();
      if (current()) setState(value => ({ ...value, pending: false }));
    }
  };

  const disabledReason = !api ? '自动采集配置服务尚未接入。' : loading ? '正在读取当前店铺自动采集状态。'
    : pending ? '正在保存当前店铺自动采集设置。' : '请先重新读取并确认当前店铺自动采集状态。';
  const status = projection ? (projection.automaticCollectionEnabled ? '自动采集已启用' : '自动采集已关闭')
    : loading ? '正在读取自动采集状态' : '尚未确认自动采集状态';
  return <WorkbenchPanel title="当前店铺自动采集" description="仅控制当前店铺后续自动采集；已开始的任务按原流程处理，手动采集仍按原权限检查执行。"
    status={<span role="status" aria-live="polite">{status}</span>}>
    <div className="mission-control-config-actions" data-capability-id="settings.ai-and-local.view">
      <WorkspaceActionButton className="workspace-button workspace-button--primary" data-capability-id="settings.store-config.update"
        aria-label="当前店铺自动采集" aria-pressed={projection ? projection.automaticCollectionEnabled : undefined}
        busy={pending} busyLabel="保存中…" disabled={!projection || loading || pending || !api} disabledReason={disabledReason} onClick={() => { void toggle(); }}>
        {projection ? (projection.automaticCollectionEnabled ? '关闭自动采集' : '启用自动采集') : '等待确认自动采集状态'}
      </WorkspaceActionButton>
      <WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={loading || pending || !api}
        disabledReason={disabledReason} busy={loading} busyLabel="读取中…" onClick={() => setReload(value => value + 1)}>重新读取自动采集状态</WorkspaceActionButton>
    </div>
    {projection?.source === 'legacy-default' && <p>当前沿用历史启用设置，尚未保存独立开关。</p>}
    {visible && state.error && <p role="alert">{state.error}</p>}
    {visible && state.notice && <p role="status" aria-live="polite">{state.notice}</p>}
  </WorkbenchPanel>;
}
