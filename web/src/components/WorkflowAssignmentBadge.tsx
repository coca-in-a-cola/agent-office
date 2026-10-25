import React from 'react';
import { GitBranch } from 'lucide-react';
import { AgentStatus, WorkflowAssignment } from '../types';
import '../styles/components/workflow-assignment-badge.scss';

// Desk status colours shared by the isometric badge and roster pill.
export const DESK_STATUS_COLOR: Record<AgentStatus, string> = {
  working: '#34d399',
  researching: '#60a5fa',
  review: '#fbbf24',
  blocked: '#f43f5e',
  awaiting_human: '#c084fc',
  defect: '#fb923c',
  idle: '#94a3b8',
};

export const deskStatusColor = (status: string): string =>
  DESK_STATUS_COLOR[status as AgentStatus] ?? DESK_STATUS_COLOR.idle;

interface WorkflowAssignmentBadgeProps {
  assignment: WorkflowAssignment;
  onOpen: (runId: string, node: string) => void;
}

/** Clickable pill "⎇ node" that jumps to the run/node in Process Studio. */
export const WorkflowAssignmentBadge: React.FC<WorkflowAssignmentBadgeProps> = ({
  assignment,
  onOpen,
}) => {
  const color = deskStatusColor(assignment.status);
  const normalizedStatus = (assignment.status || '').toLowerCase().replace(/_/g, '-');
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(assignment.run_id, assignment.node);
      }}
      title={`${assignment.current_task} (${assignment.run_status}) — open in Process Studio`}
      className={`workflow-assignment-badge workflow-assignment-badge--${normalizedStatus}`}
      style={{ borderColor: `${color}80`, color }}
    >
      <GitBranch size={10} className="workflow-assignment-badge__icon" />
      <span className="workflow-assignment-badge__node">{assignment.node}</span>
      {assignment.assignment === 'approver' && (
        <span className="workflow-assignment-badge__approver">· approve</span>
      )}
    </button>
  );
};
