import React, { useState } from 'react';
import { Agent, AgentStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { WorkflowAssignmentBadge } from './WorkflowAssignmentBadge';
import {
  Users,
  Search,
  Cpu,
  CheckSquare,
  Wrench,
  Clock,
  Sparkles,
  GitBranch,
  ExternalLink,
  Terminal,
} from 'lucide-react';

interface EmployeeRosterProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  /** Jump to a workflow run/node in Process Studio. */
  onOpenWorkflow?: (runId: string, node: string, source?: string) => void;
}

// Per-employee avatar theme (unselected state); WebDev gets the cyan/blue web look.
const AVATAR_THEME: Record<string, string> = {
  webdev: 'bg-sky-950/80 border-sky-500/60 text-sky-300',
};

export const EmployeeRoster: React.FC<EmployeeRosterProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onOpenWorkflow,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all');

  const filteredAgents = agents.filter((a) => {
    const matchesSearch =
      a.profile_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.current_model || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || a.status.toLowerCase() === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const statusCounts = agents.reduce((acc, a) => {
    const s = a.status.toLowerCase() as AgentStatus;
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<AgentStatus, number>);

  return (
    <aside className="employee-roster" aria-label="Employee roster">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-[#0f172a]/60 backdrop-blur-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="text-cyan-400" size={18} />
            <h2 className="font-semibold text-slate-100 text-sm tracking-wide uppercase">
              Employee Roster
            </h2>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-cyan-300 px-2.5 py-0.5 rounded-full border border-slate-700">
            {agents.length} AGENTS
          </span>
        </div>

        {/* Search Bar */}
        <div className="relative mb-3">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            placeholder="Search agents, roles, or models..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900/80 border border-slate-700/80 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
          />
        </div>

        {/* Status Filter Badges */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2 py-0.5 rounded-md font-medium transition ${
              statusFilter === 'all'
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({agents.length})
          </button>
          {(['working', 'researching', 'review', 'blocked', 'defect', 'awaiting_human', 'idle'] as AgentStatus[]).map((st) => {
            const count = statusCounts[st] || 0;
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(statusFilter === st ? 'all' : st)}
                className={`px-2 py-0.5 rounded-md capitalize font-medium whitespace-nowrap transition ${
                  statusFilter === st
                    ? 'bg-slate-700 text-white border border-slate-600'
                    : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {st.replace('_', ' ')} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Roster Cards List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filteredAgents.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No agents found matching the current filter.
          </div>
        ) : (
          filteredAgents.map((agent) => {
            const isSelected = selectedAgentId?.toLowerCase() === agent.id.toLowerCase();
            const assignment = agent.workflow_assignment ?? null;
            const openWorkflow = (runId: string, node: string) =>
              onOpenWorkflow?.(runId, node, agent.profile_name);

            return (
              <div
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={`group relative rounded-xl border p-3.5 transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'bg-slate-850/90 border-cyan-400/80 shadow-[0_0_20px_rgba(6,182,212,0.15)] ring-1 ring-cyan-400/30'
                    : 'bg-slate-900/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/90'
                }`}
              >
                {/* Top Row: Name, Role, and Status Badge */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2.5">
                    {/* Role Avatar Pill */}
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm border shadow-sm ${
                        isSelected
                          ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300'
                          : AVATAR_THEME[agent.id.toLowerCase()]
                            ?? 'bg-slate-800 border-slate-700 text-slate-300 group-hover:border-slate-600'
                      }`}
                    >
                      {agent.profile_name ? agent.profile_name[0] : 'A'}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-100 text-sm flex items-center gap-1.5">
                        {agent.profile_name}
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                        )}
                      </h3>
                      <p className="text-xs text-slate-400 font-medium">{agent.role}</p>
                      {assignment && onOpenWorkflow && (
                        <div className="mt-1 flex items-center gap-1">
                          <WorkflowAssignmentBadge assignment={assignment} onOpen={openWorkflow} />
                          {(agent.workflow_assignments?.length ?? 0) > 1 && (
                            <span className="text-[10px] text-slate-500 font-mono">
                              +{(agent.workflow_assignments?.length ?? 1) - 1}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <StatusBadge status={agent.status} size="sm" />
                </div>

                {/* Model / Provider Pill */}
                <div className="flex items-center gap-1.5 mb-2.5 text-[11px] text-slate-400">
                  <Cpu size={12} className="text-slate-500 shrink-0" />
                  <span className="font-mono bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800 text-slate-300 truncate max-w-[280px]">
                    {agent.current_model || 'anthropic/claude-3-5-sonnet'}
                  </span>
                </div>

                {/* Active workflow step (projected from Workflow Core) */}
                {assignment ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openWorkflow(assignment.run_id, assignment.node);
                    }}
                    disabled={!onOpenWorkflow}
                    className="w-full text-left mb-2.5 bg-slate-950/70 border border-cyan-900/70 hover:border-cyan-500/70 rounded-lg p-2.5 transition"
                    title="Open in Process Studio"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-cyan-400 uppercase font-mono">
                        <GitBranch size={11} />
                        Workflow Step
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                        {assignment.run_id}
                        <ExternalLink size={10} />
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 font-medium line-clamp-2">
                      {agent.current_task ?? assignment.current_task}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <span>Run: <strong className="text-slate-400">{assignment.run_status}</strong></span>
                      {agent.active_task_id && (
                        <span>• Bridge: <strong className="text-slate-400 font-mono">{agent.active_task_id}</strong></span>
                      )}
                    </div>
                  </button>
                ) : agent.bridge_task ? (
                  <div className="mb-2.5 bg-slate-950/70 border border-emerald-900/70 rounded-lg p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-emerald-400 uppercase font-mono">
                        <Terminal size={11} />
                        Bridge Task
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 truncate max-w-[140px]">
                        {agent.bridge_task.task_id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 font-medium line-clamp-2">
                      {agent.bridge_task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <span>Executor: <strong className="text-slate-400">{agent.bridge_task.executor || '?'}</strong></span>
                      <span>• {agent.bridge_task.is_live ? 'live' : agent.bridge_task.state}</span>
                    </div>
                  </div>
                ) : agent.active_task ? (
                  <div className="mb-2.5 bg-slate-950/70 border border-slate-800/90 rounded-lg p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-cyan-400 uppercase font-mono">
                        <CheckSquare size={11} />
                        Active Task
                      </span>
                      <span className="text-[10px] font-mono bg-cyan-950/80 text-cyan-300 px-1.5 py-0.2 rounded border border-cyan-800/50">
                        {agent.active_task.kanban_task_id || 'TASK'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 font-medium line-clamp-2">
                      {agent.active_task.title || 'In progress task execution'}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <span>Status: <strong className="text-slate-400">{agent.active_task.status}</strong></span>
                      {agent.active_task.priority && (
                        <span>• Priority: <strong className="text-slate-400">{agent.active_task.priority}</strong></span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mb-2.5 py-1.5 px-2.5 rounded bg-slate-950/40 border border-slate-850 text-[11px] text-slate-500 italic flex items-center gap-1.5">
                    <Clock size={11} />
                    No active task assigned
                  </div>
                )}

                {/* Last Tool Call / Activity Log */}
                {agent.last_tool_call ? (
                  <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800/60 text-[11px]">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                      <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400 font-medium">
                        <Wrench size={11} />
                        Last Tool Call
                      </span>
                      {agent.last_tool_call.latency_ms !== undefined && (
                        <span className="font-mono text-[9px] text-slate-500">
                          {Math.round(agent.last_tool_call.latency_ms)}ms
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-cyan-300 font-medium truncate">
                      {agent.last_tool_call.tool_name || agent.last_tool_call.event_type}
                    </div>
                    {agent.last_tool_call.tool_input_preview && (
                      <p className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">
                        in: {agent.last_tool_call.tool_input_preview}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-500 italic flex items-center gap-1 mt-1">
                    <Sparkles size={10} />
                    Awaiting telemetry events
                  </div>
                )}

                {/* Capabilities Tags */}
                {agent.capabilities && agent.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2.5 pt-2 border-t border-slate-800/60">
                    {agent.capabilities.slice(0, 4).map((cap, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono bg-slate-800/60 text-slate-400 px-1.5 py-0.5 rounded"
                      >
                        {cap}
                      </span>
                    ))}
                    {agent.capabilities.length > 4 && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        +{agent.capabilities.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
