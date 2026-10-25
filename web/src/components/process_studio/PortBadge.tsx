import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { EditorPort } from '../../editorTypes';
import '../../styles/components/port-badge.scss';

interface PortBadgeProps {
  port: EditorPort;
  hasConnection?: boolean;
  hasError?: boolean;
}


function getPortColorModifier(port: EditorPort): string {
  if (port.kind === 'control') {
    switch (port.control_outcome) {
      case 'exec_in':
        return 'ps-port-badge__type--cyan';
      case 'success':
      case 'accept_partial':
        return 'ps-port-badge__type--emerald';
      case 'defect':
        return 'ps-port-badge__type--amber';
      case 'timeout':
        return 'ps-port-badge__type--orange';
      case 'failure':
      case 'stop':
        return 'ps-port-badge__type--rose';
      case 'loop_body':
      case 'recover':
        return 'ps-port-badge__type--purple';
      case 'loop_exit':
      case 'quota_exhausted':
        return 'ps-port-badge__type--red';
      default:
        return 'ps-port-badge__type--slate';
    }
  }

  if (port.kind === 'status') {
    return 'ps-port-badge__type--amber';
  }

  switch (port.data_type) {
    case 'ChangeRequest':
      return 'ps-port-badge__type--blue';
    case 'CommitRef':
      return 'ps-port-badge__type--indigo';
    case 'PartialResult':
      return 'ps-port-badge__type--teal';
    case 'EvidenceRef':
      return 'ps-port-badge__type--emerald';
    case 'ArtifactRef':
      return 'ps-port-badge__type--violet';
    case 'TaskRef':
      return 'ps-port-badge__type--sky';
    default:
      return 'ps-port-badge__type--cyan';
  }
}

export const PortBadge: React.FC<PortBadgeProps> = ({ port, hasError }) => {
  const isInput = port.direction === 'input';
  const position = isInput ? Position.Left : Position.Right;

  // Semantic handle shape classes:
  // Control: Diamond (solid, rotated 45deg)
  // Data: Circle
  // Status: Hollow rounded rectangle
  const handleClasses = ['ps-port-badge__handle'];

  if (port.kind === 'control') {
    handleClasses.push('ps-port-badge__handle--control');
    const outcome = port.control_outcome ?? 'control-default';
    handleClasses.push(`ps-port-badge__handle--${outcome}`);
  } else if (port.kind === 'status') {
    handleClasses.push('ps-port-badge__handle--status', 'ps-port-badge__handle--status-badge');
  } else {
    handleClasses.push('ps-port-badge__handle--data');
    const dataType = port.data_type ?? 'default';
    handleClasses.push(`ps-port-badge__handle--data-${dataType}`);
  }

  if (hasError) {
    handleClasses.push('ps-port-badge__handle--error');
  }

  const colorModifier = getPortColorModifier(port);

  const tooltip = `${port.name} [${port.kind.toUpperCase()}${
    port.kind === 'data' ? `: ${port.data_type}` : port.control_outcome ? `: ${port.control_outcome}` : ''
  }${port.required ? ', required' : ''}] (id: ${port.id})`;

  return (
    <div
      className={`ps-port-badge ${isInput ? 'ps-port-badge--input' : 'ps-port-badge--output'}`}
      title={tooltip}
    >
      <Handle
        type={isInput ? 'target' : 'source'}
        position={position}
        id={port.id}
        className={handleClasses.join(' ')}
        style={{
          position: 'relative',
          transform: port.kind === 'control' ? 'rotate(45deg)' : 'none',
          left: 'auto',
          top: 'auto',
          right: 'auto',
          bottom: 'auto',
        }}
      />
      <div className="ps-port-badge__content">
        <span className={`ps-port-badge__name ${hasError ? 'ps-port-badge__name--error' : ''}`}>
          {port.name}
        </span>
        <span className={`ps-port-badge__type ${colorModifier}`}>
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
