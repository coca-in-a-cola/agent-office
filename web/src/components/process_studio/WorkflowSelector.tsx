import React, { useState } from 'react';
import { Plus, Rocket } from 'lucide-react';
import { DefinitionSummary, RunSummary } from '../../workflowTypes';
import { RunStatusBadge } from './NodeStatusBadge';
import '../../styles/components/workflow-selector.scss';

interface WorkflowSelectorProps {
  runs: RunSummary[];
  definitions: DefinitionSummary[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onCreateRun: (input: { goal: string; repo: string; definition_hash: string }) => Promise<void>;
  busy: boolean;
}

export const WorkflowSelector: React.FC<WorkflowSelectorProps> = ({
  runs,
  definitions,
  selectedRunId,
  onSelectRun,
  onCreateRun,
  busy,
}) => {
  const canonical = definitions.find((d) => d.canonical) ?? definitions[0];
  const [formOpen, setFormOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [repo, setRepo] = useState('');
  const [definitionHash, setDefinitionHash] = useState('');
  const chosenHash = definitionHash || canonical?.definition_hash || '';
  const active = runs.filter((r) => r.active);
  const history = runs.filter((r) => !r.active);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreateRun({ goal: goal.trim(), repo: repo.trim(), definition_hash: chosenHash });
    setGoal('');
    setFormOpen(false);
  };

  const renderRun = (r: RunSummary) => (
    <button
      key={r.run_id}
      type="button"
      onClick={() => onSelectRun(r.run_id)}
      className={`ps-workflow-run-card ${
        r.run_id === selectedRunId ? 'ps-workflow-run-card--selected' : ''
      }`}
    >
      <div className="ps-workflow-run-card__header">
        <span className="ps-workflow-run-card__id">{r.run_id}</span>
        <RunStatusBadge status={r.status} paused={r.paused} />
      </div>
      <div className="ps-workflow-run-card__goal">{r.goal || '—'}</div>
      <div className="ps-workflow-run-card__meta">
        {r.definition_name} v{r.definition_version} · {r.current_node ?? 'done'} · {r.attempt_count} attempts
      </div>
    </button>
  );

  return (
    <div className="ps-workflow-selector">
      <button
        type="button"
        onClick={() => setFormOpen((v) => !v)}
        className="ps-workflow-selector__create-btn"
      >
        <Plus size={14} /> New release run
      </button>

      {formOpen && (
        <form onSubmit={submit} className="ps-workflow-selector__form">
          <label className="ps-workflow-selector__field">
            <span className="ps-workflow-selector__field-label">Workflow definition</span>
            <select
              value={chosenHash}
              onChange={(e) => setDefinitionHash(e.target.value)}
              className="ps-workflow-selector__select"
            >
              {definitions.map((d) => (
                <option key={d.definition_hash} value={d.definition_hash}>
                  {d.name} v{d.version}
                  {d.canonical ? ' (canonical)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="ps-workflow-selector__field">
            <span className="ps-workflow-selector__field-label">Goal</span>
            <textarea
              required
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              className="ps-workflow-selector__textarea"
              placeholder="What should this release ship?"
            />
          </label>
          <label className="ps-workflow-selector__field">
            <span className="ps-workflow-selector__field-label">Repository path</span>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="ps-workflow-selector__input ps-workflow-selector__input--mono"
              placeholder="/path/to/repo"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !goal.trim() || !chosenHash}
            className="ps-workflow-selector__submit-btn"
          >
            <Rocket size={13} /> Start run
          </button>
        </form>
      )}

      <div className="ps-workflow-selector__runs">
        <div className="ps-workflow-selector__section">
          <div className="ps-workflow-selector__section-title">
            Active ({active.length})
          </div>
          {active.length === 0 && <p className="ps-workflow-selector__empty">No active runs.</p>}
          {active.map(renderRun)}
        </div>
        <div className="ps-workflow-selector__section">
          <div className="ps-workflow-selector__section-title">
            History ({history.length})
          </div>
          {history.map(renderRun)}
        </div>
      </div>
    </div>
  );
};
