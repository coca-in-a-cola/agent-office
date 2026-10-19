import React from 'react';
import { GitBranch } from 'lucide-react';
import { AgentStatus, WorkflowAssignment } from '../types';

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
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(assignment.run_id, assignment.node);
      }}
      title={`${assignment.current_task} (${assignment.run_status}) — open in Process Studio`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-medium bg-slate-950/80 hover:bg-slate-800 transition"
      style={{ borderColor: `${color}80`, color }}
    >
      <GitBranch size={10} />
      {assignment.node}
      {assignment.assignment === 'approver' && <span className="text-slate-400">· approve</span>}
    </button>
  );
};
