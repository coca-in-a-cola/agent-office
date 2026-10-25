import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  MarkerType,
  Edge,
  Node,
  NodeTypes,
  Connection,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../styles/components/editor-view.scss';

import {
  Save,
  RotateCcw,
  RotateCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  Eye,
  Edit3,
  ShieldAlert,
  Info,
  X,
} from 'lucide-react';

import { EditorEdge, EditorGraphDefinition, EditorNode } from '../../editorTypes';
import { ConflictError } from '../../editorApi';
import { EditorNodeComponent } from './EditorNodeComponent';
import { NodeCatalogModal } from './NodeCatalogModal';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { ConflictModal } from './ConflictModal';
import { DEFAULT_TIMEOUT_RECOVERY_GRAPH } from './defaultFixture';
import { useListDrafts, useGetDraft, shouldInitializeDraft } from '../../hooks/useDraftQueries';
import { useDraftMutations } from '../../hooks/useDraftMutations';

const nodeTypes: NodeTypes = {
  editorNode: EditorNodeComponent,
};

interface EditorViewProps {
  onSwitchToObserve?: () => void;
  activeRunId?: string | null;
}

export const EditorViewInner: React.FC<EditorViewProps> = ({
  onSwitchToObserve,
  activeRunId,
}) => {
  const reactFlow = useReactFlow();

  // Graph state
  const [graph, setGraph] = useState<EditorGraphDefinition>(DEFAULT_TIMEOUT_RECOVERY_GRAPH);
  const [draftId, setDraftId] = useState<string>('draft-release-v1');
  const [revision, setRevision] = useState<number>(1);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // History for Undo/Redo
  const [undoStack, setUndoStack] = useState<EditorGraphDefinition[]>([]);
  const [redoStack, setRedoStack] = useState<EditorGraphDefinition[]>([]);

  // Selection & UI state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  // Validation & Conflict
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [conflictState, setConflictState] = useState<{
    isOpen: boolean;
    message: string;
    serverRevision: number;
    localRevision: number;
  }>({
    isOpen: false,
    message: '',
    serverRevision: 0,
    localRevision: 0,
  });

  // Track draft list — populated from server via TanStack Query
  const [draftsList, setDraftsList] = useState<string[]>(['draft-release-v1']);

  // Ref that always holds the current {draftId, graph, isDirty} without
  // introducing stale closures in async callbacks.  Updated synchronously
  // whenever the corresponding state variables change (see useEffect below).
  const currentEditorRef = useRef({ draftId, graph, isDirty });
  useEffect(() => {
    currentEditorRef.current = { draftId, graph, isDirty };
  }, [draftId, graph, isDirty]);

  // ---------------------------------------------------------------------------
  // TanStack Query: draft list + current draft (read side)
  // ---------------------------------------------------------------------------

  const { drafts: serverDraftsList } = useListDrafts(isDirty);
  const { draftRecord, isError: isDraftLoadError, error: draftLoadError, refetch: refetchDraft } = useGetDraft(draftId, isDirty);

  // ---------------------------------------------------------------------------
  // TanStack Query: write mutations (save / validate / publish / bootstrap)
  // ---------------------------------------------------------------------------

  const { bootstrapMutation, saveMutation, validateMutation, publishMutation } = useDraftMutations();

  // Derived pending flags (replaces manual isSaving/isValidating/isPublishing state)
  const isSaving = saveMutation.isPending;
  const isValidating = validateMutation.isPending;
  const isPublishing = publishMutation.isPending;

  // Sync server draft list → local selector state
  useEffect(() => {
    if (serverDraftsList.length > 0) {
      setDraftsList(serverDraftsList.map((d) => d.draft_id));
    }
  }, [serverDraftsList]);

  // Apply server draft to local graph state when first loaded.
  // Guards:
  //  1. Only apply when the user has no unsaved local edits (isDirty).
  //  2. Only apply when the loaded record matches the currently selected draftId
  //     (prevents a late-arriving response for a previous draft overwriting state
  //     after the user has already switched to a different draft).
  useEffect(() => {
    if (!draftRecord?.graph) return;
    if (isDirty) return; // never overwrite local edits
    if (draftRecord.draft_id !== draftId) return; // stale response for a previous draft
    setGraph(draftRecord.graph);
    setRevision(draftRecord.revision);
    setIsDirty(false);
  }, [draftRecord, isDirty, draftId]);

  const showToast = useCallback((text: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((cur) => (cur?.text === text ? null : cur));
    }, 4500);
  }, []);

  // Push state to undo stack before mutation
  const pushUndo = useCallback((current: EditorGraphDefinition) => {
    setUndoStack((prev) => [...prev.slice(-30), JSON.parse(JSON.stringify(current))]);
    setRedoStack([]);
    setIsDirty(true);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, prev.length - 1));
    setRedoStack((prev) => [...prev, JSON.parse(JSON.stringify(graph))]);
    setGraph(previous);
    setIsDirty(true);
    showToast('Undo applied', 'info');
  }, [undoStack, graph, showToast]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, prev.length - 1));
    setUndoStack((prev) => [...prev, JSON.parse(JSON.stringify(graph))]);
    setGraph(next);
    setIsDirty(true);
    showToast('Redo applied', 'info');
  }, [redoStack, graph, showToast]);

  // Keyboard shortcut listener for Undo/Redo & Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // Initial draft auto-create: ONLY when the server returned 404 (draft does not
  // exist yet). Must NOT fire on 401/403/500/network errors — those indicate
  // auth or server problems and writing would risk data corruption or silent failure.
  // Also must NOT fire if the user already has unsaved local edits (isDirty).
  //
  // StrictMode dedup: bootstrapMutation.mutateAsync delegates to the shared
  // _bootstrapRegistry in useDraftMutations — the second StrictMode invoke will
  // observe the pending promise from the first invoke rather than firing a second
  // POST.
  useEffect(() => {
    if (!isDraftLoadError) return;
    if (!shouldInitializeDraft(draftLoadError, isDirty)) return;
    bootstrapMutation.mutateAsync({ draftId, graph: DEFAULT_TIMEOUT_RECOVERY_GRAPH }).then((res) => {
      // Guard: user may have switched to a different draft or made edits while
      // the bootstrap POST was in flight. Only apply when still on the same
      // draft and no unsaved edits have appeared.
      const cur = currentEditorRef.current;
      if (cur.draftId !== draftId) return; // draft switched mid-flight
      if (cur.isDirty) return; // local edits arrived while bootstrapping
      setRevision(res.revision);
      setGraph(DEFAULT_TIMEOUT_RECOVERY_GRAPH);
      setIsDirty(false);
    }).catch(() => {
      // Network offline — fixture already in local state; registry already
      // cleaned up in the hook's .finally() so a future re-mount can retry.
    });
  // bootstrapMutation.mutateAsync is stable across renders (identity from TQ).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, isDraftLoadError, isDirty]);

  // Map parsed validation errors to nodes and ports
  const { nodeErrors, portErrors } = useMemo(() => {
    const nErrors: Record<string, string[]> = {};
    const pErrors: Record<string, string> = {};

    validationErrors.forEach((err) => {
      // Look for node IDs and port IDs in error strings
      graph.nodes.forEach((n) => {
        if (err.includes(n.id)) {
          nErrors[n.id] = [...(nErrors[n.id] || []), err];
        }
        n.ports.forEach((p) => {
          if (err.includes(p.id)) {
            pErrors[p.id] = err;
          }
        });
      });
    });

    return { nodeErrors: nErrors, portErrors: pErrors };
  }, [validationErrors, graph.nodes]);

  // Convert graph to ReactFlow nodes
  const flowNodes: Node[] = useMemo(() => {
    return graph.nodes.map((node) => {
      const layoutPos = graph.layout?.nodes?.[node.id];
      const pos = layoutPos ? { x: layoutPos.x, y: layoutPos.y } : { x: 100, y: 100 };

      return {
        id: node.id,
        type: 'editorNode',
        position: pos,
        data: {
          node,
          errors: nodeErrors[node.id],
          portErrors,
          onSelectNode: (id: string) => setSelectedNodeId(id),
        },
        selected: selectedNodeId === node.id,
      };
    });
  }, [graph.nodes, graph.layout, nodeErrors, portErrors, selectedNodeId]);

  // Convert graph to ReactFlow edges
  const flowEdges: Edge[] = useMemo(() => {
    return graph.edges.map((edge) => {
      const isControl = edge.kind === 'control';
      const isStatus = edge.kind === 'status';

      let strokeColor = '#3b82f6'; // default data blue
      if (isControl) strokeColor = '#06b6d4'; // control cyan
      if (isStatus) strokeColor = '#f59e0b'; // status amber

      // Check if this is the Work.timeout -> InspectResult demonstration wire!
      const isTimeoutWire =
        edge.source_port_id.includes('timeout') || edge.target_port_id.includes('insp_ctrl_in');
      if (isTimeoutWire) {
        strokeColor = '#f97316'; // orange for timeout
      }

      return {
        id: edge.id,
        source: edge.source_node_id,
        sourceHandle: edge.source_port_id,
        target: edge.target_node_id,
        targetHandle: edge.target_port_id,
        animated: isControl,
        style: {
          stroke: strokeColor,
          strokeWidth: isTimeoutWire ? 2.5 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
          width: 14,
          height: 14,
        },
      };
    });
  }, [graph.edges]);

  // Client-side Connection Validator according to Contracts Matrix
  const checkConnectionValidity = useCallback(
    (connection: Connection | Edge): { valid: boolean; reason?: string } => {
      if (!connection.source || !connection.target) return { valid: false, reason: 'Missing source or target' };
      if (connection.source === connection.target) return { valid: false, reason: 'Cannot connect node to itself' };

      const sourceNode = graph.nodes.find((n) => n.id === connection.source);
      const targetNode = graph.nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return { valid: false, reason: 'Node not found' };

      const sourcePort = sourceNode.ports.find((p) => p.id === connection.sourceHandle);
      const targetPort = targetNode.ports.find((p) => p.id === connection.targetHandle);
      if (!sourcePort || !targetPort) return { valid: false, reason: 'Port not found' };

      // Direction check
      if (sourcePort.direction !== 'output') return { valid: false, reason: 'Source port must be an output' };
      if (targetPort.direction !== 'input') return { valid: false, reason: 'Target port must be an input' };

      // Port Kind & Type Compatibility Matrix
      if (sourcePort.kind === 'control') {
        if (targetPort.kind !== 'control') {
          return { valid: false, reason: 'Control output can only connect to control inputs (exec_in)' };
        }
        if (targetPort.control_outcome !== 'exec_in') {
          return { valid: false, reason: 'Control output must target an exec_in port' };
        }
        return { valid: true };
      }

      if (sourcePort.kind === 'status') {
        return { valid: false, reason: 'Status ports emit telemetry/waiting states and cannot activate execution' };
      }

      if (sourcePort.kind === 'data') {
        if (targetPort.kind !== 'data') {
          return { valid: false, reason: 'Data output cannot connect to control input' };
        }
        if (sourcePort.data_type !== targetPort.data_type) {
          return {
            valid: false,
            reason: `Data type mismatch: ${sourcePort.data_type} cannot wire into ${targetPort.data_type}`,
          };
        }

        // Cardinality check on target port: single input port cannot have multiple incoming wires
        if (targetPort.cardinality === 'single') {
          const existingIncoming = graph.edges.filter(
            (e) => e.target_node_id === targetNode.id && e.target_port_id === targetPort.id
          );
          if (existingIncoming.length > 0) {
            // Check control predecessor convergence exception
            const isControlPred = graph.edges.some(
              (e) =>
                e.kind === 'control' &&
                e.source_node_id === sourceNode.id &&
                e.target_node_id === targetNode.id
            );
            if (!isControlPred) {
              return {
                valid: false,
                reason: `Port ${targetPort.name} has single cardinality and already has an incoming wire`,
              };
            }
          }
        }

        return { valid: true };
      }

      return { valid: false, reason: 'Unknown port kind' };
    },
    [graph.nodes, graph.edges]
  );

  const isValidConnection = useCallback(
    (edge: Edge | Connection): boolean => {
      const res = checkConnectionValidity(edge);
      if (!res.valid && res.reason) {
        setConnectionError(res.reason);
      } else {
        setConnectionError(null);
      }
      return res.valid;
    },
    [checkConnectionValidity]
  );

  // Connect Handle
  const onConnect = useCallback(
    (params: Connection) => {
      const check = checkConnectionValidity(params);
      if (!check.valid) {
        showToast(`Connection rejected: ${check.reason}`, 'error');
        return;
      }

      pushUndo(graph);

      const sourceNode = graph.nodes.find((n) => n.id === params.source);
      const sourcePort = sourceNode?.ports.find((p) => p.id === params.sourceHandle);
      const edgeKind = sourcePort?.kind || 'control';

      const newEdge: EditorEdge = {
        id: `e_${params.source}_${params.target}_${Date.now().toString(36)}`,
        kind: edgeKind,
        source_node_id: params.source!,
        source_port_id: params.sourceHandle!,
        target_node_id: params.target!,
        target_port_id: params.targetHandle!,
      };

      setGraph((prev) => ({
        ...prev,
        edges: [...prev.edges, newEdge],
      }));

      setConnectionError(null);
      showToast('Wire connected', 'success');
    },
    [checkConnectionValidity, graph, pushUndo, showToast]
  );

  // Disconnect Edge
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return;
      pushUndo(graph);

      const idsToDelete = new Set(deleted.map((e) => e.id));
      setGraph((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => !idsToDelete.has(e.id)),
      }));

      showToast(`Disconnected ${deleted.length} wire(s)`, 'info');
    },
    [graph, pushUndo, showToast]
  );

  // Delete Node
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      pushUndo(graph);

      setGraph((prev) => {
        const nextNodes = prev.nodes.filter((n) => n.id !== nodeId);
        const nextEdges = prev.edges.filter(
          (e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId
        );
        const nextLayoutNodes = { ...(prev.layout?.nodes || {}) };
        delete nextLayoutNodes[nodeId];

        return {
          ...prev,
          nodes: nextNodes,
          edges: nextEdges,
          layout: {
            ...prev.layout,
            nodes: nextLayoutNodes,
          },
        };
      });

      setSelectedNodeId(null);
      showToast('Node removed', 'info');
    },
    [graph, pushUndo, showToast]
  );

  // Update Node Properties
  const handleUpdateNode = useCallback(
    (updated: EditorNode) => {
      pushUndo(graph);

      setGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === updated.id ? updated : n)),
      }));

      showToast(`Updated properties for ${updated.name}`, 'info');
    },
    [graph, pushUndo, showToast]
  );

  // Add Node from Catalog
  const handleAddNode = useCallback(
    (newNode: EditorNode) => {
      pushUndo(graph);

      const center = reactFlow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      setGraph((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
        layout: {
          ...prev.layout,
          nodes: {
            ...(prev.layout?.nodes || {}),
            [newNode.id]: {
              x: Math.round(center.x - 120),
              y: Math.round(center.y - 80),
              width: 260,
              height: 200,
            },
          },
        },
      }));

      setSelectedNodeId(newNode.id);
      showToast(`Added ${newNode.name}`, 'success');
    },
    [graph, pushUndo, reactFlow, showToast]
  );

  // Node Move Stop: persist in layout
  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      setGraph((prev) => {
        const currentPos = prev.layout?.nodes?.[node.id];
        if (currentPos?.x === Math.round(node.position.x) && currentPos?.y === Math.round(node.position.y)) {
          return prev;
        }

        return {
          ...prev,
          layout: {
            ...prev.layout,
            nodes: {
              ...(prev.layout?.nodes || {}),
              [node.id]: {
                ...(prev.layout?.nodes?.[node.id] || {}),
                x: Math.round(node.position.x),
                y: Math.round(node.position.y),
              },
            },
          },
        };
      });
      setIsDirty(true);
    },
    []
  );

  // Viewport Change: persist in layout
  const onMoveEnd = useCallback(() => {
    const vp = reactFlow.getViewport();
    setGraph((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        viewport: {
          x: Math.round(vp.x),
          y: Math.round(vp.y),
          zoom: Math.round(vp.zoom * 100) / 100,
        },
      },
    }));
  }, [reactFlow]);

  // Save Draft (Optimistic Concurrency)
  // Snapshot the current graph and revision at call time. On success, only
  // clear dirty if:
  //  a) the draftId hasn't changed (user didn't switch drafts mid-flight), AND
  //  b) no new edit arrived after this save was dispatched (checked via ref).
  // Uses currentEditorRef to read up-to-date state inside the async callback
  // without a stale closure over the snapshot.
  const handleSaveDraft = useCallback(
    async (forceRevision?: number) => {
      const graphSnapshot = graph;
      const revisionSnapshot = revision;
      const submittedDraftId = draftId;
      const targetRevision = forceRevision !== undefined ? forceRevision : revisionSnapshot;
      try {
        const res = await saveMutation.mutateAsync({ draftId: submittedDraftId, graph: graphSnapshot, revision: targetRevision });
        // Always update the base revision so the next save can proceed.
        setRevision(res.revision);
        // Only clear dirty when:
        //  1. The user hasn't switched to a different draft since we fired.
        //  2. The graph in state still matches the snapshot we submitted
        //     (i.e. no new edit arrived while the request was in flight).
        setIsDirty((currentDirty) => {
          const cur = currentEditorRef.current;
          if (cur.draftId !== submittedDraftId) return currentDirty; // draft switched
          if (currentDirty && cur.graph !== graphSnapshot) return true; // new edit
          return false;
        });
        showToast(`Draft saved (rev ${res.revision})`, 'success');
      } catch (err) {
        if (err instanceof ConflictError) {
          setConflictState({
            isOpen: true,
            message: err.message,
            serverRevision: err.currentRevision,
            localRevision: revisionSnapshot,
          });
        } else {
          showToast(`Save failed: ${(err as Error).message}`, 'error');
        }
      }
    },
    [draftId, graph, revision, saveMutation, showToast]
  );

  // Reload Draft from Server
  // Uses the TanStack Query refetch() to re-populate the cache, then reads the
  // data directly from the returned QueryObserverResult so we don't re-issue a
  // second request. Applies only when the reload matched the current draftId and
  // the user has explicitly chosen to discard local edits (called from the
  // ConflictModal "Reload" action, which is the only explicit-discard path).
  // Uses currentEditorRef to check the live draftId, preventing a stale reload
  // response from clobbering a newer draft the user switched to mid-flight.
  const handleReloadDraft = useCallback(async () => {
    const submittedDraftId = draftId;
    try {
      const result = await refetchDraft();
      // result is the QueryObserverResult — check that the refetch succeeded
      // and that it returned data for the current draftId (prevents a stale
      // response for a previous draft being applied after a draft switch).
      if (result.isError || !result.data) {
        throw result.error ?? new Error('Reload returned no data');
      }
      const res = result.data;
      // Guard 1: response must match the draft we submitted for.
      if (res.draft_id !== submittedDraftId) {
        // Stale response for original draft — skip silently.
        return;
      }
      // Guard 2: user may have switched draft while request was in flight.
      if (currentEditorRef.current.draftId !== submittedDraftId) {
        // Draft switched mid-flight — applying would clobber the new draft.
        return;
      }
      setGraph(res.graph);
      setRevision(res.revision);
      setIsDirty(false);
      setConflictState((prev) => ({ ...prev, isOpen: false }));
      showToast(`Reloaded draft from server (rev ${res.revision})`, 'info');
    } catch (err) {
      showToast(`Reload failed: ${(err as Error).message}`, 'error');
    }
  }, [draftId, refetchDraft, showToast]);

  // Validate Graph
  const handleValidate = useCallback(async () => {
    try {
      const res = await validateMutation.mutateAsync({ graph });
      if (res.valid) {
        setValidationErrors([]);
        showToast('Graph validation clean: valid release grammar!', 'success');
      } else {
        setValidationErrors(res.errors || []);
        showToast(`Validation found ${res.errors.length} issue(s)`, 'error');
      }
    } catch (err) {
      showToast(`Validation request failed: ${(err as Error).message}`, 'error');
    }
  }, [graph, validateMutation, showToast]);

  // Publish Graph
  const handlePublish = useCallback(async () => {
    try {
      // First save if dirty
      if (isDirty) {
        await handleSaveDraft();
      }

      const res = await publishMutation.mutateAsync({ graph });
      showToast(
        `Published v${res.version}! Hash: ${res.definition_hash.slice(0, 16)}…`,
        'success'
      );
    } catch (err) {
      showToast(`Publish failed: ${(err as Error).message}`, 'error');
    }
  }, [isDirty, handleSaveDraft, graph, publishMutation, showToast]);

  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) || null;

  return (
    <div className="ps-editor-view">
      {/* Top Toolbar */}
      <div className="ps-editor-view__toolbar">
        <div className="ps-editor-view__toolbar-left">
          <div className="ps-editor-view__title-group">
            <Edit3 size={15} className="ps-editor-view__title-icon" />
            <span className="ps-editor-view__title-text">Process Studio</span>
            <span className="ps-editor-view__title-badge">
              Editor
            </span>
          </div>

          <div className="ps-editor-view__divider ps-editor-view__divider--hidden-sm" />

          {/* Draft Selection */}
          <div className="ps-editor-view__draft-selector">
            <span className="ps-editor-view__draft-label">Draft:</span>
            <select
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
              className="ps-editor-view__draft-select"
            >
              {draftsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="ps-editor-view__draft-revision">
              (rev {revision})
            </span>
            {isDirty && (
              <span className="ps-editor-view__dirty-indicator" title="Unsaved changes" />
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="ps-editor-view__actions">
          {/* Undo / Redo */}
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="ps-editor-view__btn-history"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="ps-editor-view__btn-history"
            title="Redo (Ctrl+Y)"
          >
            <RotateCw size={13} />
          </button>

          <div className="ps-editor-view__divider ps-editor-view__divider--mx" />

          {/* Add Node */}
          <button
            onClick={() => setIsCatalogOpen(true)}
            className="ps-editor-view__btn-add"
          >
            <Plus size={13} className="ps-editor-view__btn-icon" />
            <span className="ps-editor-view__btn-label">Add Node</span>
          </button>

          {/* Validate */}
          <button
            onClick={handleValidate}
            disabled={isValidating}
            className="ps-editor-view__btn-validate"
            title="Validate graph contracts and port schemas"
          >
            <CheckCircle2 size={13} className="ps-editor-view__btn-icon" />
            <span className="ps-editor-view__btn-label">Validate</span>
          </button>

          {/* Save Draft */}
          <button
            onClick={() => handleSaveDraft()}
            disabled={isSaving}
            className="ps-editor-view__btn-save"
            title="Save draft layout & structure"
          >
            <Save size={13} />
            <span className="ps-editor-view__btn-label">Save</span>
          </button>

          {/* Publish */}
          <button
            onClick={handlePublish}
            disabled={isPublishing}
            className="ps-editor-view__btn-publish"
            title="Publish new immutable workflow definition"
          >
            <UploadCloud size={13} />
            <span className="ps-editor-view__btn-label">Publish</span>
          </button>

          <div className="ps-editor-view__divider ps-editor-view__divider--mx" />

          {/* Switch to Observe Mode */}
          {onSwitchToObserve && (
            <button
              onClick={onSwitchToObserve}
              className="ps-editor-view__btn-observe"
              title={activeRunId ? `Switch to Observe (active run: ${activeRunId})` : 'Switch to Live Observe / Monitor Mode'}
            >
              <Eye size={13} className="ps-editor-view__btn-icon" />
              <span className="ps-editor-view__btn-label">Observe</span>
              {activeRunId && (
                <span className="ps-editor-view__btn-run-id">
                  ({activeRunId})
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Connection Rejection Banner */}
      {connectionError && (
        <div className="ps-editor-view__error-banner">
          <div className="ps-editor-view__error-content">
            <AlertTriangle size={14} className="ps-editor-view__error-icon" />
            <span>Connection Rejected: {connectionError}</span>
          </div>
          <button onClick={() => setConnectionError(null)} className="ps-editor-view__error-close">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Validation Errors Header Banner */}
      {validationErrors.length > 0 && (
        <div className="ps-editor-view__validation-banner">
          <div className="ps-editor-view__validation-content">
            <ShieldAlert size={15} className="ps-editor-view__validation-icon" />
            <span className="ps-editor-view__validation-title">
              {validationErrors.length} Schema/Contract Violation(s) Detected
            </span>
          </div>
          <button onClick={() => setValidationErrors([])} className="ps-editor-view__validation-close">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Canvas + Properties Drawer */}
      <div className="ps-editor-view__main">
        <div className="ps-editor-view__canvas-wrapper">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onNodeDragStop={onNodeDragStop}
            onMoveEnd={onMoveEnd}
            isValidConnection={isValidConnection}
            fitView
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            className="ps-editor-view__flow"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.5}
              color="#1e293b"
            />
            <Controls className="ps-editor-view__controls" />
            <MiniMap
              nodeStrokeColor="#06b6d4"
              nodeColor="#1e293b"
              maskColor="rgba(8, 12, 20, 0.7)"
              className="ps-editor-view__minimap"
            />
          </ReactFlow>

          {/* Toast Notification */}
          {toastMessage && (
            <div
              className={`ps-editor-view__toast ps-editor-view__toast--${toastMessage.type}`}
            >
              <span className="ps-editor-view__toast-icon">
                {toastMessage.type === 'success' ? (
                  <CheckCircle2 size={14} />
                ) : toastMessage.type === 'error' ? (
                  <AlertTriangle size={14} />
                ) : (
                  <Info size={14} />
                )}
              </span>
              <span>{toastMessage.text}</span>
            </div>
          )}
        </div>

        {/* Selected Node Properties Panel */}
        {selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            errors={nodeErrors[selectedNode.id]}
            onClose={() => setSelectedNodeId(null)}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
          />
        )}
      </div>

      {/* Node Catalog Modal */}
      <NodeCatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onAddNode={handleAddNode}
      />

      {/* Optimistic Concurrency 409 Conflict Modal */}
      <ConflictModal
        isOpen={conflictState.isOpen}
        message={conflictState.message}
        serverRevision={conflictState.serverRevision}
        localRevision={conflictState.localRevision}
        onReload={handleReloadDraft}
        onOverwrite={() => {
          setConflictState((prev) => ({ ...prev, isOpen: false }));
          handleSaveDraft(conflictState.serverRevision);
        }}
        onClose={() => setConflictState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export const EditorView: React.FC<EditorViewProps> = (props) => {
  return (
    <ReactFlowProvider>
      <EditorViewInner {...props} />
    </ReactFlowProvider>
  );
};
