// =============================================
// Agent Protocol Types
// =============================================

export type AgentStatus =
  | 'offline'
  | 'online'
  | 'running'
  | 'waiting_approval'
  | 'blocked'
  | 'error';

export interface AgentInfo {
  agent_id: string;
  status: AgentStatus;
  machine_name?: string;
  os_version?: string;
  browser_version?: string;
  last_heartbeat: string;
  current_task_id?: string;
  blocked_reason?: string;
}

export interface BrowserProfile {
  profile_id: string;
  profile_path: string;
  status: 'active' | 'inactive' | 'corrupted';
  last_used?: string;
  login_expired?: boolean;
}

export interface PageModel {
  page_name: string;
  url_pattern: {
    domain: string;
    path_pattern: string;
  };
  required_texts: string[];
  table_headers?: string[];
  filters?: string[];
  actions: string[];
  success_toasts: string[];
  error_toasts: string[];
  locators: Record<string, ElementLocator>;
}

export interface ElementLocator {
  primary: LocatorDefinition;
  fallbacks?: LocatorDefinition[];
  must_be_inside?: string; // page section name
  allow_coordinate_click?: boolean;
}

export interface LocatorDefinition {
  type: 'role' | 'text' | 'css' | 'xpath' | 'label' | 'aria';
  value: string;
}

export type RiskLevel = 'AUTO_ALLOWED' | 'APPROVAL_REQUIRED' | 'FORBIDDEN';
