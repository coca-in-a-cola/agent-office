import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { EditorPort } from '../../editorTypes';

interface PortBadgeProps {
  port: EditorPort;
  hasConnection?: boolean;
  hasError?: boolean;
}

export function getPortColor(port: EditorPort): { bg: string; border: string; text: string } {
  if (port.kind === 'control') {
    switch (port.control_outcome) {
      case 'exec_in':
        return { bg: 'bg-cyan-500', border: 'border-cyan-300', text: 'text-cyan-300' };
      case 'success':
      case 'accept_partial':
        return { bg: 'bg-emerald-500', border: 'border-emerald-300', text: 'text-emerald-300' };
      case 'defect':
        return { bg: 'bg-amber-500', border: 'border-amber-300', text: 'text-amber-300' };
      case 'timeout':
        return { bg: 'bg-orange-500', border: 'border-orange-300', text: 'text-orange-300' };
      case 'failure':
      case 'stop':
        return { bg: 'bg-rose-500', border: 'border-rose-300', text: 'text-rose-300' };
      case 'loop_body':
      case 'recover':
        return { bg: 'bg-purple-500', border: 'border-purple-300', text: 'text-purple-300' };
      case 'loop_exit':
      case 'quota_exhausted':
        return { bg: 'bg-red-600', border: 'border-red-400', text: 'text-red-400' };
      default:
        return { bg: 'bg-slate-400', border: 'border-slate-200', text: 'text-slate-300' };
    }
  }

  if (port.kind === 'status') {
    return { bg: 'bg-amber-400/20', border: 'border-amber-400', text: 'text-amber-300' };
  }

  // data ports: color by data_type
  switch (port.data_type) {
    case 'ChangeRequest':
      return { bg: 'bg-blue-500', border: 'border-blue-300', text: 'text-blue-300' };
    case 'CommitRef':
      return { bg: 'bg-indigo-500', border: 'border-indigo-300', text: 'text-indigo-300' };
    case 'PartialResult':
      return { bg: 'bg-teal-500', border: 'border-teal-300', text: 'text-teal-300' };
    case 'EvidenceRef':
      return { bg: 'bg-emerald-500', border: 'border-emerald-300', text: 'text-emerald-300' };
    case 'ArtifactRef':
      return { bg: 'bg-violet-500', border: 'border-violet-300', text: 'text-violet-300' };
    case 'TaskRef':
      return { bg: 'bg-sky-500', border: 'border-sky-300', text: 'text-sky-300' };
    default:
      return { bg: 'bg-cyan-600', border: 'border-cyan-300', text: 'text-cyan-300' };
  }
}

export const PortBadge: React.FC<PortBadgeProps> = ({ port, hasError }) => {
  const isInput = port.direction === 'input';
  const position = isInput ? Position.Left : Position.Right;
  const colors = getPortColor(port);

  // Shape distinguishes kind without relying solely on color (SPEC Section 4 & contracts Section 2.1)
  // Control: Diamond (solid, rotated 45deg)
  // Data: Circle
  // Status: Hollow rounded rectangle
  let shapeClass = '!w-3.5 !h-3.5 !border-2 !border-slate-900 transition-transform hover:scale-125';
  if (port.kind === 'control') {
    shapeClass += ' !rounded-none !rotate-45 ' + colors.bg;
  } else if (port.kind === 'status') {
    shapeClass += ' !rounded-sm !bg-transparent ' + colors.border;
  } else {
    shapeClass += ' !rounded-full ' + colors.bg;
  }

  if (hasError) {
    shapeClass += ' !ring-2 !ring-rose-500 !ring-offset-1 !ring-offset-slate-950 animate-pulse';
  }

  const tooltip = `${port.name} [${port.kind.toUpperCase()}${
    port.kind === 'data' ? `: ${port.data_type}` : port.control_outcome ? `: ${port.control_outcome}` : ''
  }${port.required ? ', required' : ''}] (id: ${port.id})`;

  return (
    <div
      className={`relative flex items-center gap-1.5 py-1 px-1 text-[10px] font-mono leading-none ${
        isInput ? 'flex-row' : 'flex-row-reverse text-right'
      }`}
      title={tooltip}
    >
      <Handle
        type={isInput ? 'target' : 'source'}
        position={position}
        id={port.id}
        className={shapeClass}
        style={{
          position: 'relative',
          transform: port.kind === 'control' ? 'rotate(45deg)' : 'none',
          left: 'auto',
          top: 'auto',
          right: 'auto',
          bottom: 'auto',
        }}
      />
      <div className="flex flex-col min-w-0">
        <span className={`font-semibold truncate ${hasError ? 'text-rose-400' : 'text-slate-200'}`}>
          {port.name}
        </span>
        <span className={`text-[9px] truncate ${colors.text}`}>
          {port.kind === 'control'
            ? port.control_outcome ?? 'control'
            : port.kind === 'status'
            ? port.status_kind ?? 'status'
            : port.data_type ?? 'data'}
        </span>
      </div>
    </div>
  );
};
