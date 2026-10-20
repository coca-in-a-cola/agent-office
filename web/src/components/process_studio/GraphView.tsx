import React, { useMemo, useCallback } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NodeRunState, WorkflowDefinition } from '../../workflowTypes';
import { WorkflowNodeComponent } from './WorkflowNodeComponent';
import { TerminalNodeComponent } from './TerminalNodeComponent';

interface GraphViewProps {
  definition: WorkflowDefinition;
  nodeStates?: Record<string, NodeRunState>;
  selectedNode: string | null;
  onSelectNode: (node: string) => void;
  highlightNode?: string | null;
}

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeComponent,
  terminalNode: TerminalNodeComponent,
};

const NODE_X_SPACING = 300;
const NODE_Y = 180;

export const GraphView: React.FC<GraphViewProps> = ({
  definition,
  nodeStates,
  selectedNode,
  onSelectNode,
  highlightNode = null,
}) => {
  const { nodes, edges } = useMemo(() => {
    const columnMap: Record<string, number> = {};
    definition.node_order.forEach((name, i) => (columnMap[name] = i));

    const nodesByName = Object.fromEntries(definition.nodes.map((n) => [n.name, n]));
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];

    // 1. Build Nodes
    definition.node_order.forEach((name, index) => {
      const def = nodesByName[name];
      const run = nodeStates?.[name];
      const isSelected = selectedNode === name;
      const isHighlighted = highlightNode === name;
      const isCurrent = run?.is_current;

      flowNodes.push({
        id: name,
        type: 'workflowNode',
        position: { x: 40 + index * NODE_X_SPACING, y: NODE_Y },
        data: {
          name,
          role: def?.role || 'Agent',
          goal: def?.goal || '',
          runState: run,
          requiresApproval: def?.requires_approval,
          sideEffecting: def?.side_effecting,
          isCurrent,
          isSelected,
          isHighlighted,
          onSelect: onSelectNode,
        },
      });
    });

    // Terminal Node
    let completedFrom: string | null = null;
    definition.allowed_transitions.forEach((t) => {
      if (t.target === '@completed') {
        completedFrom = t.source;
      }
    });

    if (completedFrom) {
      const termX = 40 + definition.node_order.length * NODE_X_SPACING;
      flowNodes.push({
        id: 'terminal-done',
        type: 'terminalNode',
        position: { x: termX, y: NODE_Y + 16 },
        data: { label: 'Done' },
      });
    }

    // 2. Build Edges (grouped by source and target)
    const groupedEdges = new Map<string, { source: string; target: string; outcomes: string[] }>();

    definition.allowed_transitions.forEach((t) => {
      const targetId = t.target === '@completed' ? 'terminal-done' : t.target;
      if (columnMap[t.target] !== undefined || t.target === '@completed') {
        const key = `${t.source}->${targetId}`;
        const existing = groupedEdges.get(key) ?? {
          source: t.source,
          target: targetId,
          outcomes: [],
        };
        existing.outcomes.push(t.outcome);
        groupedEdges.set(key, existing);
      }
    });

    groupedEdges.forEach(({ source, target, outcomes }, key) => {
      const isDefect = outcomes.includes('defect');
      const isTimeout = outcomes.includes('timeout');
      const isSuccess = outcomes.includes('success');
      const isSelfLoop = source === target;

      const sourceState = nodeStates?.[source]?.state;
      const isActive = sourceState === 'running' || sourceState === 'approval_wait';

      // Visual styling per outcome type
      let strokeColor = '#64748b'; // default slate
      let strokeDash = undefined;

      if (isSuccess) {
        strokeColor = '#10b981'; // emerald
      } else if (isDefect) {
        strokeColor = '#f59e0b'; // amber
        strokeDash = '5 5';
      } else if (isTimeout) {
        strokeColor = '#f97316'; // orange
        strokeDash = '4 4';
      }

      flowEdges.push({
        id: key,
        source,
        target,
        type: isSelfLoop ? 'default' : 'smoothstep',
        animated: isActive && isSuccess,
        label: outcomes.join(' / '),
        labelStyle: {
          fill: isDefect ? '#fcd34d' : isSuccess ? '#6ee7b7' : '#cbd5e1',
          fontSize: 10,
          fontFamily: 'monospace',
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: '#0f172a',
          fillOpacity: 0.9,
          stroke: isDefect ? '#b45309' : isSuccess ? '#047857' : '#334155',
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        },
        labelBgPadding: [6, 2],
        style: {
          stroke: strokeColor,
          strokeWidth: 2,
          strokeDasharray: strokeDash,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
          width: 16,
          height: 16,
        },
      });
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [definition, nodeStates, selectedNode, highlightNode, onSelectNode]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'workflowNode') {
        onSelectNode(node.id);
      }
    },
    [onSelectNode]
  );

  return (
    <div className="relative w-full h-[560px] bg-neutral-950 rounded-xl border border-neutral-800 shadow-2xl overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        className="bg-neutral-950"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="#334155"
          className="opacity-40"
        />
        <Controls
          className="!bg-neutral-900 !border !border-neutral-800 !rounded-lg !shadow-xl [&>button]:!bg-neutral-900 [&>button]:!border-b [&>button]:!border-neutral-800 [&>button]:!text-neutral-300 [&>button:hover]:!bg-neutral-800 [&>button:hover]:!text-cyan-400"
          showInteractive={false}
        />
        <MiniMap
          nodeColor={(n) => {
            if (n.type === 'terminalNode') return '#10b981';
            const data = n.data as unknown as { runState?: NodeRunState };
            const state = data?.runState?.state;
            if (state === 'running') return '#06b6d4';
            if (state === 'succeeded') return '#10b981';
            if (state === 'defect') return '#f59e0b';
            if (state === 'timeout') return '#f97316';
            if (state === 'failure') return '#ef4444';
            if (state === 'approval_wait') return '#a855f7';
            return '#475569';
          }}
          maskColor="rgba(0, 0, 0, 0.75)"
          className="!bg-neutral-900/90 !border !border-neutral-800 !rounded-lg !shadow-xl"
        />
      </ReactFlow>
    </div>
  );
};
