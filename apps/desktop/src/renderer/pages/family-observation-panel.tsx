import React, { useLayoutEffect, useRef, useState } from 'react';
import type { FamilyObservation } from '@amazon-ai-ops/report-parser';
import type { FamilyObservationFile, FamilyObservationPreview, FamilyObservationScope } from '../../shared/family-observation-contracts';
import { Panel, StatusPill } from '../components/ui';
import { rendererRuntimeLog } from '../runtime-log';
import { toUserFacingError } from '../user-facing-error';
import './family-observation-panel.css';

export interface FamilyObservationApi {
  listFamilyObservationFiles(scope: FamilyObservationScope): Promise<FamilyObservationFile[]>;
  prepareFamilyObservation(input: FamilyObservationScope & { fileIds: number[]; familyLabel: string }): Promise<FamilyObservationPreview>;
  confirmFamilyObservation(input: { storeContext: FamilyObservationScope['storeContext']; token: string }): Promise<FamilyObservation>;
  cancelFamilyObservation(): Promise<void>;
}
interface Props {
  scope: FamilyObservationScope | null;
  contextKey: string;
  fileRevision: string;
  api?: FamilyObservationApi;
}
const metricNames = { impressions: '曝光', clicks: '点击', cost: '花费', orders: '订单', sales: '销售额' } as const;
const reportNames: Record<string, string> = { campaign: '广告活动', ad_group: '广告组', keyword: '关键词', auxiliary: '辅助文件' };
const display = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });

export function FamilyObservationPanel({ scope, contextKey, fileRevision, api: suppliedApi }: Props) {
  const api = suppliedApi ?? (window as unknown as { electronAPI?: FamilyObservationApi }).electronAPI;
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FamilyObservationFile[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<FamilyObservationPreview | null>(null);
  const [result, setResult] = useState<FamilyObservation | null>(null);
  const [confirmedPreview, setConfirmedPreview] = useState<FamilyObservationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const latch = useRef(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  function cancelMain() {
    void apiRef.current?.cancelFamilyObservation?.().catch(error => {
      rendererRuntimeLog.error('family_observation.cancel_failed', { error });
    });
  }
  function invalidate() {
    ++generation.current;
    latch.current = false;
    setBusy(false);
    setPreview(null);
    setResult(null);
    setConfirmedPreview(null);
    setError('');
    cancelMain();
  }
  useLayoutEffect(() => {
    invalidate();
    setOpen(false);
    setFiles([]);
    setSelected([]);
    return () => { ++generation.current; latch.current = false; cancelMain(); };
  }, [contextKey, fileRevision]);

  async function run<T,>(work: () => Promise<T>, apply: (value: T) => void) {
    if (latch.current) return;
    latch.current = true;
    setBusy(true);
    setError('');
    const captured = generation.current;
    try {
      const value = await work();
      if (captured === generation.current) apply(value);
    } catch (error) {
      rendererRuntimeLog.error('family_observation.operation_failed', { error });
      if (captured === generation.current) setError(toUserFacingError(error, '产品族观察失败，请刷新文件后重试。'));
    } finally {
      if (captured === generation.current) { latch.current = false; setBusy(false); }
    }
  }
  function load() {
    if (!scope || !api?.listFamilyObservationFiles || latch.current) return;
    invalidate();
    setOpen(true);
    setFiles([]);
    setSelected([]);
    void run(() => api.listFamilyObservationFiles(scope), setFiles);
  }
  function prepare() {
    if (!scope || !api || !label.trim() || !selected.length || latch.current) return;
    setPreview(null);
    setResult(null);
    setConfirmedPreview(null);
    void run(() => api.prepareFamilyObservation({ ...scope, familyLabel: label.trim(), fileIds: selected }), setPreview);
  }
  function confirm() {
    if (!scope || !api || !preview || latch.current) return;
    const capturedPreview = preview;
    const token = preview.token;
    setPreview(null);
    void run(() => api.confirmFamilyObservation({ storeContext: scope.storeContext, token }), value => {
      setResult(value);
      setConfirmedPreview(capturedPreview);
    });
  }
  return <Panel title="产品族只读观察" titleAccessory={<StatusPill tone="pending">不影响正式诊断</StatusPill>}>
    <div className="family-observation">
      <p>只观察您明确确认的这一组已导入文件；不会识别 ASIN、批准 AI 或修改广告。</p>
      {!open ? <button type="button" className="secondary-button" disabled={!scope || !api?.listFamilyObservationFiles} onClick={load}>选择文件并观察</button> : <>
        <div className="action-row">
          <button type="button" className="secondary-button" disabled={busy} onClick={load}>刷新文件</button>
          <button type="button" className="secondary-button" onClick={() => { invalidate(); setOpen(false); }}>关闭并取消确认</button>
        </div>
        <p>日期范围：{scope?.dateFrom} — {scope?.dateTo} · 确认仅在本次页面会话有效</p>
        <label className="family-observation-label">产品族名称<input maxLength={80} value={label} placeholder="例如：产品 A" onChange={event => { invalidate(); setLabel(event.target.value); }} /></label>
        <fieldset className="family-observation-files"><legend>选择本次归属的文件</legend>
          {files.map(file => <label key={file.id}><input type="checkbox" checked={selected.includes(file.id)} onChange={() => {
            invalidate(); setSelected(current => current.includes(file.id) ? current.filter(id => id !== file.id) : [...current, file.id]);
          }} /><span>{file.fileName}<small>{reportNames[file.reportType] ?? '辅助文件'}{!['campaign', 'ad_group', 'keyword'].includes(file.reportType) ? '（仅绑定，不参与每日计算）' : ''} · {file.dateFrom} — {file.dateTo}</small></span></label>)}
          {!busy && !files.length && <p>没有可用的已导入文件，请先导入原始报表。</p>}
        </fieldset>
        <button type="button" className="secondary-button" disabled={busy || !selected.length || !label.trim()} onClick={prepare}>核对本次文件范围</button>
        {preview && <section className="family-observation-confirm" aria-label="本次产品族确认范围">
          <h3>{preview.familyLabel} · {preview.storeName} · {preview.marketplaceCode}</h3>
          <p>{preview.dateFrom} — {preview.dateTo} · 仅以下 {preview.files.length} 个文件版本</p>
          <ul>{preview.files.map(file => <li key={file.id}>{file.fileName}{!['campaign', 'ad_group', 'keyword'].includes(file.reportType) ? '（仅绑定，不参与每日计算）' : ''}</li>)}</ul>
          <details><summary>文件版本与来源</summary>{preview.files.map(file => <p key={file.id}>{file.fileName}<br />批次：{file.batchId}<br /><code>{file.sha256}</code></p>)}</details>
          <p>我确认这些文件属于上述同一产品族；此确认不适用于其他文件或未来上传。</p>
          <button type="button" className="primary-button" disabled={busy} onClick={confirm}>确认这些文件属于同一产品族并观察</button>
        </section>}
        {busy && <p role="status">正在核对文件…</p>}
        {error && <p role="alert" className="blocked-line">{error}</p>}
        {result && confirmedPreview && <>
          <section aria-label="已确认的观察来源">
            <p>{confirmedPreview.storeName} · {confirmedPreview.marketplaceCode} · {confirmedPreview.dateFrom} — {confirmedPreview.dateTo} · {confirmedPreview.files.length} 个指定版本</p>
            <details><summary>查看本次确认的文件来源</summary>{confirmedPreview.files.map(file => <p key={file.id}>{file.fileName} · {result.consumedHashes.includes(file.sha256) ? '参与每日观察' : '仅绑定，不参与每日计算'}<br />批次：{file.batchId}<br /><code>{file.sha256}</code></p>)}</details>
          </section>
          <FamilyObservationResult result={result} />
        </>}
      </>}
    </div>
  </Panel>;
}

export function FamilyObservationResult({ result }: { result: FamilyObservation }) {
  const differences = result.days.filter(day => day.reconciliation === 'discrepancy').length;
  return <section aria-label="产品族每日观察结果">
    <h3>{result.familyLabel} · 每日观察</h3>
    <p className="warning-line">局部观察，不代表完整产品总量。币种未知 · 归因窗口未知 · 关键词覆盖未知。</p>
    <p role="status">{differences ? `${differences} 天存在活动与广告组差异，请核对报表口径。` : '未发现已知值差异不代表数据完整；缺失值仍显示未知。'}</p>
    <div className="family-observation-table"><table><caption>广告活动层每日值（不跨层相加）</caption><thead><tr><th>日期</th>{Object.values(metricNames).map(name => <th key={name}>{name}</th>)}<th>广告组核对</th></tr></thead>
      <tbody>{result.days.map(day => <tr key={day.date}><th>{day.date}</th>{Object.keys(metricNames).map(metric => <td key={metric}>{display(day.campaign?.metrics[metric as keyof typeof metricNames])}</td>)}<td>{day.reconciliation === 'discrepancy' ? '有差异' : day.reconciliation === 'match' ? '已知值一致' : '未知'}</td></tr>)}</tbody></table></div>
    <details><summary>查看广告组差值与关键词子集</summary>
      {result.days.map(day => <div key={day.date}><h4>{day.date}</h4><p>活动 − 广告组：{Object.entries(metricNames).map(([metric, name]) => `${name} ${display(day.campaignMinusAdGroup[metric as keyof typeof metricNames])}`).join(' · ')}</p>
        <p>关键词子集：{Object.entries(metricNames).map(([metric, name]) => `${name} ${display(day.keywordSubset?.metrics[metric as keyof typeof metricNames])}`).join(' · ')}</p>
        {(day.campaign?.identityStatus === 'ambiguous-repeated-dimensions' || day.adGroupCrosscheck?.identityStatus === 'ambiguous-repeated-dimensions' || day.keywordSubset?.identityStatus === 'ambiguous-repeated-dimensions') && <p className="warning-line">存在重复维度，相关指标保持未知。</p>}
      </div>)}
    </details>
  </section>;
}
