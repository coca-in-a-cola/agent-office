import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building, Edit3, Eye, GitBranch, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StudioFocus } from '../../types';
import { workflowApi, workflowKeys } from '../../workflowApi';
import type { RunCommand } from '../../workflowApi';
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
import { EditorView } from './EditorView';
import { getAuthEpoch } from '../../api/queryClient';
import '../../styles/components/process-studio.scss';
import {
  commandMutationOptions,
  createRunMutationOptions,
} from '../../api/studioMutations';

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
  const qc = useQueryClient();

  // -------------------------------------------------------------------------
  // Local UI state (never derived from server; owned by this component)
  // -------------------------------------------------------------------------
  const [studioMode, setStudioMode] = useState<'observe' | 'edit'>('edit');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(focus?.runId ?? null);
  const [selectedNode, setSelectedNode] = useState<string | null>(focus?.node ?? null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Focus prop effect — switch to observe mode and sync selection
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!focus) return;
    setStudioMode('observe');
    setSelectedRunId(focus.runId);
    setSelectedNode(focus.node);
  }, [focus?.nonce]);

  // -------------------------------------------------------------------------
  // Server queries
  // -------------------------------------------------------------------------

  // Definitions list — fetch once (immutable, hash-pinned)
  const definitionsQuery = useQuery({
    queryKey: workflowKeys.definitions(),
    queryFn: ({ signal }) => workflowApi.listDefinitions(signal),
    // Very long stale time — definitions are hash-pinned and never mutate
    staleTime: Infinity,
  });

  const definitionsList: DefinitionSummary[] = definitionsQuery.data?.definitions ?? [];
  const canonicalHashFromDefs = definitionsList.find((d) => d.canonical)?.definition_hash ?? '';

  // Runs list — poll every POLL_MS
  const runsQuery = useQuery({
    queryKey: workflowKeys.runs(),
    queryFn: ({ signal }) => workflowApi.listRuns(signal),
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const runs: RunSummary[] = runsQuery.data?.runs ?? [];
  const offline = runsQuery.isError && !runsQuery.isLoading;

  // Derive effective selectedRunId — auto-select active/first on initial load
  // (use a ref-like pattern via derived value, not a side-effect setter that
  //  causes stale closure loops)
  const effectiveRunId: string | null = (() => {
    if (selectedRunId) return selectedRunId;
    if (runs.length === 0) return null;
    return (runs.find((r) => r.active) ?? runs[0])?.run_id ?? null;
  })();

  // Sync selectedRunId state when auto-selection resolves (first load only)
  useEffect(() => {
    if (!selectedRunId && effectiveRunId) {
      setSelectedRunId(effectiveRunId);
    }
  }, [effectiveRunId]);

  // Selected run detail — poll every POLL_MS (only when a run is selected)
  const runDetailQuery = useQuery({
    queryKey: workflowKeys.run(effectiveRunId ?? ''),
    queryFn: ({ signal }) => workflowApi.getRun(effectiveRunId!, signal),
    enabled: Boolean(effectiveRunId),
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const detail: RunDetail | null = runDetailQuery.data ?? null;

  // Immutable definition for the selected run's definition_hash (staleTime=Infinity)
  const runDefHash = detail?.run.definition_hash ?? '';
  const defHashToLoad = runDefHash || canonicalHashFromDefs;

  const definitionQuery = useQuery({
    queryKey: workflowKeys.definition(defHashToLoad),
    queryFn: ({ signal }) => workflowApi.getDefinition(defHashToLoad, signal),
    enabled: Boolean(defHashToLoad),
    staleTime: Infinity,
  });

  const definition: WorkflowDefinition | null = definitionQuery.data ?? null;

  // -------------------------------------------------------------------------
  // Offline / error banner logic
  // -------------------------------------------------------------------------
  // Show a banner on:
  //  - runsQuery error (network offline / API down) — message "retrying"
  //  - definitionsQuery error — message with full text
  //  - mutation error — message with command info + dismiss button
  const networkError: string | null = (() => {
    if (definitionsQuery.isError)
      return `Workflow API unavailable: ${(definitionsQuery.error as Error)?.message ?? 'unknown'}`;
    return null;
  })();

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const commandMutation = useMutation(
    commandMutationOptions(qc, {
      onMutationError: (msg) => setMutationError(msg),
    }),
  );

  const createRunMutation = useMutation(
    createRunMutationOptions(qc, {
      onSelectRunId: (id) => {
        setSelectedRunId(id);
        setSelectedNode(null);
      },
    }),
  );

  // -------------------------------------------------------------------------
  // Handlers (preserve original signatures consumed by child components)
  // -------------------------------------------------------------------------

  const runCommand = useCallback(
    async (command: RunCommand, body: Record<string, unknown> = {}): Promise<void> => {
      if (!detail) return;
      setMutationError(null);
      // Capture epoch at dispatch time — passed as a variable so mutationFn
      // and onSuccess both guard against auth transitions that fire in-flight.
      await commandMutation.mutateAsync({
        runId: detail.run.run_id,
        command,
        body,
        authEpoch: getAuthEpoch(),
      });
    },
    [detail, commandMutation],
  );

  const createRun = useCallback(
    async (input: { goal: string; repo: string; definition_hash: string }): Promise<void> => {
      setMutationError(null);
      // Capture epoch at dispatch time — passed as a variable so onSuccess
      // guards against auth transitions that fire while createRun is in-flight.
      await createRunMutation.mutateAsync({ ...input, authEpoch: getAuthEpoch() });
    },
    [createRunMutation],
  );

  const selectRun = (runId: string) => {
    setSelectedRunId(runId);
    setSelectedNode(null);
  };

  // -------------------------------------------------------------------------
  // Derived view values
  // -------------------------------------------------------------------------

  const busy = commandMutation.isPending || createRunMutation.isPending;
  const error = mutationError ?? networkError;

  const linked = focus && detail?.run.run_id === focus.runId ? focus : null;
  const focusNode = selectedNode ?? detail?.run.current_node ?? null;
  const focusDef = definition?.nodes.find((n) => n.name === focusNode);
  const currentDef = definition?.nodes.find((n) => n.name === detail?.run.current_node);

  // -------------------------------------------------------------------------
  // Edit mode render
  // -------------------------------------------------------------------------

  if (studioMode === 'edit') {
    return (
      <div className="ps-studio ps-studio--edit">
        <div className="ps-studio__header">
          <div className="ps-studio__header-left">
            <GitBranch size={15} className="ps-studio__header-icon" />
            <span className="ps-studio__header-title">Process Studio</span>
          </div>
          <div className="ps-studio__mode-switch">
            <button
              onClick={() => setStudioMode('edit')}
              className="ps-studio__mode-btn ps-studio__mode-btn--active"
            >
              <Edit3 size={13} />
              <span>Edit Graph</span>
            </button>
            <button
              onClick={() => setStudioMode('observe')}
              className="ps-studio__mode-btn"
            >
              <Eye size={13} />
              <span>Observe Run</span>
            </button>
          </div>
        </div>
        <EditorView
          onSwitchToObserve={() => setStudioMode('observe')}
          activeRunId={detail?.run.run_id}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Observe mode render
  // -------------------------------------------------------------------------

  return (
    <div className="ps-studio ps-studio--observe">
      {/* Run list */}
      <aside className="ps-studio__sidebar">
        <WorkflowSelector
          runs={runs}
          definitions={definitionsList}
          selectedRunId={effectiveRunId}
          onSelectRun={selectRun}
          onCreateRun={createRun}
          busy={busy}
        />
      </aside>

      {/* Graph + controls */}
      <main className="ps-studio__main">
        <div className="ps-studio__toolbar">
          <div className="ps-studio__toolbar-left">
            <div>
              <h2 className="ps-studio__toolbar-title">
                <GitBranch size={16} className="ps-studio__toolbar-icon" />
                {definition ? `${definition.name} v${definition.version}` : 'Process Studio'}
              </h2>
              <p className="ps-studio__toolbar-hash" title={definition?.definition_hash}>
                {definition?.definition_hash ?? 'loading definition…'}
              </p>
            </div>
            <div className="ps-studio__mode-switch">
              <button
                onClick={() => setStudioMode('edit')}
                className="ps-studio__mode-btn"
              >
                <Edit3 size={12} />
                <span>Edit Graph</span>
              </button>
              <button
                onClick={() => setStudioMode('observe')}
                className="ps-studio__mode-btn ps-studio__mode-btn--active"
              >
                <Eye size={12} />
                <span>Observe Run</span>
              </button>
            </div>
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
          <div className="ps-studio__banner ps-studio__banner--error">
            <span className="ps-studio__banner-text">
              <AlertTriangle size={14} />
              {error ?? 'Lost connection to /api/workflow — retrying…'}
            </span>
            {error && (
              <button onClick={() => setMutationError(null)} className="ps-studio__banner-dismiss">
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className="ps-studio__content">
          {linked && (
            <div className="ps-studio__banner ps-studio__banner--linked">
              <span className="ps-studio__banner-text">
                <Building size={14} />
                Opened from Tycoon View{linked.source ? ` (${linked.source})` : ''}: run{' '}
                <span className="ps-studio__mono-val">{linked.runId}</span>
                {linked.node && (
                  <>
                    {' '}· node <span className="ps-studio__mono-val">{linked.node}</span>
                  </>
                )}
              </span>
              {onDismissFocus && (
                <button onClick={onDismissFocus} className="ps-studio__banner-dismiss ps-studio__banner-dismiss--cyan" aria-label="Dismiss">
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {definition ? (
            <div className="ps-studio__graph-wrapper">
              <GraphView
                definition={definition}
                nodeStates={detail?.node_states}
                selectedNode={focusNode}
                onSelectNode={setSelectedNode}
                highlightNode={linked?.node ?? null}
              />
            </div>
          ) : (
            <div className="ps-studio__loading">Loading workflow definition…</div>
          )}

          <div className="ps-studio__legend">
            <span className="ps-studio__legend-label">Legend</span>
            {LEGEND.map((s) => (
              <NodeStatusBadge key={s} state={s} />
            ))}
            <span className="ps-studio__legend-note">
              dashed amber arcs = defect feedback loops; engine targets in node tooltips
            </span>
          </div>

          {detail?.run.status === 'blocked' && (
            <div
              className="ps-studio__blocked-alert"
              style={{ borderColor: NODE_STATE_STYLE.failure.stroke, color: '#fecaca' }}
            >
              Run blocked: {detail.run.status_reason}
            </div>
          )}

          {!detail && runs.length === 0 && (
            <div className="ps-studio__empty">
              No workflow runs yet. Start a release run from the left panel.
            </div>
          )}
        </div>
      </main>

      {/* Inspector */}
      <aside className="ps-studio__inspector">
        {detail ? (
          <RunInspector detail={detail} selectedNode={selectedNode} node={focusDef} />
        ) : (
          <p className="ps-studio__inspector-empty">Select a run to inspect it.</p>
        )}
      </aside>
    </div>
  );
};
