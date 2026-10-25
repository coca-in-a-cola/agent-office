import React, { useState } from 'react';
import { FileDigit, GitCommit, History, ListTree, ScrollText, Workflow } from 'lucide-react';
import { Attempt, RunDetail, WorkflowNode } from '../../workflowTypes';
import { NodeStatusBadge, RunStatusBadge } from './NodeStatusBadge';
import '../../styles/components/run-inspector.scss';

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
  <div className="ps-run-inspector__section">
    <span className="ps-run-inspector__section-title">
      {icon}
      {title}
    </span>
    {children}
  </div>
);

const KV: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <>
    <dt className="ps-run-inspector__dt">{k}</dt>
    <dd className="ps-run-inspector__dd">{v ?? '—'}</dd>
  </>
);

const AttemptCard: React.FC<{ attempt: Attempt; current: boolean }> = ({ attempt, current }) => (
  <div
    className={`ps-attempt-card ${
      current ? 'ps-attempt-card--current' : ''
    } ${attempt.stale ? 'ps-attempt-card--stale' : ''}`}
  >
    <div className="ps-attempt-card__header">
      <span className="ps-attempt-card__id">{attempt.attempt_id}</span>
      <NodeStatusBadge state={ATTEMPT_STATE[attempt.status]} />
    </div>
    <dl className="ps-attempt-card__dl">
      <KV k="task (Bridge)" v={attempt.task_id} />
      <KV k="producer" v={attempt.producer} />
      <KV k="submitted" v={fmtTime(attempt.submitted_at)} />
      <KV k="deadline" v={fmtTime(attempt.deadline_at)} />
      <KV k="finished" v={fmtTime(attempt.finished_at)} />
      {attempt.stale && <KV k="stale" v="evidence invalidated by a later iteration" />}
    </dl>
    {attempt.reason && (
      <p className="ps-attempt-card__reason">
        {attempt.reason}
      </p>
    )}
    {Object.keys(attempt.artifacts).length > 0 && (
      <div className="ps-attempt-card__artifacts">
        {Object.entries(attempt.artifacts).map(([name, digest]) => (
          <div key={name} className="ps-attempt-card__artifact-row">
            <span className="ps-attempt-card__artifact-name">{name}</span>
            <span className="ps-attempt-card__artifact-digest" title={digest}>
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
    <div className="ps-run-inspector">
      <Section title="Run" icon={<Workflow size={13} className="ps-run-inspector__section-icon--run" />}>
        <div className="ps-run-inspector__run-header">
          <span className="ps-run-inspector__run-id">{run.run_id}</span>
          <RunStatusBadge status={run.status} paused={run.paused} />
        </div>
        {run.status_reason && <p className="ps-run-inspector__status-reason">{run.status_reason}</p>}
        <dl className="ps-run-inspector__dl">
          <KV k="definition" v={`${run.definition_name} v${run.definition_version}`} />
          <KV k="pinned hash" v={<span title={run.definition_hash}>{run.definition_hash.slice(0, 23)}…</span>} />
          <KV k="current node" v={run.current_node} />
          <KV k="source_sha" v={run.source_sha} />
          <KV k="goal" v={String(run.inputs.goal ?? '')} />
          <KV k="bridge" v={detail.bridge} />
        </dl>
      </Section>

      <Section title="Current attempt" icon={<GitCommit size={13} className="ps-run-inspector__section-icon--attempt" />}>
        {current ? (
          <dl className="ps-run-inspector__dl">
            <KV k="attempt id" v={current.attempt_id} />
            <KV k="Task Bridge id" v={current.task_id ?? 'not yet submitted'} />
            <KV k="idempotency" v={current.idempotency_key} />
            <KV k="status" v={current.status} />
          </dl>
        ) : (
          <p className="ps-run-inspector__empty">No attempt yet.</p>
        )}
      </Section>

      {node && (
        <Section
          title={`Node: ${node.name}`}
          icon={<ListTree size={13} className="ps-run-inspector__section-icon--node" />}
        >
          <div className="ps-run-inspector__node-header">
            <NodeStatusBadge state={nodeState?.state} />
            <span className="ps-run-inspector__node-role">role {node.role}</span>
          </div>
          <p className="ps-run-inspector__node-goal">{node.goal}</p>
          <dl className="ps-run-inspector__dl">
            <KV k="inputs" v={node.inputs.join(', ') || '—'} />
            <KV k="outputs" v={node.expected_artifacts.join(', ') || '—'} />
            <KV k="executor/model" v={`${node.allowed_executors.join('|')} / ${node.allowed_models.join('|')}`} />
            <KV k="timeout" v={`${node.timeout_seconds}s`} />
            <KV k="bounds" v={`${node.max_attempts} attempts × ${node.max_iterations} iterations`} />
            {node.requires_approval && <KV k="approval" v={node.approval_scope} />}
          </dl>
        </Section>
      )}

      <div className="ps-run-inspector__tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`ps-run-inspector__tab ${
              tab === t.id ? 'ps-run-inspector__tab--active' : ''
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'attempts' && (
        <div className="ps-run-inspector__tab-content">
          {attempts.length === 0 && <p className="ps-run-inspector__empty">No attempts for this node.</p>}
          {attempts.map((a) => (
            <AttemptCard key={a.attempt_id} attempt={a} current={a.attempt_id === current?.attempt_id} />
          ))}
        </div>
      )}

      {tab === 'timeline' && (
        <ol className="ps-run-inspector__timeline">
          {detail.timeline
            .slice()
            .reverse()
            .map((t) => (
              <li key={t.seq} className="ps-run-inspector__timeline-item">
                <div className="ps-run-inspector__timeline-header">
                  <span className="ps-run-inspector__timeline-transition">
                    #{t.seq} {t.from_node ?? '·'} —{t.outcome}→ {t.target}
                  </span>
                  <span className="ps-run-inspector__timeline-time">{fmtTime(t.created_at)}</span>
                </div>
                {t.reason && <div className="ps-run-inspector__timeline-reason">{t.reason}</div>}
              </li>
            ))}
        </ol>
      )}

      {tab === 'logs' && (
        <div className="ps-run-inspector__logs">
          {detail.logs.length === 0 && <p className="ps-run-inspector__empty">No log lines yet.</p>}
          {detail.logs.map((l, i) => (
            <div key={i} className="ps-run-inspector__log-row">
              <span className="ps-run-inspector__log-time">{fmtTime(l.at)}</span>
              <span
                className={`ps-run-inspector__log-source ${
                  l.source === 'bridge'
                    ? 'ps-run-inspector__log-source--bridge'
                    : l.source === 'engine'
                    ? 'ps-run-inspector__log-source--engine'
                    : ''
                }`}
              >
                [{l.source}]
              </span>
              <span className="ps-run-inspector__log-message">{l.message}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'evidence' && (
        <div className="ps-run-inspector__tab-content">
          {Object.keys(detail.evidence_digests).length === 0 && (
            <p className="ps-run-inspector__empty">No evidence recorded yet.</p>
          )}
          {Object.entries(detail.evidence_digests).map(([attemptId, digests]) => (
            <div key={attemptId} className="ps-run-inspector__evidence-card">
              <div className="ps-run-inspector__evidence-attempt">{attemptId}</div>
              {Object.entries(digests).map(([name, digest]) => (
                <div key={name} className="ps-run-inspector__evidence-row">
                  <span className="ps-run-inspector__evidence-name">{name}</span>
                  <span className="ps-run-inspector__evidence-digest">{digest}</span>
                </div>
              ))}
            </div>
          ))}
          {detail.gates.length > 0 && (
            <div className="ps-run-inspector__gates-card">
              <div className="ps-run-inspector__gates-title">Approval gates</div>
              {detail.gates.map((g) => (
                <div key={g.gate_id} className="ps-run-inspector__gate-row">
                  {g.gate_id}: <span className="ps-run-inspector__gate-status">{g.status}</span>
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
