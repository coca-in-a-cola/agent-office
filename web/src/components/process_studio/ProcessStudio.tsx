import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building, GitBranch, X } from 'lucide-react';
import { StudioFocus } from '../../types';
import { RunCommand, workflowApi } from '../../workflowApi';
import {
  DefinitionSummary,
  NodeState,
  RunDetail,
  RunSummary,
  WorkflowDefinition,
} from '../../workflowTypes';
import { DebugControls } from './DebugControls';
import { GraphView } from './GraphView';
import { NODE_STATE_STYLE, NodeStatusBadge } from './NodeStatusBadge';
import { RunInspector } from './RunInspector';
import { WorkflowSelector } from './WorkflowSelector';

const POLL_MS = 2500;
const LEGEND: NodeState[] = [
  'pending',
  'running',
  'succeeded',
  'defect',
  'timeout',
  'failure',
  'approval_wait',
];

interface ProcessStudioProps {
  /** Run/node to open, e.g. requested from a Tycoon View desk or roster badge. */
  focus?: StudioFocus | null;
  onDismissFocus?: () => void;
}

export const ProcessStudio: React.FC<ProcessStudioProps> = ({ focus = null, onDismissFocus }) => {
  const [definitions, setDefinitions] = useState<DefinitionSummary[]>([]);
  const [definitionCache, setDefinitionCache] = useState<Record<string, WorkflowDefinition>>({});
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(focus?.runId ?? null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(focus?.node ?? null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);

  const ensureDefinition = useCallback(
    async (hash: string) => {
      if (!hash || definitionCache[hash]) return;
      const def = await workflowApi.getDefinition(hash);
      setDefinitionCache((cache) => ({ ...cache, [hash]: def }));
    },
    [definitionCache]
  );

  // Definitions once (they are immutable and hash-pinned).
  useEffect(() => {
    workflowApi
      .listDefinitions()
      .then((data) => {
        setDefinitions(data.definitions);
        return ensureDefinition(data.canonical_hash);
      })
      .catch((e: Error) => setError(`Workflow API unavailable: ${e.message}`));
    // Mount-only: ensureDefinition is stable enough for the first load.
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await workflowApi.listRuns();
      setRuns(data.runs);
      setOffline(false);
      const runId =
        selectedRunId ?? (data.runs.find((r) => r.active) ?? data.runs[0])?.run_id ?? null;
      if (runId !== selectedRunId) setSelectedRunId(runId);
      if (runId) {
        const d = await workflowApi.getRun(runId);
        setDetail(d);
        await ensureDefinition(d.run.definition_hash);
      } else {
        setDetail(null);
      }
    } catch {
      setOffline(true);
    }
  }, [selectedRunId, ensureDefinition]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // A new Tycoon View jump while mounted re-targets run and node.
  useEffect(() => {
    if (!focus) return;
    setSelectedRunId(focus.runId);
    setSelectedNode(focus.node);
    setDetail((d) => (d?.run.run_id === focus.runId ? d : null));
  }, [focus?.nonce]);

  const linked = focus && detail?.run.run_id === focus.runId ? focus : null;

  const selectRun = (runId: string) => {
    setSelectedRunId(runId);
    setSelectedNode(null);
    setDetail(null);
  };

  const runCommand = async (command: RunCommand, body: Record<string, unknown> = {}) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await workflowApi.command(detail.run.run_id, command, { actor: 'owner', ...body }));
      await refresh();
    } catch (e) {
      setError(`${command} failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const createRun = async (input: { goal: string; repo: string; definition_hash: string }) => {
    setBusy(true);
    setError(null);
    try {
      const created = await workflowApi.createRun({
        goal: input.goal,
        repo: input.repo || undefined,
        definition_hash: input.definition_hash,
      });
      setSelectedRunId(created.run.run_id);
      setSelectedNode(null);
      setDetail(created);
      await refresh();
    } catch (e) {
      setError(`Could not start run: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const canonicalHash = definitions.find((d) => d.canonical)?.definition_hash ?? '';
  const definition = definitionCache[detail?.run.definition_hash ?? canonicalHash];
  const focusNode = selectedNode ?? detail?.run.current_node ?? null;
  const focusDef = definition?.nodes.find((n) => n.name === focusNode);
  const currentDef = definition?.nodes.find((n) => n.name === detail?.run.current_node);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Run list */}
      <aside className="w-72 shrink-0 border-r border-slate-800 bg-[#0b1120] p-3 overflow-hidden flex flex-col">
        <WorkflowSelector
          runs={runs}
          definitions={definitions}
          selectedRunId={selectedRunId}
          onSelectRun={selectRun}
          onCreateRun={createRun}
          busy={busy}
        />
      </aside>

      {/* Graph + controls */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <GitBranch size={16} className="text-cyan-400" />
              {definition ? `${definition.name} v${definition.version}` : 'Process Studio'}
            </h2>
            <p className="text-[10px] font-mono text-slate-500" title={definition?.definition_hash}>
              {definition?.definition_hash ?? 'loading definition…'}
            </p>
          </div>
          {detail && (
            <DebugControls
              detail={detail}
              busy={busy}
              sideEffecting={Boolean(currentDef?.side_effecting)}
              onCommand={runCommand}
            />
          )}
        </div>

        {(error || offline) && (
          <div className="mx-5 mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-500/50 bg-red-950/50 px-3 py-2 text-xs text-red-200">
            <span className="flex items-center gap-2">
              <AlertTriangle size={14} />
              {error ?? 'Lost connection to /api/workflow — retrying…'}
            </span>
            {error && (
              <button onClick={() => setError(null)} className="text-red-300 hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {linked && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-200">
              <span className="flex items-center gap-2">
                <Building size={14} />
                Opened from Tycoon View{linked.source ? ` (${linked.source})` : ''}: run{' '}
                <span className="font-mono">{linked.runId}</span>
                {linked.node && (
                  <>
                    {' '}· node <span className="font-mono">{linked.node}</span>
                  </>
                )}
              </span>
              {onDismissFocus && (
                <button onClick={onDismissFocus} className="text-cyan-300 hover:text-white" aria-label="Dismiss">
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {definition ? (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <GraphView
                definition={definition}
                nodeStates={detail?.node_states}
                selectedNode={focusNode}
                onSelectNode={setSelectedNode}
                highlightNode={linked?.node ?? null}
              />
            </div>
          ) : (
            <div className="text-slate-500 text-sm">Loading workflow definition…</div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Legend</span>
            {LEGEND.map((s) => (
              <NodeStatusBadge key={s} state={s} />
            ))}
            <span className="text-[10px] text-slate-500 ml-2">
              dashed amber arcs = defect feedback loops; engine targets in node tooltips
            </span>
          </div>

          {detail?.run.status === 'blocked' && (
            <div
              className="rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: NODE_STATE_STYLE.failure.stroke, color: '#fecaca' }}
            >
              Run blocked: {detail.run.status_reason}
            </div>
          )}

          {!detail && runs.length === 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-400 text-sm">
              No workflow runs yet. Start a release run from the left panel.
            </div>
          )}
        </div>
      </main>

      {/* Inspector */}
      <aside className="w-[420px] shrink-0 border-l border-slate-800 bg-[#0b1120] overflow-y-auto p-3">
        {detail ? (
          <RunInspector detail={detail} selectedNode={selectedNode} node={focusDef} />
        ) : (
          <p className="text-xs text-slate-500 italic p-2">Select a run to inspect it.</p>
        )}
      </aside>
    </div>
  );
};
