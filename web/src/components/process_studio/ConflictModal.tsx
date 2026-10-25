import React from 'react';
import { AlertTriangle, RefreshCw, UploadCloud, X } from 'lucide-react';
import '../../styles/components/conflict-modal.scss';

interface ConflictModalProps {
  isOpen: boolean;
  message: string;
  serverRevision: number;
  localRevision: number;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  isOpen,
  message,
  serverRevision,
  localRevision,
  onReload,
  onOverwrite,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="ps-conflict-modal__overlay">
      <div className="ps-conflict-modal__card">
        <div className="ps-conflict-modal__header">
          <div className="ps-conflict-modal__title-group">
            <AlertTriangle size={18} />
            <span>Draft Revision Conflict (409)</span>
          </div>
          <button onClick={onClose} className="ps-conflict-modal__close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="ps-conflict-modal__body">
          <p>{message || 'The draft was updated by another session or worker.'}</p>

          <div className="ps-conflict-modal__revisions">
            <div className="ps-conflict-modal__revision-row">
              <span className="ps-conflict-modal__revision-label">Your local revision:</span>
              <span className="ps-conflict-modal__revision-val-local">rev {localRevision}</span>
            </div>
            <div className="ps-conflict-modal__revision-row">
              <span className="ps-conflict-modal__revision-label">Server revision:</span>
              <span className="ps-conflict-modal__revision-val-server">rev {serverRevision}</span>
            </div>
          </div>

          <p className="ps-conflict-modal__description">
            Choose whether to reload the latest changes from the server (discarding conflicting uncommitted edits)
            or force-overwrite the server draft with your current changes.
          </p>
        </div>

        <div className="ps-conflict-modal__actions">
          <button
            onClick={onClose}
            className="ps-conflict-modal__btn-cancel"
          >
            Cancel
          </button>
          <button
            onClick={onReload}
            className="ps-conflict-modal__btn-reload"
          >
            <RefreshCw size={13} />
            <span>Reload from Server</span>
          </button>
          <button
            onClick={onOverwrite}
            className="ps-conflict-modal__btn-overwrite"
          >
            <UploadCloud size={13} />
            <span>Force Overwrite</span>
          </button>
        </div>
      </div>
    </div>
  );
};
