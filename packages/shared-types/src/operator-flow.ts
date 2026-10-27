import type { MissionControlViewId } from './mission-control';

export type OperatorFlowStageId = 'store-context' | 'products' | 'reports' | 'import' | 'mission' | 'analysis'
  | 'decision' | 'grant' | 'execution' | 'readback' | 'experiment' | 'memory' | 'delivery';
export type OperatorFlowStageState = 'pending' | 'in_progress' | 'recorded' | 'verified' | 'blocked' | 'unknown';

export interface OperatorFlowStageProjection {
  id: OperatorFlowStageId;
  label: string;
  state: OperatorFlowStageState;
  statusLabel: string;
  latestResult: string;
  blocker: string;
  nextAction: string;
  targetView: MissionControlViewId;
}
