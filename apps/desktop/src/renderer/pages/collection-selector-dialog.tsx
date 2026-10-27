import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import React from 'react';
import { reportStatusLabel } from './collection-presentation';
import type { useDataCollectionPage } from './collection-controller';

type Props = Pick<ReturnType<typeof useDataCollectionPage>, 'configurationRequired' | 'reportSelectorOpen' | 'reportSelectorDialogFocus' | 'setReportSelectorOpen' | 'reportSelectionState' | 'setSelectedTypes' | 'reportOptions' | 'reportStatusLoading' | 'missingReportTypes' | 'unimportedReportTypes' | 'selectedCount' | 'productionReportOptions' | 'selectedTypes' | 'toggleReport'>;
export function CollectionReportSelectorDialog({ configurationRequired, reportSelectorOpen, reportSelectorDialogFocus, setReportSelectorOpen, reportSelectionState, setSelectedTypes, reportOptions, reportStatusLoading, missingReportTypes, unimportedReportTypes, selectedCount, productionReportOptions, selectedTypes, toggleReport }: Props) { return <>{reportSelectorOpen && (
          <div
            className="collection-selector-modal-backdrop"
            ref={reportSelectorDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="collection-selector-title"
              aria-modal="true"
              className="collection-selector-modal"
              ref={reportSelectorDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="collection-selector-modal-header">
                <div>
                  <span>报表选择</span>
                  <h2 id="collection-selector-title">调整本次下载/重建的报表</h2>
                </div>
                <button className="secondary-button compact-button" onClick={() => setReportSelectorOpen(false)} type="button">
                  关闭
                </button>
              </header>
              <div className="collection-selector-modal-body">
                <div className="data-collection-workbench-toolbar collection-selector-toolbar">
                  <div>
                    <span>当前选择</span>
                    <strong key={reportSelectionState.countLabel} className={reportSelectionState.countClassName}>
                      {reportSelectionState.countLabel}
                    </strong>
                    <p className="collection-selection-live" aria-live="polite">{reportSelectionState.ariaStatus}</p>
                  </div>
                  <div className="table-action-row">
                    <button className="secondary-button compact-button" onClick={() => setSelectedTypes(reportOptions.map((item) => item.type))} type="button">
                      全选 8 类
                    </button>
                    <WorkspaceActionButton disabledReason={configurationRequired ? '当前业务数据尚未读取，请打开店铺配置创建运行配置后再核对。' : reportStatusLoading ? '报表状态读取中，请等待返回。' : '当前范围没有缺失报表，无需选择。'} className="secondary-button compact-button" disabled={configurationRequired || reportStatusLoading || missingReportTypes.length === 0} onClick={() => setSelectedTypes(missingReportTypes)} type="button">
                      只选缺失
                    </WorkspaceActionButton>
                    <WorkspaceActionButton disabledReason={configurationRequired ? '当前业务数据尚未读取，请打开店铺配置创建运行配置后再核对。' : reportStatusLoading ? '报表状态读取中，请等待返回。' : '当前范围没有未入库报表，无需选择。'} className="secondary-button compact-button" disabled={configurationRequired || reportStatusLoading || unimportedReportTypes.length === 0} onClick={() => setSelectedTypes(unimportedReportTypes)} type="button">
                      只选未入库
                    </WorkspaceActionButton>
                    <WorkspaceActionButton disabledReason="当前没有选择报表，无需清空。" className="secondary-button compact-button" disabled={selectedCount === 0} onClick={() => setSelectedTypes([])} type="button">
                      清空
                    </WorkspaceActionButton>
                  </div>
                </div>
                <div className="report-option-grid data-collection-report-grid collection-selector-grid">
                  {productionReportOptions.map((item) => (
                    <label
                      className={[
                        'report-option',
                        item.realFileAvailable ? 'report-option-ready' : '',
                        selectedTypes.includes(item.type) ? 'report-option-selected' : '',
                      ].filter(Boolean).join(' ')}
                      key={item.type}
                    >
                      <input
                        checked={selectedTypes.includes(item.type)}
                        onChange={() => toggleReport(item.type)}
                        type="checkbox"
                      />
                      <span>{item.label}</span>
                      <strong>{configurationRequired ? '状态未读取' : reportStatusLoading ? '状态读取中' : item.realFileAvailable ? '有真实文件' : '缺真实文件'}</strong>
                      <small>{configurationRequired ? '运行配置待创建；文件和入库状态未知' : reportStatusLoading ? '等待当前范围数据返回' : `${item.importedRows} 行导入 / ${reportStatusLabel(item.status)}`}</small>
                    </label>
                  ))}
                </div>
              </div>
              <footer className="collection-selector-modal-footer">
                <button className="primary-button" onClick={() => setReportSelectorOpen(false)} type="button">
                  确认选择
                </button>
                <button className="secondary-button" onClick={() => setReportSelectorOpen(false)} type="button">
                  关闭
                </button>
              </footer>
            </section>
          </div>
        )}</>; }
