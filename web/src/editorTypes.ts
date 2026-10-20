/**
 * Node Editor v1 Domain Types & Contracts.
 * Conforms to schemas/node-editor-v1.schema.json and docs/node-editor-contracts.md.
 */

export type PortKind = 'control' | 'data' | 'status';
export type PortDirection = 'input' | 'output';

export type ControlOutcome =
  | 'exec_in'
  | 'success'
  | 'defect'
  | 'timeout'
  | 'failure'
  | 'cancel'
  | 'quota_exhausted'
  | 'accept_partial'
  | 'recover'
  | 'stop'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'true'
  | 'false'
  | 'loop_body'
  | 'loop_exit'
  | 'joined';

export type StatusKind = 'quota_wait' | 'approval_wait';

export type DataType =
  | 'ChangeRequest'
  | 'CommitRef'
  | 'ArtifactRef'
  | 'EvidenceRef'
  | 'TaskRef'
  | 'InspectionResult'
  | 'ApprovalRef'
  | 'PartialResult'
  | 'SecretRef'
  | 'string'
  | 'number'
  | 'boolean';

export type Cardinality = 'single' | 'multiple';

export interface EditorPort {
  id: string;
  name: string;
  direction: PortDirection;
  kind: PortKind;
  control_outcome?: ControlOutcome;
  status_kind?: StatusKind;
  data_type?: DataType | string;
  required?: boolean;
  cardinality?: Cardinality;
}

export type NodeType =
  | 'Start'
  | 'Work'
  | 'InspectResult'
  | 'LoopGate'
  | 'IndependentAcceptance'
  | 'Condition'
  | 'Approval'
  | 'End';

export interface EditorNodeDeadlines {
  queue_timeout_seconds?: number;
  execution_timeout_seconds?: number;
}

export interface EditorNodeBudgets {
  max_attempts?: number;
  max_subagents?: number;
  max_cost_micros?: number;
}

export interface EditorNode {
  id: string;
  type: NodeType | string;
  name: string;
  role?: string;
  route_policy_id?: string;
  goal?: string;
  deadlines?: EditorNodeDeadlines;
  budgets?: EditorNodeBudgets;
  config?: Record<string, unknown>;
  ports: EditorPort[];
}

export interface EditorEdge {
  id: string;
  kind: PortKind;
  source_node_id: string;
  source_port_id: string;
  target_node_id: string;
  target_port_id: string;
}

export interface EditorGraphLayout {
  viewport?: { x: number; y: number; zoom: number };
  nodes?: Record<string, { x: number; y: number; width?: number; height?: number }>;
}

export interface RoleDefinition {
  role_id: string;
  title: string;
  allowed_executors: ('omo' | 'claude')[];
  default_route_policy_id: string;
}

export interface RoutingRoute {
  route_id: string;
  provider: string;
  model: string;
  executor: 'omo' | 'claude';
  enabled: boolean;
  cooldown_seconds?: number;
}

export interface RoutingPolicy {
  policy_id: string;
  revision: number;
  strategy: 'priority' | 'round_robin';
  routes: RoutingRoute[];
}

export interface ApprovalPolicy {
  scope: string;
  required_role: string;
  timeout_seconds?: number;
  auto_action_on_expiry?: 'deny' | 'expire';
}

export interface EditorPolicies {
  routing_policies: RoutingPolicy[];
  approval_policies: ApprovalPolicy[];
}

export interface EditorLimits {
  max_total_attempts?: number;
  max_total_iterations?: number;
  max_workflow_duration_seconds?: number;
}

export interface EditorGraphDefinition {
  schema_version: string;
  graph_id: string;
  name: string;
  description?: string;
  version: number;
  definition_hash: string;
  canonical?: boolean;
  entrypoint: string;
  layout?: EditorGraphLayout;
  roles: Record<string, RoleDefinition>;
  policies: EditorPolicies;
  limits: EditorLimits;
  nodes: EditorNode[];
  edges: EditorEdge[];
}

export interface DraftSummary {
  draft_id: string;
  graph_id?: string;
  name?: string;
  revision: number;
  updated_at: number;
  created_at?: number;
}

export interface DraftRecord {
  draft_id: string;
  graph_id: string;
  revision: number;
  graph: EditorGraphDefinition;
  created_at: number;
  updated_at: number;
}

export interface SaveDraftResponse {
  status: string;
  draft_id: string;
  revision: number;
}

export interface ValidateResponse {
  status: string;
  valid: boolean;
  errors: string[];
  definition_hash?: string | null;
}

export interface PublishResponse {
  status: string;
  graph_id: string;
  version: number;
  definition_hash: string;
  canonical_hash?: string;
}

export interface ConflictErrorData {
  status: 'error';
  message: string;
  conflict: boolean;
  current_revision: number;
  expected_revision?: number;
}
