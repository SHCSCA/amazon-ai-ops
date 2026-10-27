import React, { useId, useState } from 'react';
import {
  type ReadbackCaptureSlot,
  type ReadbackFormState,
} from "./readback-contracts";
import {
  CAPTURE_SLOT_LABELS,
} from "./readback-constants";

export function formatCaptureMissing(sessionCheck: Record<string, any>): string {
  const missingFields = sessionCheck.captureMissingFields;
  if (Array.isArray(missingFields) && missingFields.length > 0) {
    return missingFields
      .slice(0, 8)
      .map((item) => [item.group, captureFieldLabelForDisplay(item.label || item.field)].filter(Boolean).join('/'))
      .filter(Boolean)
      .join('、');
  }
  return Array.isArray(sessionCheck.unresolvedFields)
    ? sessionCheck.unresolvedFields.slice(0, 8).map(captureFieldLabelForDisplay).join('、')
    : '';
}

export function captureFieldLabelForDisplay(value: unknown): string {
  return String(value || '')
    .replace(/执行前\s*Ads UI live bid/gi, '现场出价')
    .replace(/执行后\s*Ads UI live bid/gi, '现场出价')
    .replace(/Ads UI live bid/gi, '现场出价')
    .replace(/session-input\.json/gi, '填写文件')
    .replace(/\breadback\b/gi, '回读');
}

export function captureSlotPatch(slot: ReadbackCaptureSlot, filePath: string, savedAt: string): Partial<ReadbackFormState> {
  if (slot === 'approval') {
    return { approvalArtifactPath: filePath, approvalConfirmedAt: savedAt };
  }
  if (slot === 'before') {
    return { beforeScreenshotPath: filePath, beforeCapturedAt: savedAt };
  }
  if (slot === 'after') {
    return { afterScreenshotPath: filePath, afterCapturedAt: savedAt };
  }
  return { readbackEvidencePath: filePath, readbackReadAt: savedAt };
}

export function nextEvidenceCaptureSlot(form: ReadbackFormState): Exclude<ReadbackCaptureSlot, 'approval'> {
  if (!form.beforeScreenshotPath.trim()) return 'before';
  if (!form.afterScreenshotPath.trim()) return 'after';
  return 'readback';
}

export function captureFileList(source?: DataTransfer | null): File[] {
  if (!source) return [];
  const files = Array.from(source.files || []);
  const itemFiles = Array.from(source.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((item): item is File => Boolean(item));
  return [...files, ...itemFiles].filter((file, index, all) =>
    all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index);
}

export function firstImageFile(files: File[]): File | null {
  return files.find((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)) || null;
}

export function captureFileName(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || '截图文件';
}

export function captureFileExtension(value: string): string {
  const fileName = captureFileName(value);
  const match = fileName.match(/\.([a-z0-9]+)$/i);
  return (match?.[1] || 'IMG').toUpperCase().slice(0, 4);
}

export function readbackCaptureTargetView(
  slot: ReadbackCaptureSlot,
  input: { value?: string; saving?: boolean; dragging?: boolean; previewUrl?: string } = {},
) {
  const copy = CAPTURE_SLOT_LABELS[slot];
  const className = [
    'readback-capture-target',
    input.value ? 'readback-capture-filled' : '',
    input.saving ? 'readback-capture-saving' : '',
    input.dragging && !input.saving ? 'readback-capture-dragging' : '',
  ].filter(Boolean).join(' ');
  if (input.saving) {
    return {
      className,
      title: '正在存证...',
      detail: copy.detail,
      helper: '正在写入本地证据目录...',
    };
  }
  if (input.dragging) {
    return {
      className,
      title: '松开即可存证',
      detail: copy.detail,
      helper: '已识别拖入截图，松开鼠标后写入本地证据目录。',
    };
  }
  if (input.value) {
    return {
      className,
      title: `${copy.title}已安全固定`,
      detail: copy.detail,
      helper: input.value,
      preview: {
        alt: `${copy.title}缩略预览`,
        badge: '证据已安全固定',
        extension: captureFileExtension(input.value),
        fileName: captureFileName(input.value),
        path: input.value,
        src: input.previewUrl,
      },
    };
  }
  return {
    className,
    title: copy.title,
    detail: copy.detail,
    helper: '点击此区域后 Ctrl+V，或拖入图片文件',
  };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取截图失败'));
    reader.readAsDataURL(file);
  });
}

export function ReadbackCaptureTarget({
  slot,
  value,
  saving,
  previewUrl,
  onCapture,
  repairClassName = '',
  disabled = false,
  disabledReason,
  id,
}: {
  slot: ReadbackCaptureSlot;
  value?: string;
  saving?: boolean;
  previewUrl?: string;
  onCapture: (slot: ReadbackCaptureSlot, files: File[]) => void;
  repairClassName?: string;
  disabled?: boolean;
  disabledReason?: string;
  id?: string;
}) {
  const reasonId = useId();
  const [dragging, setDragging] = useState(false);
  const view = readbackCaptureTargetView(slot, { value, saving, dragging, previewUrl });
  const clearDragging = () => setDragging(false);
  const markDragging = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!saving && !disabled) setDragging(true);
  };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    clearDragging();
    if (disabled) return;
    onCapture(slot, captureFileList(event.dataTransfer));
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = captureFileList(event.clipboardData);
    if (!files.length || disabled) return;
    event.preventDefault();
    onCapture(slot, files);
  };
  return (
    <div
      aria-label={`${CAPTURE_SLOT_LABELS[slot].title}拖拽或粘贴存证`}
      aria-disabled={disabled || undefined}
      aria-describedby={disabled && disabledReason ? reasonId : undefined}
      aria-live="polite"
      className={[view.className, repairClassName].filter(Boolean).join(' ')}
      data-capture-slot={slot}
      onDragEnter={markDragging}
      onDragLeave={clearDragging}
      onDragOver={markDragging}
      onDrop={handleDrop}
      onPaste={handlePaste}
      role="button"
      id={id}
      tabIndex={disabled ? -1 : 0}
    >
      <strong>{view.title}</strong>
      {disabled && disabledReason && <span id={reasonId}>{disabledReason}</span>}
      <span>{view.detail}</span>
      {'preview' in view && view.preview ? (
        <div className="readback-capture-fixed-preview">
          <div className="readback-capture-thumbnail" aria-label={view.preview.alt}>
            {view.preview.src ? (
              <img alt={view.preview.alt} src={view.preview.src} />
            ) : (
              <span aria-hidden="true">{view.preview.extension}</span>
            )}
          </div>
          <div className="readback-capture-fixed-meta">
            <span className="readback-capture-fixed-badge">{view.preview.badge}</span>
            <small className="readback-capture-file-name" title={view.preview.path}>{view.preview.fileName}</small>
          </div>
        </div>
      ) : (
        <small>{view.helper}</small>
      )}
    </div>
  );
}
