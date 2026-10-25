import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { TaskLog } from '../types';
import { transport } from '../api/transport';
import { FileText, Radio, Terminal, X } from 'lucide-react';
import '../styles/components/task-drilldown-modal.scss';

const STATE_STYLES: Record<string, string> = {
  running: 'bridge-state-badge--running',
  queued: 'bridge-state-badge--queued',
  succeeded: 'bridge-state-badge--succeeded',
  failed: 'bridge-state-badge--failed',
  cancelled: 'bridge-state-badge--cancelled',
  needs_approval: 'bridge-state-badge--needs-approval',
  'needs-approval': 'bridge-state-badge--needs-approval',
  degraded: 'bridge-state-badge--degraded',
};

/** Task Bridge task state pill (running / succeeded / failed / ...). */
export const BridgeStateBadge: React.FC<{ state: string }> = ({ state }) => (
  <span
    className={`bridge-state-badge ${
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

export const TERMINAL_CLASS = 'terminal-viewport';

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
      className="task-drilldown-modal__overlay"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Task Bridge drill-down"
        className="task-drilldown-modal__dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="task-drilldown-modal__header">
          <div className="task-drilldown-modal__header-info">
            <span className="task-drilldown-modal__subtitle">
              <Terminal size={12} className="task-drilldown-modal__subtitle-icon" />
              Task Bridge Drill-down
              {data?.is_live && (
                <span className="task-drilldown-modal__live-badge">
                  <Radio size={11} className="task-drilldown-modal__live-icon" /> live
                </span>
              )}
            </span>
            <h3 className="task-drilldown-modal__title">{task?.title ?? taskId}</h3>
            <div className="task-drilldown-modal__task-id">{taskId}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="task-drilldown-modal__close-btn"
          >
            <X size={18} />
          </button>
        </div>

        {error && !data && <div className="task-drilldown-modal__error">Could not load task log: {error}</div>}

        {task && (
          <>
            {/* Execution facts */}
            <div className="task-drilldown-modal__facts">
              <div className="task-drilldown-modal__fact">
                <div className="task-drilldown-modal__fact-label">Status</div>
                <BridgeStateBadge state={task.state} />
              </div>
              <div className="task-drilldown-modal__fact task-drilldown-modal__fact--grow">
                <div className="task-drilldown-modal__fact-label">Model</div>
                <div className="task-drilldown-modal__fact-value" title={task.model}>{task.model || '—'}</div>
              </div>
              <div className="task-drilldown-modal__fact">
                <div className="task-drilldown-modal__fact-label">Executor</div>
                <div className="task-drilldown-modal__fact-value">{task.executor || '—'}</div>
              </div>
              <div className="task-drilldown-modal__fact">
                <div className="task-drilldown-modal__fact-label">Duration</div>
                <div className="task-drilldown-modal__fact-value">{formatDuration(task.duration_seconds)}</div>
              </div>
            </div>
            {task.error && (
              <div className="task-drilldown-modal__task-error">
                {task.error}
              </div>
            )}

            {/* Tabs */}
            <div className="task-drilldown-modal__tabs" role="tablist">
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
                  className={`task-drilldown-modal__tab ${
                    tab === id ? 'task-drilldown-modal__tab--active' : ''
                  }`}
                >
                  {label}
                </button>
              )))}
            </div>

            <div className="task-drilldown-modal__body">
              {stream ? (
                <>
                  <div className="task-drilldown-modal__stream-meta">
                    {stream.path ?? 'log file not found'}
                    {stream.truncated && ' · showing last 512 KB'}
                  </div>
                  <pre className={`${TERMINAL_CLASS} task-drilldown-modal__terminal`}>
                    {stream.text || (stream.path ? '(empty)' : '(no log captured for this task)')}
                  </pre>
                </>
              ) : (
                <ul className="task-drilldown-modal__artifacts">
                  {data?.artifacts.length ? (
                    data.artifacts.map((a) => (
                      <li
                        key={a.path}
                        className="task-drilldown-modal__artifact-item"
                      >
                        <span className="task-drilldown-modal__artifact-name">
                          <FileText size={12} className={a.exists ? 'task-drilldown-modal__artifact-icon--active' : 'task-drilldown-modal__artifact-icon--missing'} />
                          <span className="task-drilldown-modal__artifact-path" title={a.path}>{a.path}</span>
                        </span>
                        <span className="task-drilldown-modal__artifact-size">
                          {formatBytes(a.size_bytes)}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="task-drilldown-modal__artifacts-empty">No artifacts recorded.</li>
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
