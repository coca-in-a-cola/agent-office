export type AgentStatus =
  | 'working'
  | 'researching'
  | 'review'
  | 'blocked'
  | 'awaiting_human'
  | 'defect'
  | 'idle';

export interface TaskSnapshot {
  id: string;
  kanban_task_id: string;
  board_slug?: string;
  title?: string;
  status?: string;
  assignee?: string;
  priority?: string;
  updated_at?: number;
  raw_snapshot?: Record<string, unknown> | null;
}

export interface ActivityEvent {
  id: string;
  session_id?: string;
  event_type?: string;
  agent_id?: string;
  tool_name?: string;
  tool_input_preview?: string;
  tool_output_preview?: string;
  latency_ms?: number;
  status?: string;
  timestamp: number;
  details?: Record<string, unknown> | null;
}

/** One workflow node projected onto a workstation (server: workstation_assignments). */
export interface WorkflowAssignment {
  workstation: string;
  assignment: 'performer' | 'approver';
  status: AgentStatus;
  run_id: string;
  run_status: string;
  status_reason?: string | null;
  definition_name: string;
  title: string;
  node: string;
  role: string;
  current_task: string;
  attempt_id: string | null;
  attempt_status: string | null;
  iteration: number;
  task_id: string | null;
  gate_id: string | null;
  updated_at: number;
}

/** Process Studio deep link requested from Tycoon View. */
export interface StudioFocus {
  runId: string;
  node: string | null;
  source?: string;
  nonce: number;
}

export interface Agent {
  id: string;
  profile_name: string;
  role: string;
  status: AgentStatus;
  current_model?: string;
  capabilities?: string[];
  metadata?: {
    desk?: string;
    position?: [number, number];
    avatar?: string;
    [key: string]: unknown;
  };
  last_seen_at?: number;
  active_task?: TaskSnapshot | null;
  recent_activities?: ActivityEvent[];
  last_tool_call?: ActivityEvent | null;
  current_task?: string | null;
  active_task_id?: string | null;
  workflow_run_id?: string | null;
  workflow_node?: string | null;
  workflow_assignment?: WorkflowAssignment | null;
  workflow_assignments?: WorkflowAssignment[];
}

export interface OfficeState {
  status: string;
  timestamp: number;
  agents: Agent[];
  tasks: TaskSnapshot[];
  recent_activities: ActivityEvent[];
  meta: {
    is_fallback: boolean;
    db_path: string;
    total_agents: number;
    total_tasks: number;
    total_activities: number;
    workflow_projection?: 'ok' | 'disabled' | 'error';
    workflow_assignments?: number;
  };
}
