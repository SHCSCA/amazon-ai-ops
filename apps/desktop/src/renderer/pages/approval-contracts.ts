

export type ApprovalTab = 'pending' | 'needs_review' | 'approved' | 'rejected';

export type ApprovalFeedbackState = 'approving' | 'approved' | 'rejecting' | 'rejected' | 'blocked';

export type ApprovalDecisionButtonMode = 'approved' | 'rejected';

export type ApprovalQueueExitDecision = ApprovalDecisionButtonMode;

export type ApprovalQueueExitState = { id: number; decision: ApprovalQueueExitDecision } | null;
