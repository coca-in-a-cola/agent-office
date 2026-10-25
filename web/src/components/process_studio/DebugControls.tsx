import React, { useState } from 'react';
import { CheckCircle2, Pause, Play, RotateCcw, ShieldCheck, Square, X } from 'lucide-react';
import { RunCommand } from '../../workflowApi';
import { RunDetail } from '../../workflowTypes';
import '../../styles/components/debug-controls.scss';

interface DebugControlsProps {
  detail: RunDetail;
  busy: boolean;
  /** Current node performs an external side effect (retry needs confirmation). */
  sideEffecting: boolean;
  onCommand: (command: RunCommand, body?: Record<string, unknown>) => Promise<void>;
}

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
    <div className="ps-debug-controls">
      <button
        type="button"
        className="ps-debug-btn ps-debug-btn--pause"
        disabled={busy || !actions.pause}
        onClick={() => void onCommand('pause', { reason: 'paused from Process Studio' })}
        title="Stop coordinator advancement of this run"
      >
        <Pause size={13} /> Pause
      </button>
      <button
        type="button"
        className="ps-debug-btn ps-debug-btn--resume"
        disabled={busy || !actions.resume}
        onClick={() => void onCommand('resume')}
      >
        <Play size={13} /> Resume
      </button>
      <button
        type="button"
        className="ps-debug-btn ps-debug-btn--cancel"
        disabled={busy || !actions.cancel}
        onClick={confirmCancel}
      >
        <Square size={13} /> Cancel
      </button>
      <button
        type="button"
        className="ps-debug-btn ps-debug-btn--retry"
        disabled={busy || !actions.retry}
        onClick={retry}
        title="Authorized bounded retry of the failed / timed-out node"
      >
        <RotateCcw size={13} /> Retry
      </button>
      <button
        type="button"
        className="ps-debug-btn ps-debug-btn--approve"
        disabled={busy || !actions.approve}
        onClick={openApproval}
      >
        <ShieldCheck size={13} /> Approve
      </button>

      {approvalOpen && gate && (
        <div className="ps-approval-modal__backdrop">
          <div className="ps-approval-modal__card">
            <div className="ps-approval-modal__header">
              <h3 className="ps-approval-modal__title">
                <ShieldCheck size={16} /> Approve gate
              </h3>
              <button
                type="button"
                onClick={() => setApprovalOpen(false)}
                className="ps-approval-modal__dismiss"
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>
            <dl className="ps-approval-modal__details">
              <dt className="ps-approval-modal__term">Gate</dt>
              <dd className="ps-approval-modal__desc">{gate.gate_id}</dd>
              <dt className="ps-approval-modal__term">Node</dt>
              <dd className="ps-approval-modal__desc">{gate.node} (iteration {gate.iteration})</dd>
              <dt className="ps-approval-modal__term">Evidence</dt>
              <dd className="ps-approval-modal__desc">{gate.evidence_digest || '—'}</dd>
            </dl>
            <label className="ps-approval-modal__field">
              <span className="ps-approval-modal__field-label">Approver ID</span>
              <input
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                className="ps-approval-modal__input"
              />
            </label>
            <label className="ps-approval-modal__field">
              <span className="ps-approval-modal__field-label">Scope (must match the gate exactly)</span>
              <input
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="ps-approval-modal__input"
              />
            </label>
            <div className="ps-approval-modal__actions">
              <button
                type="button"
                onClick={() => setApprovalOpen(false)}
                className="ps-debug-btn ps-debug-btn--modal-close"
              >
                Close
              </button>
              <button
                type="button"
                disabled={busy || !approver.trim() || !scope.trim()}
                onClick={async () => {
                  await onCommand('approve', {
                    approver: approver.trim(),
                    scope: scope.trim(),
                    gate_id: gate.gate_id,
                  });
                  setApprovalOpen(false);
                }}
                className="ps-debug-btn ps-debug-btn--modal-submit"
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
