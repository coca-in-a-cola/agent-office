import React, { useEffect } from 'react';
import {
  FURNITURE_CATALOG,
  type FurnitureDefinition,
  type FurnitureRotation,
} from '../../grid/footprintEngine';
import './FurnitureToolbar.scss';

export interface FurnitureToolbarProps {
  selectedDefId: string | null;
  rotation: FurnitureRotation;
  isDeleteMode: boolean;
  onSelectDef: (defId: string) => void;
  onRotate: () => void;
  onToggleDelete: () => void;
  onClose: () => void;
}

export const FurnitureToolbar: React.FC<FurnitureToolbarProps> = ({
  selectedDefId,
  rotation,
  isDeleteMode,
  onSelectDef,
  onRotate,
  onToggleDelete,
  onClose,
}) => {
  // Listen for keyboard 'R' to rotate
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        onRotate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onRotate]);

  const items: FurnitureDefinition[] = Object.values(FURNITURE_CATALOG);

  return (
    <aside className="furniture-toolbar" aria-label="Furniture Editor Toolbar">
      <div className="toolbar-section">
        <span className="section-title">Place Furniture:</span>
        <div className="item-buttons-group">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`furniture-btn ${!isDeleteMode && selectedDefId === item.id ? 'active' : ''}`}
              onClick={() => onSelectDef(item.id)}
              title={`${item.name} (${item.width}×${item.height})`}
            >
              <span className="item-name">{item.name}</span>
              <span className="item-size">{item.width}×{item.height}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-section controls-section">
        <button
          type="button"
          className="control-btn rotate-btn"
          onClick={onRotate}
          title="Rotate furniture 90° clockwise (Hotkey: R)"
        >
          <span>Rotate (R)</span>
          <span className="rotation-badge">{rotation}°</span>
        </button>

        <button
          type="button"
          className={`control-btn delete-btn ${isDeleteMode ? 'active' : ''}`}
          onClick={onToggleDelete}
          title="Toggle delete / remove mode"
        >
          <span>{isDeleteMode ? 'Delete: ON' : 'Delete Tool'}</span>
        </button>

        <button
          type="button"
          className="control-btn done-btn"
          onClick={onClose}
          title="Close Furniture Editor and return to View mode"
        >
          <span>Done</span>
        </button>
      </div>
    </aside>
  );
};
