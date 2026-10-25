import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { TaskLog } from '../types';
import { transport } from '../api/transport';
import { FileText, Radio, Terminal, X } from 'lucide-react';

const STATE_STYLES: Record<string, string> = {
  running: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60',
  queued: 'bg-slate-800 text-slate-300 border-slate-600',
  succeeded: 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60',
  failed: 'bg-red-950/80 text-red-300 border-red-700/60',
  cancelled: 'bg-slate-800 text-slate-400 border-slate-600',
  needs_approval: 'bg-purple-950/80 text-purple-300 border-purple-700/60',
  degraded: 'bg-amber-950/80 text-amber-300 border-amber-700/60',
};

/** Task Bridge task state pill (running / succeeded / failed / ...). */
export const BridgeStateBadge: React.FC<{ state: string }> = ({ state }) => (
  <span
    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wide ${
      STATE_STYLES[state] ?? STATE_STYLES.queued
    }`}
  >
    {state.replace('_', ' ') || 'unknown'}
  </span>
);

export const formatDuration = (seconds?: number | null): string => {
  if (seconds === undefined || seconds === null) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}h ${m}m ${rest}s`;
  if (m > 0) return `${m}m ${rest}s`;
  return `${rest}s`;
};

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return 'missing';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const TERMINAL_CLASS =
  'bg-black text-green-400 font-mono text-xs p-3 rounded-lg border border-neutral-800 overflow-y-auto whitespace-pre-wrap';

type Tab = 'stdout' | 'stderr' | 'artifacts';

interface TaskDrilldownModalProps {
  taskId: string;
  onClose: () => void;
}

/** Query key factory for task log polling. */
export const taskLogKey = (taskId: string) => ['taskLog', taskId] as const;

/** Task Bridge drill-down: full task header plus stdout / stderr / artifacts tabs. */
export const TaskDrilldownModal: React.FC<TaskDrilldownModalProps> = ({ taskId, onClose }) => {
  const [tab, setTab] = useState<Tab>('stdout');

  const { data, error: queryError } = useQuery<TaskLog>({
    queryKey: taskLogKey(taskId),
    queryFn: ({ signal }) =>
      transport<TaskLog>(`/api/tasks/${encodeURIComponent(taskId)}/log`, { signal }),
    // Poll while the task process is alive; v5 refetchInterval can be a function
    // receiving the Query — use data directly from closure (updated each render).
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.is_live ? 3000 : false;
    },
    // Modal is always mounted when rendered; no additional enabled guard needed
    // because the parent only renders it when taskId is truthy.
    staleTime: 0,
  });

  const error = queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const task = data?.task;
  const stream = tab === 'stdout' ? data?.stdout : tab === 'stderr' ? data?.stderr : null;

  // Portal: the inspector drawer's backdrop-filter would otherwise contain `fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Task Bridge drill-down"
        className="w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Terminal size={12} className="text-cyan-400" />
              Task Bridge Drill-down
              {data?.is_live && (
                <span className="flex items-center gap-1 text-emerald-400 normal-case">
                  <Radio size={11} className="animate-pulse" /> live
                </span>
              )}
            </span>
            <h3 className="font-bold text-slate-100 text-sm truncate">{task?.title ?? taskId}</h3>
            <div className="font-mono text-[11px] text-cyan-300 break-all">{taskId}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {error && !data && <div className="p-4 text-red-400">Could not load task log: {error}</div>}

        {task && (
          <>
            {/* Execution facts */}
            <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-800">
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Status</div>
                <BridgeStateBadge state={task.state} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-slate-500 uppercase mb-1">Model</div>
                <div className="font-mono text-slate-200 truncate" title={task.model}>{task.model || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Executor</div>
                <div className="font-mono text-slate-200">{task.executor || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Duration</div>
                <div className="font-mono text-slate-200">{formatDuration(task.duration_seconds)}</div>
              </div>
            </div>
            {task.error && (
              <div className="mx-4 mt-3 p-2 rounded bg-red-950/60 border border-red-800/60 text-red-300 font-mono text-[11px] whitespace-pre-wrap">
                {task.error}
              </div>
            )}

            {/* Tabs */}
            <div className="px-4 pt-3 flex gap-1" role="tablist">
              {(([
                ['stdout', 'Stdout Log'],
                ['stderr', 'Stderr Log'],
                ['artifacts', `Artifacts (${data?.artifacts.length ?? 0})`],
              ] as [Tab, string][]).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`px-3 py-1 rounded-md font-medium transition ${
                    tab === id
                      ? 'bg-cyan-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200 bg-slate-950/60'
                  }`}
                >
                  {label}
                </button>
              )))}
            </div>

            <div className="p-4 flex-1 min-h-0 flex flex-col">
              {stream ? (
                <>
                  <div className="text-[10px] font-mono text-slate-500 mb-1.5 truncate">
                    {stream.path ?? 'log file not found'}
                    {stream.truncated && ' · showing last 512 KB'}
                  </div>
                  <pre className={`${TERMINAL_CLASS} flex-1 min-h-[12rem] max-h-[55vh] m-0`}>
                    {stream.text || (stream.path ? '(empty)' : '(no log captured for this task)')}
                  </pre>
                </>
              ) : (
                <ul className="space-y-1.5 overflow-y-auto max-h-[55vh]">
                  {data?.artifacts.length ? (
                    data.artifacts.map((a) => (
                      <li
                        key={a.path}
                        className="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800 rounded p-2"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <FileText size={12} className={a.exists ? 'text-cyan-400' : 'text-slate-600'} />
                          <span className="font-mono text-slate-200 truncate" title={a.path}>{a.path}</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          {formatBytes(a.size_bytes)}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="text-slate-500 italic">No artifacts recorded.</li>
                  )}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
