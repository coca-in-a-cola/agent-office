// Types mirroring the /api/workflow/* JSON produced by agent_office.workflow.service.

export type NodeState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'defect'
  | 'timeout'
  | 'failure'
  | 'approval_wait'
  | 'cancelled'
  | 'quota';

export type RunStatus =
  | 'running'
  | 'waiting_approval'
  | 'quota_wait'
  | 'inspecting'
  | 'cancelling'
  | 'blocked'
  | 'cancelled'
  | 'completed';

export interface DefinitionSummary {
  definition_hash: string;
  name: string;
  version: number;
  created_at: number;
  start: string;
  node_count: number;
  canonical: boolean;
}

export interface WorkflowNode {
  name: string;
  role: string;
  goal: string;
  allowed_executors: string[];
  allowed_models: string[];
  inputs: string[];
  expected_artifacts: string[];
  required_fields: string[];
  completion_criteria: string[];
  timeout_seconds: number;
  max_attempts: number;
  max_iterations: number;
  side_effecting: boolean;
  requires_approval: boolean;
  approval_scope: string;
}

export interface WorkflowTransition {
  source: string;
  outcome: string;
  target: string;
}

export interface WorkflowDefinition {
  definition_hash: string;
  name: string;
  version: number;
  start: string;
  canonical: boolean;
  nodes: WorkflowNode[];
  roles: Record<string, string>;
  node_order: string[];
  allowed_transitions: WorkflowTransition[];
}

export interface RunSummary {
  run_id: string;
  definition_hash: string;
  definition_name: string;
  definition_version: number;
  status: RunStatus;
  status_reason: string;
  current_node: string | null;
  paused: boolean;
  active: boolean;
  attempt_count: number;
  goal: string;
  created_at: number;
  updated_at: number;
}

export interface Receipt {
  event_id: string;
  outcome: string;
  disposition: string;
  received_at: number;
}

export interface Attempt {
  attempt_id: string;
  node: string;
  iteration: number;
  attempt_no: number;
  status: string;
  task_id: string | null;
  idempotency_key: string;
  stale: boolean;
  producer: string | null;
  reason: string;
  evidence: Record<string, unknown> | null;
  artifacts: Record<string, string>;
  created_at: number;
  submitted_at: number | null;
  deadline_at: number | null;
  finished_at: number | null;
  receipts: Receipt[];
}

export interface Gate {
  gate_id: string;
  node: string;
  iteration: number;
  scope: string;
  evidence_digest: string;
  status: string;
  approver: string | null;
  decided_at: number | null;
  expires_at: number | null;
  created_at: number;
}

export interface TimelineEntry {
  seq: number;
  attempt_id: string | null;
  event_id: string | null;
  from_node: string | null;
  outcome: string;
  target: string;
  reason: string;
  created_at: number;
}

export interface LogLine {
  at: number | null;
  attempt_id: string;
  source: 'coordinator' | 'bridge' | 'engine';
  message: string;
}

export interface NodeRunState {
  state: NodeState;
  attempts: number;
  iteration: number;
  stale: boolean;
  last_attempt_id: string | null;
  is_current: boolean;
}

export interface RunActions {
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  approve: boolean;
  retry: boolean;
}

export interface RunDetail {
  run: {
    run_id: string;
    definition_hash: string;
    definition_name: string;
    definition_version: number;
    status: RunStatus;
    status_reason: string;
    current_node: string | null;
    source_sha: string | null;
    inputs: Record<string, unknown>;
    due_at: number | null;
    created_at: number;
    updated_at: number;
    paused: boolean;
  };
  current_attempt: Attempt | null;
  attempts: Attempt[];
  node_states: Record<string, NodeRunState>;
  gates: Gate[];
  pending_gate: Gate | null;
  timeline: TimelineEntry[];
  logs: LogLine[];
  evidence_digests: Record<string, Record<string, string>>;
  actions: RunActions;
  bridge: string;
}
