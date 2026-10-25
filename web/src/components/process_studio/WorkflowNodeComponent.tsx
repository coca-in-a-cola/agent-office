import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { LucideIcon, ShieldAlert, Zap, CheckCircle2, Clock, AlertTriangle, XCircle, RotateCcw } from 'lucide-react';
import { NodeRunState } from '../../workflowTypes';
import '../../styles/components/workflow-node.scss';

export interface WorkflowNodeData {
  name: string;
  role: string;
  goal: string;
  runState?: NodeRunState;
  requiresApproval?: boolean;
  sideEffecting?: boolean;
  inputScope?: 'project' | 'task' | 'batch';
  isMandatoryPublication?: boolean;
  isCurrent?: boolean;
  isSelected?: boolean;
  isHighlighted?: boolean;
  onSelect?: (name: string) => void;
}

const STATUS_CONFIG: Record<string, {
  icon: LucideIcon | null;
  pulse: boolean;
}> = {
  pending:       { icon: null,         pulse: false },
  running:       { icon: null,         pulse: true  },
  succeeded:     { icon: CheckCircle2, pulse: false },
  defect:        { icon: RotateCcw,    pulse: false },
  timeout:       { icon: Clock,        pulse: false },
  failure:       { icon: XCircle,      pulse: false },
  cancelled:     { icon: XCircle,      pulse: false },
  quota:         { icon: AlertTriangle,pulse: false },
  approval_wait: { icon: AlertTriangle,pulse: true  },
};

export const WorkflowNodeComponent: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as unknown as WorkflowNodeData;
  const {
    name,
    role,
    goal,
    runState,
    requiresApproval,
    sideEffecting,
    inputScope,
    isMandatoryPublication,
    isCurrent,
    isHighlighted,
  } = nodeData;

  const state = runState?.state || 'pending';
  const statusConfig = STATUS_CONFIG[state] || STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;

  const isSelected = Boolean(selected || nodeData.isSelected);
  const isPulse = Boolean(statusConfig.pulse);

  const rootClasses = [
    'ps-workflow-node',
    `ps-workflow-node--${state}`,
    isSelected ? 'ps-workflow-node--selected' : '',
    isHighlighted ? 'ps-workflow-node--highlighted' : '',
    isPulse ? 'ps-workflow-node--pulse' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClasses}
      onClick={() => nodeData.onSelect?.(name)}
      title={goal}
    >
      {/* Target handle on left */}
      <Handle
        type="target"
        position={Position.Left}
        className="ps-workflow-node__handle"
      />

      {/* Current indicator banner */}
      {isCurrent && (
        <div className="ps-workflow-node__current-badge">
          Active Step
        </div>
      )}

      {/* Header: Title and Role */}
      <div className="ps-workflow-node__header">
        <div className="ps-workflow-node__info">
          <h4 className="ps-workflow-node__name">
            {name}
          </h4>
          <div className="ps-workflow-node__meta">
            <span className="ps-workflow-node__role">
              {role}
            </span>
            {inputScope === 'project' && (
              <span className="ps-workflow-node__scope-badge ps-workflow-node__scope-badge--project">
                [PROJECT]
              </span>
            )}
            {inputScope === 'task' && (
              <span className="ps-workflow-node__scope-badge ps-workflow-node__scope-badge--task">
                [TASK]
              </span>
            )}
            {inputScope === 'batch' && (
              <span className="ps-workflow-node__scope-badge ps-workflow-node__scope-badge--batch">
                [BATCH]
              </span>
            )}
            {isMandatoryPublication && (
              <span className="ps-workflow-node__scope-badge ps-workflow-node__scope-badge--release-gate">
                ★ RELEASE GATE
              </span>
            )}
          </div>
        </div>

        {/* Badges: Gate and Side-effect */}
        <div className="ps-workflow-node__flags">
          {requiresApproval && (
            <span
              title="Requires manual approval gate"
              className="ps-workflow-node__flag ps-workflow-node__flag--approval"
            >
              <ShieldAlert size={11} />
            </span>
          )}
          {sideEffecting && (
            <span
              title="Side-effecting operation (irreversible)"
              className="ps-workflow-node__flag ps-workflow-node__flag--side-effect"
            >
              <Zap size={11} />
            </span>
          )}
        </div>
      </div>

      {/* Footer: State badge and attempts counter */}
      <div className="ps-workflow-node__footer">
        <div
          className={`ps-workflow-node__state-badge ps-workflow-node__state-badge--${state}`}
        >
          {StatusIcon && <StatusIcon size={10} />}
          <span>{state}</span>
        </div>

        {runState && runState.attempts > 0 && (
          <span className="ps-workflow-node__attempts">
            it{runState.iteration} · {runState.attempts}×
          </span>
        )}
      </div>

      {/* Source handle on right */}
      <Handle
        type="source"
        position={Position.Right}
        className="ps-workflow-node__handle"
      />
    </div>
  );
};
