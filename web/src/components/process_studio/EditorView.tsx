import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

import {
  EditorEdge,
  EditorGraphDefinition,
  EditorNode,
} from '../../editorTypes';
import { ConflictError, editorApi } from '../../editorApi';
import { EditorNodeComponent } from './EditorNodeComponent';
import { NodeCatalogModal } from './NodeCatalogModal';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { ConflictModal } from './ConflictModal';
import { DEFAULT_TIMEOUT_RECOVERY_GRAPH } from './defaultFixture';

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
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  // History for Undo/Redo
  const [undoStack, setUndoStack] = useState<EditorGraphDefinition[]>([]);
  const [redoStack, setRedoStack] = useState<EditorGraphDefinition[]>([]);

  // Selection & UI state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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

  // Track draft list
  const [draftsList, setDraftsList] = useState<string[]>(['draft-release-v1']);

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

  // Fetch initial draft from backend or fallback to fixture
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const listRes = await editorApi.listDrafts();
        if (!cancelled && listRes?.drafts) {
          const ids = listRes.drafts.map((d) => d.draft_id);
          if (ids.length > 0) setDraftsList(ids);
        }

        const draftRes = await editorApi.getDraft(draftId);
        if (!cancelled && draftRes?.graph) {
          setGraph(draftRes.graph);
          setRevision(draftRes.revision);
          setIsDirty(false);
          return;
        }
      } catch {
        // Fallback: save default fixture as initial draft if missing
        try {
          const saveRes = await editorApi.saveDraft(draftId, DEFAULT_TIMEOUT_RECOVERY_GRAPH);
          if (!cancelled) {
            setRevision(saveRes.revision);
            setGraph(DEFAULT_TIMEOUT_RECOVERY_GRAPH);
            setIsDirty(false);
          }
        } catch {
          // Local offline fallback
          if (!cancelled) setGraph(DEFAULT_TIMEOUT_RECOVERY_GRAPH);
        }
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

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
  const handleSaveDraft = useCallback(
    async (forceRevision?: number) => {
      setIsSaving(true);
      try {
        const targetRevision = forceRevision !== undefined ? forceRevision : revision;
        const res = await editorApi.saveDraft(draftId, graph, targetRevision);
        setRevision(res.revision);
        setIsDirty(false);
        showToast(`Draft saved (rev ${res.revision})`, 'success');
      } catch (err) {
        if (err instanceof ConflictError) {
          setConflictState({
            isOpen: true,
            message: err.message,
            serverRevision: err.currentRevision,
            localRevision: revision,
          });
        } else {
          showToast(`Save failed: ${(err as Error).message}`, 'error');
        }
      } finally {
        setIsSaving(false);
      }
    },
    [draftId, graph, revision, showToast]
  );

  // Reload Draft from Server
  const handleReloadDraft = useCallback(async () => {
    setIsSaving(true);
    try {
      const res = await editorApi.getDraft(draftId);
      setGraph(res.graph);
      setRevision(res.revision);
      setIsDirty(false);
      setConflictState((prev) => ({ ...prev, isOpen: false }));
      showToast(`Reloaded draft from server (rev ${res.revision})`, 'info');
    } catch (err) {
      showToast(`Reload failed: ${(err as Error).message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [draftId, showToast]);

  // Validate Graph
  const handleValidate = useCallback(async () => {
    setIsValidating(true);
    try {
      const res = await editorApi.validate(graph);
      if (res.valid) {
        setValidationErrors([]);
        showToast('Graph validation clean: valid release grammar!', 'success');
      } else {
        setValidationErrors(res.errors || []);
        showToast(`Validation found ${res.errors.length} issue(s)`, 'error');
      }
    } catch (err) {
      showToast(`Validation request failed: ${(err as Error).message}`, 'error');
    } finally {
      setIsValidating(false);
    }
  }, [graph, showToast]);

  // Publish Graph
  const handlePublish = useCallback(async () => {
    setIsPublishing(true);
    try {
      // First save if dirty
      if (isDirty) {
        await handleSaveDraft();
      }

      const res = await editorApi.publish({ graph });
      showToast(
        `Published v${res.version}! Hash: ${res.definition_hash.slice(0, 16)}…`,
        'success'
      );
    } catch (err) {
      showToast(`Publish failed: ${(err as Error).message}`, 'error');
    } finally {
      setIsPublishing(false);
    }
  }, [isDirty, handleSaveDraft, graph, showToast]);

  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) || null;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080c14] text-slate-100 overflow-hidden relative font-sans">
      {/* Top Toolbar */}
      <div className="h-12 border-b border-slate-800 bg-[#0f172a]/95 backdrop-blur-md px-3 sm:px-5 flex items-center justify-between gap-2 z-20 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 font-bold text-xs sm:text-sm text-slate-100 shrink-0">
            <Edit3 size={15} className="text-cyan-400" />
            <span className="hidden sm:inline">Process Studio</span>
            <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800/60 uppercase">
              Editor
            </span>
          </div>

          <div className="h-4 w-px bg-slate-800 shrink-0 hidden sm:block" />

          {/* Draft Selection */}
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <span className="text-slate-500 hidden md:inline">Draft:</span>
            <select
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:border-cyan-400 focus:outline-none"
            >
              {draftsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-400 hidden lg:inline">
              (rev {revision})
            </span>
            {isDirty && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Unsaved changes" />
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Undo / Redo */}
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white disabled:opacity-30 transition"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white disabled:opacity-30 transition"
            title="Redo (Ctrl+Y)"
          >
            <RotateCw size={13} />
          </button>

          <div className="h-4 w-px bg-slate-800 shrink-0 mx-0.5" />

          {/* Add Node */}
          <button
            onClick={() => setIsCatalogOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-400 text-xs font-medium transition"
          >
            <Plus size={13} className="text-cyan-400" />
            <span className="hidden sm:inline">Add Node</span>
          </button>

          {/* Validate */}
          <button
            onClick={handleValidate}
            disabled={isValidating}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-emerald-400 text-xs font-medium transition"
            title="Validate graph contracts and port schemas"
          >
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span className="hidden md:inline">Validate</span>
          </button>

          {/* Save Draft */}
          <button
            onClick={() => handleSaveDraft()}
            disabled={isSaving}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs transition disabled:opacity-40"
            title="Save draft layout & structure"
          >
            <Save size={13} />
            <span className="hidden sm:inline">Save</span>
          </button>

          {/* Publish */}
          <button
            onClick={handlePublish}
            disabled={isPublishing}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition disabled:opacity-40"
            title="Publish new immutable workflow definition"
          >
            <UploadCloud size={13} />
            <span className="hidden sm:inline">Publish</span>
          </button>

          <div className="h-4 w-px bg-slate-800 shrink-0 mx-0.5" />

          {/* Switch to Observe Mode */}
          {onSwitchToObserve && (
            <button
              onClick={onSwitchToObserve}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-purple-800/80 bg-purple-950/60 text-purple-200 hover:bg-purple-900 text-xs font-medium transition"
              title={activeRunId ? `Switch to Observe (active run: ${activeRunId})` : 'Switch to Live Observe / Monitor Mode'}
            >
              <Eye size={13} className="text-purple-400" />
              <span className="hidden lg:inline">Observe</span>
              {activeRunId && (
                <span className="text-[10px] font-mono text-purple-300 ml-1">
                  ({activeRunId})
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Connection Rejection Banner */}
      {connectionError && (
        <div className="bg-rose-950/90 border-b border-rose-800 px-4 py-1.5 text-xs text-rose-200 flex items-center justify-between gap-2 z-10 animate-in slide-in-from-top duration-150">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={14} className="text-rose-400 shrink-0" />
            <span>Connection Rejected: {connectionError}</span>
          </div>
          <button onClick={() => setConnectionError(null)} className="text-rose-300 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Validation Errors Header Banner */}
      {validationErrors.length > 0 && (
        <div className="bg-rose-950/90 border-b border-rose-800 px-4 py-2 text-xs text-rose-200 flex items-center justify-between gap-2 z-10">
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-rose-400 shrink-0" />
            <span className="font-semibold">
              {validationErrors.length} Schema/Contract Violation(s) Detected
            </span>
          </div>
          <button onClick={() => setValidationErrors([])} className="text-rose-300 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Canvas + Properties Drawer */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 h-full w-full relative">
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
            className="bg-[#080c14]"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.5}
              color="#1e293b"
            />
            <Controls className="!bg-slate-900 !border-slate-800 !rounded-lg overflow-hidden [&>button]:!bg-slate-900 [&>button]:!border-slate-800 [&>button]:!text-slate-300 hover:[&>button]:!bg-slate-800" />
            <MiniMap
              nodeStrokeColor="#06b6d4"
              nodeColor="#1e293b"
              maskColor="rgba(8, 12, 20, 0.7)"
              className="!bg-slate-950/90 !border !border-slate-800 !rounded-lg overflow-hidden"
            />
          </ReactFlow>

          {/* Toast Notification */}
          {toastMessage && (
            <div
              className={`absolute bottom-4 left-4 z-40 px-3.5 py-2 rounded-lg border shadow-xl flex items-center gap-2 text-xs font-medium backdrop-blur-md animate-in fade-in slide-in-from-bottom duration-200 ${
                toastMessage.type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200'
                  : toastMessage.type === 'error'
                  ? 'bg-rose-950/90 border-rose-500/60 text-rose-200'
                  : 'bg-slate-900/90 border-slate-700 text-slate-200'
              }`}
            >
              {toastMessage.type === 'success' ? (
                <CheckCircle2 size={14} className="text-emerald-400" />
              ) : toastMessage.type === 'error' ? (
                <AlertTriangle size={14} className="text-rose-400" />
              ) : (
                <Info size={14} className="text-cyan-400" />
              )}
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
