// =============================================
// API Request/Response Types
// =============================================

// Agent -> Server: Task
export interface AgentTask {
  task_id: string;
  task_type: TaskType;
  payload: TaskPayload;
  priority: number;
}

export type TaskType =
  | 'download_report'
  | 'execute_action'
  | 'check_session'
  | 'upload_file';

export interface TaskPayload {
  report_type?: ReportType;
  date_range?: { start: string; end: string };
  store_id?: number;
  marketplace?: string;
  action?: ActionPayload;
  file_path?: string;
}

export type ReportType =
  | 'campaign'
  | 'targeting'
  | 'search_term'
  | 'placement'
  | 'product_performance'
  | 'inventory'
  | 'profit';

// Agent -> Server: Action Execution
export interface ActionPayload {
  action_id: string;
  action_type: ActionType;
  entity_type: EntityType;
  entity_id: string;
  store_id: number;
  marketplace: string;
  asin?: string;
  msku?: string;
  campaign_id?: string;
  ad_group_id?: string;
  target_id?: string;
  current_value: string;
  recommended_value: string;
  page_url?: string;
}

export type ActionType =
  | 'add_negative_exact'
  | 'add_negative_phrase'
  | 'decrease_bid'
  | 'increase_bid'
  | 'pause_target'
  | 'enable_target'
  | 'increase_budget'
  | 'decrease_budget'
  | 'create_exact_keyword'
  | 'create_campaign';

export type EntityType = 'keyword' | 'target' | 'campaign' | 'ad_group';

// Server -> Agent: Task Status Update
export interface TaskStatusUpdate {
  task_id: string;
  status: TaskStatus;
  message?: string;
  screenshot_path?: string;
  progress_percent?: number;
}

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'success'
  | 'failed'
  | 'blocked'
  | 'cancelled';

// Agent -> Server: Action Result
export interface ActionResult {
  action_id: string;
  execution_status: ExecutionStatus;
  before_value: string;
  after_value: string;
  screenshot_before: string;
  screenshot_after: string;
  trace_path?: string;
  failure_reason?: string;
}

export type ExecutionStatus = 'success' | 'failed' | 'partial';
