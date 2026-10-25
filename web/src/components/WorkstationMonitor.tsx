import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Agent, AgentMonitor } from '../types';
import { transport } from '../api/transport';
import { BridgeStateBadge, TERMINAL_CLASS, TaskDrilldownModal, formatDuration } from './TaskDrilldownModal';
import { Monitor, Radio } from 'lucide-react';
import '../styles/components/workstation-monitor.scss';

interface WorkstationMonitorProps {
  agent: Agent;
}

/** Query key factory: scoped per agent id so switching agents never shows stale data. */
export const agentMonitorKey = (agentId: string) => ['agentMonitor', agentId] as const;

/** Agent's "monitor": live terminal tail of its Task Bridge task (or activity feed). */
export const WorkstationMonitor: React.FC<WorkstationMonitorProps> = ({ agent }) => {
  const [drilldownId, setDrilldownId] = useState<string | null>(null);
  const terminalRef = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);

  const isWorking = agent.status === 'working';

  // Reset scroll-follow and drilldown whenever we switch to a different agent.
  useEffect(() => {
    stickToBottom.current = true;
    setDrilldownId(null);
  }, [agent.id]);

  const { data: monitor, error: queryError } = useQuery<AgentMonitor>({
    queryKey: agentMonitorKey(agent.id),
    queryFn: ({ signal }) =>
      transport<AgentMonitor>(`/api/agents/${encodeURIComponent(agent.id)}/monitor`, { signal }),
    // Poll every 3 s while the agent is working; single fetch otherwise.
    refetchInterval: isWorking ? 3000 : false,
    // v5: refetchInterval callback receives the Query object — use the simpler boolean
    // form here since isWorking is already captured in the closure.
    staleTime: 0,
  });

  const error = queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null;

  // Follow the tail like a terminal unless the user scrolled up.
  useEffect(() => {
    const el = terminalRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [monitor]);

  const onScroll = () => {
    const el = terminalRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const task = monitor?.task ?? null;
  const lines = monitor
    ? monitor.source === 'task_bridge'
      ? [...monitor.stdout_tail, ...monitor.stderr_tail.map((l) => `[stderr] ${l}`)]
      : monitor.activity
    : [];

  return (
    <div className="workstation-monitor">
      <span className="workstation-monitor__title">
        <Monitor size={13} className="workstation-monitor__title-icon" />
        Workstation Monitor
        {monitor?.is_live && (
          <span className="workstation-monitor__live-badge">
            <Radio size={11} className="workstation-monitor__live-icon" /> live
          </span>
        )}
      </span>
      <span className="workstation-monitor__subtitle">Terminal Live Stream</span>

      {error && !monitor && <p className="workstation-monitor__error">Monitor unavailable: {error}</p>}

      {monitor && monitor.source === 'idle' ? (
        <div className="workstation-monitor__idle">
          Agent workstation is idle (waiting for dispatch)
        </div>
      ) : monitor ? (
        <div className="workstation-monitor__content">
          {task && (
            <button
              type="button"
              onClick={() => setDrilldownId(task.task_id)}
              title="Open Task Bridge drill-down"
              className="workstation-monitor__task-card"
            >
              <div className="workstation-monitor__task-header">
                <span className="workstation-monitor__task-id">
                  {task.task_id}
                </span>
                <BridgeStateBadge state={task.state} />
              </div>
              <p className="workstation-monitor__task-title">{task.title}</p>
              <div className="workstation-monitor__task-meta">
                {monitor.is_active ? 'active' : 'most recent'} · {task.executor || 'executor ?'} ·{' '}
                {task.model || 'model ?'} · {formatDuration(task.duration_seconds)}
              </div>
            </button>
          )}
          <pre ref={terminalRef} onScroll={onScroll} className={`${TERMINAL_CLASS} workstation-monitor__terminal`}>
            {lines.length > 0
              ? lines.join('\n')
              : task?.is_live
                ? '$ waiting for output…'
                : '(no output captured)'}
          </pre>
        </div>
      ) : (
        !error && <p className="workstation-monitor__connecting">Connecting to workstation…</p>
      )}

      {drilldownId && (
        <TaskDrilldownModal taskId={drilldownId} onClose={() => setDrilldownId(null)} />
      )}
    </div>
  );
};
