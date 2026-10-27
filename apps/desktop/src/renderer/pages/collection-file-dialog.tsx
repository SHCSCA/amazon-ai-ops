import React from 'react';
import { toUserFacingError } from '../user-facing-error';
import { reportStatusLabel, getFileExtension, formatFileSize, formatUpdatedAt, shortHash } from './collection-presentation';
import type { useDataCollectionPage } from './collection-controller';

type Props = Pick<ReturnType<typeof useDataCollectionPage>, 'selectedReportFile' | 'reportFileDialogFocus' | 'setSelectedReportFile' | 'selectedReportFileImported' | 'selectedReportFileBinding' | 'renderOpenArtifactButton'>;
export function CollectionReportFileDialog({ selectedReportFile, reportFileDialogFocus, setSelectedReportFile, selectedReportFileImported, selectedReportFileBinding, renderOpenArtifactButton }: Props) { return <>{selectedReportFile && (
          <div
            className="collection-selector-modal-backdrop"
            ref={reportFileDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="collection-file-detail-title"
              aria-modal="true"
              className="collection-selector-modal collection-file-modal"
              ref={reportFileDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="collection-selector-modal-header">
                <div>
                  <span>真实报表文件</span>
                  <h2 id="collection-file-detail-title">{selectedReportFile.displayName}</h2>
                </div>
                <button className="secondary-button compact-button" onClick={() => setSelectedReportFile(null)} type="button">
                  关闭
                </button>
              </header>
              <div className="collection-selector-modal-body collection-file-modal-body">
                <div className="collection-file-status-strip">
                  <div>
                    <span>入库状态</span>
                    <strong>{selectedReportFileImported ? '已入库' : selectedReportFile.importError ? '导入失败' : '未入库'}</strong>
                  </div>
                  <div>
                    <span>DB 指标行数</span>
                    <strong>{selectedReportFile.importedRows}</strong>
                  </div>
                  <div>
                    <span>文件状态</span>
                    <strong>{reportStatusLabel(selectedReportFileBinding?.state || selectedReportFile.status)}</strong>
                  </div>
                </div>
                {selectedReportFile.importError && (
                  <p className="blocked-line collection-file-error">{toUserFacingError(new Error(selectedReportFile.importError), '当前报表未完成导入，请核对文件后重试。')}</p>
                )}
                <div className="collection-file-detail-grid">
                  <div>
                    <span>文件名</span>
                    <strong>{selectedReportFile.fileName || '-'}</strong>
                  </div>
                  <div>
                    <span>扩展名</span>
                    <strong>{getFileExtension(selectedReportFile.fileName, selectedReportFile.fileExtension)}</strong>
                  </div>
                  <div>
                    <span>文件大小</span>
                    <strong>{formatFileSize(selectedReportFile.fileSizeBytes)}</strong>
                  </div>
                  <div>
                    <span>最近入库</span>
                    <strong>{formatUpdatedAt(selectedReportFile.lastImportedAt || selectedReportFile.updatedAt)}</strong>
                  </div>
                  <div>
                    <span>文件指纹</span>
                    <strong>{shortHash(selectedReportFile.fileHash)}</strong>
                  </div>
                  <div>
                    <span>受控目录</span>
                    <strong>{selectedReportFile.folderArtifactId ? selectedReportFile.folderDisplayName || '已登记' : '-'}</strong>
                  </div>
                </div>
                <div className="collection-file-path-block">
                  <span>本地文件访问</span>
                  <strong>{selectedReportFile.artifactId ? '已绑定当前店铺的受控工件' : '未登记可打开工件'}</strong>
                </div>
              </div>
              <footer className="collection-selector-modal-footer collection-file-modal-footer">
                {renderOpenArtifactButton({
                  className: 'secondary-button',
                  disabled: !selectedReportFile.artifactId,
                  idleLabel: '打开文件',
                  messageLabel: `打开${selectedReportFile.displayName}`,
                  artifactId: selectedReportFile.artifactId || '',
                })}
                {renderOpenArtifactButton({
                  className: 'secondary-button',
                  disabled: !selectedReportFile.folderArtifactId,
                  idleLabel: '打开文件夹',
                  messageLabel: `打开${selectedReportFile.displayName}文件夹`,
                  artifactId: selectedReportFile.folderArtifactId || '',
                })}
                <button className="primary-button" onClick={() => setSelectedReportFile(null)} type="button">
                  知道了
                </button>
              </footer>
            </section>
          </div>
        )}</>; }
