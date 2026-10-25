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
  border: string;
  bg: string;
  text: string;
  badgeBg: string;
  badgeText: string;
  icon: LucideIcon | null;
  pulse: boolean;
}> = {
  pending: {
    border: 'border-neutral-700',
    bg: 'bg-neutral-900/90',
    text: 'text-neutral-400',
    badgeBg: 'bg-neutral-800',
    badgeText: 'text-neutral-400',
    icon: null,
    pulse: false,
  },
  running: {
    border: 'border-cyan-500',
    bg: 'bg-cyan-950/40',
    text: 'text-cyan-300',
    badgeBg: 'bg-cyan-900/60',
    badgeText: 'text-cyan-300',
    icon: null,
    pulse: true,
  },
  succeeded: {
    border: 'border-emerald-500',
    bg: 'bg-emerald-950/30',
    text: 'text-emerald-300',
    badgeBg: 'bg-emerald-900/50',
    badgeText: 'text-emerald-300',
    icon: CheckCircle2,
    pulse: false,
  },
  defect: {
    border: 'border-amber-500',
    bg: 'bg-amber-950/30',
    text: 'text-amber-300',
    badgeBg: 'bg-amber-900/50',
    badgeText: 'text-amber-300',
    icon: RotateCcw,
    pulse: false,
  },
  timeout: {
    border: 'border-orange-500',
    bg: 'bg-orange-950/30',
    text: 'text-orange-300',
    badgeBg: 'bg-orange-900/50',
    badgeText: 'text-orange-300',
    icon: Clock,
    pulse: false,
  },
  failure: {
    border: 'border-rose-500',
    bg: 'bg-rose-950/30',
    text: 'text-rose-300',
    badgeBg: 'bg-rose-900/50',
    badgeText: 'text-rose-300',
    icon: XCircle,
    pulse: false,
  },
  cancelled: {
    border: 'border-neutral-700',
    bg: 'bg-neutral-900/60',
    text: 'text-neutral-500',
    badgeBg: 'bg-neutral-800',
    badgeText: 'text-neutral-500',
    icon: XCircle,
    pulse: false,
  },
  quota: {
    border: 'border-amber-600',
    bg: 'bg-amber-950/30',
    text: 'text-amber-400',
    badgeBg: 'bg-amber-900/50',
    badgeText: 'text-amber-400',
    icon: AlertTriangle,
    pulse: false,
  },
  approval_wait: {
    border: 'border-purple-500',
    bg: 'bg-purple-950/40',
    text: 'text-purple-300',
    badgeBg: 'bg-purple-900/60',
    badgeText: 'text-purple-300',
    icon: AlertTriangle,
    pulse: true,
  },
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
