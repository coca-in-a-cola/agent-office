import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { CheckCircle2 } from 'lucide-react';

export interface TerminalNodeData {
  label: string;
}

export const TerminalNodeComponent: React.FC<NodeProps> = ({ data }) => {
  const nodeData = data as unknown as TerminalNodeData;
  return (
    <div className="relative flex items-center gap-2 px-4 py-2.5 rounded-full border-2 border-emerald-500 bg-emerald-950/80 text-emerald-300 shadow-xl shadow-emerald-950/40 backdrop-blur-md">
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-neutral-900 transition-colors hover:!bg-emerald-300"
      />
      <CheckCircle2 size={16} className="text-emerald-400" />
      <span className="font-mono text-xs font-bold uppercase tracking-wider">
        {nodeData.label || 'Completed'}
      </span>
    </div>
  );
};
