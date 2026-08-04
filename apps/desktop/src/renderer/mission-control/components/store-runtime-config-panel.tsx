import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowCounterClockwise,
  Check,
  Clock,
  GearSix,
  PencilSimple,
  Plus,
  Sparkle,
  X,
} from '@phosphor-icons/react';
import type {
  ArchiveStoreRuntimeConfigInput,
  CreateStoreRuntimeConfigInput,
  RestoreStoreRuntimeConfigInput,
  StoreContextEnvelope,
  StoreRuntimeConfigProjection,
  StoreRuntimeConfigRecord,
  StoreRuntimeConfigValues,
  StoreRuntimeConfigVersion,
  UpdateStoreRuntimeConfigInput,
} from '@amazon-ai-ops/shared-types';
import {
  PriorityDataTable,
  WorkbenchPanel,
  WorkspaceState,
  type PriorityDataTableColumn,
} from '../../components/workspace';

export const STORE_RUNTIME_CONFIG_CAPABILITY_IDS = {
  view: 'settings.ai-and-local.view',
  create: 'settings.store-config.create',
  update: 'settings.store-config.update',
  archive: 'settings.store-config.archive',
  restore: 'settings.store-config.restore',
} as const;

export interface StoreRuntimeConfigRendererApi {
  getStoreRuntimeConfig(context: StoreContextEnvelope): Promise<StoreRuntimeConfigProjection>;
  createStoreRuntimeConfig(
    context: StoreContextEnvelope,
    input: CreateStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection>;
  updateStoreRuntimeConfig(
    context: StoreContextEnvelope,
    input: UpdateStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection>;
  archiveStoreRuntimeConfig(
    context: StoreContextEnvelope,
    input: ArchiveStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection>;
  restoreStoreRuntimeConfig(
    context: StoreContextEnvelope,
    input: RestoreStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection>;
}
export type StoreRuntimeConfigPanelProps = {
  storeContext: StoreContextEnvelope;
  api?: StoreRuntimeConfigRendererApi | null;
};

type ConfigMutation = 'create' | 'update' | 'archive' | 'restore';
type ConfigDraft = StoreRuntimeConfigValues;
type ConfigDraftErrors = Partial<Record<keyof ConfigDraft, string>>;

export const DEFAULT_STORE_RUNTIME_CONFIG_VALUES: StoreRuntimeConfigValues = {
  aiRecommendationsEnabled: true,
  collectionScheduleLocalTime: '08:00',
  collectionLookbackDays: 14,
  analysisWindowDays: 30,
  defaultTargetAcosPercent: 28,
  minimumRecommendationConfidencePercent: 72,
  evidenceRetentionDays: 365,
};

export function validateStoreRuntimeConfigDraft(draft: ConfigDraft): ConfigDraftErrors {
  const errors: ConfigDraftErrors = {};
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.collectionScheduleLocalTime)) {
    errors.collectionScheduleLocalTime = '采集时间必须使用 HH:mm。';
  }
  validateIntegerRange(draft.collectionLookbackDays, 1, 90, '采集回看天数', errors, 'collectionLookbackDays');
  validateIntegerRange(draft.analysisWindowDays, 7, 90, '分析窗口天数', errors, 'analysisWindowDays');
  validateNumberRange(draft.defaultTargetAcosPercent, 1, 100, '默认目标 ACOS', errors, 'defaultTargetAcosPercent');
  validateNumberRange(
    draft.minimumRecommendationConfidencePercent,
    50,
    99,
    '最低建议置信度',
    errors,
    'minimumRecommendationConfidencePercent',
  );
  validateIntegerRange(draft.evidenceRetentionDays, 30, 3650, '证据保留天数', errors, 'evidenceRetentionDays');
  return errors;
}

export function readStoreRuntimeConfigApi(target: unknown = globalThis): StoreRuntimeConfigRendererApi | null {
  const candidate = (target as { electronAPI?: Partial<StoreRuntimeConfigRendererApi> } | null)?.electronAPI;
  if (!candidate) return null;
  const required = [
    'getStoreRuntimeConfig',
    'createStoreRuntimeConfig',
    'updateStoreRuntimeConfig',
    'archiveStoreRuntimeConfig',
    'restoreStoreRuntimeConfig',
  ] as const;
  return required.every((name) => typeof candidate[name] === 'function')
    ? candidate as StoreRuntimeConfigRendererApi
    : null;
}

export function StoreRuntimeConfigPanel({
  storeContext,
  api: explicitApi,
}: StoreRuntimeConfigPanelProps) {
  const api = explicitApi === undefined ? readStoreRuntimeConfigApi(window) : explicitApi;
  const [projection, setProjection] = useState<StoreRuntimeConfigProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<ConfigDraft | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [errors, setErrors] = useState<ConfigDraftErrors>({});
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pending, setPending] = useState<ConfigMutation | null>(null);
  const loadSequence = useRef(0);
  const current = projection?.current ?? null;

  useEffect(() => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setProjection(null);
    setRuntimeError(null);
    setEditor(null);
    setConfirmArchive(false);
    if (!api) {
      setLoading(false);
      setRuntimeError('Store Runtime Config API 未接入，已失败关闭。');
      return undefined;
    }
    void api.getStoreRuntimeConfig(storeContext)
      .then((next) => {
        if (sequence === loadSequence.current) setProjection(next);
      })
      .catch((error) => {
        if (sequence === loadSequence.current) setRuntimeError(errorMessage(error));
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
    return () => { loadSequence.current += 1; };
  }, [api, storeContext]);

  const run = async (action: ConfigMutation, operation: () => Promise<StoreRuntimeConfigProjection>) => {
    if (!api || pending) return;
    setPending(action);
    setRuntimeError(null);
    try {
      const next = await operation();
      setProjection(next);
      setEditor(null);
      setConfirmArchive(false);
    } catch (error) {
      setRuntimeError(errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const saveEditor = async () => {
    if (!editor || !api) return;
    const nextErrors = validateStoreRuntimeConfigDraft(editor);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!current) {
      await run('create', () => api.createStoreRuntimeConfig(storeContext, { values: editor }));
      return;
    }
    const patch = changedValues(current.values, editor);
    if (Object.keys(patch).length === 0) {
      setErrors({ collectionScheduleLocalTime: '没有需要保存的变更。' });
      return;
    }
    await run('update', () => api.updateStoreRuntimeConfig(storeContext, {
      expectedRevision: current.revision,
      patch,
    }));
  };

  const versionRows = useMemo(
    () => [...(projection?.versions ?? [])].sort((left, right) => right.revision - left.revision),
    [projection?.versions],
  );
  const versionColumns: Array<PriorityDataTableColumn<StoreRuntimeConfigVersion>> = [
    {
      key: 'revision',
      header: '版本',
      priority: 'anchor',
      width: '12%',
      cell: (version) => <strong>r{version.revision}</strong>,
    },
    {
      key: 'action',
      header: '动作',
      priority: 'primary',
      width: '18%',
      cell: (version) => <span className="mission-control-config-version-action" data-action={version.action}>{versionActionLabel(version.action)}</span>,
    },
    {
      key: 'schedule',
      header: '采集 / 分析',
      priority: 'primary',
      width: '26%',
      cell: (version) => `${version.snapshot.values.collectionScheduleLocalTime} · ${version.snapshot.values.analysisWindowDays} 天`,
    },
    {
      key: 'target',
      header: '目标 / 置信度',
      priority: 'supporting',
      width: '22%',
      cell: (version) => `${formatPercent(version.snapshot.values.defaultTargetAcosPercent)} / ${formatPercent(version.snapshot.values.minimumRecommendationConfidencePercent)}`,
    },
    {
      key: 'time',
      header: '记录时间',
      priority: 'supporting',
      cell: (version) => formatTimestamp(version.occurredAt),
    },
  ];

  return (
    <div
      className="mission-control-runtime-config"
      data-capability-id={STORE_RUNTIME_CONFIG_CAPABILITY_IDS.view}
      data-config-state={current?.status ?? (loading ? 'loading' : 'empty')}
    >
      <WorkbenchPanel
        description="当前店铺独立保存采集、量化与 AI 建议参数；Amazon Ads 自动执行上限与急停仍由策略/执行 Authority 管理。"
        status={<span>{current ? `r${current.revision} · ${current.status === 'active' ? '生效中' : '已归档'}` : loading ? '读取中' : '未配置'}</span>}
        title="店铺运行配置"
        toolbar={(
          <div className="mission-control-config-actions" role="group" aria-label="店铺运行配置操作">
            {!current && (
              <button
                className="workspace-button workspace-button--primary"
                data-capability-id={STORE_RUNTIME_CONFIG_CAPABILITY_IDS.create}
                disabled={loading || Boolean(pending) || !api}
                onClick={() => { setErrors({}); setEditor({ ...DEFAULT_STORE_RUNTIME_CONFIG_VALUES }); }}
                type="button"
              >
                <Plus aria-hidden="true" size={16} />新建配置
              </button>
            )}
            {current?.status === 'active' && (
              <>
                <button
                  className="workspace-button workspace-button--primary"
                  data-capability-id={STORE_RUNTIME_CONFIG_CAPABILITY_IDS.update}
                  disabled={Boolean(pending)}
                  onClick={() => { setErrors({}); setEditor({ ...current.values }); }}
                  type="button"
                >
                  <PencilSimple aria-hidden="true" size={16} />编辑配置
                </button>
                <button
                  className="workspace-button workspace-button--secondary"
                  data-capability-id={STORE_RUNTIME_CONFIG_CAPABILITY_IDS.archive}
                  disabled={Boolean(pending)}
                  onClick={() => setConfirmArchive(true)}
                  type="button"
                >
                  <Archive aria-hidden="true" size={16} />归档
                </button>
              </>
            )}
            {current?.status === 'archived' && (
              <button
                aria-busy={pending === 'restore' || undefined}
                className="workspace-button workspace-button--primary"
                data-capability-id={STORE_RUNTIME_CONFIG_CAPABILITY_IDS.restore}
                disabled={Boolean(pending)}
                onClick={() => run('restore', () => api!.restoreStoreRuntimeConfig(storeContext, { expectedRevision: current.revision }))}
                type="button"
              >
                <ArrowCounterClockwise aria-hidden="true" size={16} />{pending === 'restore' ? '恢复中…' : '恢复配置'}
              </button>
            )}
          </div>
        )}
      >
        {runtimeError && <div className="mission-control-store-error" role="alert">{runtimeError}</div>}
        {loading ? (
          <WorkspaceState description="Main 正在复核当前 StoreContext 并读取独立配置。" kind="loading" title="正在读取店铺配置" />
        ) : !current ? (
          <WorkspaceState description="创建后，这些参数只影响当前店铺；切换店铺不会复用或覆盖配置。" kind="empty" title="当前店铺尚未配置" />
        ) : (
          <div className="mission-control-config-grid" role="list" aria-label="当前店铺运行参数">
            <ConfigFact icon={<Clock aria-hidden="true" size={18} />} label="每日采集" value={`${current.values.collectionScheduleLocalTime} · 回看 ${current.values.collectionLookbackDays} 天`} />
            <ConfigFact icon={<GearSix aria-hidden="true" size={18} />} label="量化窗口" value={`${current.values.analysisWindowDays} 天 · 目标 ACOS ${formatPercent(current.values.defaultTargetAcosPercent)}`} />
            <ConfigFact icon={<Sparkle aria-hidden="true" size={18} />} label="AI 建议" value={current.values.aiRecommendationsEnabled ? `启用 · ≥ ${formatPercent(current.values.minimumRecommendationConfidencePercent)}` : '已关闭'} />
            <ConfigFact icon={<Archive aria-hidden="true" size={18} />} label="证据保留" value={`${current.values.evidenceRetentionDays} 天`} />
            <ConfigFact icon={<GearSix aria-hidden="true" size={18} />} label="站点 / 币种" value={`${current.marketplace} / ${current.currency}`} />
            <ConfigFact icon={<Clock aria-hidden="true" size={18} />} label="业务时区" value={current.businessTimezone} />
          </div>
        )}
      </WorkbenchPanel>

      {versionRows.length > 0 && (
        <WorkbenchPanel
          description="每次创建、修改、归档和恢复都保留完整快照，方便追溯当日分析采用的参数。"
          status={<span>{versionRows.length} 个版本</span>}
          title="配置版本记录"
        >
          <PriorityDataTable
            caption="当前店铺运行配置版本历史"
            columns={versionColumns}
            getRowKey={(version) => `${version.action}-${version.revision}`}
            rows={versionRows}
          />
        </WorkbenchPanel>
      )}

      {editor && (
        <ConfigEditor
          busy={pending === 'create' || pending === 'update'}
          draft={editor}
          errors={errors}
          mode={current ? 'update' : 'create'}
          onCancel={() => setEditor(null)}
          onChange={setEditor}
          onSave={saveEditor}
          storeContext={storeContext}
        />
      )}

      {confirmArchive && current && (
        <div className="mission-control-dialog-backdrop">
          <section aria-labelledby="runtime-config-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="dialog">
            <header>
              <div><span>RECOVERABLE ARCHIVE</span><h2 id="runtime-config-archive-title">归档当前店铺配置？</h2><p>配置会停止生效但保留全部版本，可随时恢复；不会影响其他店铺。</p></div>
              <button aria-label="关闭归档确认" className="mission-control-dialog__close" disabled={Boolean(pending)} onClick={() => setConfirmArchive(false)} type="button"><X aria-hidden="true" size={18} /></button>
            </header>
            <footer>
              <button className="workspace-button workspace-button--secondary" disabled={Boolean(pending)} onClick={() => setConfirmArchive(false)} type="button">取消</button>
              <button
                aria-busy={pending === 'archive' || undefined}
                className="workspace-button workspace-button--primary"
                data-capability-id={STORE_RUNTIME_CONFIG_CAPABILITY_IDS.archive}
                disabled={Boolean(pending)}
                onClick={() => run('archive', () => api!.archiveStoreRuntimeConfig(storeContext, {
                  expectedRevision: current.revision,
                  reason: 'operator_archived_from_mission_control',
                }))}
                type="button"
              >
                <Archive aria-hidden="true" size={16} />{pending === 'archive' ? '归档中…' : '确认归档'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function ConfigFact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="mission-control-config-fact" role="listitem"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function ConfigEditor({
  busy,
  draft,
  errors,
  mode,
  onCancel,
  onChange,
  onSave,
  storeContext,
}: {
  busy: boolean;
  draft: ConfigDraft;
  errors: ConfigDraftErrors;
  mode: 'create' | 'update';
  onCancel(): void;
  onChange(next: ConfigDraft): void;
  onSave(): void;
  storeContext: StoreContextEnvelope;
}) {
  const set = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="mission-control-dialog-backdrop">
      <section aria-describedby="runtime-config-editor-description" aria-labelledby="runtime-config-editor-title" aria-modal="true" className="mission-control-dialog mission-control-config-dialog" role="dialog">
        <header>
          <div>
            <span>STORE CONFIG · US / USD</span>
            <h2 id="runtime-config-editor-title">{mode === 'create' ? '新建店铺运行配置' : '编辑店铺运行配置'}</h2>
            <p id="runtime-config-editor-description">参数绑定 {String(storeContext.storeId)}，时间按 {storeContext.businessTimezone} 解释。</p>
          </div>
          <button aria-label="关闭配置编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="mission-control-store-form mission-control-config-form">
          <label><span>每日采集时间</span><input autoFocus type="time" value={draft.collectionScheduleLocalTime} onChange={(event) => set('collectionScheduleLocalTime', event.target.value)} />{errors.collectionScheduleLocalTime && <small role="alert">{errors.collectionScheduleLocalTime}</small>}</label>
          <NumberField draft={draft} errors={errors} field="collectionLookbackDays" label="采集回看天数" maximum={90} minimum={1} onChange={set} suffix="天" />
          <NumberField draft={draft} errors={errors} field="analysisWindowDays" label="量化分析窗口" maximum={90} minimum={7} onChange={set} suffix="天" />
          <NumberField draft={draft} errors={errors} field="defaultTargetAcosPercent" label="默认目标 ACOS" maximum={100} minimum={1} onChange={set} step={0.5} suffix="%" />
          <NumberField draft={draft} errors={errors} field="minimumRecommendationConfidencePercent" label="最低建议置信度" maximum={99} minimum={50} onChange={set} step={1} suffix="%" />
          <NumberField draft={draft} errors={errors} field="evidenceRetentionDays" label="证据保留期" maximum={3650} minimum={30} onChange={set} suffix="天" />
          <label className="mission-control-config-toggle">
            <span>AI 调整建议</span>
            <input checked={draft.aiRecommendationsEnabled} onChange={(event) => set('aiRecommendationsEnabled', event.target.checked)} type="checkbox" />
            <strong>{draft.aiRecommendationsEnabled ? '启用分析建议' : '仅保留量化结果'}</strong>
          </label>
        </div>
        <footer>
          <button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</button>
          <button aria-busy={busy || undefined} className="workspace-button workspace-button--primary" data-capability-id={mode === 'create' ? STORE_RUNTIME_CONFIG_CAPABILITY_IDS.create : STORE_RUNTIME_CONFIG_CAPABILITY_IDS.update} disabled={busy} onClick={onSave} type="button"><Check aria-hidden="true" size={16} />{busy ? '保存中…' : mode === 'create' ? '创建配置' : '保存变更'}</button>
        </footer>
      </section>
    </div>
  );
}

function NumberField<K extends Exclude<keyof ConfigDraft, 'aiRecommendationsEnabled' | 'collectionScheduleLocalTime'>>({
  draft,
  errors,
  field,
  label,
  maximum,
  minimum,
  onChange,
  step = 1,
  suffix,
}: {
  draft: ConfigDraft;
  errors: ConfigDraftErrors;
  field: K;
  label: string;
  maximum: number;
  minimum: number;
  onChange<T extends keyof ConfigDraft>(key: T, value: ConfigDraft[T]): void;
  step?: number;
  suffix: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <div className="mission-control-config-number"><input max={maximum} min={minimum} step={step} type="number" value={draft[field]} onChange={(event) => onChange(field, Number(event.target.value) as ConfigDraft[K])} /><em>{suffix}</em></div>
      {errors[field] && <small role="alert">{errors[field]}</small>}
    </label>
  );
}

function changedValues(current: StoreRuntimeConfigValues, next: ConfigDraft): Partial<StoreRuntimeConfigValues> {
  const patch: Partial<StoreRuntimeConfigValues> = {};
  for (const key of Object.keys(next) as Array<keyof StoreRuntimeConfigValues>) {
    if (current[key] !== next[key]) (patch as Record<string, unknown>)[key] = next[key];
  }
  return patch;
}

function validateIntegerRange<K extends keyof ConfigDraftErrors>(value: number, minimum: number, maximum: number, label: string, errors: ConfigDraftErrors, key: K) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) errors[key] = `${label}必须是 ${minimum}–${maximum} 的整数。`;
}

function validateNumberRange<K extends keyof ConfigDraftErrors>(value: number, minimum: number, maximum: number, label: string, errors: ConfigDraftErrors, key: K) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) errors[key] = `${label}必须在 ${minimum}–${maximum} 之间。`;
}

function versionActionLabel(action: StoreRuntimeConfigVersion['action']): string {
  return { create: '创建', update: '修改', archive: '归档', restore: '恢复' }[action];
}

function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return '店铺配置操作未完成，请刷新后重试。';
}
