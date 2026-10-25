import React from 'react';
import { NodeProps } from '@xyflow/react';
import { Clock, AlertTriangle, ShieldCheck, Cpu, Play, CheckCircle, RotateCcw, AlertOctagon } from 'lucide-react';
import { EditorNode } from '../../editorTypes';
import { PortBadge } from './PortBadge';
import '../../styles/components/editor-node.scss';

export interface EditorNodeData {
  node: EditorNode;
  errors?: string[];
  portErrors?: Record<string, string>;
  onSelectNode?: (id: string) => void;
}

function getNodeIcon(type: string) {
  switch (type) {
    case 'Start':
      return <Play size={13} className="ps-editor-node__icon ps-editor-node__icon--cyan" />;
    case 'Work':
      return <Cpu size={13} className="ps-editor-node__icon ps-editor-node__icon--purple" />;
    case 'InspectResult':
      return <ShieldCheck size={13} className="ps-editor-node__icon ps-editor-node__icon--amber" />;
    case 'LoopGate':
      return <RotateCcw size={13} className="ps-editor-node__icon ps-editor-node__icon--emerald" />;
    case 'IndependentAcceptance':
      return <CheckCircle size={13} className="ps-editor-node__icon ps-editor-node__icon--blue" />;
    case 'End':
      return <AlertOctagon size={13} className="ps-editor-node__icon ps-editor-node__icon--rose" />;
    default:
      return <Cpu size={13} className="ps-editor-node__icon ps-editor-node__icon--muted" />;
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
  const widthModifier = isCompact ? 'ps-editor-node--compact' : 'ps-editor-node--standard';
  const stateModifier = hasErrors
    ? 'ps-editor-node--error'
    : selected
    ? 'ps-editor-node--selected'
    : '';

  return (
    <div
      onClick={() => nodeData.onSelectNode?.(id)}
      className={`ps-editor-node ${widthModifier} ${stateModifier}`}
    >
      {/* Node Header */}
      <div className="ps-editor-node__header">
        <div className="ps-editor-node__header-left">
          <div className="ps-editor-node__icon-box">
            {getNodeIcon(node.type)}
          </div>
          <div className="ps-editor-node__title-wrap">
            <h4 className="ps-editor-node__title" title={node.name}>
              {node.name}
            </h4>
            <div className="ps-editor-node__meta">
              <span className="ps-editor-node__type-tag">{node.type}</span>
              {node.role && <span className="ps-editor-node__role-tag">@{node.role}</span>}
            </div>
          </div>
        </div>

        {/* Timeout / Badges */}
        <div className="ps-editor-node__badges">
          {execTimeout !== undefined && (
            <span
              className="ps-editor-node__badge ps-editor-node__badge--timeout"
              title={`Execution timeout: ${execTimeout}s${queueTimeout ? ` (Queue: ${queueTimeout}s)` : ''}`}
            >
              <Clock size={10} />
              {execTimeout}s
            </span>
          )}
          {hasErrors && (
            <span
              className="ps-editor-node__badge ps-editor-node__badge--error"
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
        <p className="ps-editor-node__goal" title={node.goal}>
          {node.goal}
        </p>
      )}

      {/* Ports Columns */}
      <div className="ps-editor-node__ports">
        {/* Inputs (Left) */}
        <div className="ps-editor-node__ports-col ps-editor-node__ports-col--inputs">
          {inputPorts.length > 0 && (
            <span className="ps-editor-node__ports-label">
              Inputs
            </span>
          )}
          {inputPorts.map((port) => (
            <PortBadge key={port.id} port={port} hasError={Boolean(portErrors[port.id])} />
          ))}
        </div>

        {/* Outputs (Right) */}
        <div className="ps-editor-node__ports-col ps-editor-node__ports-col--outputs">
          {outputPorts.length > 0 && (
            <span className="ps-editor-node__ports-label">
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
