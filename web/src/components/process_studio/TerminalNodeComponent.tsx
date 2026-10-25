import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { CheckCircle2 } from 'lucide-react';
import '../../styles/components/workflow-node.scss';

export interface TerminalNodeData {
  label: string;
}

export const TerminalNodeComponent: React.FC<NodeProps> = ({ data }) => {
  const nodeData = data as unknown as TerminalNodeData;
  return (
    <div className="ps-terminal-node">
      <Handle
        type="target"
        position={Position.Left}
        className="ps-terminal-node__handle"
      />
      <CheckCircle2 size={16} className="ps-terminal-node__icon" />
      <span className="ps-terminal-node__label">
        {nodeData.label || 'Completed'}
      </span>
    </div>
  );
};
