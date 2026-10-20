import React from 'react';
import { NodeProps } from '@xyflow/react';
import { Clock, AlertTriangle, ShieldCheck, Cpu, Play, CheckCircle, RotateCcw, AlertOctagon } from 'lucide-react';
import { EditorNode } from '../../editorTypes';
import { PortBadge } from './PortBadge';

export interface EditorNodeData {
  node: EditorNode;
  errors?: string[];
  portErrors?: Record<string, string>;
  onSelectNode?: (id: string) => void;
}

function getNodeIcon(type: string) {
  switch (type) {
    case 'Start':
      return <Play size={13} className="text-cyan-400" />;
    case 'Work':
      return <Cpu size={13} className="text-purple-400" />;
    case 'InspectResult':
      return <ShieldCheck size={13} className="text-amber-400" />;
    case 'LoopGate':
      return <RotateCcw size={13} className="text-emerald-400" />;
    case 'IndependentAcceptance':
      return <CheckCircle size={13} className="text-blue-400" />;
    case 'End':
      return <AlertOctagon size={13} className="text-rose-400" />;
    default:
      return <Cpu size={13} className="text-slate-400" />;
  }
}

export const EditorNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = data as unknown as EditorNodeData;
  const node = nodeData.node;
  const errors = nodeData.errors || [];
  const portErrors = nodeData.portErrors || {};
  const hasErrors = errors.length > 0;

  const inputPorts = node.ports.filter((p) => p.direction === 'input');
  const outputPorts = node.ports.filter((p) => p.direction === 'output');

  const execTimeout = node.deadlines?.execution_timeout_seconds;
  const queueTimeout = node.deadlines?.queue_timeout_seconds;

  const isCompact = node.type === 'Start' || node.type === 'End' || node.type === 'LoopGate';
  const widthClass = isCompact ? 'min-w-[190px] max-w-[210px]' : 'min-w-[220px] max-w-[245px]';

  return (
    <div
      onClick={() => nodeData.onSelectNode?.(id)}
      className={`relative ${widthClass} rounded-xl border p-2.5 bg-slate-900/95 backdrop-blur-md shadow-2xl transition-all duration-150 cursor-pointer ${
        hasErrors
          ? 'border-rose-500 ring-2 ring-rose-500/40 shadow-rose-950/40'
          : selected
          ? 'border-cyan-400 ring-2 ring-cyan-400/50 shadow-cyan-950/50'
          : 'border-slate-700/80 hover:border-slate-500'
      }`}
    >
      {/* Node Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="p-1 rounded bg-slate-950 border border-slate-800 shrink-0">
            {getNodeIcon(node.type)}
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-xs text-slate-100 truncate" title={node.name}>
              {node.name}
            </h4>
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-400">
              <span className="uppercase text-cyan-400 font-semibold">{node.type}</span>
              {node.role && <span className="bg-slate-800 px-1 rounded text-slate-300">@{node.role}</span>}
            </div>
          </div>
        </div>

        {/* Timeout / Badges */}
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {execTimeout !== undefined && (
            <span
              className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-950/80 border border-orange-800/60 text-orange-300"
              title={`Execution timeout: ${execTimeout}s${queueTimeout ? ` (Queue: ${queueTimeout}s)` : ''}`}
            >
              <Clock size={10} />
              {execTimeout}s
            </span>
          )}
          {hasErrors && (
            <span
              className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-800/60 text-rose-300"
              title={errors.join('\n')}
            >
              <AlertTriangle size={10} />
              {errors.length} err
            </span>
          )}
        </div>
      </div>

      {/* Goal Preview */}
      {node.goal && (
        <p className="text-[10px] text-slate-400 mb-2.5 line-clamp-2 italic leading-tight" title={node.goal}>
          {node.goal}
        </p>
      )}

      {/* Ports Columns */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {/* Inputs (Left) */}
        <div className="space-y-1">
          {inputPorts.length > 0 && (
            <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider block px-1">
              Inputs
            </span>
          )}
          {inputPorts.map((port) => (
            <PortBadge key={port.id} port={port} hasError={Boolean(portErrors[port.id])} />
          ))}
        </div>

        {/* Outputs (Right) */}
        <div className="space-y-1 text-right">
          {outputPorts.length > 0 && (
            <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider block px-1">
              Outputs
            </span>
          )}
          {outputPorts.map((port) => (
            <PortBadge key={port.id} port={port} hasError={Boolean(portErrors[port.id])} />
          ))}
        </div>
      </div>
    </div>
  );
};
