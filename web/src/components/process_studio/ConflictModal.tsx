import React from 'react';
import { AlertTriangle, RefreshCw, UploadCloud, X } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-amber-600/60 rounded-xl shadow-2xl overflow-hidden text-xs">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-amber-950/30">
          <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
            <AlertTriangle size={18} />
            <span>Draft Revision Conflict (409)</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-slate-300">
          <p>{message || 'The draft was updated by another session or worker.'}</p>

          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 font-mono text-[11px] space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Your local revision:</span>
              <span className="text-amber-400 font-bold">rev {localRevision}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Server revision:</span>
              <span className="text-cyan-400 font-bold">rev {serverRevision}</span>
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            Choose whether to reload the latest changes from the server (discarding conflicting uncommitted edits)
            or force-overwrite the server draft with your current changes.
          </p>
        </div>

        <div className="p-3 border-t border-slate-800 bg-slate-950/50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={onReload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition"
          >
            <RefreshCw size={13} />
            <span>Reload from Server</span>
          </button>
          <button
            onClick={onOverwrite}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold transition"
          >
            <UploadCloud size={13} />
            <span>Force Overwrite</span>
          </button>
        </div>
      </div>
    </div>
  );
};
