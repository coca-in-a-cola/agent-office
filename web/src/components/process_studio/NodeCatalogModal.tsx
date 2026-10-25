import React from 'react';
import { X, Play, Cpu, ShieldCheck, RotateCcw, CheckCircle, AlertOctagon } from 'lucide-react';
import { EditorNode, EditorPort } from '../../editorTypes';
import '../../styles/components/node-catalog-modal.scss';

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
    icon: <Play size={16} className="ps-catalog-modal__icon ps-catalog-modal__icon--cyan" />,
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
    icon: <Cpu size={16} className="ps-catalog-modal__icon ps-catalog-modal__icon--purple" />,
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
    icon: <ShieldCheck size={16} className="ps-catalog-modal__icon ps-catalog-modal__icon--amber" />,
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
    icon: <RotateCcw size={16} className="ps-catalog-modal__icon ps-catalog-modal__icon--emerald" />,
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
    icon: <CheckCircle size={16} className="ps-catalog-modal__icon ps-catalog-modal__icon--blue" />,
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
    icon: <AlertOctagon size={16} className="ps-catalog-modal__icon ps-catalog-modal__icon--emerald" />,
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
    <div className="ps-catalog-modal__overlay">
      <div className="ps-catalog-modal__dialog">
        <div className="ps-catalog-modal__header">
          <h3 className="ps-catalog-modal__title">
            <span>Add Node from Catalog</span>
          </h3>
          <button onClick={onClose} className="ps-catalog-modal__close-btn" aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        <div className="ps-catalog-modal__list">
          {TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.type}
              onClick={() => handleSelect(tmpl)}
              className="ps-catalog-modal__item"
            >
              <div className="ps-catalog-modal__item-icon-box">
                {tmpl.icon}
              </div>
              <div className="ps-catalog-modal__item-content">
                <div className="ps-catalog-modal__item-header">
                  <h4 className="ps-catalog-modal__item-name">{tmpl.name}</h4>
                  <span className="ps-catalog-modal__item-type-badge">
                    {tmpl.type}
                  </span>
                </div>
                <p className="ps-catalog-modal__item-goal">{tmpl.goal}</p>
                <div className="ps-catalog-modal__item-meta">
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
