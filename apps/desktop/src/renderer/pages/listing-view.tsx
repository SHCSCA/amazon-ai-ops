import { BusinessDataConfigurationNotice } from '../components/business-data-configuration';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { ensureFiveBullets, listingManualFieldGroups } from './listing-content';
import { readStatus, listingHeatmapKeywordButtonClass, listingHeatmapSectionClass, listingDraftPanelClass, listingCharacterLimitClass, sectionLabel, draftSourceLabel } from './listing-presentation';
import { includesKeyword } from './listing-heatmap';
import { buildListingTextDiffSegments } from './listing-text-diff';
import type { useListingOptimizationPage } from './listing-controller';

export function ListingOptimizationPageView({
  configurationRequired,
  workflowSummary,
  listingTaskModel,
  workflowBlocker,
  loading,
  listingActionBusy,
  canReadLingxing,
  runListingTaskIntent,
  listingSecondaryActions,
  keywords,
  listingReady,
  listingProbeAttempted,
  listing,
  listingSourceStatus,
  draftReady,
  aiStatus,
  data,
  scope,
  manualListing,
  pageMatched,
  expectedAsin,
  titleRead,
  bulletsRead,
  backendTermsRead,
  listingVersions,
  setListingEditorOpen,
  historyRefreshButton,
  editorHistoryRefreshButton,
  refreshListingVersions,
  readLingxingButton,
  readFromLingxing,
  asinMatched,
  detailProbeStatus,
  readEvidence,
  listingScopeMatched,
  currentScopeText,
  readScopeText,
  listingReadinessIssues,
  handoffPayload,
  drafts,
  draftWorkspaceCopy,
  handoffScopeText,
  handoffContext,
  heatmapModel,
  selectedHeatmapKeyword,
  pulsingHeatmapKeyword,
  heatmapPulseSerial,
  focusHeatmapKeyword,
  renderHeatmapSegments,
  renderListingDiffPreview,
  heatmapFocusAnnouncement,
  setKeywordEditorOpen,
  quantReady,
  aiDraftCount,
  ruleDraftCount,
  generateDraftButton,
  generateDrafts,
  exportDraftButton,
  exportDrafts,
  listingEditorOpen,
  closeListingEditor,
  listingEditorDialogFocus,
  renderManualListingField,
  saveManualButton,
  saveManualListing,
  keywordEditorOpen,
  closeKeywordEditor,
  listingKeywordDialogFocus,
  keywordsText,
  setKeywordsText,
  message,
}: ReturnType<typeof useListingOptimizationPage>) {
  return (
    <div>
      <PageHeader
        eyebrow="增长"
        title={PAGE_HEADER_TITLES.listingOptimization}
        description="录入或辅助读取当前 Listing，结合关键词机会检查覆盖，生成只供本地复核和导出的草案；不会提交 Amazon，也不会改写 Lingxing。"
      />
      {configurationRequired && <BusinessDataConfigurationNotice />}

      <div className="business-stack listing-optimization-page-stack">
        <TaskBanner
          description={(
            <>
              <strong>{workflowSummary.headline}</strong>
              <p>{listingTaskModel.description}</p>
            </>
          )}
          eyebrow="本地草案工作流"
          meta={<span>关键词交接与发布边界。当前下一步：{workflowSummary.nextAction || workflowBlocker} {listingTaskModel.publishBoundary}</span>}
          primaryAction={{
            busy: listingTaskModel.primaryBusy,
            busyLabel: '处理中...',
            disabled: listingActionBusy && !listingTaskModel.primaryBusy,
            disabledReason: '当前 Listing 动作正在处理，请等待完成后继续。',
            label: listingTaskModel.primaryLabel,
            onClick: () => runListingTaskIntent(listingTaskModel.primaryIntent),
          }}
          secondaryActions={listingSecondaryActions}
          status={<StatusPill tone={listingTaskModel.tone === 'confirmed' ? 'ready' : listingTaskModel.tone === 'blocked' ? 'blocked' : 'pending'}>{listingTaskModel.statusLabel}</StatusPill>}
          title={`当前草案任务：${listingTaskModel.title}`}
          tone={listingTaskModel.tone}
        >
          <ol className="listing-progress-rail" aria-label="Listing 草案四步进度">
            <li className={keywords.length ? 'is-ready' : 'is-pending'}>
              <span>1</span>
              <strong>关键词</strong>
              <em>{keywords.length ? '已就绪' : '待输入'}</em>
            </li>
            <li className={listingReady ? 'is-ready' : listingProbeAttempted || listing ? 'is-warning' : 'is-pending'}>
              <span>2</span>
              <strong>Listing</strong>
              <em>{listingSourceStatus.label}</em>
            </li>
            <li className={draftReady ? 'is-ready' : listingReady && keywords.length ? 'is-pending' : 'is-blocked'}>
              <span>3</span>
              <strong>草案</strong>
              <em>{draftReady ? '已生成' : aiStatus.label}</em>
            </li>
            <li className={draftReady ? 'is-ready' : 'is-pending'}>
              <span>4</span>
              <strong>导出</strong>
              <em>{draftReady ? '可导出' : '待草案'}</em>
            </li>
          </ol>
        </TaskBanner>

        <ProgressiveDetails title="录入、辅助读取和维护当前 Listing">
        <Panel className="listing-editor-panel listing-editor-entry-panel" title="当前 Listing 维护" tone={listing ? (listingReady ? 'success' : 'warning') : 'warning'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">主界面只确认当前 Listing 状态；标题、五点、A+ 和后台词维护进入弹窗编辑。</p>
              <p className="blocked-line">本功能只保存本地版本，不会自动提交 Amazon，也不会改写 Lingxing。</p>
            </div>
            <StatusPill tone={listingReady ? 'ready' : listing ? 'warning' : 'pending'}>{listingSourceStatus.label}</StatusPill>
          </div>
          <div className="listing-editor-summary-grid">
            <div>
              <span>ASIN</span>
              <strong>{manualListing.asin || listing?.asin || scope.asin || '-'}</strong>
              <p>{pageMatched ? '页面 ASIN 已匹配' : expectedAsin ? `目标 ${expectedAsin}` : '待确认当前产品'}</p>
            </div>
            <div>
              <span>标题</span>
              <strong>{manualListing.title || listing?.title || '未维护'}</strong>
              <p>{titleRead ? '已有标题内容' : '生成草案前需补齐'}</p>
            </div>
            <div>
              <span>五点</span>
              <strong>{ensureFiveBullets(manualListing.bullets || listing?.bullets).filter((item) => item.trim()).length}/5</strong>
              <p>{bulletsRead ? '五点内容已读取或维护' : '建议补齐五点'}</p>
            </div>
            <div>
              <span>后台词</span>
              <strong>{manualListing.backendTerms || listing?.backendTerms ? '已维护' : '未维护'}</strong>
              <p>{backendTermsRead ? '可用于覆盖检查' : '生成草案前建议补齐'}</p>
            </div>
            <div>
              <span>版本历史</span>
              <strong>{listingVersions.length}</strong>
              <p>本地版本用于对比修改，不自动提交。</p>
            </div>
          </div>
          <div className="action-row">
            <button className="primary-button" onClick={() => setListingEditorOpen(true)} type="button">
              编辑当前 Listing
            </button>
            <WorkspaceActionButton disabledReason={listingActionBusy ? '当前 Listing 动作正在处理，请等待完成。' : '请先在 Listing 编辑中填写 ASIN，再刷新本地历史。'}
              aria-busy={historyRefreshButton.ariaBusy}
              className={historyRefreshButton.className}
              disabled={(historyRefreshButton.disabled) || listingActionBusy}
              onClick={() => {
                void refreshListingVersions();
              }}
              type="button"
            >
              {historyRefreshButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{historyRefreshButton.label}</span>
            </WorkspaceActionButton>
          </div>
        </Panel>

        <Panel className="listing-read-panel" title="从领星辅助读取" tone={listing ? (listingReady ? 'success' : 'warning') : listingProbeAttempted ? 'warning' : 'default'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">领星字段读取不完整时，不再阻断流程。读取成功后只填入上方手工表单，仍需人工保存为版本。</p>
              <p className="blocked-line">辅助读取不会自动提交 Amazon，也不会直接覆盖已保存版本。</p>
            </div>
            <StatusPill tone={listingSourceStatus.tone}>{listingSourceStatus.label}</StatusPill>
          </div>
          <div className="action-row">
            <WorkspaceActionButton disabledReason={!canReadLingxing ? '当前版本请打开 Listing 编辑，手工录入并保存本地内容。' : '当前 Listing 动作正在处理，请等待完成。'} aria-busy={readLingxingButton.ariaBusy} className={readLingxingButton.className} disabled={(readLingxingButton.disabled) || listingActionBusy} onClick={() => void readFromLingxing('panel-read')} type="button">
              {readLingxingButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
              <span>{readLingxingButton.label}</span>
            </WorkspaceActionButton>
          </div>
          <div className="evidence-grid">
            <div><span>ASIN matched/status</span><strong>{listing ? `${asinMatched ? 'ASIN 匹配' : 'ASIN 待核对'}${detailProbeStatus ? ` / ${detailProbeStatus}` : ''}` : listingProbeAttempted ? `ASIN 缺失${detailProbeStatus ? ` / ${detailProbeStatus}` : ''}` : '未读取'}</strong></div>
            <div><span>Title read</span><strong>{readStatus(titleRead, listingSourceStatus.missingFieldLabel)}</strong></div>
            <div><span>Bullets read</span><strong>{readStatus(bulletsRead, listingSourceStatus.missingFieldLabel)}</strong></div>
            <div><span>Backend terms read</span><strong>{readStatus(backendTermsRead, listingSourceStatus.missingFieldLabel)}</strong></div>
            <div><span>范围核对</span><strong>{readEvidence ? (listingScopeMatched ? '店铺/站点匹配' : '店铺/站点待核对') : '未读取'}</strong></div>
            <div><span>当前店铺/站点</span><strong>{currentScopeText}</strong></div>
            <div><span>读取店铺/站点</span><strong>{readScopeText}</strong></div>
            <div><span>Page URL</span><strong>{readEvidence?.pageUrl || listing?.pageUrl || '-'}</strong></div>
            <div><span>Screenshot path</span><strong>{readEvidence?.screenshotPath || listing?.screenshotPath || '-'}</strong></div>
          </div>
          <div className="inline-alert">
            <strong>Listing 读取缺口</strong>
            <p>
              {listingReadinessIssues.length
                ? `生成草案前需补齐：${listingReadinessIssues.join('、')}。`
                : '无，当前页面已满足草案门槛。'}
            </p>
          </div>
          {readEvidence && !listingScopeMatched && (
            <p className="warning-line">Listing 读取范围未能证明匹配当前店铺/站点：请确认当前范围后重新读取。</p>
          )}
          {listing && !listingReady && (
            <p className="warning-line">详情页已读取但 Listing 内容不完整：生成草案前必须核对 ASIN、标题、五点和后台词。</p>
          )}
          {!listing && listingProbeAttempted && (
            <p className="warning-line">页面已探测但内容未完整读取：已保留截图和页面 URL；请确认当前页是领星 Listing 详情页，并等待 ASIN、标题、五点和后台词加载后重新读取。</p>
          )}
        </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="关键词交接与发布边界">
          <Panel className="listing-boundary-panel" title="交接与边界详情" tone={keywords.length ? 'success' : 'warning'}>
            <p className="muted-line">关键词交接与发布边界：以下信息只用于核对来源、范围和本地草案用途。</p>
            <div className="context-summary-grid">
              <div>
                <span>关键词来源</span>
                <strong>{handoffPayload ? '关键词机会页' : '手工输入/待带入'}</strong>
                <p>{handoffPayload ? '来自当前范围真实广告指标的机会池。' : '建议先从关键词机会页按 ASIN 带入，减少跨产品误用。'}</p>
              </div>
              <div>
                <span>带入 ASIN</span>
                <strong>{expectedAsin || '-'}</strong>
                <p>读取 Listing 后必须核对页面 ASIN 与该 ASIN 一致。</p>
              </div>
              <div>
                <span>关键词数量</span>
                <strong>{keywords.length}</strong>
                <p>生成草案前应删除不相关词和竞品误匹配词。</p>
              </div>
              <div>
                <span>草案来源</span>
                <strong>{drafts.length ? draftWorkspaceCopy.sourceLabel : '未生成'}</strong>
                <p>DeepSeek 不可用时会标记本地规则参考，不能当作 AI 已验证。</p>
              </div>
              <div>
                <span>AI 连接</span>
                <strong>{aiStatus.label}</strong>
                <p>{aiStatus.detail}</p>
              </div>
            </div>
            <p className="muted-line">交接范围：{handoffScopeText}</p>
            {handoffContext && (
              <div className="detail-grid evidence-grid">
                <div><span>广告组合</span><strong>{handoffContext.portfolioName || '-'}</strong></div>
                <div><span>广告活动</span><strong>{handoffContext.campaignName || '-'}</strong></div>
                <div><span>广告组</span><strong>{handoffContext.adGroupName || '-'}</strong></div>
                <div><span>对象类型</span><strong>{handoffContext.entityType || '-'}</strong></div>
                <div><span>触发关键词</span><strong>{handoffContext.keyword || '-'}</strong></div>
                <div><span>点击/订单</span><strong>{handoffContext.clicks ?? '-'} / {handoffContext.orders ?? '-'}</strong></div>
                <div><span>花费/销售 USD</span><strong>{handoffContext.spend ?? '-'} / {handoffContext.sales ?? '-'}</strong></div>
                <div><span>来源文件</span><strong><code>{handoffContext.sourceFile || '-'}</code></strong></div>
              </div>
            )}
            <p className="blocked-line">本页只生成本地草案和导出文件，不提交 Amazon，不修改 Lingxing Listing。</p>
          </Panel>
        </ProgressiveDetails>

        <Panel className="listing-heatmap-panel" title="核心商机词根覆盖" tone={heatmapModel.summary.keywordCount ? (heatmapModel.summary.missingCount ? 'warning' : 'success') : 'warning'}>
          <div className="business-split">
            <div>
              <p className="muted-line">用关键词机会或手工词根检查标题、五点、后台词和详情/A+ 的覆盖情况；无词根时只保留录入入口。</p>
              <p className="blocked-line">热力图只做本地覆盖复核，不提交 Amazon，不自动改写 Lingxing Listing。</p>
            </div>
            <StatusPill tone={heatmapModel.summary.missingCount ? 'warning' : heatmapModel.summary.keywordCount ? 'ready' : 'pending'}>
              {heatmapModel.summary.keywordCount ? `${heatmapModel.summary.coveredCount}/${heatmapModel.summary.keywordCount} 已覆盖` : '待输入词根'}
            </StatusPill>
          </div>
          {heatmapModel.keywords.length ? (
            <>
              <div className="listing-heatmap-grid">
                <aside className="listing-heatmap-keyword-rail" aria-label="核心商机词根">
                  <div className="listing-heatmap-summary">
                    <div><span>词根</span><strong>{heatmapModel.summary.keywordCount}</strong></div>
                    <div><span>草案新增</span><strong>{heatmapModel.summary.draftGainCount}</strong></div>
                    <div><span>待融入</span><strong>{heatmapModel.summary.missingCount}</strong></div>
                  </div>
                  {heatmapModel.keywords.map((item) => (
                    <button
                      aria-pressed={selectedHeatmapKeyword === item.keyword}
                      className={listingHeatmapKeywordButtonClass(
                        item.level,
                        selectedHeatmapKeyword === item.keyword,
                        pulsingHeatmapKeyword === item.keyword,
                        heatmapPulseSerial,
                      )}
                      key={item.keyword}
                      onClick={() => focusHeatmapKeyword(item.keyword)}
                      type="button"
                    >
                      <span>{item.keyword}</span>
                      <strong>{item.score}</strong>
                      <small>{item.levelLabel} / 建议 {item.recommendedSection}</small>
                    </button>
                  ))}
                </aside>
                <div className="listing-heatmap-matrix">
                  {heatmapModel.sections.map((section) => {
                    const activeHit = Boolean(selectedHeatmapKeyword && (
                      includesKeyword(section.currentText, selectedHeatmapKeyword)
                      || includesKeyword(section.draftText, selectedHeatmapKeyword)
                    ));
                    const pulsingSection = Boolean(activeHit && pulsingHeatmapKeyword);
                    const diff = buildListingTextDiffSegments(section.currentText, section.draftText);
                    const draftLength = section.draftText.length;
                    const draftGenerating = loading === 'draft';
                    return (
                      <section className={listingHeatmapSectionClass(activeHit, pulsingSection, heatmapPulseSerial)} key={section.key}>
                        <div className="listing-heatmap-section-head">
                          <div>
                            <span>{section.label}</span>
                            <strong>{section.draftHits.length ? `命中 ${section.draftHits.length} 个词根` : '未命中词根'}</strong>
                          </div>
                          <StatusPill tone={section.draftHits.length ? 'ready' : section.currentText ? 'warning' : 'pending'}>
                            {activeHit ? '当前命中' : section.draftHits.length ? '有覆盖' : '待覆盖'}
                          </StatusPill>
                        </div>
                        <div className="listing-heatmap-text-grid">
                          <div>
                            <span>线上原文</span>
                            <p>{renderHeatmapSegments(section.currentText, selectedHeatmapKeyword, pulsingSection)}</p>
                          </div>
                          <div className={listingDraftPanelClass(draftGenerating)} aria-busy={draftGenerating}>
                            <span>本地草案 / 复核文本</span>
                            <p>{renderHeatmapSegments(section.draftText, selectedHeatmapKeyword, pulsingSection)}</p>
                            {section.charLimit && (
                              <small className={listingCharacterLimitClass(draftLength, section.charLimit)}>
                                {draftLength} / {section.charLimit}
                              </small>
                            )}
                          </div>
                        </div>
                        {renderListingDiffPreview(diff)}
                      </section>
                    );
                  })}
                </div>
              </div>
              {selectedHeatmapKeyword && (
                <p aria-atomic="true" aria-live="polite" className="muted-line listing-heatmap-focus-status">
                  {heatmapFocusAnnouncement} {heatmapModel.keywords.find((item) => item.keyword === selectedHeatmapKeyword)?.evidence || '暂无命中证据。'}
                </p>
              )}
            </>
          ) : (
            <div className="listing-heatmap-empty" role="status" aria-live="polite">
              <div>
                <span>暂无词根</span>
                <strong>先录入关键词，再看覆盖矩阵</strong>
                <p>可以从关键词机会页带入，也可以手工粘贴；未录入前不展示空热力图，避免误以为已有 Listing 覆盖结论。</p>
              </div>
              <button className="primary-button" onClick={() => setKeywordEditorOpen(true)} type="button">录入关键词</button>
            </div>
          )}
        </Panel>

        <ProgressiveDetails title="当前 Listing 内容与版本历史">
          <Panel className="listing-current-panel" title="当前 Listing 内容">
            <div className="detail-grid">
              <div><span>ASIN</span><strong>{listing?.asin || '-'}</strong></div>
              <div><span>目标 ASIN</span><strong>{expectedAsin || '-'}</strong></div>
              <div><span>页面匹配</span><strong>{listing ? (pageMatched ? '通过' : '阻断：ASIN 不一致') : '未读取'}</strong></div>
              <div><span>来源</span><strong>{listing?.source || '-'}</strong></div>
              <div><span>页面 URL</span><strong>{listing?.pageUrl || '-'}</strong></div>
              <div><span>版本</span><strong>{listing?.versionLabel || (listing?.versionId ? '本地保存版本' : '-')}</strong></div>
              <div><span>后台词</span><strong>{listing?.backendTerms || '-'}</strong></div>
              <div><span>详情</span><strong>{listing?.description || '-'}</strong></div>
              <div><span>A+</span><strong>{listing?.aPlus || '-'}</strong></div>
              <div><span>图片文案</span><strong>{listing?.imageCopy || '-'}</strong></div>
            </div>
            <div className="listing-copy-block">
              <h3>标题</h3>
              <p>{listing?.title || '尚未读取标题。'}</p>
              <h3>五点</h3>
              {(listing?.bullets?.length ? listing.bullets : ['尚未读取五点。']).map((item, index) => (
                <p key={`${index}-${item}`}>{index + 1}. {item}</p>
              ))}
            </div>
          </Panel>

          <Panel className="listing-history-panel" title="Listing 版本历史" tone={listingVersions.length ? 'success' : 'default'}>
            {listingVersions.length ? (
              <div className="business-card-list">
                {listingVersions.map((version) => (
                  <div className="business-card" key={version.versionId}>
                    <div className="business-split">
                      <div>
                        <strong>{version.versionLabel || '未命名本地版本'}</strong>
                        <p className="muted-line">{version.createdAt || '-'} / {version.source || 'manual'} / {version.storeName || scope.storeName || '-'} / {version.marketplaceCode || scope.marketplaceCode || '-'}</p>
                        <p>{version.changeSummary || '未填写修改说明'}</p>
                      </div>
                      <StatusPill tone="ready">已保存在本地</StatusPill>
                    </div>
                    <div className="detail-grid">
                      <div><span>标题</span><strong>{version.title || '-'}</strong></div>
                      <div><span>五点</span><strong>{version.bullets?.filter(Boolean).length || 0}</strong></div>
                      <div><span>后台词</span><strong>{version.backendTerms || '-'}</strong></div>
                      <div><span>详情/A+</span><strong>{version.description || version.aPlus || '-'}</strong></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-line">当前 ASIN 还没有版本历史。保存手工 Listing 后会在这里显示每次修改记录。</p>
            )}
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="关键词、草案生成和导出">
          <Panel className="listing-draft-panel" title="关键词与本地草案工作台" tone={quantReady ? 'success' : 'warning'}>
            <div className="listing-draft-workbench" aria-label="Listing 关键词与本地草案工作台">
              <section className="listing-draft-pane listing-draft-keyword-pane">
                <div className="listing-draft-pane-head">
                  <div>
                    <span>01 关键词输入</span>
                    <strong>{handoffPayload ? '来自关键词机会' : '手工粘贴或待带入'}</strong>
                  </div>
                  <StatusPill tone={keywords.length ? 'ready' : 'pending'}>{draftWorkspaceCopy.keywordStatusLabel}</StatusPill>
                </div>
                <div className="listing-keyword-summary" aria-live="polite">
                  <div>
                    <span>关键词</span>
                    <strong>{keywords.length}</strong>
                  </div>
                  <p>{keywords.length ? '已进入热力图和草案生成；需要修改时打开关键词编辑。' : '当前没有关键词，先从关键词机会页带入，或手工粘贴。'}</p>
                </div>
                <div className="action-row">
                  <button className={keywords.length ? 'secondary-button' : 'primary-button'} onClick={() => setKeywordEditorOpen(true)} type="button">
                    {keywords.length ? '编辑关键词' : '录入关键词'}
                  </button>
                </div>
              </section>

              <section className="listing-draft-pane">
                <div className="listing-draft-pane-head">
                  <div>
                    <span>02 数据门槛与用途</span>
                    <strong>{draftWorkspaceCopy.draftUseLabel}</strong>
                  </div>
                  <StatusPill tone={draftWorkspaceCopy.dataGateTone}>{configurationRequired ? '业务数据未读取' : draftWorkspaceCopy.dataGateLabel}</StatusPill>
                </div>
                <div className="listing-draft-gate-grid">
                  <div className={`listing-draft-gate listing-draft-gate-${draftWorkspaceCopy.dataGateTone}`}>
                    <span>数据门槛</span>
                    <strong>{configurationRequired ? '业务数据未读取' : draftWorkspaceCopy.dataGateLabel}</strong>
                    <p>{configurationRequired ? '运行配置待创建，当前广告指标未知；仅允许本地参考草案，不作为量化验收证据。' : draftWorkspaceCopy.dataGateDetail}</p>
                  </div>
                  <div className={`listing-draft-gate listing-draft-gate-${quantReady ? 'ready' : 'warning'}`}>
                    <span>草案用途</span>
                    <strong>{draftWorkspaceCopy.draftUseLabel}</strong>
                    <p>{draftWorkspaceCopy.draftUseDetail}</p>
                  </div>
                </div>
              </section>

              <section className="listing-draft-pane listing-draft-action-pane">
                <div className="listing-draft-pane-head">
                  <div>
                    <span>03 生成与导出</span>
                    <strong>{draftWorkspaceCopy.sourceLabel}</strong>
                  </div>
                  <StatusPill tone={draftReady ? 'ready' : listingReady && keywords.length ? aiStatus.tone : 'blocked'}>
                    {draftReady ? '草案已生成' : aiStatus.label}
                  </StatusPill>
                </div>
                <p className="muted-line">{draftWorkspaceCopy.sourceDetail}</p>
                <div className="listing-draft-metrics" aria-label="Listing 草案来源统计">
                  <div><span>AI 草案</span><strong>{aiDraftCount}</strong></div>
                  <div><span>本地规则参考</span><strong>{ruleDraftCount}</strong></div>
                  <div><span>可导出草案</span><strong>{drafts.length}</strong></div>
                </div>
                <div className="action-row">
                  <WorkspaceActionButton disabledReason={listingActionBusy ? '当前 Listing 动作正在处理，请等待完成。' : '请先打开 Listing 编辑，补齐当前商品内容并保存本地版本。'} aria-busy={generateDraftButton.ariaBusy} className={generateDraftButton.className} disabled={(generateDraftButton.disabled) || listingActionBusy} onClick={() => void generateDrafts('panel-generate')} type="button">
                    {generateDraftButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{generateDraftButton.label}</span>
                  </WorkspaceActionButton>
                  <WorkspaceActionButton disabledReason={listingActionBusy ? '当前 Listing 动作正在处理，请等待完成。' : '当前没有本地草案，请先完成内容与关键词，再生成草案。'} aria-busy={exportDraftButton.ariaBusy} className={exportDraftButton.className} disabled={(exportDraftButton.disabled) || listingActionBusy} onClick={() => void exportDrafts('panel-export')} type="button">
                    {exportDraftButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{exportDraftButton.label}</span>
                  </WorkspaceActionButton>
                </div>
              </section>
            </div>
            <p className="blocked-line">本地草案不会自动提交 Amazon，不修改 Lingxing Listing；缺真实广告数据时也不会进入交付证据包。</p>
            <div className="listing-draft-table-title">
              <div>
                <span>草案明细</span>
                <strong>{draftReady ? `${drafts.length} 条待人工复核` : '尚未生成草案'}</strong>
              </div>
              <StatusPill tone={draftReady ? 'ready' : 'pending'}>{draftReady ? '可导出' : '待草案'}</StatusPill>
            </div>
            <div className="table-wrap">
              <table className="business-table">
                <thead>
                  <tr>
                    <th>位置</th>
                    <th>当前文本</th>
                    <th>草案文本</th>
                    <th>关键词</th>
                    <th>来源</th>
                    <th>原因/证据</th>
                    <th>风险</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft, index) => (
                    <tr key={`${draft.section}-${index}`}>
                      <td>{sectionLabel(draft.section)}</td>
                      <td>{draft.currentText || '-'}</td>
                      <td>{draft.draftedText || '-'}</td>
                      <td>{draft.keywords?.join(', ') || '-'}</td>
                      <td>{draftSourceLabel(draft)}{draft.aiFallbackReason ? ` / ${draft.aiFallbackReason}` : ''}</td>
                      <td>{draft.evidence || '-'}</td>
                      <td>{draft.riskWarnings?.join(', ') || '需人工复核'}</td>
                    </tr>
                  ))}
                  {!drafts.length && (
                    <tr>
                      <td colSpan={7}>尚未生成草案。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </ProgressiveDetails>

        {listingEditorOpen && (
          <div
            className="product-config-modal-backdrop listing-editor-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeListingEditor();
            }}
            ref={listingEditorDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="listing-editor-modal-title"
              aria-modal="true"
              className="product-config-modal listing-editor-modal"
              onMouseDown={(event) => event.stopPropagation()}
              ref={listingEditorDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <div className="product-config-modal-header">
                <div>
                  <span>{manualListing.asin || expectedAsin || '当前产品'}</span>
                  <h2 id="listing-editor-modal-title">编辑当前 Listing</h2>
                </div>
                <WorkspaceActionButton disabledReason="当前 Listing 动作正在处理，请等待完成后重试。" className="secondary-button compact-button" disabled={(loading === 'save-manual') || listingActionBusy} onClick={closeListingEditor} type="button">关闭</WorkspaceActionButton>
              </div>
              <div className="product-config-modal-body listing-editor-modal-body">
                {listingActionBusy && <p id="listing-operation-lock" role="status">当前 Listing 动作正在处理，完成后可继续编辑。</p>}
                <div className="operation-hint">
                  <strong>只保存本地版本</strong>
                  <p>填写当前线上 Listing 的标题、五点、详情/A+ 和后台搜索词；保存后写入本地版本历史，不提交 Amazon，也不覆盖 Lingxing。</p>
                </div>
                <div className="listing-editor-table listing-editor-modal-table">
                  {listingManualFieldGroups().map((group) => (
                    <section className="listing-editor-section" key={group.title}>
                      <strong>{group.title}</strong>
                      <FormTable>
                        {group.fields.map(renderManualListingField)}
                      </FormTable>
                    </section>
                  ))}
                </div>
              </div>
              <div className="product-config-modal-footer">
                <span className="muted-line">保存只进入本地版本历史，后续用于草案对比和导出。</span>
                <div className="action-row">
                  <WorkspaceActionButton disabledReason="当前 Listing 动作正在处理，请等待完成后重试。" aria-busy={saveManualButton.ariaBusy} className={saveManualButton.className} disabled={(saveManualButton.disabled) || listingActionBusy} onClick={saveManualListing} type="button">
                    {saveManualButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{saveManualButton.label}</span>
                  </WorkspaceActionButton>
                  <WorkspaceActionButton disabledReason={listingActionBusy ? '当前 Listing 动作正在处理，请等待完成。' : '请先在 Listing 编辑中填写 ASIN，再刷新本地历史。'}
                    aria-busy={editorHistoryRefreshButton.ariaBusy}
                    className={editorHistoryRefreshButton.className}
                    disabled={(editorHistoryRefreshButton.disabled) || listingActionBusy}
                    onClick={() => {
                      void refreshListingVersions('editor-history');
                    }}
                    type="button"
                  >
                    {editorHistoryRefreshButton.showSpinner && <span className="button-spinner" aria-hidden="true" />}
                    <span>{editorHistoryRefreshButton.label}</span>
                  </WorkspaceActionButton>
                </div>
              </div>
            </section>
          </div>
        )}

        {keywordEditorOpen && (
          <div
            className="product-config-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeKeywordEditor();
            }}
            ref={listingKeywordDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="listing-keyword-editor-title"
              aria-modal="true"
              className="product-config-modal listing-keyword-modal"
              onMouseDown={(event) => event.stopPropagation()}
              ref={listingKeywordDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <div className="product-config-modal-header">
                <div>
                  <span>{expectedAsin || '当前产品'}</span>
                  <h2 id="listing-keyword-editor-title">编辑 Listing 关键词</h2>
                </div>
                <button className="secondary-button compact-button" onClick={closeKeywordEditor} type="button">关闭</button>
              </div>
              <div className="product-config-modal-body">
                {listingActionBusy && <p id="listing-keywords-operation-lock" role="status">当前 Listing 动作正在处理，完成后可继续修改关键词。</p>}
                <div className="operation-hint">
                  <strong>{keywords.length ? `${keywords.length} 个关键词已录入` : '尚未录入关键词'}</strong>
                  <p>关键词只用于本地热力图和草案生成，不会提交 Amazon，也不会改写 Lingxing Listing。</p>
                </div>
                <label className="textarea-label">
                  粘贴关键词机会（逗号或换行分隔）
                  <textarea
                    readOnly={listingActionBusy}
                    aria-describedby={listingActionBusy ? 'listing-keywords-operation-lock' : undefined}
                    value={keywordsText}
                    onChange={(event) => setKeywordsText(event.target.value)}
                    placeholder={draftWorkspaceCopy.keywordPlaceholder}
                  />
                </label>
                <p className="muted-line" aria-live="polite">
                  已输入 {keywords.length} 个关键词；生成前请删除不相关词、竞品误匹配词和跨产品词。
                </p>
              </div>
              <div className="product-config-modal-footer">
                <button className="primary-button" onClick={closeKeywordEditor} type="button">完成</button>
                <WorkspaceActionButton disabledReason={listingActionBusy ? '当前 Listing 动作正在处理，请等待完成。' : '当前关键词为空，无需清空。'} className="secondary-button" onClick={() => setKeywordsText('')} type="button" disabled={(!keywordsText.trim()) || listingActionBusy}>清空</WorkspaceActionButton>
              </div>
            </section>
          </div>
        )}

        {message && <p className={message.includes('失败') || message.includes('请先') ? 'blocked-line' : 'muted-line'}>{message}</p>}
      </div>
    </div>
  );
}
