export { CanonicalWorkspace } from './canonical-workspace';
export type { CanonicalWorkspaceProps } from './canonical-workspace';
export { ExecutionWorkspace } from './execution-workspace';
export type { ExecutionWorkspaceProps } from './execution-workspace';
export { LegacyWorkspace } from './legacy-workspace';
export type { LegacyWorkspaceProps } from './legacy-workspace';
export { MissionControlWorkspaceView } from './mission-control-workspace-view';
export {
  MISSION_CONTROL_WORKSPACE_REGISTRY,
  missionControlViewIdForIntent,
  registrationForWorkspace,
  subviewDefinitionForIntent,
} from './registry';
export type {
  LegacyWorkspaceSlot,
  LegacyWorkspaceSlotInput,
  MissionControlWorkspaceRegistration,
  MissionControlWorkspaceSubviewDefinition,
  MissionControlWorkspaceSubviewKind,
  MissionControlWorkspaceViewProps,
} from './types';
