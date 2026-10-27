import React from 'react';
import type { DeliveryActionButtonView } from './delivery-contracts';

export function NonReadyDeliveryEvidenceExport({ available, button, onExport }: {
  available: boolean;
  button: DeliveryActionButtonView;
  onExport: () => void;
}) {
  if (!available) return null;
  return (
    <div>
      <button aria-busy={button.ariaBusy} className={button.className} disabled={button.disabled}
        onClick={onExport} aria-describedby={button.disabled ? 'delivery-non-ready-export-note delivery-non-ready-export-reason' : 'delivery-non-ready-export-note'} type="button">
        {button.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{button.label}</span>
      </button>
      {button.disabled && <p id="delivery-non-ready-export-reason" className="muted-line">{button.disabledReason || '当前材料正在导出，请等待完成后重试。'}</p>}
      <p id="delivery-non-ready-export-note" className="muted-line">材料包含当前缺口，不能作为生产就绪证明。</p>
    </div>
  );
}
