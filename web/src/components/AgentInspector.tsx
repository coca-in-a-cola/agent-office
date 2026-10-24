import { useState, useEffect, useRef } from 'react';
import { X, Palette } from 'lucide-react';
import { Agent } from '../types';
import { StatusBadge } from './StatusBadge';
import { WorkflowAssignmentBadge } from './WorkflowAssignmentBadge';
import { WorkstationMonitor } from './WorkstationMonitor';
import { EmployeeModelPolicyEditor } from './EmployeeModelPolicyEditor';
import { SkinCustomizerModal, getAgentSkin } from './character';

interface Props {
  agent: Agent;
  onClose: () => void;
  onOpenWorkflow: (runId: string, node: string | null, source?: string) => void;
}

export function AgentInspector({ agent, onClose, onOpenWorkflow }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const [showSkinCustomizer, setShowSkinCustomizer] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]'
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);

  return (
    <div className="inspector-layer">
      <button className="inspector-backdrop" aria-label="Close agent details" onClick={onClose} tabIndex={-1} />
      <div ref={dialog} className="agent-inspector" role="dialog" aria-modal="true" aria-labelledby="inspector-title" tabIndex={-1}>
        <div className="inspector-grip" aria-hidden="true"
          onPointerDown={(event) => { dragStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerUp={(event) => {
            if (dragStart.current !== null && event.clientY - dragStart.current > 65) onClose();
            dragStart.current = null;
          }} onPointerCancel={() => { dragStart.current = null; }}><span /></div>
        <header className="inspector-header">
          <div className="inspector-avatar">{agent.profile_name[0]}</div>
          <div className="inspector-identity"><h2 id="inspector-title">{agent.profile_name}</h2><p>{agent.role}</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={20} /></button>
        </header>
        <div className="inspector-body">
          <section><h3>Current status</h3><StatusBadge status={agent.status} size="lg" /></section>
          {!!agent.workflow_assignments?.length && (
            <section className="inspector-card"><h3>Workflow assignments</h3>
              {agent.workflow_assignments.map((assignment) => (
                <div className="inspector-assignment" key={`${assignment.run_id}/${assignment.assignment}`}>
                  <p>{assignment.current_task}</p>
                  <WorkflowAssignmentBadge assignment={assignment} onOpen={(runId, node) => onOpenWorkflow(runId, node, agent.profile_name)} />
                  <small>{assignment.run_status} · {assignment.attempt_id ?? assignment.gate_id ?? 'no attempt yet'}{assignment.task_id ? ` · bridge ${assignment.task_id}` : ''}</small>
                </div>
              ))}
            </section>
          )}
          <EmployeeModelPolicyEditor agent={agent} />
          <section className="inspector-card"><h3>Active task snapshot</h3>
            {agent.active_task ? <>
              <code>{agent.active_task.kanban_task_id} · {agent.active_task.status}</code>
              <p>{agent.active_task.title}</p>
              {agent.active_task.priority && <small>Priority: {agent.active_task.priority}</small>}
            </> : <p className="muted">No active task assigned.</p>}
          </section>
          {!!agent.capabilities?.length && <section><h3>Skill capabilities</h3><div className="capability-list">
            {agent.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
          </div></section>}
          <section className="inspector-card">
            <button
              type="button"
              onClick={() => setShowSkinCustomizer(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-mono font-medium transition cursor-pointer"
            >
              <Palette size={14} />
              <span>Customize Character Skin & Limbs</span>
            </button>
          </section>
          <WorkstationMonitor agent={agent} />
          <SkinCustomizerModal
            agentId={agent.id}
            currentSkin={getAgentSkin(agent.id, agent.role)}
            isOpen={showSkinCustomizer}
            onClose={() => setShowSkinCustomizer(false)}
            onSave={(id, updatedSkin) => {
              try {
                const stored = JSON.parse(localStorage.getItem('agent_office_custom_skins') || '{}');
                stored[id] = updatedSkin;
                localStorage.setItem('agent_office_custom_skins', JSON.stringify(stored));
                window.dispatchEvent(new Event('skins-updated'));
              } catch (err) {
                console.error('Failed to save custom skin', err);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
