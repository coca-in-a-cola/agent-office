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

/** Task Bridge task summary (server: TaskBridgeReader._summarize). */
export interface BridgeTask {
  task_id: string;
  title: string;
  state: string;
  executor: string;
  model: string;
  requested_model?: string;
  repo?: string;
  working_dir?: string;
  project_id?: string | null;
  complexity?: string;
  progress_summary?: string;
  error?: string;
  exit_code?: number | null;
  git_sha?: string | null;
  pid?: number | null;
  artifacts: string[];
  created_at?: number | null;
  updated_at?: number | null;
  started_at?: number | null;
  completed_at?: number | null;
  duration_seconds?: number | null;
  is_live: boolean;
  workstation: string;
}

/** GET /api/agents/{id}/monitor */
export interface AgentMonitor {
  status: string;
  timestamp: number;
  agent: Pick<Agent, 'id' | 'profile_name' | 'role' | 'status' | 'current_model'
    | 'current_task' | 'active_task_id' | 'workflow_run_id' | 'workflow_node'>;
  source: 'task_bridge' | 'activity' | 'idle';
  task: BridgeTask | null;
  is_active: boolean;
  is_live: boolean;
  tail_lines: number;
  stdout_tail: string[];
  stderr_tail: string[];
  activity: string[];
}

export interface TaskLogStream {
  path: string | null;
  text: string;
  size_bytes: number;
  truncated: boolean;
  error?: string;
}

export interface TaskArtifact {
  path: string;
  name: string;
  exists: boolean;
  size_bytes: number | null;
}

/** GET /api/tasks/{id}/log */
export interface TaskLog {
  status: string;
  timestamp: number;
  task: BridgeTask;
  is_live: boolean;
  stdout: TaskLogStream;
  stderr: TaskLogStream;
  artifacts: TaskArtifact[];
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
  bridge_task?: BridgeTask | null;
  bridge_tasks?: BridgeTask[];
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
    bridge_ingestion?: 'ok' | 'disabled' | 'error';
    bridge_tasks?: number;
    bridge_active_tasks?: number;
  };
}
