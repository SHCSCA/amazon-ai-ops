import type { AppRoute } from '../types';

export type DashboardRecommendationStatus = 'pending' | 'needs_review';

export type DashboardWorkflowStep = {
  id: string;
  route: AppRoute;
  title: string;
  status: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  next: string;
};

export type DashboardPrimaryTaskAction = { route: AppRoute; label: string; title: string };

export type DashboardPrimaryTaskNavigationFeedback = {
  label: string;
  busy: boolean;
  busyLabel?: string;
  disabled: boolean;
};

export type DashboardActionQueueItem = {
  title: string;
  detail: string;
  route: AppRoute;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
};

export type DashboardStatusCard = {
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  route?: AppRoute;
  actionLabel?: string;
};

export type DashboardRouteAction = { route: AppRoute; label: string; disabled: boolean };
