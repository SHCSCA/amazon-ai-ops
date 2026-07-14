import type React from 'react';

export type WorkspaceTone = 'neutral' | 'attention' | 'blocked' | 'confirmed';

export type WorkspaceAction = {
  label: string;
  onClick: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  busyLabel?: string;
};

export type WorkspaceContent = React.ReactNode;
