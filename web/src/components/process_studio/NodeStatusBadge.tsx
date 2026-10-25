import React from 'react';
import { NodeState } from '../../workflowTypes';
import '../../styles/components/node-status-badge.scss';

interface StateStyle {
  label: string;
  stroke: string; // SVG outline / dot colour
  fill: string; // SVG node fill
  badge: string; // Semantic badge modifier class
  pulse: boolean;
}

// Process Studio legend: pending gray, running blue pulse, succeeded green,
// defect amber, timeout orange, failure red, approval_wait purple pulse.
export const NODE_STATE_STYLE: Record<NodeState, StateStyle> = {
  pending: {
    label: 'Pending',
    stroke: '#64748b',
    fill: '#1e293b',
    badge: 'node-status-badge--pending',
    pulse: false,
  },
  running: {
    label: 'Running',
    stroke: '#3b82f6',
    fill: '#172554',
    badge: 'node-status-badge--running',
    pulse: true,
  },
  succeeded: {
    label: 'Succeeded',
    stroke: '#22c55e',
    fill: '#052e16',
    badge: 'node-status-badge--succeeded',
    pulse: false,
  },
  defect: {
    label: 'Defect',
    stroke: '#f59e0b',
    fill: '#451a03',
    badge: 'node-status-badge--defect',
    pulse: false,
  },
  timeout: {
    label: 'Timeout',
    stroke: '#f97316',
    fill: '#431407',
    badge: 'node-status-badge--timeout',
    pulse: false,
  },
  failure: {
    label: 'Failure',
    stroke: '#ef4444',
    fill: '#450a0a',
    badge: 'node-status-badge--failure',
    pulse: false,
  },
  approval_wait: {
    label: 'Approval wait',
    stroke: '#a855f7',
    fill: '#3b0764',
    badge: 'node-status-badge--approval-wait',
    pulse: true,
  },
  cancelled: {
    label: 'Cancelled',
    stroke: '#94a3b8',
    fill: '#0f172a',
    badge: 'node-status-badge--cancelled',
    pulse: false,
  },
  quota: {
    label: 'Quota wait',
    stroke: '#06b6d4',
    fill: '#083344',
    badge: 'node-status-badge--quota',
    pulse: false,
  },
};

export const styleFor = (state: string | undefined): StateStyle =>
  NODE_STATE_STYLE[(state as NodeState) ?? 'pending'] ?? NODE_STATE_STYLE.pending;

export const NodeStatusBadge: React.FC<{ state: string | undefined }> = ({ state }) => {
  const style = styleFor(state);
  return (
    <span className={`node-status-badge ${style.badge}`}>
      <span className="node-status-badge__dot-wrapper">
        {style.pulse && (
          <span
            className="node-status-badge__pulse-ring"
            style={{ backgroundColor: style.stroke }}
          />
        )}
        <span
          className="node-status-badge__dot"
          style={{ backgroundColor: style.stroke }}
        />
      </span>
      <span className="node-status-badge__label">{style.label}</span>
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
    <span className="run-status-badge-group">
      <span className={`run-status-badge ${style.badge}`}>
        {status.replace('_', ' ')}
      </span>
      {paused && (
        <span className="run-status-badge run-status-badge--paused">
          paused
        </span>
      )}
    </span>
  );
};
