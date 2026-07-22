import type React from 'react';
import type {
  MissionControlAutonomyProjection,
  MissionControlCapabilityProjection,
  MissionControlViewId,
  MissionControlWorkspaceId,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { AppRoute } from '../../types';
import type { NavigationIntent } from '../../navigation';

export type MissionControlWorkspaceSubviewKind = 'legacy' | 'canonical';

export interface MissionControlWorkspaceSubviewDefinition {
  id: string;
  label: string;
  description: string;
  view: MissionControlViewId;
  kind: MissionControlWorkspaceSubviewKind;
  legacyRoute?: AppRoute;
}

export interface MissionControlWorkspaceRegistration {
  id: MissionControlWorkspaceId;
  label: string;
  description: string;
  subviews: readonly MissionControlWorkspaceSubviewDefinition[];
}

export interface LegacyWorkspaceSlotInput {
  route: AppRoute;
  intent: NavigationIntent;
  capabilities: readonly MissionControlCapabilityProjection[];
}

export type LegacyWorkspaceSlot =
  | React.ReactNode
  | ((input: LegacyWorkspaceSlotInput) => React.ReactNode);

export interface MissionControlWorkspaceViewProps {
  intent: NavigationIntent;
  storeContext: StoreContextEnvelope | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  autonomy?: MissionControlAutonomyProjection | null;
  previewMode: boolean;
  onNavigate: (intent: NavigationIntent) => void;
  legacySlot?: LegacyWorkspaceSlot;
  storeCrudSlot?: React.ReactNode;
  settingsCrudSlot?: React.ReactNode;
}
