import React, { useId, useLayoutEffect, useState } from 'react';
import { AI_PURPOSES, type AiSpendPolicyInput, type AiSpendProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { V16_API_VERSION, type V16ServicesApi } from '@amazon-ai-ops/shared-types/src/v16-api';
import { Panel } from '../ui';
import { rendererRuntimeLog } from '../../runtime-log';
import { useWorkspaceOperation, type WorkspaceOperationTicket } from './use-workspace-operation';
import { WorkspaceActionButton } from './action-feedback';

type Fields = { [K in Exclude<keyof AiSpendPolicyInput, 'enabled' | 'expectedRevision'>]: string };
const empty: Fields = { providerBaseUrl: '', model: '', windowStartsAt: '', windowEndsAt: '', budgetMicrousd: '',
  contextTokenLimit: '', outputTokenLimit: '', inputMicrousdPerMillion: '', outputMicrousdPerMillion: '', pricingReference: '', reason: '' };
const labels: Record<keyof Fields, string> = {
  providerBaseUrl: '服务地址（与 AI 设置完全一致）', model: '模型名称', windowStartsAt: '预算开始时间（UTC）', windowEndsAt: '预算结束时间（UTC）',
  budgetMicrousd: '本窗口预算（USD）', contextTokenLimit: '服务商规定的模型上下文上限（tokens）', outputTokenLimit: '本次输出上限（tokens）',
  inputMicrousdPerMillion: '输入报价（USD / 百万 tokens）', outputMicrousdPerMillion: '输出报价（USD / 百万 tokens）',
  pricingReference: '公开报价与模型上限来源（HTTPS）', reason: '预算批准说明',
};
const moneyKeys = new Set(['budgetMicrousd','inputMicrousdPerMillion','outputMicrousdPerMillion']);
const timeKeys = new Set(['windowStartsAt','windowEndsAt']);
const numericKeys = new Set([...moneyKeys, 'contextTokenLimit','outputTokenLimit']);
const currency = (micros?: number) => micros === undefined ? '未知' : `USD ${(micros / 1000000).toFixed(6)}`;
const statusText = { started: '请求中', succeeded: '请求已完成', failed: '请求失败', interrupted: '请求中断', blocked: '付费已阻断' };

export function AiSpendPanel({ storeContext }: { storeContext: StoreContextEnvelope }) {
  const api = typeof window === 'undefined' ? undefined : (window as unknown as { electronAPI?: { v16?: V16ServicesApi } }).electronAPI?.v16;
  const [projection, setProjection] = useState<AiSpendProjection>();
  const [fields, setFields] = useState<Fields>(empty);
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState<'refresh' | 'save' | null>(null);
  const [message, setMessage] = useState('');
  const request = <T,>(input: T) => ({ apiVersion: V16_API_VERSION, storeContext: { ...storeContext }, input });
  const contextKey = JSON.stringify(storeContext);
  const operation = useWorkspaceOperation(contextKey);
  const busy = operation.busy;
  const lockId = useId();
  const disabledReason = !api ? '当前应用尚未连接 AI 费用服务，请重新打开应用。'
    : '当前 AI 费用或预算操作正在处理，请等待完成后继续。';
  function apply(result: AiSpendProjection) {
    setProjection(result);
    const policy = result.policy;
    setEnabled(policy?.enabled ?? false);
    setFields(policy ? Object.fromEntries(Object.keys(empty).map(key => {
      const value = policy[key as keyof Fields];
      return [key, moneyKeys.has(key) ? String(Number(value) / 1000000) : timeKeys.has(key) ? String(value).slice(0, 16) : String(value)];
    })) as Fields : empty);
  }
  async function readProjection(ticket: WorkspaceOperationTicket): Promise<boolean> {
    try {
      if (!api) throw new Error('AI 费用服务未连接');
      const result = await api.aiSpendGet(request({}));
      if (!ticket.isCurrent()) return false;
      if (!result.success) throw new Error(result.error);
      apply(result.data);
      return true;
    } catch (error) {
      rendererRuntimeLog.error('ai_spend.read_failed', { error });
      if (ticket.isCurrent()) setMessage('读取 AI 费用失败，请刷新后核对当前预算状态。');
      return false;
    }
  }
  async function refresh(): Promise<void> {
    const ticket = operation.begin();
    if (!ticket) return;
    setActive('refresh'); setMessage('正在读取本店费用…');
    try {
      const loaded = await readProjection(ticket);
      if (ticket.isCurrent() && loaded) setMessage('');
    }
    finally {
      if (ticket.isCurrent()) { setActive(null); }
      ticket.finish();
    }
  }
  useLayoutEffect(() => {
    setProjection(undefined); setFields(empty); setEnabled(false); setMessage(''); setActive(null);
    void refresh();
  }, [contextKey]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const ticket = operation.begin();
    if (!ticket) return;
    setActive('save'); setMessage('正在保存本店 AI 预算…');
    try {
      if (!api) throw new Error('AI 预算保存服务未连接');
      const data: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (moneyKeys.has(key)) {
          if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('预算和报价最多使用六位小数。');
          data[key] = Math.round(Number(value) * 1000000);
        } else if (timeKeys.has(key)) data[key] = new Date(value + 'Z').toISOString();
        else if (numericKeys.has(key)) data[key] = Number(value);
        else data[key] = value;
      }
      const result = await api.aiSpendSave(request({ ...data, enabled, expectedRevision: projection?.policy?.revision ?? 0 } as unknown as AiSpendPolicyInput));
      if (!ticket.isCurrent()) return;
      if (!result.success) throw new Error(result.error);
      const reloaded = await readProjection(ticket);
      if (ticket.isCurrent()) setMessage(reloaded ? '本店 AI 预算已保存并重新读取。报价用于估算，账单未确认时保留未知费用。' : '预算已保存，但刷新失败，请重新读取后核对。');
    } catch (error) {
      rendererRuntimeLog.error('ai_spend.save_failed', { error });
      if (ticket.isCurrent()) setMessage('预算未保存。请核对完整字段、日期、正数报价与模型上限，刷新后重试。');
    } finally {
      if (ticket.isCurrent()) setActive(null);
      ticket.finish();
    }
  }
  return <Panel title="AI 费用与预算">
    <p>自动调用先预留已复核模型上限对应的费用。预算缺失、不足或窗口内有未知费用时，保留规则或模板结果。此预算不授予广告操作权限。</p>
    <p role="status" aria-live="polite">{message || (busy ? '正在读取本店费用…' : projection?.policy?.enabled ? '本店已配置自动付费预算，调用时仍须检查有效期和余额。' : '本店未启用自动付费预算。')}</p>
    <p>已计费用：{currency(projection?.committedMicrousd)} · 请求预留：{currency(projection?.reservedMicrousd)} · 可用余额：{currency(projection?.remainingMicrousd)} · 未知费用：{projection?.unknownCount ?? '未知'} 笔</p>
    <WorkspaceActionButton className="secondary-button" type="button" disabled={busy || !api} disabledReason={disabledReason}
      busy={busy && active === 'refresh'} busyLabel="读取费用中…" onClick={() => void refresh()}>刷新费用与预算</WorkspaceActionButton>
    <details>
      <summary>配置或调整本店 AI 预算</summary>
      <p>先核对服务商报价、计费规则和模型硬性上限，再批准独立预算。报价采用不含缓存优惠的最高单价；典型样本测量值不能代替上限或预算。</p>
      <form onSubmit={save} aria-busy={busy}>
        {(busy || !api) && <p id={lockId}>{disabledReason}</p>}
        <fieldset disabled={busy || !api} aria-describedby={busy || !api ? lockId : undefined} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', border: 0, padding: 0 }}>
          <legend className="sr-only">本店 AI 预算设置</legend>
          {Object.keys(labels).map(key => <label key={key} style={{ display: 'grid', gap: 4 }}>{labels[key as keyof Fields]}
            <input required type={timeKeys.has(key) ? 'datetime-local' : numericKeys.has(key) ? 'number' : key.includes('Url') || key === 'pricingReference' ? 'url' : 'text'}
              step={moneyKeys.has(key) ? '0.000001' : numericKeys.has(key) ? '1' : undefined} min={moneyKeys.has(key) ? '0.000001' : numericKeys.has(key) ? '1' : undefined}
              value={fields[key as keyof Fields]} onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} />
          </label>)}
          <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用本店自动付费预算</label>
          <WorkspaceActionButton className="primary-button" type="submit" disabled={busy || !api} disabledReason={disabledReason}
            busy={busy && active === 'save'} busyLabel="正在保存…">批准并保存 AI 预算</WorkspaceActionButton>
        </fieldset>
      </form>
    </details>
    <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="本店 AI 调用记录，可横向滚动">
      <table><caption>最近 50 次 AI 调用（仅本店）</caption>
        <thead><tr>{['开始时间','用途','状态','费用','用量','结果处理'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{projection?.records.map(record => <tr key={record.id}>
          <td>{new Date(record.startedAt).toLocaleString('zh-CN')}</td><td>{AI_PURPOSES[record.purpose].label}</td><td>{statusText[record.status]}</td>
          <td>{record.status === 'blocked' ? '未发出付费请求' : `${record.costStatus === 'estimated' ? '估算 ' : ''}${currency(record.costMicrousd)}`}</td>
          <td>{record.usage ? `输入 ${record.usage.promptTokens} / 输出 ${record.usage.completionTokens}` : '未知'}</td>
          <td>{record.outputStatus === 'discarded' ? '旧上下文结果已丢弃' : record.fallback === 'none'
            ? record.outputStatus === 'accepted' ? '内容校验通过' : '内容尚未完成校验'
            : record.fallback === 'no_generation' ? '未生成' : record.fallback === 'template' ? '模板结果' : '规则结果'}</td>
        </tr>)}</tbody>
      </table>
      {!projection?.records.length && <p>本店暂无已记录调用。</p>}
    </div>
  </Panel>;
}
