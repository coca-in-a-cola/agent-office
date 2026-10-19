import React, { useState } from 'react';
import { Plus, Rocket } from 'lucide-react';
import { DefinitionSummary, RunSummary } from '../../workflowTypes';
import { RunStatusBadge } from './NodeStatusBadge';

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
      onClick={() => onSelectRun(r.run_id)}
      className={`w-full text-left rounded-lg border p-2.5 space-y-1 transition ${
        r.run_id === selectedRunId
          ? 'border-cyan-500/70 bg-cyan-950/30'
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-cyan-300 truncate">{r.run_id}</span>
        <RunStatusBadge status={r.status} paused={r.paused} />
      </div>
      <div className="text-[11px] text-slate-300 truncate">{r.goal || '—'}</div>
      <div className="text-[10px] text-slate-500 font-mono">
        {r.definition_name} v{r.definition_version} · {r.current_node ?? 'done'} · {r.attempt_count} attempts
      </div>
    </button>
  );

  return (
    <div className="flex flex-col gap-3 text-xs h-full">
      <button
        onClick={() => setFormOpen((v) => !v)}
        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 transition"
      >
        <Plus size={14} /> New release run
      </button>

      {formOpen && (
        <form onSubmit={submit} className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
          <label className="block space-y-1">
            <span className="text-slate-400">Workflow definition</span>
            <select
              value={chosenHash}
              onChange={(e) => setDefinitionHash(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
            >
              {definitions.map((d) => (
                <option key={d.definition_hash} value={d.definition_hash}>
                  {d.name} v{d.version}
                  {d.canonical ? ' (canonical)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-slate-400">Goal</span>
            <textarea
              required
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
              placeholder="What should this release ship?"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-slate-400">Repository path</span>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 font-mono text-slate-100"
              placeholder="/path/to/repo"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !goal.trim() || !chosenHash}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-40"
          >
            <Rocket size={13} /> Start run
          </button>
        </form>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Active ({active.length})
          </div>
          {active.length === 0 && <p className="text-slate-500 italic">No active runs.</p>}
          {active.map(renderRun)}
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            History ({history.length})
          </div>
          {history.map(renderRun)}
        </div>
      </div>
    </div>
  );
};
