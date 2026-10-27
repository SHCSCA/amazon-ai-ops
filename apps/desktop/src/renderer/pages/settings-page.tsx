// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { AiSpendPanel } from '../components/workspace/ai-spend-panel';
import { aiCallEvidenceLabel, aiCallEvidenceTotal, aiCallKindLabel, aiCallOutputFormatLabel, buildAiCallDiagnostics } from '../ai-call-diagnostics';
import { ProgressiveDetails } from '../components/progressive-details';
import { TagMetricGroup, type TagMetricItem } from '../components/tag-metric-group';
import { FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import type { AiCallLogView, AiConnectionStatus, AiProviderSettings, SettingsRuleConfig, StoragePathsView } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { rendererRuntimeLog } from '../runtime-log';
import { useWorkspaceOperation, type WorkspaceOperationTicket } from '../components/workspace/use-workspace-operation';
import { useOptionalMissionControlStoreContext } from '../mission-control/store-context';
import { DEFAULT_AI_SETTINGS, DEFAULT_RULE_CONFIG, type SettingsLocalActionKey, type SettingsModalMode, DIAGNOSTIC_CHECKS, type SettingsTaskActionKind, SAFETY_POLICIES, STRUCTURED_AI_OUTPUT_TOKEN_FLOOR, DEFAULT_AI_PERSONA } from './settings-contracts';
import { api, normalizeAiSettings, testedStatusForSettings, normalizeRuleConfig, settingsRuleConfigFieldFeedback, readString, validateRuleConfigForSave, percentLabel, clampStructuredAiMaxTokens, updateAiSettingsField, listToText, parseListInput } from './settings-values';
import { aiSettingsActionHint, settingsRuleActionButtonView, settingsLocalActionButtonView, settingsPrimaryAiStatusItems, settingsAiConnectionFeedback, buildSettingsTaskBannerState, settingsSecondaryStatusMessage, displayAiStatusTone, displayAiStatusLabel, settingsAiContractPrimaryCopy, settingsAiContractTags, tagToneToStatusPillTone, aiAuditIntroText, aiAuditPurposeText, aiAuditLogTitle, aiAuditLogFormatLine, storagePathDisplay, settingsLocalActionButtonContent, settingsAiContractVersionItems } from './settings-presentation';

export function SettingsPage({ embedded = false, storeContext }: { embedded?: boolean; storeContext?: StoreContextEnvelope } = {}) {
  const authority = useOptionalMissionControlStoreContext();
  const operationKey = JSON.stringify([authority?.authorityKey, authority?.contextEpoch, authority?.phase, storeContext]);
  const operation = useWorkspaceOperation(operationKey);
  const activeTicket = useRef<WorkspaceOperationTicket | null>(null);
  const apiKeyLabelId = useId();
  const apiKeyHintId = useId();
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const activeAction = operation.busy ? runningAction : null;
  const [aiSettings, setAiSettings] = useState<AiProviderSettings>(DEFAULT_AI_SETTINGS);
  const [ruleConfig, setRuleConfig] = useState<SettingsRuleConfig>(DEFAULT_RULE_CONFIG);
  const [aiStatus, setAiStatus] = useState<AiConnectionStatus>('unconfigured');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const savingAi = activeAction === 'save-ai' || activeAction === 'clear-ai-key';
  const savingRules = activeAction === 'save-rules';
  const [copyNotice, setCopyNotice] = useState('');
  const localAction: SettingsLocalActionKey | null = activeAction === 'clear-ai-key' || activeAction === 'copy-diagnostics' ? activeAction : null;
  const [storagePaths, setStoragePaths] = useState<StoragePathsView>({});
  const [aiCallLogs, setAiCallLogs] = useState<AiCallLogView[]>([]);
  const [settingsModal, setSettingsModal] = useState<SettingsModalMode>(null);

  const apiSurface = useMemo(() => api(), []);
  const canLoadSettings = typeof apiSurface.getSettings === 'function';
  const canSaveSettings = typeof apiSurface.saveSettings === 'function';
  const canTestAi = typeof apiSurface.testAiSettings === 'function';
  const canLoadRules = typeof apiSurface.getRuleConfig === 'function';
  const canSaveRules = typeof apiSurface.saveRuleConfig === 'function';
  const canLoadStoragePaths = typeof apiSurface.getStoragePaths === 'function';
  const canLoadAiCallLogs = typeof apiSurface.listAiCallLogs === 'function';
  const keyPresent = Boolean(aiSettings.aiApiKey.trim() || aiSettings.aiKeyConfigured);
  const canRunAiTest = canTestAi && keyPresent && Boolean(storeContext);
  const settingsDisabledReason = operation.busy ? '当前设置操作正在处理中，请稍候。'
    : loading ? '正在读取设置，请稍候。' : '';
  const aiActionHint = aiSettingsActionHint({
    canSaveSettings,
    keyPresent,
    canTestAi: canRunAiTest,
  });
  const ruleSaveButton = settingsRuleActionButtonView({
    active: savingRules,
    baseClassName: 'primary-button',
    busyLabel: '保存中...',
    disabled: !canSaveRules || operation.busy || loading,
    label: '保存系统回退规则',
  });
  const clearAiKeyButton = settingsLocalActionButtonView({
    action: 'clear-ai-key',
    activeAction: localAction,
    baseClassName: 'secondary-button',
    busyLabel: '清除中...',
    disabled: operation.busy || loading || !canSaveSettings || !keyPresent,
    label: '清除本地 AI Key',
  });
  const copyDiagnosticsButton = settingsLocalActionButtonView({
    action: 'copy-diagnostics',
    activeAction: localAction,
    baseClassName: 'secondary-button',
    busyLabel: '复制中...',
    disabled: operation.busy || loading,
    label: '复制支持检查清单',
  });

  function closeSettingsModal() {
    if (activeTicket.current?.isCurrent()) return;
    setSettingsModal(null);
  }

  function beginSettingsAction(action: string): WorkspaceOperationTicket | null {
    if (loading) return null;
    const ticket = operation.begin();
    if (!ticket) return null;
    activeTicket.current = ticket;
    setRunningAction(action);
    return ticket;
  }

  function finishSettingsAction(ticket: WorkspaceOperationTicket): void {
    if (activeTicket.current === ticket) activeTicket.current = null;
    ticket.finish();
  }

  const settingsDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: savingAi || savingRules || operation.busy,
    onDismiss: closeSettingsModal,
    open: Boolean(settingsModal),
  });

  async function refreshAiSettingsFromStore(isCurrent: () => boolean): Promise<AiProviderSettings | null> {
    if (!canLoadSettings) return null;
    const settings = await apiSurface.getSettings();
    if (!isCurrent()) return null;
    const next = normalizeAiSettings(settings);
    setAiSettings(next);
    setAiStatus(testedStatusForSettings(next));
    return next;
  }

  useEffect(() => {
    let mounted = true;
    const isCurrent = operation.capture();
    async function load() {
      setLoading(true);
      const notes: string[] = [];
      try {
        if (canLoadSettings) {
          const settings = await apiSurface.getSettings();
          if (mounted && isCurrent()) {
            const next = normalizeAiSettings(settings);
            setAiSettings(next);
            setAiStatus(testedStatusForSettings(next));
          }
        } else {
          notes.push('getSettings 未接入，AI 设置使用页面默认值。');
        }
        if (canLoadRules) {
          const rules = await apiSurface.getRuleConfig();
          if (mounted && isCurrent()) setRuleConfig(normalizeRuleConfig(rules));
        } else {
          notes.push('getRuleConfig 未接入，阈值使用页面默认值。');
        }
        if (canLoadStoragePaths) {
          const paths = await apiSurface.getStoragePaths();
          if (mounted && isCurrent()) setStoragePaths(paths || {});
        } else {
          notes.push('getStoragePaths 未接入，路径显示为不可用。');
        }
        if (canLoadAiCallLogs) {
          const logs = await apiSurface.listAiCallLogs({ limit: 5 });
          if (mounted && isCurrent()) setAiCallLogs(Array.isArray(logs) ? logs : []);
        }
      } catch (caught) {
        rendererRuntimeLog.error('settings.load_failed', { error: caught });
        notes.push(toUserFacingError(caught, '读取设置失败。'));
      } finally {
        if (mounted && isCurrent()) {
          setMessage(notes.join(' '));
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [apiSurface, canLoadAiCallLogs, canLoadRules, canLoadSettings, canLoadStoragePaths, operationKey]);

  useLayoutEffect(() => {
    setMessage('');
    setCopyNotice('');
    setLoading(true);
    setSettingsModal(null);
    setAiStatus(current => current === 'testing' ? testedStatusForSettings(aiSettings) : current);
  }, [operationKey]);

  useEffect(() => {
    if (!keyPresent && aiStatus !== 'unconfigured') setAiStatus('unconfigured');
    if (keyPresent && aiStatus === 'unconfigured') setAiStatus('pending_test');
  }, [aiStatus, keyPresent]);

  const aiStatusItems = useMemo(
    () => settingsPrimaryAiStatusItems(aiSettings, aiStatus, keyPresent),
    [aiSettings, aiStatus, keyPresent],
  );
  const aiConnectionFeedback = useMemo(
    () => settingsAiConnectionFeedback({
      status: aiStatus,
      keyPresent,
      saving: savingAi,
      message,
    }),
    [aiStatus, keyPresent, message, savingAi],
  );
  const settingsTaskBannerState = useMemo(
    () => buildSettingsTaskBannerState({
      canSaveSettings,
      canTestAi: canRunAiTest,
      keyPresent,
      loading,
      message,
      saving: savingAi,
      status: aiStatus,
    }),
    [aiStatus, canRunAiTest, canSaveSettings, keyPresent, loading, message, savingAi],
  );
  const secondaryStatusMessage = useMemo(
    () => settingsSecondaryStatusMessage(message),
    [message],
  );
  const ruleFieldFeedback = useMemo(
    () => settingsRuleConfigFieldFeedback(ruleConfig),
    [ruleConfig],
  );
  const aiCallDiagnostics = useMemo(
    () => buildAiCallDiagnostics(aiCallLogs),
    [aiCallLogs],
  );
  const ruleFeedbackFor = (field: keyof SettingsRuleConfig) => (
    ruleFieldFeedback[field]
      ? { tone: 'blocked' as const, children: ruleFieldFeedback[field] }
      : undefined
  );

  async function saveAiSettings() {
    if (!canSaveSettings) {
      setMessage('saveSettings 未接入，当前环境只能编辑页面表单。');
      return;
    }
    const ticket = beginSettingsAction('save-ai');
    if (!ticket) return;
    setMessage('');
    try {
      await apiSurface.saveSettings(aiSettings);
      if (!ticket.isCurrent()) return;
      const refreshed = await refreshAiSettingsFromStore(ticket.isCurrent);
      if (!ticket.isCurrent()) return;
      if (!refreshed) {
        const nextSettings = { ...aiSettings, aiApiKey: '', aiKeyConfigured: true };
        setAiSettings(nextSettings);
        setAiStatus(testedStatusForSettings(nextSettings));
      }
      setMessage('AI 设置已保存。API Key 仅显示为已配置状态，不在页面展示明文。');
    } catch (caught) {
      rendererRuntimeLog.error('settings.ai_save_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setMessage(`AI 设置保存失败：${toUserFacingError(caught, 'AI 设置保存失败。')}`);
    } finally {
      finishSettingsAction(ticket);
    }
  }

  async function testAiSettings() {
    if (!canTestAi || !storeContext) {
      setMessage('testAiSettings 未接入，无法在当前环境发起连接测试。');
      return;
    }
    if (!keyPresent) {
      setAiStatus('unconfigured');
      setMessage('请先填写 API Key，再测试连接。');
      return;
    }
    const ticket = beginSettingsAction('test-ai');
    if (!ticket) return;
    setAiStatus('testing');
    setMessage('正在测试 AI 连接...');
    try {
      const result = await apiSurface.testAiSettings({ ...aiSettings, storeContext });
      if (!ticket.isCurrent()) return;
      const success = Boolean(result?.success);
      const resultMessage = readString(result?.message, success ? 'AI 连接可用。' : 'AI 连接失败。');
      const refreshed = await refreshAiSettingsFromStore(ticket.isCurrent);
      if (!ticket.isCurrent()) return;
      if (!refreshed) {
        setAiStatus(success ? 'available' : 'failed');
        setAiSettings((current) => ({
          ...current,
          aiLastTestStatus: success ? 'available' : 'failed',
          aiLastTestAt: new Date().toISOString(),
          aiLastTestBaseUrl: current.aiBaseUrl,
          aiLastTestModel: current.aiModel,
          aiLastTestMessage: resultMessage,
        }));
      }
      setMessage(resultMessage);
    } catch (caught) {
      rendererRuntimeLog.error('settings.ai_test_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setAiStatus('failed');
      setMessage(`AI 连接测试失败：${toUserFacingError(caught, 'AI 连接测试失败。')}`);
    } finally {
      finishSettingsAction(ticket);
    }
  }

  async function clearLocalAiKey() {
    if (!canSaveSettings) {
      setMessage('saveSettings 未接入，无法清除本地 AI Key。');
      return;
    }
    const ticket = beginSettingsAction('clear-ai-key');
    if (!ticket) return;
    setMessage('正在清除本地 AI Key...');
    try {
      await apiSurface.saveSettings({
        ...aiSettings,
        aiApiKey: '',
        ai_key: '',
        clearAiKey: true,
        aiLastTestStatus: '',
        aiLastTestAt: '',
        aiLastTestBaseUrl: '',
        aiLastTestModel: '',
        aiLastTestMessage: '',
      });
      if (!ticket.isCurrent()) return;
      const refreshed = await refreshAiSettingsFromStore(ticket.isCurrent);
      if (!ticket.isCurrent()) return;
      if (!refreshed) {
        setAiSettings({
          ...aiSettings,
          aiApiKey: '',
          aiKeyConfigured: false,
          aiLastTestStatus: '',
          aiLastTestAt: '',
          aiLastTestBaseUrl: '',
          aiLastTestModel: '',
          aiLastTestMessage: '',
        });
        setAiStatus('unconfigured');
      }
      setMessage('AI Key 已清除。需要重新填写并测试后，AI 才会参与建议生成。');
    } catch (caught) {
      rendererRuntimeLog.error('settings.ai_key_clear_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setMessage(`AI Key 清除失败：${toUserFacingError(caught, 'AI Key 清除失败。')}`);
    } finally {
      finishSettingsAction(ticket);
    }
  }

  async function saveRuleConfig() {
    if (!canSaveRules) {
      setMessage('saveRuleConfig 未接入，当前环境只能编辑页面表单。');
      return;
    }
    const validationErrors = validateRuleConfigForSave(ruleConfig);
    if (validationErrors.length > 0) {
      setMessage(`阈值保存已阻断：${validationErrors.join('；')}。`);
      return;
    }
    const ticket = beginSettingsAction('save-rules');
    if (!ticket) return;
    setMessage('');
    try {
      await apiSurface.saveRuleConfig(ruleConfig);
      if (!ticket.isCurrent()) return;
      setMessage('系统回退规则已保存。');
    } catch (caught) {
      rendererRuntimeLog.error('settings.rules_save_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setMessage(`阈值保存失败：${toUserFacingError(caught, '阈值保存失败。')}`);
    } finally {
      finishSettingsAction(ticket);
    }
  }

  async function copyDiagnostics() {
    const ticket = beginSettingsAction('copy-diagnostics');
    if (!ticket) return;
    setCopyNotice('正在复制支持检查清单...');
    try {
      await navigator.clipboard.writeText(DIAGNOSTIC_CHECKS.join('\n'));
      if (!ticket.isCurrent()) return;
      setCopyNotice('支持检查清单已复制。');
    } catch (caught) {
      rendererRuntimeLog.error('settings.copy_diagnostics_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setCopyNotice(`复制失败：${toUserFacingError(caught, '复制失败。')}`);
    } finally {
      finishSettingsAction(ticket);
    }
  }

  function runSettingsTaskAction(kind: SettingsTaskActionKind) {
    if (activeTicket.current?.isCurrent() || loading) return;
    if (kind === 'test-connection') {
      void testAiSettings();
      return;
    }
    setSettingsModal(kind === 'open-contract' ? 'ai-contract' : 'ai-connection');
  }

  return (
    <div>
      {!embedded && (
        <PageHeader
          eyebrow="系统"
          title={PAGE_HEADER_TITLES.settings}
          description="维护系统级 AI 连接和兼容回退规则；店铺运行参数在同页上方按店铺独立保存。API Key 全程脱敏。"
        />
      )}

      <div className="business-stack">
        <TaskBanner
          eyebrow="AI 与规则"
          title={settingsTaskBannerState.title}
          description={settingsTaskBannerState.description}
          tone={settingsTaskBannerState.tone}
          status={<StatusPill tone={settingsTaskBannerState.statusTone}>{settingsTaskBannerState.statusLabel}</StatusPill>}
          primaryAction={{
            label: settingsTaskBannerState.primaryAction.label,
            busy: activeAction === 'test-ai',
            busyLabel: settingsTaskBannerState.primaryAction.busyLabel,
            disabled: operation.busy || loading || settingsTaskBannerState.primaryAction.disabled,
            disabledReason: settingsDisabledReason || settingsTaskBannerState.primaryAction.disabledReason,
            onClick: () => runSettingsTaskAction(settingsTaskBannerState.primaryAction.kind),
          }}
          secondaryActions={settingsTaskBannerState.secondaryActions.map((action) => ({
            label: action.label,
            disabled: operation.busy || loading || action.disabled,
            disabledReason: settingsDisabledReason || action.disabledReason,
            onClick: () => runSettingsTaskAction(action.kind),
          }))}
          meta="API Key 仅由主进程本机安全存储；AI 输出仍受固定合同和人工审批边界约束。"
        />
        {settingsDisabledReason && <p id="settings-operation-reason" role="status">{settingsDisabledReason}</p>}
        {!storeContext && <p className="warning-line">请先选择店铺后测试 AI 连接；系统设置仍可保存。</p>}
        {!canSaveRules && <p className="warning-line">当前应用未提供规则保存接口。</p>}

        <Panel
          title="AI 服务连接"
          titleAccessory={<StatusPill tone={displayAiStatusTone(aiStatus, keyPresent)}>{displayAiStatusLabel(aiStatus, keyPresent)}</StatusPill>}
        >
          <div className={`settings-ai-workbench settings-ai-workbench-${aiConnectionFeedback.tone}`}>
            <div className="settings-ai-workbench-facts">
              {aiStatusItems.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="settings-section-header">
            {loading && <span className="muted-line">正在读取设置...</span>}
          </div>
          {aiActionHint && <p className="muted-line">{aiActionHint}</p>}
          <div className="settings-contract-strip settings-ai-contract-copy-folded">
            <div>
              <span>AI 输出合同</span>
              <strong>系统固定字段，普通用户只看标准结果</strong>
              <p>{settingsAiContractPrimaryCopy()}</p>
            </div>
            <div className="business-pill-row">
              {settingsAiContractTags().map((item) => (
                <StatusPill key={item.label} tone={tagToneToStatusPillTone(item.tone)}>
                  {item.label}
                </StatusPill>
              ))}
            </div>
          </div>
        </Panel>

        {storeContext && <AiSpendPanel key={JSON.stringify(storeContext)} storeContext={storeContext} />}
        <Panel title="系统回退规则（兼容）">
          <div className="settings-rule-summary">
            <div>
              <span>目标利润线</span>
              <strong>目标 ACOS {percentLabel(ruleConfig.targetAcos)}</strong>
              <p>低于目标线的词和投放对象优先保留、观察或扩量复核。</p>
            </div>
            <div>
              <span>风险线</span>
              <strong>高 ACOS {percentLabel(ruleConfig.highAcosThreshold)}</strong>
              <p>超过风险线且花费达到最低门槛时，进入降价或否词建议。</p>
            </div>
            <div>
              <span>无订单浪费</span>
              <strong>{ruleConfig.noOrderClickThreshold} 点击 / {ruleConfig.minSpend} USD</strong>
              <p>达到点击或花费门槛仍无订单时，标记为浪费风险。</p>
            </div>
            <div>
              <span>动作边界</span>
              <strong>每次降价 {percentLabel(ruleConfig.bidAdjustPercent)}</strong>
              <p>单次建议不超过 {percentLabel(ruleConfig.maxBidDecrement)}，且受 CPC 下限保护。</p>
            </div>
          </div>
          <div className="settings-panel-action-line">
            <span>店铺配置会覆盖目标 ACOS 与 AI 开关；这里仅维护未覆盖字段的系统回退值，不会直接写入广告账户。</span>
            <button className="secondary-button" disabled={operation.busy || loading} onClick={() => { if (!activeTicket.current?.isCurrent()) setSettingsModal('rules'); }} type="button">
              编辑规则阈值
            </button>
          </div>
        </Panel>

        <ProgressiveDetails title="高级诊断与本地支持">
          <div className="settings-support-stack">
            <Panel title="AI 调用记录与支持信息">
              <p className="muted-line">{aiAuditIntroText()}</p>
              <div className="context-summary-grid">
                <div>
                  <span>最近 AI 是否参与</span>
                  <strong>{aiCallDiagnostics.headline}</strong>
                  <p>{aiCallDiagnostics.detail}</p>
                  <StatusPill tone={aiCallDiagnostics.status === 'ready' ? 'ready' : aiCallDiagnostics.status === 'blocked' ? 'blocked' : 'warning'}>
                    {aiCallDiagnostics.nextAction}
                  </StatusPill>
                </div>
                <div>
                  <span>日志数量</span>
                  <strong>{aiCallLogs.length} 条</strong>
                  <p>{aiAuditPurposeText()}</p>
                  <StatusPill tone={canLoadAiCallLogs ? 'ready' : 'blocked'}>{canLoadAiCallLogs ? '接口可用' : '接口缺失'}</StatusPill>
                </div>
              </div>
              {!canLoadAiCallLogs && <p className="warning-line">当前环境未暴露 AI 调用审计接口。</p>}
              {canLoadAiCallLogs && aiCallLogs.length === 0 && <p className="muted-line">暂无 AI 调用记录。</p>}
              {aiCallLogs.length > 0 && (
                <div className="context-summary-grid">
                  {aiCallLogs.map((log) => (
                    <div key={log.id}>
                      <span>{aiAuditLogTitle(log)}</span>
                      <strong>{log.model}</strong>
                      <p className="muted-line">{log.createdAt}</p>
                      <p className="muted-line">{aiAuditLogFormatLine(log)}</p>
                      <div className="business-pill-row">
                        <StatusPill tone={log.success ? 'ready' : 'blocked'}>{log.success ? '成功' : '失败'}</StatusPill>
                        <StatusPill tone={aiCallEvidenceTotal(log) ? 'ready' : 'warning'}>{aiCallEvidenceLabel(log)}</StatusPill>
                      </div>
                      {log.errorMessage && <p className="warning-line">{log.errorMessage}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <div className="business-grid">
              <Panel title="安全策略">
                <ul className="business-list">
                  {SAFETY_POLICIES.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Panel>

              <Panel title="本地支持路径">
                <dl className="business-definition-list">
                  <div>
                    <dt>设置路径</dt>
                    <dd>{storagePathDisplay(storagePaths.settingsPath, '设置路径')}</dd>
                  </div>
                  <div>
                    <dt>证据目录</dt>
                    <dd>{storagePathDisplay(storagePaths.evidenceDir, '证据目录')}</dd>
                  </div>
                  <div>
                    <dt>下载目录</dt>
                    <dd>{storagePathDisplay(storagePaths.downloadsDir, '下载目录')}</dd>
                  </div>
                  <div>
                    <dt>导出目录</dt>
                    <dd>{storagePathDisplay(storagePaths.exportsDir, '导出目录')}</dd>
                  </div>
                  <div>
                    <dt>交付包目录</dt>
                    <dd>{storagePathDisplay(storagePaths.deliveryDir, '交付包目录')}</dd>
                  </div>
                  <div>
                    <dt>本地数据库</dt>
                    <dd>{storagePathDisplay(storagePaths.localDbPath, '本地数据库')}</dd>
                  </div>
                </dl>
              </Panel>
            </div>

            <Panel title="支持检查工具">
              <div className="settings-diagnostic-row">
                <p>用于验证 AI 连接、广告解释、Listing 草案和最终交付状态；不会改变广告账户，也不会绕过审批、执行前/执行后/回读或范围匹配要求。</p>
                <button
                  aria-busy={copyDiagnosticsButton.ariaBusy}
                  className={copyDiagnosticsButton.className}
                  disabled={copyDiagnosticsButton.disabled}
                  onClick={copyDiagnostics}
                  type="button"
                >
                  {settingsLocalActionButtonContent(copyDiagnosticsButton)}
                </button>
              </div>
              <div className="details-panel inline-details">
                <strong>诊断覆盖项</strong>
                <div className="details-content">
                  <ul className="business-list">
                    {DIAGNOSTIC_CHECKS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {copyNotice && <p className="muted-line">{copyNotice}</p>}
            </Panel>

            {secondaryStatusMessage && (
              <Panel title="本地接口状态">{secondaryStatusMessage}</Panel>
            )}
          </div>
        </ProgressiveDetails>

        {settingsModal && (
          <div
            className="settings-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeSettingsModal();
            }}
            ref={settingsDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="settings-modal-title"
              aria-modal="true"
              className="settings-modal"
              onMouseDown={(event) => event.stopPropagation()}
              ref={settingsDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="settings-modal-header">
                <div>
                  <span>系统 AI 与回退规则</span>
                  <h2 id="settings-modal-title">
                    {settingsModal === 'ai-contract'
                      ? 'AI 输出合同和字段'
                      : settingsModal === 'ai-connection'
                        ? '编辑 AI 连接和输出参数'
                        : '编辑规则阈值、动作边界和白名单'}
                  </h2>
                </div>
                <button
                  className="secondary-button compact-button"
                  disabled={operation.busy}
                  onClick={closeSettingsModal}
                  type="button"
                >
                  关闭
                </button>
              </header>

              <fieldset className="settings-modal-body" disabled={operation.busy || loading} style={{ border: 0, margin: 0, minWidth: 0 }}>
                {settingsModal === 'ai-contract' && (
                  <>
                    <div className="settings-ai-contract-copy">
                      <span>输出合同</span>
                      <strong>系统固定字段</strong>
                      <p>{settingsAiContractPrimaryCopy()}</p>
                    </div>
                    <TagMetricGroup items={settingsAiContractTags()} />
                    <TagMetricGroup items={settingsAiContractVersionItems()} />
                    <div className="settings-status-grid">
                      <div>
                        <span>输出预算</span>
                        <strong>{clampStructuredAiMaxTokens(aiSettings.aiMaxTokens)} tokens</strong>
                      </div>
                      <div>
                        <span>普通用户视图</span>
                        <strong>只展示标准字段和解释</strong>
                        <p>原始输出只用于诊断，不作为日常操作入口。</p>
                      </div>
                    </div>
                  </>
                )}

                {settingsModal === 'ai-connection' && (
                  <>
                    <FormTable>
                      <FormTableRow label="API Key" labelId={apiKeyLabelId} hintId={apiKeyHintId} required hint="仅保存脱敏状态，页面不展示完整 Key。">
                        <input
                          aria-labelledby={apiKeyLabelId}
                          aria-describedby={apiKeyHintId}
                          aria-required={aiSettings.aiKeyConfigured !== true}
                          autoComplete="off"
                          placeholder="DeepSeek 或 OpenAI Compatible API Key"
                          type="password"
                          value={aiSettings.aiApiKey}
                          onChange={(event) => {
                            const nextKey = event.target.value;
                            setAiSettings(updateAiSettingsField(aiSettings, 'aiApiKey', nextKey));
                            setAiStatus(nextKey.trim() || aiSettings.aiKeyConfigured ? 'pending_test' : 'unconfigured');
                          }}
                        />
                      </FormTableRow>
                      <FormTableRow label="Base URL" required hint="兼容 OpenAI Chat Completions 的服务地址。">
                        <input
                          value={aiSettings.aiBaseUrl}
                          onChange={(event) => {
                            setAiSettings(updateAiSettingsField(aiSettings, 'aiBaseUrl', event.target.value));
                            setAiStatus(keyPresent ? 'pending_test' : 'unconfigured');
                          }}
                          placeholder="https://api.deepseek.com"
                        />
                      </FormTableRow>
                      <FormTableRow label="Model" required hint="广告表现解释、建议说明和 Listing 本地草案共用同一模型配置。">
                        <input
                          value={aiSettings.aiModel}
                          onChange={(event) => {
                            setAiSettings(updateAiSettingsField(aiSettings, 'aiModel', event.target.value));
                            setAiStatus(keyPresent ? 'pending_test' : 'unconfigured');
                          }}
                          placeholder="deepseek-v4-flash"
                        />
                      </FormTableRow>
                    </FormTable>
                    <div className="settings-status-grid">
                      <div>
                        <span>输出语言</span>
                        <strong>{aiSettings.aiOutputLanguage || DEFAULT_AI_SETTINGS.aiOutputLanguage || '简体中文'}</strong>
                      </div>
                      <div>
                        <span>最近测试</span>
                        <strong>{aiSettings.aiLastTestAt ? `${aiSettings.aiLastTestStatus === 'available' ? '通过' : '失败'} / ${aiSettings.aiLastTestMessage || aiSettings.aiLastTestAt}` : '暂无记录'}</strong>
                      </div>
                    </div>
                    <div className="settings-form-grid">
                      <label>
                        Temperature
                        <input
                          type="number"
                          step="0.1"
                          value={aiSettings.aiTemperature}
                          onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiTemperature', event.target.value))}
                        />
                      </label>
                      <label>
                        结构输出预算
                        <input
                          type="number"
                          min={STRUCTURED_AI_OUTPUT_TOKEN_FLOOR}
                          value={aiSettings.aiMaxTokens}
                          onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiMaxTokens', event.target.value))}
                          onBlur={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiMaxTokens', clampStructuredAiMaxTokens(event.target.value)))}
                        />
                      </label>
                      <label>
                        输出语言
                        <input
                          value={aiSettings.aiOutputLanguage || ''}
                          onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiOutputLanguage', event.target.value))}
                          placeholder="简体中文"
                        />
                      </label>
                      <label className="form-grid-wide">
                        <span>AI 人设与表达风格</span>
                        <textarea
                          aria-label="AI 人设与表达风格"
                          value={aiSettings.aiPersona || ''}
                          onChange={(event) => setAiSettings(updateAiSettingsField(aiSettings, 'aiPersona', event.target.value))}
                          placeholder={DEFAULT_AI_PERSONA}
                        />
                      </label>
                    </div>
                  </>
                )}

                {settingsModal === 'rules' && (
                  <FormTable>
                    <FormTableRow label="目标 ACOS" required hint="低于目标线的词和投放对象优先保留、观察或扩量复核。" feedback={ruleFeedbackFor('targetAcos')}>
                      <input
                        type="number"
                        step="0.01"
                        value={ruleConfig.targetAcos}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, targetAcos: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="高 ACOS 阈值" required hint="超过风险线且花费达到最低门槛时，进入降价或否词建议。" feedback={ruleFeedbackFor('highAcosThreshold')}>
                      <input
                        type="number"
                        step="0.01"
                        value={ruleConfig.highAcosThreshold}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, highAcosThreshold: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="无订单点击阈值" required hint="达到点击阈值仍无订单时，标记为浪费风险。" feedback={ruleFeedbackFor('noOrderClickThreshold')}>
                      <input
                        type="number"
                        value={ruleConfig.noOrderClickThreshold}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, noOrderClickThreshold: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="最低花费" required hint="单位 USD；花费低于该值时只提示观察，不生成强动作。" feedback={ruleFeedbackFor('minSpend')}>
                      <input
                        type="number"
                        step="0.01"
                        value={ruleConfig.minSpend}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, minSpend: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="降价比例" required hint="只生成建议，不自动写入 Ads；执行仍走审批和回读。" feedback={ruleFeedbackFor('bidAdjustPercent')}>
                      <input
                        type="number"
                        step="0.01"
                        value={ruleConfig.bidAdjustPercent}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, bidAdjustPercent: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="最大降价比例" required hint="单次建议不超过该比例，且受 CPC 下限保护。" feedback={ruleFeedbackFor('maxBidDecrement')}>
                      <input
                        type="number"
                        step="0.01"
                        value={ruleConfig.maxBidDecrement}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, maxBidDecrement: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="最高 CPC" hint="单位 USD；用于识别异常高出价和建议上限。" feedback={ruleFeedbackFor('maxCpc')}>
                      <input
                        type="number"
                        step="0.01"
                        value={ruleConfig.maxCpc}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, maxCpc: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="最低 CPC" hint="单位 USD；降价建议不会低于该下限。" feedback={ruleFeedbackFor('minCpc')}>
                      <input
                        type="number"
                        step="0.01"
                        value={ruleConfig.minCpc}
                        onChange={(event) => setRuleConfig({ ...ruleConfig, minCpc: Number(event.target.value) })}
                      />
                    </FormTableRow>
                    <FormTableRow label="降价建议" hint="只生成建议，不自动写入 Ads；执行仍走审批和回读。">
                      <input
                        checked={ruleConfig.enableAutoLowerBid}
                        type="checkbox"
                        onChange={(event) => setRuleConfig({ ...ruleConfig, enableAutoLowerBid: event.target.checked })}
                      />
                    </FormTableRow>
                    <FormTableRow label="否词建议" hint="只进入建议池，白名单词会阻断。">
                      <input
                        checked={ruleConfig.enableAutoAddNegative}
                        type="checkbox"
                        onChange={(event) => setRuleConfig({ ...ruleConfig, enableAutoAddNegative: event.target.checked })}
                      />
                    </FormTableRow>
                    <FormTableRow label="品牌词白名单" hint="品牌词用逗号或换行分隔，命中后阻断否词建议。">
                      <textarea
                        aria-label="品牌词白名单"
                        value={listToText(ruleConfig.brandWordWhitelist)}
                        onChange={(event) => {
                          setRuleConfig({ ...ruleConfig, brandWordWhitelist: parseListInput(event.target.value) });
                        }}
                        placeholder="品牌词，用逗号或换行分隔"
                      />
                    </FormTableRow>
                    <FormTableRow label="核心词白名单" hint="核心业务词用逗号或换行分隔，命中后进入人工复核。">
                      <textarea
                        aria-label="核心词白名单"
                        value={listToText(ruleConfig.coreWordWhitelist)}
                        onChange={(event) => {
                          setRuleConfig({ ...ruleConfig, coreWordWhitelist: parseListInput(event.target.value) });
                        }}
                        placeholder="核心业务词，用逗号或换行分隔"
                      />
                    </FormTableRow>
                  </FormTable>
                )}
              </fieldset>
              {settingsDisabledReason && <p role="status">{settingsDisabledReason}</p>}

              <footer className="settings-modal-footer">
                {settingsModal === 'ai-connection' && (
                  <>
                    <button
                      aria-busy={activeAction === 'save-ai' || undefined}
                      className={activeAction === 'save-ai' ? 'primary-button button-loading' : 'primary-button'}
                      disabled={!canSaveSettings || operation.busy || loading}
                      onClick={saveAiSettings}
                      type="button"
                    >
                      {activeAction === 'save-ai' && <span className="button-spinner" aria-hidden="true" />}
                      <span>{activeAction === 'save-ai' ? '保存中...' : '保存 AI 设置'}</span>
                    </button>
                    <button
                      aria-busy={clearAiKeyButton.ariaBusy}
                      className={clearAiKeyButton.className}
                      disabled={clearAiKeyButton.disabled}
                      onClick={clearLocalAiKey}
                      type="button"
                    >
                      {settingsLocalActionButtonContent(clearAiKeyButton)}
                    </button>
                  </>
                )}
                {settingsModal === 'rules' && (
                  <button
                    aria-busy={ruleSaveButton.ariaBusy}
                    className={ruleSaveButton.className}
                    disabled={ruleSaveButton.disabled}
                    onClick={saveRuleConfig}
                    type="button"
                  >
                    {ruleSaveButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{ruleSaveButton.label}</span>
                  </button>
                )}
                <button
                  className="secondary-button"
                  disabled={operation.busy}
                  onClick={closeSettingsModal}
                  type="button"
                >
                  {settingsModal === 'ai-contract' ? '关闭' : '取消'}
                </button>
              </footer>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}

export { type SettingsRuleActionButtonView, type SettingsLocalActionButtonView } from './settings-contracts';

export { settingsRuleConfigFieldFeedback, shouldResetAiTestForSettingsField } from './settings-values';

export { aiAuditIntroText, aiAuditPurposeText, aiAuditLogFormatLine, aiAuditLogTitle, aiSettingsActionHint, storagePathDisplay, settingsAiContractPrimaryCopy, settingsAiContractTags, settingsAiContractVersionItems, settingsPrimaryAiStatusItems, settingsAiTaskTitle, settingsAiConnectionFeedback, buildSettingsTaskBannerState, settingsSecondaryStatusMessage, settingsRuleActionButtonView, settingsLocalActionButtonView } from './settings-presentation';
