import { ProgressiveDetails } from '../components/progressive-details';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { deliveryReadbackVerifierPassed, navigate } from './delivery-actions';
import type { useDeliveryPage } from './delivery-controller';
import { NonReadyDeliveryEvidenceExport } from './delivery-export-control';
import { DELIVERY_BUNDLE_PATH, DeliveryPreviewNotice, deliverySummaryStatusLabel, deliveryTextForDisplay, evidenceGovernanceRules, evidenceGovernanceSummary, gateMessageForDisplay, gateStatusLabel, readinessStatus, reconciliationSourceLabel, statusLabel, summarizeScope } from './delivery-presentation';
import { readbackBlockerSummary, readbackSessionStatusCopy } from './delivery-readback';

export function DeliveryPageView({
  nonReadyEvidenceExportAvailable,
  nonReadyEvidenceExportButton,
  exportNonReadyEvidence,
  deliveryReady,
  missingItems,
  previewState,
  deliveryPrimaryButton,
  deliveryPrimaryAction,
  gateSummaryText,
  deliveryTaskTitle,
  deliveryTaskDetail,
  readiness,
  packageBrief,
  deliveryDataFact,
  secondaryTaskActions,
  actionDisabledReason,
  evidenceGovernanceStatus,
  evidenceGovernanceFacts,
  renderOpenPathButton,
  deliveryBundleOpenPath,
  renderOpenArtifactButton,
  reportFolderArtifact,
  reportManifestArtifact,
  packageDirectory,
  finalManifestPath,
  exportReconciliationButton,
  exportDataReconciliation,
  data,
  scope,
  reportDownloadLabel,
  collectionManifestLabel,
  packageSummary,
  finalReadinessRefresh,
  readbackBlockerGate,
  createReadbackButton,
  createReadbackWorkPackage,
  readbackCandidatePath,
  requestReadbackRepair,
  readbackSession,
  verifyReadbackSessionButton,
  verifyReadbackWorkPackage,
  fillReadbackSessionButton,
  fillReadbackWorkPackage,
  verifyReadbackEvidenceButton,
  verifyGeneratedReadbackEvidence,
  refreshWithReadbackButton,
  refreshFinalReadinessWithReadback,
  readbackSessionCheck,
  readbackSessionFill,
  readbackEvidenceVerify,
  deliveryMatrix,
  dataReconciliation,
  manifestReady,
  items,
  loading,
  message,
}: ReturnType<typeof useDeliveryPage>) {
  return (
    <div aria-busy={loading || undefined}>
      <PageHeader
        eyebrow="系统"
        title={PAGE_HEADER_TITLES.delivery}
        description="判断当前范围能不能交付、最关键阻塞是什么、交付包在哪里，以及可复制给运营的交付摘要。"
      />

      <div className="business-stack delivery-prototype-stack">
        <Panel className="delivery-summary-workbench" title="交付摘要" tone={deliveryReady ? 'success' : missingItems.length ? 'warning' : 'default'}>
          <DeliveryPreviewNotice state={previewState} />
          <div className="action-row delivery-prototype-actions">
            <WorkspaceActionButton
              aria-busy={deliveryPrimaryButton.ariaBusy}
              className={deliveryPrimaryButton.className}
              data-action-priority="primary"
              disabled={deliveryPrimaryButton.disabled}
              disabledReason={deliveryPrimaryButton.disabledReason || actionDisabledReason}
              onClick={deliveryPrimaryAction.onClick}
              type="button"
            >
              {deliveryPrimaryButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              <span>{deliveryPrimaryButton.label}</span>
            </WorkspaceActionButton>
          </div>
          <div className="delivery-summary-hero" aria-label="交付验收结论">
            <div className="delivery-summary-conclusion">
              <div className="delivery-summary-status-row">
                <StatusPill tone={deliveryReady ? 'ready' : missingItems.length ? 'warning' : 'pending'}>
                  {deliverySummaryStatusLabel({ deliveryReady, previewOnly: Boolean(previewState) })}
                </StatusPill>
                <span>{gateSummaryText}</span>
              </div>
              <strong>{deliveryTaskTitle}</strong>
              <p>{deliveryTaskDetail}</p>
            </div>
            <div className="delivery-summary-side">
              <div>
                <span>最终验收</span>
                <strong>{readinessStatus(readiness)}</strong>
                <small>{readiness?.path ? '最终验收汇总已生成' : '等待生成'}</small>
              </div>
              <div>
                <span>交付包</span>
                <strong>{deliveryReady ? '可导出' : '阻断'}</strong>
                <small>{packageBrief}</small>
              </div>
              <div>
                <span>缺口</span>
                <strong>{missingItems.length || 0}</strong>
                <small>{missingItems[0] || '无主要缺口'}</small>
              </div>
            </div>
          </div>
          {deliveryDataFact && (
            <div className="delivery-summary-data-line">
              <span>{deliveryDataFact.label}</span>
              <strong>{deliveryDataFact.value}</strong>
              <small>最终能否交付仍以最终验收汇总和安装包证据为准。</small>
            </div>
          )}
          {deliveryReady ? (
            <p className="muted-line">交付包摘要：{packageBrief}</p>
          ) : (
            <ul className="delivery-action-list delivery-primary-missing-list">
              {(missingItems.length ? missingItems : ['刷新最终验收后查看当前最关键缺口。']).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {secondaryTaskActions.length > 0 && (
            <div className="action-row delivery-prototype-actions">
              {secondaryTaskActions.map((action) => (
                <WorkspaceActionButton
                  aria-busy={action.busy || undefined}
                  className={action.busy ? 'secondary-button button-loading' : 'secondary-button'}
                  disabled={action.disabled}
                  disabledReason={actionDisabledReason}
                  key={action.label}
                  onClick={action.onClick}
                  type="button"
                >
                  {action.busy && <span className="button-spinner" aria-hidden="true" />}
                  <span>{action.busy ? action.busyLabel || action.label : action.label}</span>
                </WorkspaceActionButton>
              ))}
            </div>
          )}
          <NonReadyDeliveryEvidenceExport available={nonReadyEvidenceExportAvailable}
            button={nonReadyEvidenceExportButton} onExport={exportNonReadyEvidence} />
        </Panel>
      </div>

      <div className="business-stack delivery-details-stack">
        <ProgressiveDetails title="交付判断依据与证据治理">
          <Panel title="交付判断依据" tone={evidenceGovernanceStatus === 'ready' ? 'success' : evidenceGovernanceStatus === 'blocked' ? 'blocked' : 'warning'}>
            <div className="evidence-governance-card">
              <div className="evidence-governance-headline">
                <StatusPill tone={evidenceGovernanceStatus === 'ready' ? 'ready' : evidenceGovernanceStatus === 'blocked' ? 'blocked' : 'warning'}>
                  {evidenceGovernanceStatus === 'ready' ? '权威证据已绑定' : evidenceGovernanceStatus === 'blocked' ? '证据治理阻断' : '证据需复核'}
                </StatusPill>
                <p>{evidenceGovernanceSummary(readiness)}</p>
              </div>
              <div className="delivery-meta-grid evidence-governance-grid">
                {evidenceGovernanceFacts.map((fact) => (
                  <div key={fact.label}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </div>
                ))}
              </div>
              <ul className="delivery-action-list evidence-governance-rules">
                {evidenceGovernanceRules(readiness).map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="文件位置与支持入口">
          <div className="delivery-action-row">
            {renderOpenPathButton({ idleLabel: '打开交付包', targetPath: deliveryBundleOpenPath })}
            {renderOpenArtifactButton({ artifactId: reportFolderArtifact?.artifactId, idleLabel: '打开证据目录' })}
            {renderOpenArtifactButton({ artifactId: reportManifestArtifact?.artifactId, idleLabel: '打开采集清单' })}
            {renderOpenPathButton({ disabled: !packageDirectory, idleLabel: '打开安装包目录', targetPath: packageDirectory })}
            {renderOpenPathButton({ idleLabel: '打开最终验收汇总', targetPath: finalManifestPath })}
            <WorkspaceActionButton disabledReason={exportReconciliationButton.disabledReason || actionDisabledReason} aria-busy={exportReconciliationButton.ariaBusy} className={exportReconciliationButton.className} disabled={exportReconciliationButton.disabled} onClick={exportDataReconciliation} type="button">
              {exportReconciliationButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              <span>{exportReconciliationButton.label}</span>
            </WorkspaceActionButton>
          </div>
          <div className="delivery-meta-grid">
            <div>
              <span>运营范围</span>
              <strong>{summarizeScope(data, scope)}</strong>
            </div>
            <div>
              <span>真实文件目录</span>
              <strong>{reportDownloadLabel}</strong>
            </div>
            <div>
              <span>采集清单</span>
              <strong>{collectionManifestLabel}</strong>
            </div>
            <div>
              <span>最终验收汇总</span>
              <strong>{finalManifestPath || deliveryTextForDisplay(readiness?.message || '') || '最终验收汇总尚未生成'}</strong>
            </div>
            <div>
              <span>安装包路径与校验码</span>
              <strong>{packageSummary}</strong>
            </div>
            <div>
              <span>交付包目标</span>
              <strong>{deliveryBundleOpenPath}</strong>
            </div>
          </div>
        </ProgressiveDetails>

        {finalReadinessRefresh && (
          <ProgressiveDetails title="最终验收刷新结果">
            <div className="delivery-meta-grid">
              <div>
                <span>证据汇总</span>
                <strong>{finalReadinessRefresh.evidenceManifestPath || '-'}</strong>
              </div>
              <div>
                <span>最终验收</span>
                <strong>{finalReadinessRefresh.finalReadinessPath || '-'}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{readinessStatus(finalReadinessRefresh.readiness || null)}</strong>
              </div>
              <div>
                <span>验收项</span>
                <strong>{finalReadinessRefresh.readiness?.gatesSummary ? `${finalReadinessRefresh.readiness.gatesSummary.passed}/${finalReadinessRefresh.readiness.gatesSummary.total} 通过` : '-'}</strong>
              </div>
            </div>
            <p className={finalReadinessRefresh.readiness?.appReady ? 'muted-line' : 'blocked-line'}>
              {finalReadinessRefresh.readiness?.appReady
                ? '最终验收已通过；导出可交付包前仍需确认 README 交付状态和安装包校验码。'
                : '最终验收已生成诊断文件，但仍有验收项未通过，不能声明可交付。'}
            </p>
          </ProgressiveDetails>
        )}

        {readbackBlockerGate && (
          <ProgressiveDetails title="广告回读补证">
            <div className="delivery-readiness-row">
              <div>
                <StatusPill tone="blocked">阻断</StatusPill>
                <p className="delivery-readiness-copy">最终验收当前卡在真实广告回读。需要为这个候选动作补齐审批、执行前/执行后截图和刷新回读证据。</p>
                <p className="blocked-line">{readbackBlockerSummary(readbackBlockerGate)}</p>
              </div>
              <div className="delivery-action-row">
                {deliveryPrimaryAction.kind !== 'create-readback' && (
                  <WorkspaceActionButton disabledReason={createReadbackButton.disabledReason || actionDisabledReason} aria-busy={createReadbackButton.ariaBusy} className={createReadbackButton.className} disabled={createReadbackButton.disabled} onClick={createReadbackWorkPackage} type="button">
                    {createReadbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{createReadbackButton.label}</span>
                  </WorkspaceActionButton>
                )}
                {renderOpenPathButton({ disabled: !readbackCandidatePath, idleLabel: '打开候选证据', messageLabel: '打开回读候选证据', targetPath: readbackCandidatePath })}
                <button className="secondary-button" onClick={requestReadbackRepair} type="button">
                  直达补执行证据
                </button>
              </div>
            </div>
            {readbackSession && (
              <Panel title="回读工作包路径">
                <div className="delivery-meta-grid">
                  <div>
                    <span>工作包目录</span>
                    <strong>{readbackSession.sessionDir || '-'}</strong>
                  </div>
                  <div>
                    <span>待填写文件</span>
                    <strong>{readbackSession.sessionInputPath || '-'}</strong>
                  </div>
                  <div>
                    <span>填写说明</span>
                    <strong>{readbackSession.sessionInputGuidePath || '-'}</strong>
                  </div>
                  <div>
                    <span>操作清单</span>
                    <strong>{readbackSession.checklistPath || '-'}</strong>
                  </div>
                  <div>
                    <span>广告后台定位单</span>
                    <strong>{readbackSession.locatorGuidePath || '-'}</strong>
                  </div>
                  <div>
                    <span>最终证据输出</span>
                    <strong>{readbackSession.passEvidencePath || '-'}</strong>
                  </div>
                </div>
              </Panel>
            )}
            {readbackSession?.sessionDir && (
              <div className="delivery-action-row">
                {renderOpenPathButton({ idleLabel: '打开回读工作包', targetPath: readbackSession.sessionDir || '' })}
                {renderOpenPathButton({ idleLabel: '打开操作清单', targetPath: readbackSession.checklistPath || '' })}
                {renderOpenPathButton({ idleLabel: '打开广告后台定位单', targetPath: readbackSession.locatorGuidePath || '' })}
                {renderOpenPathButton({ idleLabel: '打开待填写文件', targetPath: readbackSession.sessionInputPath || '' })}
                {renderOpenPathButton({ idleLabel: '打开填写说明', targetPath: readbackSession.sessionInputGuidePath || '' })}
                <WorkspaceActionButton disabledReason={verifyReadbackSessionButton.disabledReason || actionDisabledReason} aria-busy={verifyReadbackSessionButton.ariaBusy} className={verifyReadbackSessionButton.className} disabled={verifyReadbackSessionButton.disabled} onClick={verifyReadbackWorkPackage} type="button">
                  {verifyReadbackSessionButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{verifyReadbackSessionButton.label}</span>
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={fillReadbackSessionButton.disabledReason || actionDisabledReason} aria-busy={fillReadbackSessionButton.ariaBusy} className={fillReadbackSessionButton.className} disabled={fillReadbackSessionButton.disabled} onClick={fillReadbackWorkPackage} type="button">
                  {fillReadbackSessionButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{fillReadbackSessionButton.label}</span>
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={verifyReadbackEvidenceButton.disabledReason || actionDisabledReason} aria-busy={verifyReadbackEvidenceButton.ariaBusy} className={verifyReadbackEvidenceButton.className} disabled={verifyReadbackEvidenceButton.disabled} onClick={verifyGeneratedReadbackEvidence} type="button">
                  {verifyReadbackEvidenceButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{verifyReadbackEvidenceButton.label}</span>
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={refreshWithReadbackButton.disabledReason || actionDisabledReason} aria-busy={refreshWithReadbackButton.ariaBusy} className={refreshWithReadbackButton.className} disabled={refreshWithReadbackButton.disabled} onClick={refreshFinalReadinessWithReadback} type="button">
                  {refreshWithReadbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{refreshWithReadbackButton.label}</span>
                </WorkspaceActionButton>
              </div>
            )}
            {readbackSessionCheck && (
              <div className={`readback-session-check ${readbackSessionStatusCopy(readbackSessionCheck).className}`}>
                <strong>工作包检查：{readbackSessionStatusCopy(readbackSessionCheck).title}</strong>
                <span>{readbackSessionStatusCopy(readbackSessionCheck).detail}</span>
                {readbackSessionCheck.ready && !readbackSessionCheck.captureReady && (
                  <p className="muted-line">这只证明目录、清单、定位单和输出路径可用；最终仍必须填写现场审批、执行前/执行后、执行和回读字段。</p>
                )}
              </div>
            )}
            {readbackSessionFill && (
              <div className={`readback-session-check ${readbackSessionFill.readyForVerifier ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                <strong>回读证据生成：{readbackSessionFill.readyForVerifier ? '可校验' : '未通过'}</strong>
                <span>{readbackSessionFill.readyForVerifier ? (readbackSessionFill.jsonPath || '-') : (readbackSessionFill.issues || []).slice(0, 3).join('；')}</span>
              </div>
            )}
            {readbackEvidenceVerify && (
              <div className={`readback-session-check ${deliveryReadbackVerifierPassed(readbackEvidenceVerify) ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                <strong>回读证据校验：{deliveryReadbackVerifierPassed(readbackEvidenceVerify) ? '通过' : '未通过'}</strong>
                <span>{(readbackEvidenceVerify.issues || readbackEvidenceVerify.blockers || []).slice(0, 3).join('；') || '校验结果已返回。'}</span>
              </div>
            )}
          </ProgressiveDetails>
        )}

        <ProgressiveDetails title={`业务闭环矩阵：已闭合 ${deliveryMatrix.readyCount}/${deliveryMatrix.totalCount}`}>
          <div className="delivery-readiness-row">
            <div>
              <StatusPill tone={deliveryMatrix.status === 'ready' ? 'ready' : deliveryMatrix.status === 'blocked' ? 'blocked' : 'warning'}>
                {deliveryMatrix.status === 'ready' ? '证据闭环' : deliveryMatrix.status === 'blocked' ? '当前范围阻断' : '仍需补齐'}
              </StatusPill>
              <p className="delivery-readiness-copy">{deliveryMatrix.headline}</p>
              <p className="muted-line">矩阵只说明当前日期、店铺、站点和批次的业务环节；最终是否可交付仍以最终验收汇总为准。</p>
            </div>
            <div className="delivery-action-row">
              <button className="primary-button" onClick={() => navigate(data === null ? 'settings' : deliveryMatrix.status === 'blocked' ? 'data-collection' : 'delivery')} type="button">
                {deliveryMatrix.primaryNextAction}
              </button>
            </div>
          </div>
          <div className="context-summary-grid">
            {deliveryMatrix.items.map((item) => (
              <button className="context-action-card" key={item.key} onClick={() => navigate(item.route)} type="button">
                <span>{item.label}</span>
                <strong>{item.statusLabel}</strong>
                <p>{item.detail}</p>
                <StatusPill tone={item.tone}>{item.nextAction}</StatusPill>
              </button>
            ))}
          </div>
        </ProgressiveDetails>

        {dataReconciliation && (
          <ProgressiveDetails title="数据口径导出结果">
            <div className="delivery-meta-grid">
              <div>
                <span>权威口径</span>
                <strong>{reconciliationSourceLabel(dataReconciliation.canonicalSource)}</strong>
              </div>
              <div>
                <span>DB 汇总</span>
                <strong>
                  {dataReconciliation.canonical?.rows ?? 0} 行 / {Number(dataReconciliation.canonical?.spend || 0).toFixed(2)} USD / {dataReconciliation.canonical?.orders ?? 0} 单
                </strong>
              </div>
              <div>
                <span>报告数据文件</span>
                <strong>{dataReconciliation.jsonPath || '-'}</strong>
              </div>
              <div>
                <span>报告说明文件</span>
                <strong>{dataReconciliation.markdownPath || '-'}</strong>
              </div>
            </div>
            {Boolean(dataReconciliation.blockers?.length) && (
              <ul className="delivery-action-list">
                {dataReconciliation.blockers?.slice(0, 6).map((item) => (
                  <li key={item}>{deliveryTextForDisplay(item)}</li>
                ))}
              </ul>
            )}
            <div className="delivery-action-row">
              {renderOpenPathButton({ disabled: !dataReconciliation.markdownPath, idleLabel: '打开说明文件', messageLabel: '打开数据口径核对说明文件', targetPath: dataReconciliation.markdownPath || '' })}
              {renderOpenPathButton({ disabled: !dataReconciliation.jsonPath, idleLabel: '打开数据文件', messageLabel: '打开数据口径核对数据文件', targetPath: dataReconciliation.jsonPath || '' })}
            </div>
          </ProgressiveDetails>
        )}

        <ProgressiveDetails title="最终证据清单">
          <p className="muted-line">这里列出最终验收汇总采用的证据文件。当前范围的数据卡片只说明本地数据状态，不能替代这些验收项。</p>
          {readiness?.gates?.length ? (
            <div className="delivery-gate-list">
              {readiness.gates.map((gate) => (
                <div className="delivery-gate-row" key={`${gate.name}-${gate.evidencePath || 'missing'}`}>
                  <div>
                    <strong>{gate.name}</strong>
                    <span>{gateMessageForDisplay(gate, Boolean(manifestReady))}</span>
                  </div>
                  <StatusPill tone={gate.ok ? 'ready' : 'blocked'}>{gateStatusLabel(gate)}</StatusPill>
                  <code>{gate.evidencePath || '未绑定证据路径'}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="blocked-line">尚未读取到最终验收项。需要先生成最终验收汇总。</p>
          )}
        </ProgressiveDetails>

        <ProgressiveDetails title="完整业务证据项">
          <div className="delivery-section-grid">
            {items.map((item) => (
              <Panel key={item.title} title={item.title} tone={item.tone === 'ready' ? 'success' : item.tone === 'blocked' ? 'blocked' : item.tone === 'warning' ? 'warning' : 'default'}>
                <div className="delivery-card-header">
                  <StatusPill tone={item.tone}>{statusLabel(item.tone)}</StatusPill>
                </div>
                <p>{item.summary}</p>
                <ul className="delivery-action-list">
                  {item.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
                {item.evidence && item.evidence.length > 0 && (
                  <div className="delivery-evidence-list">
                    {item.evidence.map((entry) => (
                      <span key={entry}>{entry}</span>
                    ))}
                  </div>
                )}
              </Panel>
            ))}
          </div>
        </ProgressiveDetails>

        <ProgressiveDetails title="技术支持细节">
          <div className="details-content">
            <p>数据管道生成时间：{data?.generatedAt || (loading ? '读取中...' : '不可用')}</p>
            <p>最终验收生成时间：{readiness?.generatedAt || '不可用'}</p>
            <p>最终验收检查时间：{readiness?.checkedAt || '不可用'}</p>
            <p>验收项汇总：{readiness?.gatesSummary ? `${readiness.gatesSummary.passed}/${readiness.gatesSummary.total} 通过` : '不可用'}</p>
            <p>证据目录工件：{reportDownloadLabel}</p>
            <p>采集清单工件：{collectionManifestLabel}</p>
            <p>交付包目标：{DELIVERY_BUNDLE_PATH}</p>
          </div>
        </ProgressiveDetails>

        {message && <Panel title="交付消息">{message}</Panel>}
      </div>
    </div>
  );
}
