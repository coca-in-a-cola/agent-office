import React, { useEffect, useState } from 'react';
import { OfficeState, StudioFocus } from './types';
import { IsometricOffice } from './components/IsometricOffice';
import { EmployeeRoster } from './components/EmployeeRoster';
import { StatusBadge } from './components/StatusBadge';
import { WorkflowAssignmentBadge } from './components/WorkflowAssignmentBadge';
import { ProcessStudio } from './components/process_studio/ProcessStudio';
import { WorkstationMonitor } from './components/WorkstationMonitor';
import {
  Building2,
  Activity,
  CheckCircle2,
  Cpu,
  Layers,
  X,
  GitBranch,
  Building,
} from 'lucide-react';

type View = 'studio' | 'tycoon';

const FALLBACK_STATE: OfficeState = {
  status: 'ok',
  timestamp: Date.now() / 1000,
  agents: [
    {
      id: 'tyler',
      profile_name: 'Tyler',
      role: 'Managing Director',
      status: 'idle',
      current_model: 'anthropic/claude-3-7-sonnet',
      capabilities: ['leadership', 'planning', 'coordination', 'strategy'],
      metadata: { desk: 'executive', position: [0, 0] },
    },
    {
      id: 'artist',
      profile_name: 'Artist',
      role: 'Artist',
      status: 'idle',
      current_model: 'tripo/hunyuan3d-2.0',
      capabilities: ['3d_modeling', 'textures', 'concept_art', 'rigging'],
      metadata: { desk: 'creative', position: [1, 0] },
    },
    {
      id: 'coder',
      profile_name: 'Coder',
      role: 'Game Developer (Godot)',
      status: 'idle',
      current_model: 'anthropic/claude-3-5-sonnet',
      capabilities: ['godot4', 'gdscript', 'c_sharp', 'shaders', 'physics', 'rendering'],
      metadata: { desk: 'engineering', position: [0, 1] },
    },
    {
      id: 'webdev',
      profile_name: 'WebDev',
      role: 'Web Engineer',
      status: 'idle',
      current_model: 'anthropic/claude-3-5-sonnet',
      capabilities: ['react', 'typescript', 'tailwind', 'vite', 'web_apis', 'browser_testing', 'performance'],
      metadata: { desk: 'frontend', position: [2, 0], avatar: 'webdev' },
    },
    {
      id: 'devops',
      profile_name: 'DevOps',
      role: 'DevOps',
      status: 'idle',
      current_model: 'anthropic/claude-3-5-haiku',
      capabilities: ['infrastructure', 'docker', 'ci_cd', 'observability'],
      metadata: { desk: 'operations', position: [1, 1] },
    },
    {
      id: 'qa',
      profile_name: 'QA',
      role: 'QA',
      status: 'idle',
      current_model: 'anthropic/claude-3-5-sonnet',
      capabilities: ['testing', 'regression', 'verification', 'security'],
      metadata: { desk: 'quality', position: [2, 1] },
    },
  ],
  tasks: [],
  recent_activities: [],
  meta: {
    is_fallback: true,
    db_path: 'office.sqlite3',
    total_agents: 6,
    total_tasks: 0,
    total_activities: 0,
  },
};

export const App: React.FC = () => {
  const [state, setState] = useState<OfficeState>(FALLBACK_STATE);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('coder');
  const [isLive, setIsLive] = useState<boolean>(true);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'office' | 'activities'>('office');
  const [view, setView] = useState<View>(
    window.location.hash === '#tycoon' ? 'tycoon' : 'studio'
  );

  const [studioFocus, setStudioFocus] = useState<StudioFocus | null>(null);
  const [authUser, setAuthUser] = useState<{ id: string; role: string; name?: string } | null>(null);

  const switchView = (next: View) => {
    setView(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  // Tycoon View -> Process Studio: open the run and highlight the node.
  const openInStudio = (runId: string, node: string | null, source?: string) => {
    setStudioFocus({ runId, node, source, nonce: Date.now() });
    setIsInspectorOpen(false);
    switchView('studio');
  };

  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OfficeState = await res.json();
      setState(data);
      setIsLive(true);
      setLastSync(new Date());
    } catch {
      setIsLive(false);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const tg = (window as any).Telegram?.WebApp;
        if (tg) {
          tg.ready();
          tg.expand();
          if (tg.initData) {
            const res = await fetch('/api/auth/telegram', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ initData: tg.initData }),
            });
            if (res.ok) {
              const data = await res.json();
              setAuthUser(data.user);
              return;
            }
          }
        }
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          setAuthUser(meData.user);
        }
      } catch (err) {
        console.warn('Auth initialization:', err);
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 2500);
    return () => clearInterval(interval);
  }, []);

  const selectedAgent = state.agents.find(
    (a) => a.id.toLowerCase() === (selectedAgentId || '').toLowerCase()
  ) || state.agents[0];

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setIsInspectorOpen(true);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#080c14] text-slate-100 overflow-hidden font-sans">
      {/* Top Experience Plane Navigation Bar */}
      <header className="h-14 border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-500/60 flex items-center justify-center text-cyan-400 shadow-md">
            <Building2 size={18} />
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              Agent Office
              <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800/60 uppercase">
                AO-03 Plane
              </span>
            </h1>
            <p className="text-[10px] text-slate-400 font-medium">
              {view === 'studio'
                ? 'Process Studio — workflow graph & visual debugger'
                : 'Tycoon View — isometric office & employee roster'}
            </p>
          </div>
        </div>

        {/* Primary navigation: Process Studio / Tycoon View */}
        <div className="flex items-center gap-2">
          {authUser && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-300 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-[11px] text-cyan-300">{authUser.name || authUser.id}</span>
              <span className="text-[10px] text-slate-500 uppercase">({authUser.role})</span>
            </div>
          )}
          <nav className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs" aria-label="Views">
          <button
            onClick={() => switchView('studio')}
            aria-current={view === 'studio' ? 'page' : undefined}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition ${
              view === 'studio'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitBranch size={13} />
            Process Studio
          </button>
          <button
            onClick={() => switchView('tycoon')}
            aria-current={view === 'tycoon' ? 'page' : undefined}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition ${
              view === 'tycoon'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building size={13} />
            Tycoon View
          </button>
        </nav>
        </div>

        {/* Tycoon sub-tabs */}
        <div className={`items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs ${view === 'tycoon' ? 'flex' : 'hidden'}`}>
          <button
            onClick={() => setActiveTab('office')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition ${
              activeTab === 'office'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers size={13} />
            Isometric Office
          </button>
          <button
            onClick={() => setActiveTab('activities')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition ${
              activeTab === 'activities'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity size={13} />
            Activity Log ({state.recent_activities.length})
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 text-xs">
          <div className="hidden md:flex items-center gap-2 text-slate-400 font-mono text-[11px]">
            <span className="text-slate-500">Sync:</span>
            <span>{lastSync.toLocaleTimeString()}</span>
          </div>

          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${
              isLive
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                : 'bg-amber-950/80 border-amber-500/50 text-amber-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span>{isLive ? 'Live API' : 'Fallback State'}</span>
          </div>
        </div>
      </header>

      {view === 'studio' && (
        <ProcessStudio focus={studioFocus} onDismissFocus={() => setStudioFocus(null)} />
      )}

      {/* Main Experience Viewport (Tycoon View) */}
      {view === 'tycoon' && (
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left / Center View: Isometric Canvas OR Activity Log */}
        <main className="flex-1 relative flex flex-col overflow-hidden bg-radial-gradient">
          {activeTab === 'office' ? (
            <IsometricOffice
              agents={state.agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={handleSelectAgent}
              onOpenWorkflow={openInStudio}
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
              <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                <Activity size={20} className="text-cyan-400" />
                Global Office Telemetry & Activity Feed
              </h2>
              {state.recent_activities.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-sm">
                  No activity events recorded yet. Ingest events via hooks to populate feed.
                </div>
              ) : (
                <div className="space-y-3">
                  {state.recent_activities.map((act) => (
                    <div
                      key={act.id}
                      className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 text-xs flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-cyan-300 font-semibold">
                          {act.agent_id || 'System'} • {act.tool_name || act.event_type}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(act.timestamp * 1000).toLocaleTimeString()}
                        </span>
                      </div>
                      {act.tool_input_preview && (
                        <p className="font-mono text-[11px] text-slate-400 bg-slate-950/60 p-1.5 rounded">
                          Input: {act.tool_input_preview}
                        </p>
                      )}
                      {act.tool_output_preview && (
                        <p className="font-mono text-[11px] text-emerald-400/90 bg-slate-950/60 p-1.5 rounded">
                          Output: {act.tool_output_preview}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Right Sidebar: Employee Roster */}
        <EmployeeRoster
          agents={state.agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={handleSelectAgent}
          onOpenWorkflow={openInStudio}
        />
      </div>
      )}

      {/* Agent Details Modal / Inspector Drawer */}
      {view === 'tycoon' && isInspectorOpen && selectedAgent && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-slate-900/95 backdrop-blur-xl border-l border-slate-700 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
          {/* Drawer Header */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-500/60 flex items-center justify-center text-cyan-300 font-bold text-lg">
                {selectedAgent.profile_name[0]}
              </div>
              <div>
                <h3 className="font-bold text-slate-100 text-base">
                  {selectedAgent.profile_name}
                </h3>
                <p className="text-xs text-slate-400">{selectedAgent.role}</p>
              </div>
            </div>
            <button
              onClick={() => setIsInspectorOpen(false)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              <X size={18} />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
            {/* Status Section */}
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Current Status
              </span>
              <StatusBadge status={selectedAgent.status} size="lg" />
            </div>

            {/* Workflow assignment projected from Workflow Core */}
            {selectedAgent.workflow_assignments && selectedAgent.workflow_assignments.length > 0 && (
              <div className="bg-slate-950/80 border border-cyan-900/60 rounded-xl p-3.5 space-y-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <GitBranch size={13} className="text-cyan-400" />
                  Workflow Assignments
                </span>
                {selectedAgent.workflow_assignments.map((wa) => (
                  <div key={`${wa.run_id}/${wa.assignment}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-200 truncate">{wa.current_task}</span>
                      <WorkflowAssignmentBadge
                        assignment={wa}
                        onOpen={(runId, node) => openInStudio(runId, node, selectedAgent.profile_name)}
                      />
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {wa.run_status} · {wa.attempt_id ?? wa.gate_id ?? 'no attempt yet'}
                      {wa.task_id ? ` · bridge ${wa.task_id}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Model & Runtime Section */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu size={13} className="text-cyan-400" />
                Model & Provider
              </span>
              <div className="font-mono text-cyan-300 bg-slate-900 p-2 rounded border border-slate-800 text-[11px]">
                {selectedAgent.current_model || 'anthropic/claude-3-5-sonnet'}
              </div>
            </div>

            {/* Active Task Snapshot Section */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-400" />
                Active Task Snapshot
              </span>
              {selectedAgent.active_task ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-cyan-400 font-semibold">
                      {selectedAgent.active_task.kanban_task_id}
                    </span>
                    <span className="font-mono bg-slate-900 text-slate-300 px-2 py-0.5 rounded text-[10px]">
                      {selectedAgent.active_task.status}
                    </span>
                  </div>
                  <p className="font-medium text-slate-200">
                    {selectedAgent.active_task.title}
                  </p>
                  {selectedAgent.active_task.priority && (
                    <div className="text-[11px] text-slate-400">
                      Priority: <span className="text-slate-200 capitalize">{selectedAgent.active_task.priority}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-500 italic">No active task assigned.</p>
              )}
            </div>

            {/* Capabilities Pill List */}
            {selectedAgent.capabilities && selectedAgent.capabilities.length > 0 && (
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Skill Capabilities
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAgent.capabilities.map((cap, i) => (
                    <span
                      key={i}
                      className="bg-slate-800/80 text-cyan-300 border border-slate-700 px-2 py-1 rounded text-[11px] font-mono"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Workstation Monitor: live terminal of the agent's Bridge task */}
            <WorkstationMonitor agent={selectedAgent} />
          </div>
        </div>
      )}
    </div>
  );
};
