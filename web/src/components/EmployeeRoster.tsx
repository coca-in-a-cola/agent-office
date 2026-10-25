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
import '../styles/components/employee-roster.scss';

interface EmployeeRosterProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  /** Jump to a workflow run/node in Process Studio. */
  onOpenWorkflow?: (runId: string, node: string, source?: string) => void;
}

const AGENT_ROLE_AVATAR_MODIFIERS: Record<string, string> = {
  webdev: 'roster-avatar--webdev',
};

const getAvatarModifier = (agent: Agent, isSelected: boolean): string => {
  if (isSelected) {
    return 'roster-avatar--selected';
  }
  const idKey = (agent.id || '').toLowerCase();
  const roleKey = (agent.role || '').toLowerCase();
  return (
    AGENT_ROLE_AVATAR_MODIFIERS[idKey] ||
    AGENT_ROLE_AVATAR_MODIFIERS[roleKey] ||
    'roster-avatar--default'
  );
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
      <div className="roster-header">
        <div className="roster-header__top">
          <div className="roster-header__title-group">
            <Users className="roster-header__icon" size={18} />
            <h2 className="roster-header__title">
              Employee Roster
            </h2>
          </div>
          <span className="roster-header__count">
            {agents.length} AGENTS
          </span>
        </div>

        {/* Search Bar */}
        <div className="roster-search">
          <Search
            size={14}
            className="roster-search__icon"
          />
          <input
            type="text"
            placeholder="Search agents, roles, or models..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="roster-search__input"
          />
        </div>

        {/* Status Filter Badges */}
        <div className="roster-filter-bar">
          <button
            onClick={() => setStatusFilter('all')}
            className={`roster-filter-btn ${
              statusFilter === 'all' ? 'roster-filter-btn--active-all' : ''
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
                className={`roster-filter-btn ${
                  statusFilter === st ? 'roster-filter-btn--active-status' : ''
                }`}
              >
                {st.replace('_', ' ')} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Roster Cards List */}
      <div className="roster-list">
        {filteredAgents.length === 0 ? (
          <div className="roster-empty">
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
                className={`roster-card ${
                  isSelected ? 'roster-card--selected' : ''
                }`}
              >
                {/* Top Row: Name, Role, and Status Badge */}
                <div className="roster-card__top">
                  <div className="roster-card__identity">
                    {/* Role Avatar Pill */}
                    <div
                      className={`roster-avatar ${getAvatarModifier(agent, isSelected)}`}
                    >
                      {agent.profile_name ? agent.profile_name[0] : 'A'}
                    </div>
                    <div className="roster-card__name-block">
                      <h3 className="roster-card__name">
                        {agent.profile_name}
                        {isSelected && (
                          <span className="roster-card__name-ping" />
                        )}
                      </h3>
                      <p className="roster-card__role">{agent.role}</p>
                      {assignment && onOpenWorkflow && (
                        <div className="roster-card__workflow-row">
                          <WorkflowAssignmentBadge assignment={assignment} onOpen={openWorkflow} />
                          {(agent.workflow_assignments?.length ?? 0) > 1 && (
                            <span className="roster-card__workflow-more">
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
                <div className="roster-card__model-row">
                  <Cpu size={12} className="roster-card__model-icon" />
                  <span className="roster-card__model-pill">
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
                    className="roster-task-block roster-task-block--workflow"
                    title="Open in Process Studio"
                  >
                    <div className="roster-task-block__header">
                      <span className="roster-task-block__label roster-task-block__label--workflow">
                        <GitBranch size={11} />
                        Workflow Step
                      </span>
                      <span className="roster-task-block__meta">
                        {assignment.run_id}
                        <ExternalLink size={10} />
                      </span>
                    </div>
                    <p className="roster-task-block__title">
                      {agent.current_task ?? assignment.current_task}
                    </p>
                    <div className="roster-task-block__footer">
                      <span>Run: <strong>{assignment.run_status}</strong></span>
                      {agent.active_task_id && (
                        <span>• Bridge: <strong>{agent.active_task_id}</strong></span>
                      )}
                    </div>
                  </button>
                ) : agent.bridge_task ? (
                  <div className="roster-task-block roster-task-block--bridge">
                    <div className="roster-task-block__header">
                      <span className="roster-task-block__label roster-task-block__label--bridge">
                        <Terminal size={11} />
                        Bridge Task
                      </span>
                      <span className="roster-task-block__meta">
                        {agent.bridge_task.task_id}
                      </span>
                    </div>
                    <p className="roster-task-block__title">
                      {agent.bridge_task.title}
                    </p>
                    <div className="roster-task-block__footer">
                      <span>Executor: <strong>{agent.bridge_task.executor || '?'}</strong></span>
                      <span>• {agent.bridge_task.is_live ? 'live' : agent.bridge_task.state}</span>
                    </div>
                  </div>
                ) : agent.active_task ? (
                  <div className="roster-task-block roster-task-block--task">
                    <div className="roster-task-block__header">
                      <span className="roster-task-block__label roster-task-block__label--task">
                        <CheckSquare size={11} />
                        Active Task
                      </span>
                      <span className="roster-task-block__meta-pill">
                        {agent.active_task.kanban_task_id || 'TASK'}
                      </span>
                    </div>
                    <p className="roster-task-block__title">
                      {agent.active_task.title || 'In progress task execution'}
                    </p>
                    <div className="roster-task-block__footer">
                      <span>Status: <strong>{agent.active_task.status}</strong></span>
                      {agent.active_task.priority && (
                        <span>• Priority: <strong>{agent.active_task.priority}</strong></span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="roster-task-block roster-task-block--empty">
                    <div className="roster-task-block__empty-text">
                      <Clock size={11} />
                      No active task assigned
                    </div>
                  </div>
                )}

                {/* Last Tool Call / Activity Log */}
                {agent.last_tool_call ? (
                  <div className="roster-tool-block">
                    <div className="roster-tool-block__header">
                      <span className="roster-tool-block__label">
                        <Wrench size={11} />
                        Last Tool Call
                      </span>
                      {agent.last_tool_call.latency_ms !== undefined && (
                        <span className="roster-tool-block__latency">
                          {Math.round(agent.last_tool_call.latency_ms)}ms
                        </span>
                      )}
                    </div>
                    <div className="roster-tool-block__name">
                      {agent.last_tool_call.tool_name || agent.last_tool_call.event_type}
                    </div>
                    {agent.last_tool_call.tool_input_preview && (
                      <p className="roster-tool-block__preview">
                        in: {agent.last_tool_call.tool_input_preview}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="roster-no-telemetry">
                    <Sparkles size={10} />
                    Awaiting telemetry events
                  </div>
                )}

                {/* Capabilities Tags */}
                {agent.capabilities && agent.capabilities.length > 0 && (
                  <div className="roster-capabilities">
                    {agent.capabilities.slice(0, 4).map((cap, i) => (
                      <span
                        key={i}
                        className="roster-capability-tag"
                      >
                        {cap}
                      </span>
                    ))}
                    {agent.capabilities.length > 4 && (
                      <span className="roster-capability-overflow">
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
