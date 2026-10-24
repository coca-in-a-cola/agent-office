import React, { useCallback, useEffect, useState } from 'react';
import { OfficeState, StudioFocus } from './types';
import { IsometricOffice } from './components/IsometricOffice';
import { EmployeeRoster } from './components/EmployeeRoster';
import { AgentInspector } from './components/AgentInspector';
import { ProcessStudio } from './components/process_studio/ProcessStudio';
import { Building2, Activity, GitBranch, Building, Users, Zap } from 'lucide-react';

type View = 'studio' | 'tycoon';
type OfficeTab = 'office' | 'roster' | 'activities';

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
      capabilities: ['react', 'typescript', 'scss', 'vite', 'web_apis', 'browser_testing', 'performance'],
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

const PixiOfficeCanvas = React.lazy<React.ComponentType<{
  agents?: OfficeState['agents'];
  onSelectAgent?: (agentId: string) => void;
  onOpenWorkflow?: (runId: string, node: string | null, source?: string) => void;
  onClosePreview?: () => void;
}>>(() =>
  import('./components/canvas/PixiOfficeCanvas').then((m) => ({ default: m.PixiOfficeCanvas as any }))
);

const MainOfficeApp: React.FC = () => {
  const [state, setState] = useState<OfficeState>(FALLBACK_STATE);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('coder');
  const [isLive, setIsLive] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<OfficeTab>('office');
  const initialView: View = (typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('studio') === 'true' || window.location.hash === '#studio')) ? 'studio' : 'tycoon';
  const [view, setView] = useState<View>(initialView);
  const isLegacySvg = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('legacy') === 'true';

  const [studioFocus, setStudioFocus] = useState<StudioFocus | null>(null);
  const [authUser, setAuthUser] = useState<{ id: string; role: string; name?: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginSecret, setLoginSecret] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState('');

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginPending(true);
    setLoginError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginSecret, token: loginSecret }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Invalid password or access token.' : `Login failed (HTTP ${response.status}).`);
      const data = await response.json();
      setLoginSecret('');
      setAuthUser(data.user);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setLoginPending(false);
    }
  };

  const switchView = (next: View) => {
    setIsInspectorOpen(false);
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
      if (res.status === 401) setAuthUser(null);
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
      } finally {
        setAuthReady(true);
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    fetchState();
    const interval = setInterval(fetchState, 2500);
    return () => clearInterval(interval);
  }, [authUser]);

  const selectedAgent = state.agents.find(
    (a) => a.id.toLowerCase() === (selectedAgentId || '').toLowerCase()
  ) || state.agents[0];

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setIsInspectorOpen(true);
  };

  const closeInspector = useCallback(() => setIsInspectorOpen(false), []);
  const selectOfficeTab = (tab: OfficeTab) => {
    setActiveTab(tab);
    switchView('tycoon');
  };

  if (!authUser) return (
    <main className="office-app" style={{ padding: '2rem', minHeight: '100vh', justifyContent: 'center', alignItems: 'center' }}>
      <form onSubmit={login} style={{ width: 'min(100%, 380px)', display: 'grid', gap: '1rem' }}>
        <h1>Agent Office</h1>
        <p>{authReady ? 'Login required. Open from Telegram or sign in with your Office password or access token.' : 'Checking your session…'}</p>
        <label htmlFor="office-login">Password or access token</label>
        <input id="office-login" name="password" type="password" autoComplete="current-password" required value={loginSecret} onChange={(event) => setLoginSecret(event.target.value)} style={{ padding: '0.8rem' }} />
        <button type="submit" disabled={!authReady || loginPending} style={{ padding: '0.8rem' }}>{loginPending ? 'Signing in…' : 'Sign in'}</button>
        {loginError && <p role="alert">{loginError}</p>}
      </form>
    </main>
  );

  return (
    <div className="office-app">
      <header className="office-header">
        <div className="office-brand"><span className="brand-mark"><Building2 size={20} /></span>
          <div><h1>Agent Office <span className="plane-badge">AO-03</span></h1>
            <p className="brand-caption">{view === 'studio' ? 'Workflow graph & visual debugger' : 'Your autonomous team, at work'}</p></div>
        </div>
        <nav className="desktop-navigation" aria-label="Views">
          <button onClick={() => switchView('tycoon')} aria-current={view === 'tycoon' ? 'page' : undefined}><Building size={15} />Office</button>
          <button onClick={() => switchView('studio')} aria-current={view === 'studio' ? 'page' : undefined}><GitBranch size={15} />Process Studio</button>
        </nav>
        {view === 'tycoon' && <nav className="desktop-navigation office-subtabs" aria-label="Office views">
          <button onClick={() => selectOfficeTab('office')} aria-current={activeTab !== 'activities' ? 'page' : undefined}>Workstations</button>
          <button onClick={() => selectOfficeTab('activities')} aria-current={activeTab === 'activities' ? 'page' : undefined}><Activity size={14} />Activity</button>
        </nav>}
        <div className="header-status">
          <div className="user-badge"><span>{authUser?.name || authUser?.id || 'Guest'}</span><small>{authUser?.role || 'Viewer'}</small></div>
          <time className="sync-time">Sync: {lastSync.toLocaleTimeString()}</time>
          <span className={`connection-status ${isLive ? 'is-live' : 'is-offline'}`} role="status"><i /><span>{isLive ? 'Live API' : 'Offline'}</span></span>
        </div>
      </header>

      {view === 'studio' && <div className="studio-viewport"><ProcessStudio focus={studioFocus} onDismissFocus={() => setStudioFocus(null)} /></div>}
      {view === 'tycoon' && <div className={`office-workspace office-workspace--${activeTab}`}>
        <main className="office-main">
          {activeTab !== 'activities' ? (
            isLegacySvg ? (
              <IsometricOffice
                agents={state.agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={handleSelectAgent}
                onOpenWorkflow={openInStudio}
              />
            ) : (
              <React.Suspense
                fallback={
                  <div className="pixi-loading-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0b0f19', color: '#94a3b8', fontFamily: 'monospace' }}>
                    Loading Tycoon Canvas...
                  </div>
                }
              >
                <PixiOfficeCanvas
                  agents={state.agents}
                  onSelectAgent={handleSelectAgent}
                  onOpenWorkflow={openInStudio}
                />
              </React.Suspense>
            )
          ) : (
            <section className="activity-feed"><h2><Activity size={20} />Office activity</h2>
              {state.recent_activities.length === 0 ? <div className="empty-state">No activity events recorded yet. Ingest events via hooks to populate feed.</div> : (
                <div className="activity-list">{state.recent_activities.map((activity) => (
                  <article className="activity-card" key={activity.id}>
                    <header><strong>{activity.agent_id || 'System'} · {activity.tool_name || activity.event_type}</strong><time>{new Date(activity.timestamp * 1000).toLocaleTimeString()}</time></header>
                    {activity.tool_input_preview && <p>Input: {activity.tool_input_preview}</p>}
                    {activity.tool_output_preview && <p className="activity-output">Output: {activity.tool_output_preview}</p>}
                  </article>
                ))}</div>
              )}
            </section>
          )}
        </main>
        <div className="office-roster"><EmployeeRoster agents={state.agents} selectedAgentId={selectedAgentId} onSelectAgent={handleSelectAgent} onOpenWorkflow={openInStudio} /></div>
      </div>}

      <nav className="mobile-navigation" aria-label="Mobile views">
        <button onClick={() => selectOfficeTab('office')} aria-current={view === 'tycoon' && activeTab === 'office' ? 'page' : undefined}><Building2 size={21} /><span>Office</span></button>
        <button onClick={() => selectOfficeTab('roster')} aria-current={view === 'tycoon' && activeTab === 'roster' ? 'page' : undefined}><Users size={21} /><span>Roster</span></button>
        <button onClick={() => switchView('studio')} aria-current={view === 'studio' ? 'page' : undefined}><Zap size={21} /><span>Studio</span></button>
        <button onClick={() => selectOfficeTab('activities')} aria-current={view === 'tycoon' && activeTab === 'activities' ? 'page' : undefined}><Activity size={21} /><span>Activity</span></button>
      </nav>
      {view === 'tycoon' && isInspectorOpen && selectedAgent && <AgentInspector agent={selectedAgent} onClose={closeInspector} onOpenWorkflow={openInStudio} />}
    </div>
  );
};

export const App: React.FC = () => {
  return <MainOfficeApp />;
};
