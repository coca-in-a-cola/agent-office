import React from 'react';
import { NodeState } from '../../workflowTypes';

interface StateStyle {
  label: string;
  stroke: string; // SVG outline / dot colour
  fill: string; // SVG node fill
  badge: string; // Tailwind classes for the pill
  pulse: boolean;
}

// Process Studio legend: pending gray, running blue pulse, succeeded green,
// defect amber, timeout orange, failure red, approval_wait purple pulse.
export const NODE_STATE_STYLE: Record<NodeState, StateStyle> = {
  pending: {
    label: 'Pending',
    stroke: '#64748b',
    fill: '#1e293b',
    badge: 'bg-slate-800 border-slate-600 text-slate-300',
    pulse: false,
  },
  running: {
    label: 'Running',
    stroke: '#3b82f6',
    fill: '#172554',
    badge: 'bg-blue-950 border-blue-500/60 text-blue-300',
    pulse: true,
  },
  succeeded: {
    label: 'Succeeded',
    stroke: '#22c55e',
    fill: '#052e16',
    badge: 'bg-emerald-950 border-emerald-500/60 text-emerald-300',
    pulse: false,
  },
  defect: {
    label: 'Defect',
    stroke: '#f59e0b',
    fill: '#451a03',
    badge: 'bg-amber-950 border-amber-500/60 text-amber-300',
    pulse: false,
  },
  timeout: {
    label: 'Timeout',
    stroke: '#f97316',
    fill: '#431407',
    badge: 'bg-orange-950 border-orange-500/60 text-orange-300',
    pulse: false,
  },
  failure: {
    label: 'Failure',
    stroke: '#ef4444',
    fill: '#450a0a',
    badge: 'bg-red-950 border-red-500/60 text-red-300',
    pulse: false,
  },
  approval_wait: {
    label: 'Approval wait',
    stroke: '#a855f7',
    fill: '#3b0764',
    badge: 'bg-purple-950 border-purple-500/60 text-purple-300',
    pulse: true,
  },
  cancelled: {
    label: 'Cancelled',
    stroke: '#94a3b8',
    fill: '#0f172a',
    badge: 'bg-slate-900 border-slate-500/60 text-slate-400 line-through',
    pulse: false,
  },
  quota: {
    label: 'Quota wait',
    stroke: '#06b6d4',
    fill: '#083344',
    badge: 'bg-cyan-950 border-cyan-500/60 text-cyan-300',
    pulse: false,
  },
};

export const styleFor = (state: string | undefined): StateStyle =>
  NODE_STATE_STYLE[(state as NodeState) ?? 'pending'] ?? NODE_STATE_STYLE.pending;

export const NodeStatusBadge: React.FC<{ state: string | undefined }> = ({ state }) => {
  const style = styleFor(state);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}
    >
      <span className="relative flex h-2 w-2">
        {style.pulse && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: style.stroke }}
          />
        )}
        <span
          className="relative inline-flex rounded-full h-2 w-2"
          style={{ backgroundColor: style.stroke }}
        />
      </span>
      {style.label}
    </span>
  );
};

const RUN_STATUS_STATE: Record<string, NodeState> = {
  running: 'running',
  waiting_approval: 'approval_wait',
  quota_wait: 'quota',
  inspecting: 'timeout',
  cancelling: 'cancelled',
  blocked: 'failure',
  cancelled: 'cancelled',
  completed: 'succeeded',
};

export const RunStatusBadge: React.FC<{ status: string; paused?: boolean }> = ({
  status,
  paused,
}) => {
  const style = styleFor(RUN_STATUS_STATE[status]);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}
      >
        {status.replace('_', ' ')}
      </span>
      {paused && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide bg-yellow-950 border-yellow-500/60 text-yellow-300">
          paused
        </span>
      )}
    </span>
  );
};
