import React from 'react';
import { X, Play, Cpu, ShieldCheck, RotateCcw, CheckCircle, AlertOctagon } from 'lucide-react';
import { EditorNode, EditorPort } from '../../editorTypes';

interface NodeCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddNode: (template: EditorNode) => void;
}

interface NodeTemplate {
  type: string;
  name: string;
  role?: string;
  goal: string;
  icon: React.ReactNode;
  deadlines?: { execution_timeout_seconds: number; queue_timeout_seconds: number };
  budgets?: { max_attempts: number; max_subagents: number };
  config?: Record<string, unknown>;
  ports: EditorPort[];
}

const TEMPLATES: NodeTemplate[] = [
  {
    type: 'Start',
    name: 'Admission Gate',
    goal: 'Validate incoming change request and allocate run workspace',
    icon: <Play size={16} className="text-cyan-400" />,
    ports: [
      {
        id: 'p_start_ctrl_out',
        name: 'Started',
        direction: 'output',
        kind: 'control',
        control_outcome: 'success',
      },
      {
        id: 'p_start_cr_out',
        name: 'Change Request',
        direction: 'output',
        kind: 'data',
        data_type: 'ChangeRequest',
        required: true,
        cardinality: 'single',
      },
    ],
  },
  {
    type: 'Work',
    name: 'Software Implementation',
    role: 'webdev',
    goal: 'Implement requested feature and commit to git with verified test exit',
    icon: <Cpu size={16} className="text-purple-400" />,
    deadlines: {
      execution_timeout_seconds: 1800,
      queue_timeout_seconds: 300,
    },
    budgets: {
      max_attempts: 3,
      max_subagents: 2,
    },
    config: {
      side_effecting: false,
      requires_approval: false,
      workspace_isolated: true,
    },
    ports: [
      {
        id: 'p_work_ctrl_in',
        name: 'Execute',
        direction: 'input',
        kind: 'control',
        control_outcome: 'exec_in',
      },
      {
        id: 'p_work_cr_in',
        name: 'Change Request',
        direction: 'input',
        kind: 'data',
        data_type: 'ChangeRequest',
        required: true,
        cardinality: 'single',
      },
      {
        id: 'p_work_succ',
        name: 'Success',
        direction: 'output',
        kind: 'control',
        control_outcome: 'success',
      },
      {
        id: 'p_work_defect',
        name: 'Defect',
        direction: 'output',
        kind: 'control',
        control_outcome: 'defect',
      },
      {
        id: 'p_work_timeout',
        name: 'Timeout',
        direction: 'output',
        kind: 'control',
        control_outcome: 'timeout',
      },
      {
        id: 'p_work_failure',
        name: 'Failure',
        direction: 'output',
        kind: 'control',
        control_outcome: 'failure',
      },
      {
        id: 'p_work_quota_wait',
        name: 'Quota Wait',
        direction: 'output',
        kind: 'status',
        status_kind: 'quota_wait',
      },
      {
        id: 'p_work_approval_wait',
        name: 'Approval Wait',
        direction: 'output',
        kind: 'status',
        status_kind: 'approval_wait',
      },
      {
        id: 'p_work_quota_exhausted',
        name: 'Quota Exhausted',
        direction: 'output',
        kind: 'control',
        control_outcome: 'quota_exhausted',
      },
      {
        id: 'p_work_commit_out',
        name: 'Commit Ref',
        direction: 'output',
        kind: 'data',
        data_type: 'CommitRef',
        required: false,
        cardinality: 'single',
      },
      {
        id: 'p_work_partial_out',
        name: 'Partial Result',
        direction: 'output',
        kind: 'data',
        data_type: 'PartialResult',
        required: false,
        cardinality: 'single',
      },
    ],
  },
  {
    type: 'InspectResult',
    name: 'Inspect Partial Snapshot',
    role: 'qa',
    goal: 'Verify whether timed-out execution yielded a clean quiescent commit or recoverable state',
    icon: <ShieldCheck size={16} className="text-amber-400" />,
    deadlines: {
      execution_timeout_seconds: 600,
      queue_timeout_seconds: 120,
    },
    budgets: {
      max_attempts: 1,
      max_subagents: 0,
    },
    ports: [
      {
        id: 'p_insp_ctrl_in',
        name: 'Inspect Trigger',
        direction: 'input',
        kind: 'control',
        control_outcome: 'exec_in',
      },
      {
        id: 'p_insp_partial_in',
        name: 'Partial Result In',
        direction: 'input',
        kind: 'data',
        data_type: 'PartialResult',
        required: true,
        cardinality: 'single',
      },
      {
        id: 'p_insp_accept_partial',
        name: 'Accept Partial',
        direction: 'output',
        kind: 'control',
        control_outcome: 'accept_partial',
      },
      {
        id: 'p_insp_recover',
        name: 'Recover Attempt',
        direction: 'output',
        kind: 'control',
        control_outcome: 'recover',
      },
      {
        id: 'p_insp_stop',
        name: 'Stop Run',
        direction: 'output',
        kind: 'control',
        control_outcome: 'stop',
      },
      {
        id: 'p_insp_commit_out',
        name: 'Recovered Commit',
        direction: 'output',
        kind: 'data',
        data_type: 'CommitRef',
        required: false,
        cardinality: 'single',
      },
      {
        id: 'p_insp_evidence_out',
        name: 'Inspection Evidence',
        direction: 'output',
        kind: 'data',
        data_type: 'EvidenceRef',
        required: true,
        cardinality: 'single',
      },
    ],
  },
  {
    type: 'LoopGate',
    name: 'Retry Gate',
    role: 'tyler',
    goal: 'Enforce bounded iteration count on implementation retries',
    icon: <RotateCcw size={16} className="text-emerald-400" />,
    config: {
      max_iterations: 3,
      loop_variable: 'retry_count',
    },
    ports: [
      {
        id: 'p_gate_ctrl_in',
        name: 'Gate Trigger',
        direction: 'input',
        kind: 'control',
        control_outcome: 'exec_in',
      },
      {
        id: 'p_gate_body',
        name: 'Iterate',
        direction: 'output',
        kind: 'control',
        control_outcome: 'loop_body',
      },
      {
        id: 'p_gate_exit',
        name: 'Exhausted',
        direction: 'output',
        kind: 'control',
        control_outcome: 'loop_exit',
      },
    ],
  },
  {
    type: 'IndependentAcceptance',
    name: 'Independent Acceptance',
    role: 'qa',
    goal: 'Verify implementation independently from author identity',
    icon: <CheckCircle size={16} className="text-blue-400" />,
    deadlines: {
      execution_timeout_seconds: 900,
      queue_timeout_seconds: 180,
    },
    budgets: {
      max_attempts: 2,
      max_subagents: 1,
    },
    ports: [
      {
        id: 'p_acc_ctrl_in',
        name: 'Acceptance Trigger',
        direction: 'input',
        kind: 'control',
        control_outcome: 'exec_in',
      },
      {
        id: 'p_acc_commit_in',
        name: 'Commit Under Review',
        direction: 'input',
        kind: 'data',
        data_type: 'CommitRef',
        required: true,
        cardinality: 'single',
      },
      {
        id: 'p_acc_succ',
        name: 'Accepted',
        direction: 'output',
        kind: 'control',
        control_outcome: 'success',
      },
      {
        id: 'p_acc_defect',
        name: 'Rejected',
        direction: 'output',
        kind: 'control',
        control_outcome: 'defect',
      },
      {
        id: 'p_acc_evidence_out',
        name: 'Review Evidence',
        direction: 'output',
        kind: 'data',
        data_type: 'EvidenceRef',
        required: true,
        cardinality: 'single',
      },
    ],
  },
  {
    type: 'End',
    name: 'Workflow Completed',
    goal: 'Record successful completion and release run resources',
    icon: <AlertOctagon size={16} className="text-emerald-400" />,
    config: {
      terminal_outcome: 'completed',
    },
    ports: [
      {
        id: 'p_end_in',
        name: 'Terminal In',
        direction: 'input',
        kind: 'control',
        control_outcome: 'exec_in',
      },
    ],
  },
];

export const NodeCatalogModal: React.FC<NodeCatalogModalProps> = ({ isOpen, onClose, onAddNode }) => {
  if (!isOpen) return null;

  const handleSelect = (template: NodeTemplate) => {
    const timestamp = Date.now().toString(36).slice(-4);
    const nodeId = `node_${template.type.toLowerCase()}_${timestamp}`;

    // Generate unique port IDs for this instance
    const ports = template.ports.map((p) => ({
      ...p,
      id: `${p.id}_${timestamp}`,
    }));

    const newNode: EditorNode = {
      id: nodeId,
      type: template.type,
      name: template.name,
      role: template.role,
      goal: template.goal,
      deadlines: template.deadlines ? { ...template.deadlines } : undefined,
      budgets: template.budgets ? { ...template.budgets } : undefined,
      config: template.config ? { ...template.config } : undefined,
      ports,
    };

    onAddNode(newNode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <span>Add Node from Catalog</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2.5 overflow-y-auto">
          {TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.type}
              onClick={() => handleSelect(tmpl)}
              className="p-3 bg-slate-950/70 border border-slate-800 hover:border-cyan-500/70 rounded-lg cursor-pointer transition flex items-start gap-3"
            >
              <div className="p-2 rounded bg-slate-900 border border-slate-800 shrink-0">
                {tmpl.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-xs text-slate-100">{tmpl.name}</h4>
                  <span className="text-[10px] font-mono uppercase bg-slate-800 px-1.5 py-0.5 rounded text-cyan-300">
                    {tmpl.type}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{tmpl.goal}</p>
                <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-slate-500">
                  {tmpl.role && <span>Role: {tmpl.role}</span>}
                  {tmpl.deadlines?.execution_timeout_seconds && (
                    <span>Timeout: {tmpl.deadlines.execution_timeout_seconds}s</span>
                  )}
                  <span>Ports: {tmpl.ports.length}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
