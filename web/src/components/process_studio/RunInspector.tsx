import React, { useState } from 'react';
import { FileDigit, GitCommit, History, ListTree, ScrollText, Workflow } from 'lucide-react';
import { Attempt, RunDetail, WorkflowNode } from '../../workflowTypes';
import { NodeStatusBadge, RunStatusBadge } from './NodeStatusBadge';

interface RunInspectorProps {
  detail: RunDetail;
  selectedNode: string | null;
  node: WorkflowNode | undefined;
}

type Tab = 'attempts' | 'timeline' | 'logs' | 'evidence';

const ATTEMPT_STATE: Record<string, string> = {
  pending: 'running',
  submitted: 'running',
  succeeded: 'succeeded',
  defect: 'defect',
  timed_out: 'timeout',
  failed: 'failure',
  cancelled: 'cancelled',
  quota: 'quota',
  awaiting_approval: 'approval_wait',
};

const fmtTime = (t: number | null | undefined) =>
  t ? new Date(t * 1000).toLocaleTimeString() : '—';

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  children,
}) => (
  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2">
    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
      {icon}
      {title}
    </span>
    {children}
  </div>
);

const KV: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <>
    <dt className="text-slate-500">{k}</dt>
    <dd className="text-slate-200 break-all">{v ?? '—'}</dd>
  </>
);

const AttemptCard: React.FC<{ attempt: Attempt; current: boolean }> = ({ attempt, current }) => (
  <div
    className={`rounded-lg border p-2.5 space-y-1.5 ${
      current ? 'border-cyan-500/60 bg-cyan-950/20' : 'border-slate-800 bg-slate-900/60'
    } ${attempt.stale ? 'opacity-60' : ''}`}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[11px] text-cyan-300 truncate">{attempt.attempt_id}</span>
      <NodeStatusBadge state={ATTEMPT_STATE[attempt.status]} />
    </div>
    <dl className="grid grid-cols-[96px_1fr] gap-y-0.5 font-mono text-[10px]">
      <KV k="task (Bridge)" v={attempt.task_id} />
      <KV k="producer" v={attempt.producer} />
      <KV k="submitted" v={fmtTime(attempt.submitted_at)} />
      <KV k="deadline" v={fmtTime(attempt.deadline_at)} />
      <KV k="finished" v={fmtTime(attempt.finished_at)} />
      {attempt.stale && <KV k="stale" v="evidence invalidated by a later iteration" />}
    </dl>
    {attempt.reason && (
      <p className="text-[10px] text-amber-200/90 bg-slate-950/70 rounded px-1.5 py-1 font-mono">
        {attempt.reason}
      </p>
    )}
    {Object.keys(attempt.artifacts).length > 0 && (
      <div className="space-y-0.5">
        {Object.entries(attempt.artifacts).map(([name, digest]) => (
          <div key={name} className="font-mono text-[10px] flex gap-2">
            <span className="text-emerald-300 shrink-0">{name}</span>
            <span className="text-slate-400 truncate" title={digest}>
              {digest}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

export const RunInspector: React.FC<RunInspectorProps> = ({ detail, selectedNode, node }) => {
  const [tab, setTab] = useState<Tab>('attempts');
  const { run, current_attempt: current } = detail;
  const attempts = (selectedNode
    ? detail.attempts.filter((a) => a.node === selectedNode)
    : detail.attempts
  ).slice().reverse();
  const nodeState = selectedNode ? detail.node_states[selectedNode] : undefined;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'attempts', label: `Attempts (${attempts.length})`, icon: <ListTree size={12} /> },
    { id: 'timeline', label: 'Timeline', icon: <History size={12} /> },
    { id: 'logs', label: 'Logs', icon: <ScrollText size={12} /> },
    { id: 'evidence', label: 'Evidence', icon: <FileDigit size={12} /> },
  ];

  return (
    <div className="flex flex-col gap-3 text-xs">
      <Section title="Run" icon={<Workflow size={13} className="text-cyan-400" />}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-cyan-300 font-semibold">{run.run_id}</span>
          <RunStatusBadge status={run.status} paused={run.paused} />
        </div>
        {run.status_reason && <p className="text-slate-300">{run.status_reason}</p>}
        <dl className="grid grid-cols-[110px_1fr] gap-y-0.5 font-mono text-[10px]">
          <KV k="definition" v={`${run.definition_name} v${run.definition_version}`} />
          <KV k="pinned hash" v={<span title={run.definition_hash}>{run.definition_hash.slice(0, 23)}…</span>} />
          <KV k="current node" v={run.current_node} />
          <KV k="source_sha" v={run.source_sha} />
          <KV k="goal" v={String(run.inputs.goal ?? '')} />
          <KV k="bridge" v={detail.bridge} />
        </dl>
      </Section>

      <Section title="Current attempt" icon={<GitCommit size={13} className="text-blue-400" />}>
        {current ? (
          <dl className="grid grid-cols-[110px_1fr] gap-y-0.5 font-mono text-[10px]">
            <KV k="attempt id" v={current.attempt_id} />
            <KV k="Task Bridge id" v={current.task_id ?? 'not yet submitted'} />
            <KV k="idempotency" v={current.idempotency_key} />
            <KV k="status" v={current.status} />
          </dl>
        ) : (
          <p className="text-slate-500 italic">No attempt yet.</p>
        )}
      </Section>

      {node && (
        <Section
          title={`Node: ${node.name}`}
          icon={<ListTree size={13} className="text-purple-400" />}
        >
          <div className="flex items-center gap-2">
            <NodeStatusBadge state={nodeState?.state} />
            <span className="text-slate-400 font-mono text-[10px]">role {node.role}</span>
          </div>
          <p className="text-slate-300">{node.goal}</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-0.5 font-mono text-[10px]">
            <KV k="inputs" v={node.inputs.join(', ') || '—'} />
            <KV k="outputs" v={node.expected_artifacts.join(', ') || '—'} />
            <KV k="executor/model" v={`${node.allowed_executors.join('|')} / ${node.allowed_models.join('|')}`} />
            <KV k="timeout" v={`${node.timeout_seconds}s`} />
            <KV k="bounds" v={`${node.max_attempts} attempts × ${node.max_iterations} iterations`} />
            {node.requires_approval && <KV k="approval" v={node.approval_scope} />}
          </dl>
        </Section>
      )}

      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
              tab === t.id ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'attempts' && (
        <div className="space-y-2">
          {attempts.length === 0 && <p className="text-slate-500 italic">No attempts for this node.</p>}
          {attempts.map((a) => (
            <AttemptCard key={a.attempt_id} attempt={a} current={a.attempt_id === current?.attempt_id} />
          ))}
        </div>
      )}

      {tab === 'timeline' && (
        <ol className="space-y-1 font-mono text-[10px]">
          {detail.timeline
            .slice()
            .reverse()
            .map((t) => (
              <li key={t.seq} className="bg-slate-900/70 border border-slate-800 rounded px-2 py-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-200">
                    #{t.seq} {t.from_node ?? '·'} —{t.outcome}→ {t.target}
                  </span>
                  <span className="text-slate-500">{fmtTime(t.created_at)}</span>
                </div>
                {t.reason && <div className="text-slate-400 break-all">{t.reason}</div>}
              </li>
            ))}
        </ol>
      )}

      {tab === 'logs' && (
        <div className="bg-black/60 border border-slate-800 rounded-lg p-2 font-mono text-[10px] space-y-0.5 max-h-80 overflow-y-auto">
          {detail.logs.length === 0 && <p className="text-slate-500">No log lines yet.</p>}
          {detail.logs.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-slate-500 shrink-0">{fmtTime(l.at)}</span>
              <span
                className={`shrink-0 ${
                  l.source === 'bridge' ? 'text-blue-300' : l.source === 'engine' ? 'text-amber-300' : 'text-slate-400'
                }`}
              >
                [{l.source}]
              </span>
              <span className="text-slate-200 break-all">{l.message}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'evidence' && (
        <div className="space-y-2">
          {Object.keys(detail.evidence_digests).length === 0 && (
            <p className="text-slate-500 italic">No evidence recorded yet.</p>
          )}
          {Object.entries(detail.evidence_digests).map(([attemptId, digests]) => (
            <div key={attemptId} className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 font-mono text-[10px]">
              <div className="text-cyan-300 mb-1">{attemptId}</div>
              {Object.entries(digests).map(([name, digest]) => (
                <div key={name} className="flex gap-2">
                  <span className="text-emerald-300 shrink-0">{name}</span>
                  <span className="text-slate-300 break-all">{digest}</span>
                </div>
              ))}
            </div>
          ))}
          {detail.gates.length > 0 && (
            <div className="bg-slate-900/70 border border-purple-800/60 rounded-lg p-2 font-mono text-[10px] space-y-1">
              <div className="text-purple-300">Approval gates</div>
              {detail.gates.map((g) => (
                <div key={g.gate_id} className="text-slate-300 break-all">
                  {g.gate_id}: <span className="text-purple-200">{g.status}</span>
                  {g.approver ? ` by ${g.approver}` : ''} — {g.scope}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
