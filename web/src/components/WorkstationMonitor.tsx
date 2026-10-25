import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Agent, AgentMonitor } from '../types';
import { transport } from '../api/transport';
import { BridgeStateBadge, TERMINAL_CLASS, TaskDrilldownModal, formatDuration } from './TaskDrilldownModal';
import { Monitor, Radio } from 'lucide-react';
import { useState } from 'react';

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
    <div>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
        <Monitor size={13} className="text-amber-400" />
        Workstation Monitor
        {monitor?.is_live && (
          <span className="ml-auto flex items-center gap-1 text-emerald-400 normal-case font-medium">
            <Radio size={11} className="animate-pulse" /> live
          </span>
        )}
      </span>
      <span className="block text-[10px] text-slate-500 mb-2">Terminal Live Stream</span>

      {error && !monitor && <p className="text-red-400">Monitor unavailable: {error}</p>}

      {monitor && monitor.source === 'idle' ? (
        <div className="bg-slate-950/60 border border-dashed border-slate-800 rounded-lg p-4 text-center text-slate-500 italic">
          Agent workstation is idle (waiting for dispatch)
        </div>
      ) : monitor ? (
        <div className="space-y-2">
          {task && (
            <button
              type="button"
              onClick={() => setDrilldownId(task.task_id)}
              title="Open Task Bridge drill-down"
              className="w-full text-left bg-slate-950/80 border border-slate-800 hover:border-cyan-500/70 rounded-lg p-2.5 transition space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-cyan-300 text-[11px] truncate underline decoration-dotted">
                  {task.task_id}
                </span>
                <BridgeStateBadge state={task.state} />
              </div>
              <p className="text-slate-200 font-medium truncate">{task.title}</p>
              <div className="text-[10px] font-mono text-slate-500">
                {monitor.is_active ? 'active' : 'most recent'} · {task.executor || 'executor ?'} ·{' '}
                {task.model || 'model ?'} · {formatDuration(task.duration_seconds)}
              </div>
            </button>
          )}
          <pre ref={terminalRef} onScroll={onScroll} className={`${TERMINAL_CLASS} max-h-56 m-0`}>
            {lines.length > 0
              ? lines.join('\n')
              : task?.is_live
                ? '$ waiting for output…'
                : '(no output captured)'}
          </pre>
        </div>
      ) : (
        !error && <p className="text-slate-500 italic">Connecting to workstation…</p>
      )}

      {drilldownId && (
        <TaskDrilldownModal taskId={drilldownId} onClose={() => setDrilldownId(null)} />
      )}
    </div>
  );
};
