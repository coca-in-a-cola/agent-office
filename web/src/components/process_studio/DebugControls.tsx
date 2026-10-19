import React, { useState } from 'react';
import { CheckCircle2, Pause, Play, RotateCcw, ShieldCheck, Square, X } from 'lucide-react';
import { RunCommand } from '../../workflowApi';
import { RunDetail } from '../../workflowTypes';

interface DebugControlsProps {
  detail: RunDetail;
  busy: boolean;
  /** Current node performs an external side effect (retry needs confirmation). */
  sideEffecting: boolean;
  onCommand: (command: RunCommand, body?: Record<string, unknown>) => Promise<void>;
}

const buttonBase =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-35 disabled:cursor-not-allowed';

export const DebugControls: React.FC<DebugControlsProps> = ({
  detail,
  busy,
  sideEffecting,
  onCommand,
}) => {
  const { actions, pending_gate: gate, run } = detail;
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approver, setApprover] = useState('owner');
  const [scope, setScope] = useState('');
  const currentNode = run.current_node;

  const openApproval = () => {
    setScope(gate?.scope ?? '');
    setApprovalOpen(true);
  };

  const confirmCancel = () => {
    if (window.confirm(`Cancel run ${run.run_id}? The active attempt is cancelled via Task Bridge.`)) {
      void onCommand('cancel', { reason: 'cancelled from Process Studio' });
    }
  };

  const retry = () => {
    const reason = window.prompt(
      `Authorize one bounded retry of "${currentNode}"? Reason (recorded in the journal):`,
      ''
    );
    if (reason === null) return;
    let confirmSideEffect = false;
    if (sideEffecting) {
      confirmSideEffect = window.confirm(
        `"${currentNode}" is side-effecting. Confirm you reconciled the external state and want to run it again.`
      );
      if (!confirmSideEffect) return;
    }
    void onCommand('retry', { reason, confirm_side_effect: confirmSideEffect });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={`${buttonBase} bg-yellow-950/60 border-yellow-600/50 text-yellow-200 hover:bg-yellow-900/60`}
        disabled={busy || !actions.pause}
        onClick={() => void onCommand('pause', { reason: 'paused from Process Studio' })}
        title="Stop coordinator advancement of this run"
      >
        <Pause size={13} /> Pause
      </button>
      <button
        className={`${buttonBase} bg-emerald-950/60 border-emerald-600/50 text-emerald-200 hover:bg-emerald-900/60`}
        disabled={busy || !actions.resume}
        onClick={() => void onCommand('resume')}
      >
        <Play size={13} /> Resume
      </button>
      <button
        className={`${buttonBase} bg-red-950/60 border-red-600/50 text-red-200 hover:bg-red-900/60`}
        disabled={busy || !actions.cancel}
        onClick={confirmCancel}
      >
        <Square size={13} /> Cancel
      </button>
      <button
        className={`${buttonBase} bg-orange-950/60 border-orange-600/50 text-orange-200 hover:bg-orange-900/60`}
        disabled={busy || !actions.retry}
        onClick={retry}
        title="Authorized bounded retry of the failed / timed-out node"
      >
        <RotateCcw size={13} /> Retry
      </button>
      <button
        className={`${buttonBase} bg-purple-950/60 border-purple-500/60 text-purple-200 hover:bg-purple-900/60`}
        disabled={busy || !actions.approve}
        onClick={openApproval}
      >
        <ShieldCheck size={13} /> Approve
      </button>

      {approvalOpen && gate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[460px] bg-slate-900 border border-purple-500/50 rounded-xl shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-purple-200 flex items-center gap-2">
                <ShieldCheck size={16} /> Approve gate
              </h3>
              <button onClick={() => setApprovalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 font-mono text-[11px]">
              <dt className="text-slate-400">Gate</dt>
              <dd className="text-slate-200 break-all">{gate.gate_id}</dd>
              <dt className="text-slate-400">Node</dt>
              <dd className="text-slate-200">{gate.node} (iteration {gate.iteration})</dd>
              <dt className="text-slate-400">Evidence</dt>
              <dd className="text-slate-200 break-all">{gate.evidence_digest || '—'}</dd>
            </dl>
            <label className="block space-y-1">
              <span className="text-slate-400">Approver ID</span>
              <input
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 font-mono text-slate-100"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-slate-400">Scope (must match the gate exactly)</span>
              <input
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 font-mono text-slate-100"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setApprovalOpen(false)}
                className={`${buttonBase} border-slate-700 text-slate-300 hover:bg-slate-800`}
              >
                Close
              </button>
              <button
                disabled={busy || !approver.trim() || !scope.trim()}
                onClick={async () => {
                  await onCommand('approve', {
                    approver: approver.trim(),
                    scope: scope.trim(),
                    gate_id: gate.gate_id,
                  });
                  setApprovalOpen(false);
                }}
                className={`${buttonBase} bg-purple-600 border-purple-400 text-white hover:bg-purple-500`}
              >
                <CheckCircle2 size={13} /> Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
