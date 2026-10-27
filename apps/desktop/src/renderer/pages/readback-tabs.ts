import {
  readbackWizardSteps,
  type ReadbackWizardStepId,
} from '../readback-wizard';

export function readbackStepTabId(stepId: ReadbackWizardStepId): string {
  return `readback-step-tab-${stepId}`;
}

export function readbackStepPanelId(stepId: ReadbackWizardStepId): string {
  return `readback-step-panel-${stepId}`;
}

export function readbackStepPanelProps(stepId: ReadbackWizardStepId) {
  return {
    'aria-labelledby': readbackStepTabId(stepId),
    className: 'readback-step-panel',
    id: readbackStepPanelId(stepId),
    role: 'tabpanel' as const,
    tabIndex: 0,
  };
}

export function readbackStepTabTitle(title: string): string {
  return title.replace(/^\d+\.\s*/, '');
}

export function readbackStepFromKeyboard(currentStepId: ReadbackWizardStepId, key: string): ReadbackWizardStepId | null {
  const stepIds = readbackWizardSteps.map((step) => step.id);
  const currentIndex = stepIds.indexOf(currentStepId);
  if (currentIndex < 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return stepIds[(currentIndex + 1) % stepIds.length];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return stepIds[(currentIndex - 1 + stepIds.length) % stepIds.length];
  if (key === 'Home') return stepIds[0];
  if (key === 'End') return stepIds[stepIds.length - 1];
  return null;
}
