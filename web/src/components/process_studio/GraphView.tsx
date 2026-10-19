import React, { useMemo } from 'react';
import { NodeRunState, WorkflowDefinition } from '../../workflowTypes';
import { styleFor } from './NodeStatusBadge';

interface GraphViewProps {
  definition: WorkflowDefinition;
  nodeStates?: Record<string, NodeRunState>;
  selectedNode: string | null;
  onSelectNode: (node: string) => void;
}

const NODE_W = 150;
const NODE_H = 76;
const GAP_X = 64;
const PAD = 40;
const ROW_Y = 70;
const TERMINAL_R = 22;

interface Edge {
  source: string;
  target: string;
  outcomes: string[];
}

/**
 * Left-to-right layered layout: columns follow the success path (node_order),
 * forward edges are straight, feedback edges (defect loops) arc underneath and
 * self-loops sit above the node. Engine targets (@retry, @blocked, ...) are
 * shown as per-node outcome chips; only @completed is drawn as a terminal.
 */
export const GraphView: React.FC<GraphViewProps> = ({
  definition,
  nodeStates,
  selectedNode,
  onSelectNode,
}) => {
  const layout = useMemo(() => {
    const column: Record<string, number> = {};
    definition.node_order.forEach((name, i) => (column[name] = i));
    const nodeNames = new Set(definition.node_order);
    const grouped = new Map<string, Edge>();
    const special: Record<string, Record<string, string[]>> = {};
    let completedFrom: string | null = null;
    for (const t of definition.allowed_transitions) {
      if (nodeNames.has(t.target)) {
        const key = `${t.source}->${t.target}`;
        const edge = grouped.get(key) ?? { source: t.source, target: t.target, outcomes: [] };
        edge.outcomes.push(t.outcome);
        grouped.set(key, edge);
      } else if (t.target === '@completed') {
        completedFrom = t.source;
      } else {
        special[t.source] ??= {};
        special[t.source][t.target] ??= [];
        special[t.source][t.target].push(t.outcome);
      }
    }
    const xOf = (name: string) => PAD + column[name] * (NODE_W + GAP_X);
    const terminalX = PAD + definition.node_order.length * (NODE_W + GAP_X) + TERMINAL_R;
    const width = terminalX + TERMINAL_R + PAD;
    return {
      edges: Array.from(grouped.values()),
      special,
      completedFrom,
      xOf,
      column,
      terminalX,
      width,
      height: ROW_Y + NODE_H + 150,
    };
  }, [definition]);

  const nodesByName = Object.fromEntries(definition.nodes.map((n) => [n.name, n]));
  const midY = ROW_Y + NODE_H / 2;
  let backIndex = 0;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="min-w-[900px] w-full"
        role="img"
        aria-label={`Workflow graph ${definition.name} v${definition.version}`}
      >
        <defs>
          <marker id="ps-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
          <marker id="ps-arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
          </marker>
        </defs>

        {/* Edges between workflow nodes */}
        {layout.edges.map((edge) => {
          const sx = layout.xOf(edge.source);
          const tx = layout.xOf(edge.target);
          const label = edge.outcomes.join(' / ');
          if (edge.source === edge.target) {
            const cx = sx + NODE_W / 2;
            return (
              <g key={`${edge.source}-self`}>
                <path
                  d={`M ${cx - 24} ${ROW_Y} C ${cx - 40} ${ROW_Y - 50}, ${cx + 40} ${ROW_Y - 50}, ${cx + 24} ${ROW_Y}`}
                  fill="none"
                  stroke="#f59e0b"
                  strokeDasharray="4 3"
                  markerEnd="url(#ps-arrow-amber)"
                />
                <text x={cx} y={ROW_Y - 42} textAnchor="middle" className="fill-amber-300" fontSize="10">
                  {label}
                </text>
              </g>
            );
          }
          if (layout.column[edge.target] > layout.column[edge.source]) {
            return (
              <g key={`${edge.source}-${edge.target}`}>
                <line x1={sx + NODE_W} y1={midY} x2={tx - 2} y2={midY} stroke="#64748b" strokeWidth="1.5" markerEnd="url(#ps-arrow)" />
                <text x={(sx + NODE_W + tx) / 2} y={midY - 6} textAnchor="middle" className="fill-slate-400" fontSize="10">
                  {label}
                </text>
              </g>
            );
          }
          backIndex += 1;
          const depth = ROW_Y + NODE_H + 22 + backIndex * 18;
          const x1 = sx + NODE_W / 2 - 10;
          const x2 = tx + NODE_W / 2 + 10;
          return (
            <g key={`${edge.source}-${edge.target}`}>
              <path
                d={`M ${x1} ${ROW_Y + NODE_H} C ${x1} ${depth}, ${x2} ${depth}, ${x2} ${ROW_Y + NODE_H + 2}`}
                fill="none"
                stroke="#f59e0b"
                strokeOpacity="0.8"
                strokeDasharray="4 3"
                markerEnd="url(#ps-arrow-amber)"
              />
              <text x={(x1 + x2) / 2} y={depth - 4} textAnchor="middle" className="fill-amber-300" fontSize="10">
                {label}
              </text>
            </g>
          );
        })}

        {/* Terminal success */}
        {layout.completedFrom && (
          <g>
            <line
              x1={layout.xOf(layout.completedFrom) + NODE_W}
              y1={midY}
              x2={layout.terminalX - TERMINAL_R - 2}
              y2={midY}
              stroke="#64748b"
              strokeWidth="1.5"
              markerEnd="url(#ps-arrow)"
            />
            <circle cx={layout.terminalX} cy={midY} r={TERMINAL_R} fill="#052e16" stroke="#22c55e" strokeWidth="2" />
            <text x={layout.terminalX} y={midY + 4} textAnchor="middle" fontSize="10" className="fill-emerald-300 font-semibold">
              done
            </text>
          </g>
        )}

        {/* Nodes */}
        {definition.node_order.map((name) => {
          const node = nodesByName[name];
          const run = nodeStates?.[name];
          const style = styleFor(run?.state);
          const x = layout.xOf(name);
          const selected = selectedNode === name;
          const chips = Object.entries(layout.special[name] ?? {});
          return (
            <g
              key={name}
              transform={`translate(${x}, ${ROW_Y})`}
              onClick={() => onSelectNode(name)}
              className="cursor-pointer"
              role="button"
              aria-label={`${name}: ${style.label}`}
            >
              {style.pulse && (
                <rect
                  x={-4}
                  y={-4}
                  width={NODE_W + 8}
                  height={NODE_H + 8}
                  rx={14}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth="3"
                  className="animate-pulse"
                />
              )}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={style.fill}
                stroke={selected ? '#e2e8f0' : style.stroke}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              <text x={10} y={20} fontSize="12" className="fill-slate-100 font-semibold">
                {name}
              </text>
              <text x={10} y={36} fontSize="10" className="fill-slate-400">
                {node?.role}
              </text>
              <circle cx={14} cy={56} r={4} fill={style.stroke} />
              <text x={24} y={60} fontSize="10" fill={style.stroke} className="font-semibold uppercase">
                {style.label}
              </text>
              {run && run.attempts > 0 && (
                <text x={NODE_W - 8} y={60} fontSize="9" textAnchor="end" className="fill-slate-400 font-mono">
                  it{run.iteration} · {run.attempts}×
                </text>
              )}
              {node?.requires_approval && (
                <text x={NODE_W - 8} y={20} fontSize="10" textAnchor="end" className="fill-purple-300">
                  gate
                </text>
              )}
              {node?.side_effecting && (
                <text x={NODE_W - 8} y={36} fontSize="9" textAnchor="end" className="fill-orange-300">
                  side-effect
                </text>
              )}
              {run?.is_current && (
                <text x={NODE_W / 2} y={-10} fontSize="9" textAnchor="middle" className="fill-cyan-300 font-semibold uppercase">
                  ▼ current
                </text>
              )}
              <title>
                {`${name} (${node?.role})\n${node?.goal}\n` +
                  chips.map(([target, outcomes]) => `${outcomes.join('/')} → ${target}`).join('\n')}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
