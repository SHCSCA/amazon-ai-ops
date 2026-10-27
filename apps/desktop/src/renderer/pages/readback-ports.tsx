import type { WorkspaceOperationTicket } from '../components/workspace/use-workspace-operation';
import React from 'react';
import { type ReadbackRepairIntent } from '../readback-repair-intent';
import { type ReadbackWizardStepId } from '../readback-wizard';
import {
  type ReadbackAuthority,
  type ReadbackRepairAction,
  type ReadbackRequestSnapshot,
  type ReadbackWorkspaceActionKey,
} from './readback-workspace-model';
import type { RecommendationView } from '../types';
import {
  type ReadbackFormState,
  type ReadbackCaptureSlot,
  type ReadbackCopyCommandKey,
  type ReadbackContractCheck,
  type ReadbackActionButtonView,
} from "./readback-contracts";
import type { OperationScope } from '../types';
import type { ReadbackExportRoute } from './readback-workspace-model';

export interface ReadbackPageActionContext {
  captureReadbackContext(): () => boolean;
  beginOperation(): WorkspaceOperationTicket | null;
  formEpochRef: React.MutableRefObject<number>;
  activeExportRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  exportRequestIdRef: React.MutableRefObject<number>;
  queryKey: string;
  activeCaptureRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  captureRequestIdRef: React.MutableRefObject<number>;
  activeFinalRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  finalRequestIdRef: React.MutableRefObject<number>;
  activeVerifyRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  verifyRequestIdRef: React.MutableRefObject<number>;
  activeSessionRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  sessionRequestIdRef: React.MutableRefObject<number>;
  setForm: React.Dispatch<React.SetStateAction<ReadbackFormState>>;
  setExportResult: React.Dispatch<React.SetStateAction<{ jsonPath?: string; markdownPath?: string; sha256?: string; status?: string; readyForVerifier?: boolean; nextAction?: "verify" | "prepare"; } | null>>;
  setSessionResult: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  setSessionCheck: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  setSessionFillResult: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  setSessionVerifyResult: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  authority: ReadbackAuthority;
  setCopyNotice: React.Dispatch<React.SetStateAction<string | null>>;
  runWorkspaceAction: <T>(action: ReadbackWorkspaceActionKey, task: () => Promise<T>) => Promise<T | undefined>;
  setActiveCaptureSlot: React.Dispatch<React.SetStateAction<ReadbackCaptureSlot | null>>;
  sessionResult: Record<string, any> | null;
  update: (patch: Partial<ReadbackFormState>, options?: { preserveSession?: boolean; }) => void;
  setCapturePreviews: React.Dispatch<React.SetStateAction<Partial<Record<ReadbackCaptureSlot, string>>>>;
  rowsRequestIdRef: React.MutableRefObject<number>;
  activeRowsRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  scope: OperationScope;
  currentBatchId: string | undefined;
  setApprovedRows: React.Dispatch<React.SetStateAction<RecommendationView[]>>;
  previewScenarioId: string | undefined;
  setActiveStep: React.Dispatch<React.SetStateAction<ReadbackWizardStepId>>;
  activeActionRef: React.MutableRefObject<ReadbackWorkspaceActionKey | null>;
  setActiveAction: React.Dispatch<React.SetStateAction<ReadbackWorkspaceActionKey | null>>;
  form: ReadbackFormState;
  setActivePathKey: React.Dispatch<React.SetStateAction<string | null>>;
  openReadbackPath: (targetPath?: string, label?: string) => Promise<void>;
  exportOpenPath: string;
  exportRoute: ReadbackExportRoute;
  sessionFillResult: Record<string, any> | null;
  activateReadbackStep: (stepId: ReadbackWizardStepId, focusTab?: boolean) => void;
  exportEvidence: (options?: { withinActiveAction?: boolean; }) => Promise<any>;
  verifyReadbackEvidence: (options?: { evidencePath?: string; withinActiveAction?: boolean; }) => Promise<any>;
  setTechnicalInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  focusRepairTarget: (action: ReadbackRepairAction) => void;
  runFinalVerification: () => Promise<void>;
  exportResult: { jsonPath?: string; markdownPath?: string; sha256?: string; status?: string; readyForVerifier?: boolean; nextAction?: "verify" | "prepare"; } | null;
  setActiveCopyCommand: React.Dispatch<React.SetStateAction<ReadbackCopyCommandKey | null>>;
}

export interface ReadbackPageViewModel {
  authorityUnavailableReason: string | null;
  authority: ReadbackAuthority;
  previewScenarioId: string | undefined;
  primaryTaskCopy: { dataAction: string; title: string; description: string; statusLabel: string; };
  finalVerificationPassed: boolean;
  missing: string[];
  precheckCopy: { statusLabel: string; chipLabel: string; exportButtonLabel: string; helperText: string; };
  form: ReadbackFormState;
  capturedEvidenceCount: number;
  passedTaskAction: { label: string; ariaLabel: string; disabled: boolean; onClick: () => void; };
  taskBannerAction: (action: ReadbackRepairAction) => { label: string; ariaLabel: string; busy: boolean; busyLabel: string | undefined; disabled: boolean; disabledReason: string | undefined; onClick: () => void; };
  primaryRepairAction: ReadbackRepairAction;
  selectApprovedActionTaskAction: { label: string; ariaLabel: string; disabled: boolean; disabledReason: string | undefined; onClick: () => void; };
  secondaryRepairActions: ReadbackRepairAction[];
  repairIntent: ReadbackRepairIntent | null;
  activeStepIndex: number;
  activeStepSummary: { missingCount: number; status: string; detail: string; id: ReadbackWizardStepId; title: string; fields: string[]; };
  activeStepDetail: string;
  readbackStepRailStyle: React.CSSProperties;
  readbackStepSummaries: { missingCount: number; status: string; detail: string; id: ReadbackWizardStepId; title: string; fields: string[]; }[];
  activeStep: ReadbackWizardStepId;
  repairIntentStep: ReadbackWizardStepId;
  activateReadbackStep: (stepId: ReadbackWizardStepId, focusTab?: boolean) => void;
  stepTabRefs: React.MutableRefObject<Partial<Record<ReadbackWizardStepId, HTMLButtonElement | null>>>;
  activeMissingCount: number;
  technicalInspectorLocked: boolean;
  setTechnicalInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeAction: ReadbackWorkspaceActionKey | null;
  currentBatchId: string | undefined;
  sourceBatchMatches: boolean;
  approvedRows: RecommendationView[];
  scope: OperationScope;
  formEpochRef: React.MutableRefObject<number>;
  activeExportRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  exportRequestIdRef: React.MutableRefObject<number>;
  queryKey: string;
  activeCaptureRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  captureRequestIdRef: React.MutableRefObject<number>;
  activeFinalRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  finalRequestIdRef: React.MutableRefObject<number>;
  activeVerifyRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  verifyRequestIdRef: React.MutableRefObject<number>;
  activeSessionRequestRef: React.MutableRefObject<ReadbackRequestSnapshot | null>;
  sessionRequestIdRef: React.MutableRefObject<number>;
  setForm: React.Dispatch<React.SetStateAction<ReadbackFormState>>;
  setExportResult: React.Dispatch<React.SetStateAction<{ jsonPath?: string; markdownPath?: string; sha256?: string; status?: string; readyForVerifier?: boolean; nextAction?: "verify" | "prepare"; } | null>>;
  setSessionResult: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  setSessionCheck: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  setSessionFillResult: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  setSessionVerifyResult: React.Dispatch<React.SetStateAction<Record<string, any> | null>>;
  setCapturePreviews: React.Dispatch<React.SetStateAction<Partial<Record<ReadbackCaptureSlot, string>>>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setCopyNotice: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveStep: React.Dispatch<React.SetStateAction<ReadbackWizardStepId>>;
  loading: boolean;
  sourceFieldCount: number;
  sourceFilesCount: number;
  captureEvidence: (slot: ReadbackCaptureSlot, files: File[]) => Promise<void>;
  firstScreenshotRepairSlot: ReadbackCaptureSlot | null;
  capturePreviews: Partial<Record<ReadbackCaptureSlot, string>>;
  captureSavingSlot: ReadbackCaptureSlot | null;
  update: (patch: Partial<ReadbackFormState>, options?: { preserveSession?: boolean; }) => void;
  repairPulse: boolean;
  contractChecks: ReadbackContractCheck[];
  repairFieldClass: (label: string, baseClassName?: string) => string;
  missingGroups: { title: string; items: string[]; }[];
  message: string | null;
  technicalInspectorOpen: boolean;
  exportResult: { jsonPath?: string; markdownPath?: string; sha256?: string; status?: string; readyForVerifier?: boolean; nextAction?: "verify" | "prepare"; } | null;
  completedViaWorkPackage: boolean;
  exportEvidenceButton: ReadbackActionButtonView;
  exportEvidence: (options?: { withinActiveAction?: boolean }) => Promise<any>;
  openExportButton: ReadbackActionButtonView;
  openExport: () => Promise<void>;
  prepareSessionButton: ReadbackActionButtonView;
  prepareSessionPacket: () => Promise<void>;
  verifySessionButton: ReadbackActionButtonView;
  verifySessionPacket: () => Promise<void>;
  fillSessionButton: ReadbackActionButtonView;
  fillSessionPacket: () => Promise<void>;
  verifyEvidenceButton: ReadbackActionButtonView;
  verifyReadbackEvidence: (options?: { evidencePath?: string; withinActiveAction?: boolean; }) => Promise<any>;
  sessionWorkflow: { sessionDir: string; steps: string[]; warning: string; };
  sessionResult: Record<string, any> | null;
  openSessionPacketButton: ReadbackActionButtonView;
  openSessionPacket: () => Promise<void>;
  openSessionInputFileButton: ReadbackActionButtonView;
  openSessionInputFile: () => Promise<void>;
  openSessionInputGuideButton: ReadbackActionButtonView;
  openSessionInputGuide: () => Promise<void>;
  sessionCheck: Record<string, any> | null;
  sessionFillResult: Record<string, any> | null;
  sessionVerifyResult: Record<string, any> | null;
  copyNotice: string | null;
  prepareCopyCommandButton: ReadbackActionButtonView;
  copySessionCommand: (kind: "prepare" | "verify" | "fill") => Promise<void>;
  verifyCopyCommandButton: ReadbackActionButtonView;
  fillCopyCommandButton: ReadbackActionButtonView;
  longFillCopyCommandButton: ReadbackActionButtonView;
  copyFillCommand: () => Promise<void>;
}
