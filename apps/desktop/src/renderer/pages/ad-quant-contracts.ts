

export type AdQuantMetricFocus = 'all' | 'high_acos' | 'waste' | 'orders' | 'scale' | 'review';

export type StatusTone = 'ready' | 'pending' | 'blocked' | 'warning';

export interface AdQuantDecisionStatus {
  aiLabel: string;
  aiDetail: string;
  aiTone: StatusTone;
  ruleLabel: string;
  ruleDetail: string;
  ruleTone: StatusTone;
  actionLabel: string;
  actionDetail: string;
  actionTone: StatusTone;
  primaryActionLabel: string;
}

export interface StrategyRunFeedback {
  visible: boolean;
  title: string;
  detail: string;
  statusLabel: string;
  tone: StatusTone;
  className: string;
  ariaBusy?: boolean;
  radarVisible?: boolean;
  primaryAction?: StrategyRunFeedbackAction;
  secondaryAction?: StrategyRunFeedbackAction;
}

export interface StrategyRunFeedbackAction {
  label: string;
  target: 'run-ai' | 'settings' | 'data-collection' | 'data-import-validation' | 'recommendations';
}

export interface AdQuantActionButtonInput {
  active: boolean;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
  idleLabel: string;
}

export interface AdQuantActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export interface WasteRiskSpendTile {
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}
