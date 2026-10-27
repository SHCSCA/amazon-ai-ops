import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import React from 'react';
import { collectionOpenArtifactButtonView, collectionArtifactActionKey, getFileExtension } from './collection-presentation';
export function createCollectionArtifactControls({ openingArtifactKey, openArtifact, operationPending }: {
  openingArtifactKey: string | null;
  operationPending: boolean;
  openArtifact: (artifactId: string, label?: string) => Promise<void>;
}) {
function renderOpenArtifactButton(input: {
    className?: string;
    disabled?: boolean;
    idleLabel: string;
    messageLabel?: string;
    artifactId: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = collectionOpenArtifactButtonView({
      activeArtifactKey: openingArtifactKey,
      baseClassName: input.className,
      disabled: input.disabled || operationPending,
      idleLabel: input.idleLabel,
      artifactKey: collectionArtifactActionKey(messageLabel, input.artifactId),
    });
    return (
      <WorkspaceActionButton disabledReason={openingArtifactKey ? '正在打开已登记的报表文件或目录，请等待完成。' : operationPending ? '当前采集任务动作尚未结束，请等待完成后打开文件。' : '当前文件尚未登记，请完成采集后刷新。'}
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        onClick={() => openArtifact(input.artifactId, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </WorkspaceActionButton>
    );
  }

function renderOpenArtifactChip(file: {
    displayName: string;
    fileName: string;
    fileExtension?: string;
    artifactId: string;
    id?: string;
    importedRows?: number;
    smallText?: string;
  }) {
    const view = collectionOpenArtifactButtonView({
      activeArtifactKey: openingArtifactKey,
      baseClassName: 'real-file-chip',
      idleLabel: file.displayName,
      artifactKey: collectionArtifactActionKey(file.displayName, file.artifactId),
      disabled: operationPending,
    });
    return (
      <WorkspaceActionButton disabledReason={openingArtifactKey ? '正在打开已登记的报表文件或目录，请等待完成。' : operationPending ? '当前采集任务动作尚未结束，请等待完成后打开文件。' : '当前文件尚未登记，请完成采集后刷新。'}
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        key={file.id || file.artifactId}
        onClick={() => openArtifact(file.artifactId, file.displayName)}
        type="button"
      >
        <span>{file.displayName}</span>
        <strong>{file.fileName}</strong>
        <small>
          {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
          {view.showSpinner ? view.label : file.smallText || `${getFileExtension(file.fileName, file.fileExtension)} / ${file.importedRows || 0} 行`}
        </small>
      </WorkspaceActionButton>
    );
  }
  return { renderOpenArtifactButton, renderOpenArtifactChip };
}
