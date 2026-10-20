import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { LucideIcon, ShieldAlert, Zap, CheckCircle2, Clock, AlertTriangle, XCircle, RotateCcw } from 'lucide-react';
import { NodeRunState } from '../../workflowTypes';

export interface WorkflowNodeData {
  name: string;
  role: string;
  goal: string;
  runState?: NodeRunState;
  requiresApproval?: boolean;
  sideEffecting?: boolean;
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
    isCurrent,
    isHighlighted,
  } = nodeData;

  const state = runState?.state || 'pending';
  const statusConfig = STATUS_CONFIG[state] || STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;

  return (
    <div
      className={`relative rounded-xl border p-3.5 shadow-2xl transition-all duration-200 w-56 backdrop-blur-md cursor-pointer ${
        statusConfig.bg
      } ${
        selected || isHighlighted
          ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-neutral-950 border-cyan-400 shadow-cyan-500/20'
          : statusConfig.border
      } ${statusConfig.pulse ? 'ring-1 ring-cyan-500/50 shadow-lg shadow-cyan-500/10' : ''}`}
      onClick={() => nodeData.onSelect?.(name)}
      title={goal}
    >
      {/* Target handle on left */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-neutral-400 !border-2 !border-neutral-900 transition-colors hover:!bg-cyan-400"
      />

      {/* Current indicator banner */}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-cyan-500 text-neutral-950 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-md animate-pulse">
          Active Step
        </div>
      )}

      {/* Header: Title and Role */}
      <div className="flex items-start justify-between gap-1.5 mb-1.5">
        <div>
          <h4 className="font-semibold text-xs text-neutral-100 tracking-tight leading-snug">
            {name}
          </h4>
          <span className="text-[10px] font-mono text-neutral-400 block leading-tight">
            {role}
          </span>
        </div>

        {/* Badges: Gate and Side-effect */}
        <div className="flex items-center gap-1">
          {requiresApproval && (
            <span
              title="Requires manual approval gate"
              className="p-1 rounded bg-purple-950/80 border border-purple-800/60 text-purple-300"
            >
              <ShieldAlert size={11} />
            </span>
          )}
          {sideEffecting && (
            <span
              title="Side-effecting operation (irreversible)"
              className="p-1 rounded bg-orange-950/80 border border-orange-800/60 text-orange-300"
            >
              <Zap size={11} />
            </span>
          )}
        </div>
      </div>

      {/* Footer: State badge and attempts counter */}
      <div className="flex items-center justify-between pt-2 border-t border-neutral-800/70 text-[10px]">
        <div
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded font-mono font-medium uppercase tracking-wider ${statusConfig.badgeBg} ${statusConfig.badgeText}`}
        >
          {StatusIcon && <StatusIcon size={10} />}
          <span>{state}</span>
        </div>

        {runState && runState.attempts > 0 && (
          <span className="font-mono text-neutral-400 text-[10px]">
            it{runState.iteration} · {runState.attempts}×
          </span>
        )}
      </div>

      {/* Source handle on right */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-neutral-400 !border-2 !border-neutral-900 transition-colors hover:!bg-cyan-400"
      />
    </div>
  );
};
