import React, { useState, useMemo, useEffect } from 'react';
import { Agent } from '../types';
import { StatusBadge } from './StatusBadge';
import { deskStatusColor } from './WorkflowAssignmentBadge';
import { ModularCharacter } from './character/ModularCharacter';
import { getAgentSkin } from './character/characterSkins';
import {
  generateDefaultCampus,
  assignDefaultRoomForAgent,
  CampusGrid,
  getIsometricPolygonPoints,
  gridToIso,
  findPath,
  pathToSvgD,
} from '../grid';
import { OfficeProp } from './office/props/OfficeProps';
import { RenderIsometricTile } from './office/tiles/IsometricTiles';
import { Hammer, Plus, Square, DoorOpen, Paintbrush } from 'lucide-react';
import { usePanZoom } from '../hooks/usePanZoom';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Monitor,
  Terminal,
  Palette,
  ShieldCheck,
  Crown,
  Globe,
  ExternalLink,
  GitBranch,
  User,
  X,
  Zap,
  Navigation,
  Layers,
} from 'lucide-react';

interface IsometricOfficeProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  /** Jump to a workflow run/node in Process Studio. */
  onOpenWorkflow?: (runId: string, node: string, source?: string) => void;
}

const POPOVER_W = 260;
const POPOVER_H = 190;

export interface SuiteDefinition {
  id: string;
  name: string;
  suiteCode: string;
  suiteTitle: string;
  role: string;
  gridX: number;
  gridY: number;
  center: { x: number; y: number };
  deskPos: { x: number; y: number };
  rx: number;
  ry: number;
  wallHeight: number;
  icon: React.ElementType;
  accentColor: string;
  deskType: 'executive' | 'code' | 'art' | 'ops' | 'qa' | 'web';
  floorTheme: 'mahogany' | 'dev-grid' | 'creative-bay' | 'server-noc' | 'qa-cleanroom' | 'staging-deck';
}

// 6 Dedicated Suites arranged in a high-tech corporate campus compound
export const WORKSTATION_CONFIG: Record<string, SuiteDefinition> = {
  tyler: {
    id: 'tyler',
    name: 'Tyler',
    suiteCode: 'STE-01',
    suiteTitle: 'Executive Suite',
    role: 'Managing Director',
    gridX: -2.0,
    gridY: -2.0,
    center: { x: 0, y: -175 },
    deskPos: { x: 0, y: -170 },
    rx: 110,
    ry: 55,
    wallHeight: 52,
    icon: Crown,
    accentColor: '#f59e0b',
    deskType: 'executive',
    floorTheme: 'mahogany',
  },
  coder: {
    id: 'coder',
    name: 'Coder',
    suiteCode: 'STE-02',
    suiteTitle: 'Dev Den',
    role: 'Godot Dev',
    gridX: -2.5,
    gridY: 0.5,
    center: { x: -270, y: -85 },
    deskPos: { x: -270, y: -80 },
    rx: 100,
    ry: 50,
    wallHeight: 50,
    icon: Terminal,
    accentColor: '#10b981',
    deskType: 'code',
    floorTheme: 'dev-grid',
  },
  artist: {
    id: 'artist',
    name: 'Artist',
    suiteCode: 'STE-03',
    suiteTitle: 'Creative Bay',
    role: 'Lead Artist',
    gridX: 0.5,
    gridY: -2.5,
    center: { x: 270, y: -85 },
    deskPos: { x: 270, y: -80 },
    rx: 100,
    ry: 50,
    wallHeight: 50,
    icon: Palette,
    accentColor: '#ec4899',
    deskType: 'art',
    floorTheme: 'creative-bay',
  },
  devops: {
    id: 'devops',
    name: 'DevOps',
    suiteCode: 'STE-04',
    suiteTitle: 'Server NOC & Vault',
    role: 'Site Reliability',
    gridX: -0.5,
    gridY: 2.5,
    center: { x: -270, y: 95 },
    deskPos: { x: -270, y: 100 },
    rx: 100,
    ry: 50,
    wallHeight: 50,
    icon: Monitor,
    accentColor: '#3b82f6',
    deskType: 'ops',
    floorTheme: 'server-noc',
  },
  qa: {
    id: 'qa',
    name: 'QA',
    suiteCode: 'STE-05',
    suiteTitle: 'Testing Lab',
    role: 'QA Engineer',
    gridX: 2.5,
    gridY: -0.5,
    center: { x: 270, y: 95 },
    deskPos: { x: 270, y: 100 },
    rx: 100,
    ry: 50,
    wallHeight: 50,
    icon: ShieldCheck,
    accentColor: '#06b6d4',
    deskType: 'qa',
    floorTheme: 'qa-cleanroom',
  },
  webdev: {
    id: 'webdev',
    name: 'WebDev',
    suiteCode: 'STE-06',
    suiteTitle: 'Staging Deck',
    role: 'Web Engineer',
    gridX: 2.0,
    gridY: 2.0,
    center: { x: 0, y: 185 },
    deskPos: { x: 0, y: 190 },
    rx: 110,
    ry: 55,
    wallHeight: 52,
    icon: Globe,
    accentColor: '#0ea5e9',
    deskType: 'web',
    floorTheme: 'staging-deck',
  },
};

export const IsometricOffice: React.FC<IsometricOfficeProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onOpenWorkflow,
}) => {
  const { zoom, pan, setZoom, reset, containerRef, isPanning } = usePanZoom<HTMLDivElement>({ minZoom: 0.35, maxZoom: 3.0, initialZoom: 1.0 });
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [popoverId, setPopoverId] = useState<string | null>(null);
  const [activePipelineOverride, setActivePipelineOverride] = useState<string | null>(null);
  const [animationTick, setAnimationTick] = useState<number>(0);
  const [campusGrid, setCampusGrid] = useState<CampusGrid>(() => generateDefaultCampus());
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [hoveredTileKey, setHoveredTileKey] = useState<string | null>(null);
  const [buildMode, setBuildMode] = useState<boolean>(false);
  const [buildTool, setBuildTool] = useState<'floor' | 'wall_n' | 'wall_w' | 'door' | 'corridor' | 'cooler' | 'server' | 'coffee' | 'whiteboard' | 'plant' | 'sofa' | 'eraser' | 'new_suite'>('floor');
  const [customSkins, setCustomSkins] = useState<Record<string, any>>(() => {
    try {
      return JSON.parse(localStorage.getItem('agent_office_custom_skins') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const handleSkinsUpdate = () => {
      try {
        setCustomSkins(JSON.parse(localStorage.getItem('agent_office_custom_skins') || '{}'));
      } catch {
        // Ignore malformed localStorage JSON — stale skins simply keep their previous value
      }
    };
    window.addEventListener('skins-updated', handleSkinsUpdate);
    return () => window.removeEventListener('skins-updated', handleSkinsUpdate);
  }, []);

  useEffect(() => {
    fetch('/api/office/grid')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.status === 'ok' && d.grid && d.grid.tiles && Object.keys(d.grid.tiles).length > 0) {
          setCampusGrid(d.grid);
        }
      })
      .catch((err) => console.error('Failed to load campus grid from server', err));
  }, []);

  const handleSaveCampus = async () => {
    setSaveStatus('Saving...');
    try {
      const res = await fetch('/api/office/grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grid: campusGrid }),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        setSaveStatus('Saved!');
        setTimeout(() => setSaveStatus(null), 2500);
      } else {
        setSaveStatus('Error');
        setTimeout(() => setSaveStatus(null), 2500);
      }
    } catch (err) {
      setSaveStatus('Error');
      setTimeout(() => setSaveStatus(null), 2500);
    }
  };

  const handleTileClick = (x: number, y: number) => {
    if (!buildMode) return;
    const key = `${x},${y}`;
    setCampusGrid((prev) => {
      const newTiles = { ...prev.tiles };
      const existing = newTiles[key] || { x, y, type: 'empty' };
      if (buildTool === 'eraser') {
        delete existing.propId;
        newTiles[key] = { ...existing, type: 'empty' };
        return { ...prev, tiles: newTiles };
      }
      if (buildTool === 'cooler' || buildTool === 'server' || buildTool === 'coffee' || buildTool === 'whiteboard' || buildTool === 'plant' || buildTool === 'sofa') {
        newTiles[key] = { ...existing, type: existing.type === 'empty' ? 'floor' : existing.type, propId: buildTool };
        return { ...prev, tiles: newTiles };
      }
      let newType: any = buildTool;
      if (buildTool === 'door') newType = 'door_n';
      if (buildTool === 'new_suite') {
        return assignDefaultRoomForAgent(prev, `hire-${Date.now()}`, 'engineer', 'Custom Studio');
      }
      newTiles[key] = { ...existing, type: newType };
      return { ...prev, tiles: newTiles };
    });
  };

  // Periodic heartbeat for blinking lights & ambient runner transitions
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimationTick((t) => (t + 1) % 1000);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const getAgentData = (key: string): Agent => {
    const found = agents.find((a) => a.id.toLowerCase() === key.toLowerCase());
    if (found) return found;
    return {
      id: key,
      profile_name: WORKSTATION_CONFIG[key]?.name || key,
      role: WORKSTATION_CONFIG[key]?.role || 'Agent',
      status: 'idle',
      current_model: 'unknown',
    };
  };


  // Active workflow desks open a quick preview; others open the agent inspector.
  const handleDeskClick = (id: string) => {
    if (getAgentData(id).workflow_assignment) {
      setPopoverId((current) => (current === id ? null : id));
      return;
    }
    setPopoverId(null);
    onSelectAgent(id);
  };

  const popoverAgent = popoverId ? getAgentData(popoverId) : null;
  const popoverAssignment = popoverAgent?.workflow_assignment ?? null;
  const popoverPos = popoverId && WORKSTATION_CONFIG[popoverId]
    ? WORKSTATION_CONFIG[popoverId].deskPos
    : null;

  // Detect active task courier transition based on real workflow states
  const activeCourierInfo = useMemo(() => {
    if (activePipelineOverride) {
      return activePipelineOverride;
    }

    // Check who is actively working or assigned
    const workingAgents = agents.filter(
      (a) => a.status === 'working' || !!a.workflow_assignment
    );

    if (workingAgents.length > 0) {
      const active = workingAgents[0];
      const id = active.id.toLowerCase();
      if (id === 'coder') return 'coder-to-qa';
      if (id === 'qa') return 'qa-to-devops';
      if (id === 'artist') return 'artist-to-web';
      if (id === 'devops') return 'devops-to-web';
      if (id === 'webdev') return 'web-to-tyler';
      if (id === 'tyler') return 'tyler-to-coder';
    }

    // Default cyclic ambient patrol between departments
    const patrolStages = [
      'tyler-to-coder',
      'coder-to-devops',
      'devops-to-web',
      'web-to-qa',
      'qa-to-artist',
      'artist-to-tyler',
    ];
    return patrolStages[animationTick % patrolStages.length];
  }, [agents, activePipelineOverride, animationTick]);

  // Corridor runner path string for SVG motion
  const courierPathData = useMemo(() => {
    switch (activeCourierInfo) {
      case 'coder-to-qa':
        return 'M -270,-80 L -140,-70 L 0,5 L 140,80 L 270,100';
      case 'qa-to-devops':
        return 'M 270,100 L 140,80 L 0,5 L -140,80 L -270,100';
      case 'artist-to-web':
        return 'M 270,-80 L 140,-70 L 0,5 L 0,165';
      case 'devops-to-web':
        return 'M -270,100 L -140,80 L 0,5 L 0,165';
      case 'web-to-tyler':
        return 'M 0,165 L 0,5 L 0,-150';
      case 'coder-to-devops':
        return 'M -270,-80 L -270,10 L -270,100';
      case 'qa-to-artist':
        return 'M 270,100 L 270,10 L 270,-80';
      case 'artist-to-tyler':
        return 'M 270,-80 L 140,-70 L 0,5 L 0,-150';
      case 'tyler-to-coder':
      default:
        return 'M 0,-150 L 0,5 L -140,-70 L -270,-80';
    }
  }, [activeCourierInfo]);

  const { aStarCourierPath, activeSenderId, isFacingLeft } = useMemo(() => {
    const parts = (activeCourierInfo || 'coder-to-qa').split('-');
    const sId = parts[0] === 'web' ? 'webdev' : parts[0];
    const rId = parts[2] === 'web' ? 'webdev' : parts[2];

    const sRoom = campusGrid.rooms[sId];
    const rRoom = campusGrid.rooms[rId];

    let pathStr = '';
    let facingLeft = false;

    if (sRoom && rRoom) {
      const coords = findPath(campusGrid, sRoom.deskCoord, rRoom.deskCoord);
      if (coords && coords.length > 1) {
        pathStr = pathToSvgD(coords);
        facingLeft = coords[coords.length - 1].x < coords[0].x;
      }
    }
    if (!pathStr) {
      pathStr = courierPathData;
    }
    return {
      aStarCourierPath: pathStr,
      activeSenderId: sId,
      isFacingLeft: facingLeft,
    };
  }, [activeCourierInfo, campusGrid, courierPathData]);

  // Friendly label for the task courier HUD banner
  const courierLabel = useMemo(() => {
    switch (activeCourierInfo) {
      case 'coder-to-qa':
        return 'Coder ➔ QA (Test Build Review)';
      case 'qa-to-devops':
        return 'QA ➔ DevOps (Release Signoff)';
      case 'artist-to-web':
        return 'Artist ➔ WebDev (Vector Assets)';
      case 'devops-to-web':
        return 'DevOps ➔ WebDev (Deploy Staging)';
      case 'web-to-tyler':
        return 'WebDev ➔ Tyler (Sprint Demo)';
      case 'coder-to-devops':
        return 'Coder ➔ DevOps (Container CI)';
      case 'qa-to-artist':
        return 'QA ➔ Artist (Visual Inspection)';
      case 'artist-to-tyler':
        return 'Artist ➔ Tyler (Design System)';
      case 'tyler-to-coder':
      default:
        return 'Tyler ➔ Coder (Task Roadmapping)';
    }
  }, [activeCourierInfo]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-radial-gradient overflow-hidden select-none">
      {/* Top Floating Controls */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3.5 py-1.5 rounded-lg border border-slate-700/60 shadow-xl text-xs text-slate-300">
        <span className="font-semibold text-slate-200 flex items-center gap-1.5">
          <Layers size={13} className="text-cyan-400" />
          Compound:
        </span>
        <span className="text-cyan-300 font-mono text-[11px]">6-Suite Campus</span>
        <span className="text-slate-600">|</span>
        <button
          onClick={() => setZoom((z) => Math.min(Number((z + 0.15).toFixed(2)), 3.0))}
          className="p-1 hover:text-white hover:bg-slate-800 rounded transition"
          title="Zoom In"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(Number((z - 0.15).toFixed(2)), 0.35))}
          className="p-1 hover:text-white hover:bg-slate-800 rounded transition"
          title="Zoom Out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={reset}
          className="p-1 hover:text-white hover:bg-slate-800 rounded transition"
          title="Reset View"
        >
          <RotateCcw size={14} />
        </button>
        <span className="text-slate-400 pl-1 font-mono">{Math.round(zoom * 100)}%</span>

        <span className="text-slate-600 hidden sm:inline">|</span>
        {/* Task Courier Pipeline indicator */}
        <div className="hidden md:flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded border border-cyan-500/30 text-[10.5px]">
          <Zap size={11} className="text-amber-400 animate-pulse" />
          <span className="text-slate-400">Task Courier:</span>
          <span className="text-cyan-300 font-medium font-mono">{courierLabel}</span>
        </div>
      </div>

      {/* Office Floor Legend & Courier Pipeline Shortcuts */}
      <div className="absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-1.5 max-w-[92vw] bg-slate-900/85 backdrop-blur-md px-3 py-2 rounded-lg border border-slate-700/60 shadow-xl text-xs">
        <span className="text-slate-400 font-medium flex items-center gap-1 mr-1">
          <Navigation size={12} className="text-cyan-400" />
          Suites:
        </span>
        {Object.entries(WORKSTATION_CONFIG).map(([id, conf]) => {
          const isSelected = selectedAgentId?.toLowerCase() === id;
          const agent = getAgentData(id);
          const isWorking = agent.status === 'working';
          return (
            <button
              key={id}
              onClick={() => onSelectAgent(id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded transition border text-[11px] ${
                isSelected
                  ? 'bg-slate-800 border-cyan-400 text-white shadow-sm ring-1 ring-cyan-400/40'
                  : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${isWorking ? 'animate-ping' : ''}`}
                style={{ backgroundColor: conf.accentColor }}
              />
              <span className="font-mono text-[9px] text-slate-400">{conf.suiteCode}</span>
              <span className="font-medium">{conf.name}</span>
            </button>
          );
        })}

        {/* Quick Courier Dispatch button */}
        <button
          onClick={() => {
            const pipelines = [
              'coder-to-qa',
              'artist-to-web',
              'devops-to-web',
              'web-to-tyler',
              'tyler-to-coder',
            ];
            const nextIdx = (pipelines.indexOf(activeCourierInfo) + 1) % pipelines.length;
            setActivePipelineOverride(pipelines[nextIdx]);
          }}
          className="ml-2 flex items-center gap-1 px-2 py-1 rounded bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60 text-[10.5px] font-mono transition"
          title="Cycle task runner courier route"
        >
          <Zap size={10} className="text-amber-400" />
          <span>Dispatch Courier</span>
        </button>

        <button
          onClick={() => setBuildMode((b) => !b)}
          className={`ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition ${
            buildMode
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 border border-slate-700'
          }`}
          title="Toggle The Sims Room & Corridor Build Mode"
        >
          <Hammer size={12} className={buildMode ? 'text-amber-400' : 'text-slate-400'} />
          <span>{buildMode ? 'Exit Build Mode' : 'The Sims Build Mode'}</span>
        </button>
      </div>

      {/* The Sims Build Mode Palette Toolbar */}
      {buildMode && (
        <div className="w-full bg-slate-900/90 border-b border-amber-500/30 px-3 py-1.5 flex items-center gap-2 text-xs backdrop-blur-sm z-10 animate-fadeIn">
          <span className="text-amber-400 font-semibold font-mono text-[10.5px] uppercase flex items-center gap-1 mr-1">
            <Hammer size={11} /> Build Tools:
          </span>
          {(['floor', 'wall_n', 'wall_w', 'door', 'corridor'] as const).map((tool) => (
            <button
              key={tool}
              onClick={() => setBuildTool(tool)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition flex items-center gap-1 ${
                buildTool === tool
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              {tool === 'floor' && <Paintbrush size={10} />}
              {(tool === 'wall_n' || tool === 'wall_w') && <Square size={10} />}
              {tool === 'door' && <DoorOpen size={10} />}
              {tool === 'corridor' && <Layers size={10} />}
              <span>{tool.toUpperCase()}</span>
            </button>
          ))}
          {/* Props tools */}
          {(['cooler', 'server', 'coffee', 'whiteboard', 'plant', 'sofa', 'eraser'] as const).map((prop) => (
            <button
              key={prop}
              type="button"
              onClick={() => setBuildTool(prop)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition flex items-center gap-1 cursor-pointer ${
                buildTool === prop
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              {prop === 'cooler' && <span>🚰 Cooler</span>}
              {prop === 'server' && <span>🖥️ Server</span>}
              {prop === 'coffee' && <span>☕ Coffee</span>}
              {prop === 'whiteboard' && <span>📋 Board</span>}
              {prop === 'plant' && <span>🪴 Plant</span>}
              {prop === 'sofa' && <span>🛋️ Sofa</span>}
              {prop === 'eraser' && <span className="text-rose-400">🧹 Eraser</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const targetAgent = agents[0]?.id || 'tyler';
              onSelectAgent(targetAgent);
            }}
            className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950/80 hover:bg-purple-900 text-purple-300 border border-purple-500/50 flex items-center gap-1 transition cursor-pointer"
            title="Open Agent Inspector to customize character skin & limbs"
          >
            <Palette size={10} />
            <span>SKINS</span>
          </button>
          <button
            onClick={() =>
              setCampusGrid((g) =>
                assignDefaultRoomForAgent(g, `agent-${Date.now()}`, 'engineer', 'New Studio')
              )
            }
            className="ml-auto px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/50 flex items-center gap-1 transition"
            title="Auto-generate and attach a new suite for a hired employee"
          >
            <Plus size={10} />
            <span>+ NEW SUITE</span>
          </button>
          <button
            type="button"
            onClick={handleSaveCampus}
            className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold flex items-center gap-1 transition cursor-pointer shadow-sm"
            title="Save current room and furniture layout to cloud database"
          >
            <span>💾 {saveStatus || 'SAVE LAYOUT'}</span>
          </button>
        </div>
      )}

      {/* Main Isometric SVG Compound Canvas */}
      <div ref={containerRef} className="w-full h-full flex items-center justify-center p-3 touch-none">
        <svg
          viewBox="-540 -320 1080 620"
          className={`w-full h-full max-h-[90vh] ${isPanning ? '' : 'transition-transform duration-200 ease-out'}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <defs>
            {/* Background Radial Shading */}
            <radialGradient id="campusGlow" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#1e293b" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#0f172a" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#020617" stopOpacity="0" />
            </radialGradient>

            {/* Corridor Floor Patterns */}
            <linearGradient id="corridorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1a2333" />
              <stop offset="50%" stopColor="#111827" />
              <stop offset="100%" stopColor="#0a0f18" />
            </linearGradient>

            {/* Custom Room Floor Textures */}
            {/* Tyler: Dark Mahogany Planks */}
            <linearGradient id="mahoganyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2c1409" />
              <stop offset="50%" stopColor="#1b0c05" />
              <stop offset="100%" stopColor="#0e0602" />
            </linearGradient>

            {/* Coder: Cyberpunk Dev Matrix Grid */}
            <linearGradient id="coderFloorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#061f17" />
              <stop offset="50%" stopColor="#03140e" />
              <stop offset="100%" stopColor="#010a07" />
            </linearGradient>

            {/* Artist: Creative Bay Studio Tile */}
            <linearGradient id="artistFloorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#291124" />
              <stop offset="50%" stopColor="#190a16" />
              <stop offset="100%" stopColor="#0d040c" />
            </linearGradient>

            {/* DevOps: Server NOC Vault Grate */}
            <linearGradient id="opsFloorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0f213d" />
              <stop offset="50%" stopColor="#0a1526" />
              <stop offset="100%" stopColor="#050a14" />
            </linearGradient>

            {/* QA: Testing Cleanroom Cyan Grid */}
            <linearGradient id="qaFloorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#082b36" />
              <stop offset="50%" stopColor="#051b22" />
              <stop offset="100%" stopColor="#020c10" />
            </linearGradient>

            {/* WebDev: Staging Deck Slate */}
            <linearGradient id="webFloorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0a263d" />
              <stop offset="50%" stopColor="#071827" />
              <stop offset="100%" stopColor="#030c14" />
            </linearGradient>

            {/* Wall Partition Gradients */}
            <linearGradient id="glassWallLeft" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id="glassWallRight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#334155" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#1e293b" stopOpacity="0.7" />
            </linearGradient>

            {/* Screen Shaders */}
            <linearGradient id="screenCodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#064e3b" />
              <stop offset="100%" stopColor="#022c22" />
            </linearGradient>
            <linearGradient id="screenArtGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#831843" />
              <stop offset="100%" stopColor="#4c0519" />
            </linearGradient>
            <linearGradient id="screenOpsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e3a8a" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
            <linearGradient id="screenQaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#155e75" />
              <stop offset="100%" stopColor="#083344" />
            </linearGradient>
            <linearGradient id="screenWebGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0c4a6e" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>

            {/* Filters */}
            <filter id="deskShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#000000" floodOpacity="0.65" />
            </filter>
            <filter id="glowLight" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Compound Ambient Glow */}
          <ellipse cx="0" cy="5" rx="460" ry="240" fill="url(#campusGlow)" />

          {/* ======================================================== */}
          {/* 1. INTER-CABINET CORRIDOR NETWORK & PLAZA FOUNDATION     */}
          {/* ======================================================== */}
          <g id="corridor-network" onClick={() => setPopoverId(null)}>
            {/* Central Atrium Plaza Diamond */}
            <polygon
              points="0,-48 95,5 0,58 -95,5"
              fill="url(#corridorGrad)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            {/* Plaza Slab 3D Bevel Edge */}
            <polygon points="95,5 95,14 0,67 0,58" fill="#0c121e" />
            <polygon points="-95,5 -95,14 0,67 0,58" fill="#070b13" />

            {/* North Radial Corridor (Tyler) */}
            <polygon
              points="-22,-45 22,-45 22,-120 -22,-120"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />
            {/* South Radial Corridor (WebDev) */}
            <polygon
              points="-22,50 22,50 22,130 -22,130"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />
            {/* West Radial Corridor (Coder) */}
            <polygon
              points="-60,-32 -170,-98 -170,-72 -60,-4"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />
            {/* East Radial Corridor (Artist) */}
            <polygon
              points="60,-32 170,-98 170,-72 60,-4"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />
            {/* South-West Radial Corridor (DevOps) */}
            <polygon
              points="-60,14 -170,82 -170,108 -60,42"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />
            {/* South-East Radial Corridor (QA) */}
            <polygon
              points="60,14 170,82 170,108 60,42"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />

            {/* West Wing Gallery (Coder <-> DevOps corridor) */}
            <polygon
              points="-288,-35 -252,-35 -252,45 -288,45"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />
            {/* East Wing Gallery (Artist <-> QA corridor) */}
            <polygon
              points="252,-35 288,-35 288,45 252,45"
              fill="url(#corridorGrad)"
              stroke="#1e293b"
              strokeWidth="1.2"
            />

            {/* Central Plaza Medallion & Compass Rose */}
            <polygon
              points="0,-25 45,5 0,35 -45,5"
              fill="#0f172a"
              stroke="#38bdf8"
              strokeWidth="1"
              strokeDasharray="4 2"
              opacity="0.6"
            />
            <circle cx="0" cy="5" r="9" fill="#020617" stroke="#38bdf8" strokeWidth="1" />
            <circle cx="0" cy="5" r="3.5" fill="#38bdf8" className="animate-pulse" />

            {/* Corridor Center Guidance Tracks (Laser Line for Courier) */}
            <line x1="0" y1="-120" x2="0" y2="130" stroke="#0ea5e9" strokeWidth="1" strokeDasharray="6 4" opacity="0.45" />
            <line x1="-170" y1="-85" x2="170" y2="95" stroke="#0ea5e9" strokeWidth="1" strokeDasharray="6 4" opacity="0.35" />
            <line x1="170" y1="-85" x2="-170" y2="95" stroke="#0ea5e9" strokeWidth="1" strokeDasharray="6 4" opacity="0.35" />
            <line x1="-270" y1="-35" x2="-270" y2="45" stroke="#0ea5e9" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
            <line x1="270" y1="-35" x2="270" y2="45" stroke="#0ea5e9" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />

            {/* Floor Directional Chevron Markings */}
            <g opacity="0.5">
              <path d="M -4,-80 L 0,-85 L 4,-80" fill="none" stroke="#38bdf8" strokeWidth="1.2" />
              <path d="M -4,-60 L 0,-65 L 4,-60" fill="none" stroke="#38bdf8" strokeWidth="1.2" />
              <path d="M -4,80 L 0,85 L 4,80" fill="none" stroke="#38bdf8" strokeWidth="1.2" />
              <path d="M -4,100 L 0,105 L 4,100" fill="none" stroke="#38bdf8" strokeWidth="1.2" />
              <path d="M -115,-80 L -120,-75 L -125,-80" fill="none" stroke="#10b981" strokeWidth="1.2" />
              <path d="M 115,-80 L 120,-75 L 125,-80" fill="none" stroke="#ec4899" strokeWidth="1.2" />
              <path d="M -115,85 L -120,90 L -125,85" fill="none" stroke="#3b82f6" strokeWidth="1.2" />
              <path d="M 115,85 L 120,90 L 125,85" fill="none" stroke="#06b6d4" strokeWidth="1.2" />
            </g>
          </g>

          {/* ======================================================== */}
          {/* 2. THE 6 DEDICATED SUITES / ROOM GENERATION               */}
          {/* ======================================================== */}

          {/* SUITE 01 (North): TYLER - EXECUTIVE SUITE */}
          <g id="suite-tyler" onClick={() => handleDeskClick('tyler')}>
            {/* Room Diamond Floor */}
            <polygon
              points="0,-230 110,-175 0,-120 -110,-175"
              fill="url(#mahoganyGrad)"
              stroke="#78350f"
              strokeWidth="2"
            />
            {/* Floor Slab 3D Edges */}
            <polygon points="110,-175 110,-167 0,-112 0,-120" fill="#1e0c04" />
            <polygon points="-110,-175 -110,-167 0,-112 0,-120" fill="#0f0502" />

            {/* Mahogany Wood Plank Grooves */}
            {[-1.2, -0.6, 0, 0.6, 1.2].map((idx) => (
              <line
                key={`plank-${idx}`}
                x1={idx * 35}
                y1={-175 + idx * 17.5 - 25}
                x2={idx * 35}
                y2={-175 + idx * 17.5 + 25}
                stroke="#451a03"
                strokeWidth="0.8"
                opacity="0.4"
              />
            ))}

            {/* Rear Left Wall */}
            <polygon
              points="-110,-175 -110,-225 0,-280 0,-230"
              fill="url(#glassWallLeft)"
              stroke="#475569"
              strokeWidth="1.5"
            />
            {/* Rear Right Wall */}
            <polygon
              points="0,-230 0,-280 110,-225 110,-175"
              fill="url(#glassWallRight)"
              stroke="#475569"
              strokeWidth="1.5"
            />
            {/* Glass Wall Translucent Highlights */}
            <line x1="-110" y1="-225" x2="0" y2="-280" stroke="#f59e0b" strokeWidth="1.5" opacity="0.75" />
            <line x1="0" y1="-280" x2="110" y2="-225" stroke="#f59e0b" strokeWidth="1.5" opacity="0.75" />
            <line x1="0" y1="-280" x2="0" y2="-230" stroke="#38bdf8" strokeWidth="1.2" opacity="0.5" />
            <line x1="-55" y1="-252" x2="-55" y2="-202" stroke="#475569" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
            <line x1="55" y1="-252" x2="55" y2="-202" stroke="#475569" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />

            {/* Door Frame at South Front Corner */}
            <g transform="translate(0, -120)">
              <line x1="-20" y1="0" x2="-20" y2="-32" stroke="#f59e0b" strokeWidth="1.5" />
              <line x1="20" y1="0" x2="20" y2="-32" stroke="#f59e0b" strokeWidth="1.5" />
              <line x1="-20" y1="-32" x2="20" y2="-32" stroke="#f59e0b" strokeWidth="2" />
              {/* Illuminated Suite Placard */}
              <rect x="-24" y="-42" width="48" height="9" rx="2" fill="#0f172a" stroke="#f59e0b" strokeWidth="1" />
              <text x="0" y="-36" fill="#fbbf24" fontSize="5.5" fontWeight="bold" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                STE-01 · EXEC
              </text>
            </g>

            {/* Strategic Whiteboard on Rear Left Wall */}
            <g transform="translate(-50, -225)">
              <polygon points="-28,-8 28,-22 28,16 -28,30" fill="#0f172a" stroke="#d97706" strokeWidth="1.2" />
              <polygon points="-25,-5 25,-19 25,13 -25,27" fill="#1e293b" />
              <line x1="-20" y1="3" x2="18" y2="-7" stroke="#38bdf8" strokeWidth="1.5" opacity="0.8" />
              <line x1="-20" y1="11" x2="5" y2="4" stroke="#34d399" strokeWidth="1.2" opacity="0.8" />
              <line x1="-20" y1="19" x2="12" y2="10" stroke="#fbbf24" strokeWidth="1.2" opacity="0.8" />
              <text x="0" y="-10" fill="#94a3b8" fontSize="4.5" textAnchor="middle" fontWeight="bold" fontFamily="monospace">
                Q4 STRATEGY ROADMAP
              </text>
            </g>

            {/* Luxury Executive Carpet Rug */}
            <polygon
              points="0,-192 60,-162 0,-132 -60,-162"
              fill="#1e1b4b"
              stroke="#f59e0b"
              strokeWidth="1.2"
              strokeDasharray="4 2"
              opacity="0.75"
            />

            {/* Brass Arc Floor Lamp in corner */}
            <g transform="translate(65, -195)">
              <ellipse cx="0" cy="5" rx="7" ry="3.5" fill="#451a03" stroke="#f59e0b" strokeWidth="0.8" />
              <path d="M 0,5 Q 5,-25 -10,-32" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
              <polygon points="-14,-31 -6,-34 -10,-26" fill="#fef08a" />
              {/* Subtle ambient light pool */}
              <ellipse cx="-10" cy="-10" rx="14" ry="7" fill="#fef08a" opacity="0.12" />
            </g>

            {/* Credenza & Espresso Station in left corner */}
            <g transform="translate(-75, -180)">
              <polygon points="0,-12 18,-3 0,6 -18,-3" fill="#451a03" stroke="#78350f" strokeWidth="1" />
              <polygon points="18,-3 18,8 0,17 0,6" fill="#1c0d02" />
              <polygon points="-18,-3 -18,8 0,17 0,6" fill="#0f0701" />
              {/* Coffee machine */}
              <rect x="-5" y="-12" width="10" height="9" rx="1.5" fill="#334155" stroke="#f59e0b" strokeWidth="0.8" />
              <circle cx="0" cy="-6" r="1.5" fill="#ef4444" className="animate-pulse" />
            </g>
          </g>

          {/* SUITE 02 (West): CODER - DEV DEN */}
          <g id="suite-coder" onClick={() => handleDeskClick('coder')}>
            {/* Room Diamond Floor */}
            <polygon
              points="-270,-135 -170,-85 -270,-35 -370,-85"
              fill="url(#coderFloorGrad)"
              stroke="#059669"
              strokeWidth="2"
            />
            {/* Floor Slab 3D Edges */}
            <polygon points="-170,-85 -170,-77 -270,-27 -270,-35" fill="#041f17" />
            <polygon points="-370,-85 -370,-77 -270,-27 -270,-35" fill="#020e0a" />

            {/* Cyberpunk Circuit Traces on Floor */}
            <path
              d="M -350,-85 L -310,-65 L -290,-65 L -280,-60"
              fill="none"
              stroke="#10b981"
              strokeWidth="1.2"
              opacity="0.6"
            />
            <circle cx="-280" cy="-60" r="2" fill="#34d399" />
            <path
              d="M -310,-115 L -280,-100 L -250,-100"
              fill="none"
              stroke="#10b981"
              strokeWidth="1"
              opacity="0.4"
            />

            {/* Rear Left Wall */}
            <polygon
              points="-370,-85 -370,-135 -270,-185 -270,-135"
              fill="url(#glassWallLeft)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            {/* Rear Right Wall */}
            <polygon
              points="-270,-135 -270,-185 -170,-135 -170,-85"
              fill="url(#glassWallRight)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            <line x1="-370" y1="-135" x2="-270" y2="-185" stroke="#10b981" strokeWidth="1.5" opacity="0.75" />
            <line x1="-270" y1="-185" x2="-170" y2="-135" stroke="#10b981" strokeWidth="1.5" opacity="0.75" />

            {/* Door Frame facing East towards Corridor */}
            <g transform="translate(-170, -85)">
              <line x1="0" y1="-15" x2="0" y2="-45" stroke="#10b981" strokeWidth="1.5" />
              <line x1="20" y1="-5" x2="20" y2="-35" stroke="#10b981" strokeWidth="1.5" />
              <line x1="0" y1="-45" x2="20" y2="-35" stroke="#10b981" strokeWidth="2" />
              <rect x="-6" y="-55" width="46" height="9" rx="2" fill="#0f172a" stroke="#10b981" strokeWidth="1" />
              <text x="17" y="-49" fill="#34d399" fontSize="5.5" fontWeight="bold" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                STE-02 · DEV
              </text>
            </g>

            {/* CRT Wall Matrix Displays on Left Wall */}
            <g transform="translate(-320, -145)">
              <polygon points="-24,-5 20,-27 20,5 -24,27" fill="#022c22" stroke="#10b981" strokeWidth="1.2" />
              <line x1="-18" y1="2" x2="14" y2="-14" stroke="#34d399" strokeWidth="1" />
              <line x1="-18" y1="10" x2="10" y2="-4" stroke="#34d399" strokeWidth="1" />
              <line x1="-18" y1="18" x2="5" y2="7" stroke="#34d399" strokeWidth="1" />
              <text x="-4" y="-12" fill="#10b981" fontSize="4" fontFamily="monospace">
                GODOT 4.4 :: OK
              </text>
            </g>

            {/* Water-Cooled Server Tower on Floor */}
            <g transform="translate(-340, -80)">
              <polygon points="0,-24 14,-17 0,-10 -14,-17" fill="#1e293b" stroke="#10b981" strokeWidth="1" />
              <polygon points="14,-17 14,8 0,15 0,-10" fill="#0f172a" />
              <polygon points="-14,-17 -14,8 0,15 0,-10" fill="#090d16" />
              {/* Glowing green coolant pipe */}
              <line x1="0" y1="-8" x2="0" y2="10" stroke="#34d399" strokeWidth="2" className="animate-pulse" />
              <circle cx="8" cy="-5" r="1.5" fill="#10b981" />
              <circle cx="8" cy="2" r="1.5" fill="#34d399" className="animate-ping" />
            </g>
          </g>

          {/* SUITE 03 (East): ARTIST - CREATIVE BAY */}
          <g id="suite-artist" onClick={() => handleDeskClick('artist')}>
            {/* Room Diamond Floor */}
            <polygon
              points="270,-135 370,-85 270,-35 170,-85"
              fill="url(#artistFloorGrad)"
              stroke="#db2777"
              strokeWidth="2"
            />
            {/* Floor Slab 3D Edges */}
            <polygon points="370,-85 370,-77 270,-27 270,-35" fill="#200619" />
            <polygon points="170,-85 170,-77 270,-27 270,-35" fill="#0f020c" />

            {/* Creative Pastel Studio Tiles Pattern */}
            <polygon
              points="270,-105 320,-80 270,-55 220,-80"
              fill="#371b34"
              stroke="#ec4899"
              strokeWidth="1"
              strokeDasharray="4 2"
              opacity="0.4"
            />

            {/* Rear Left Wall */}
            <polygon
              points="170,-85 170,-135 270,-185 270,-135"
              fill="url(#glassWallLeft)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            {/* Rear Right Wall */}
            <polygon
              points="270,-135 270,-185 370,-135 370,-85"
              fill="url(#glassWallRight)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            <line x1="170" y1="-135" x2="270" y2="-185" stroke="#ec4899" strokeWidth="1.5" opacity="0.75" />
            <line x1="270" y1="-185" x2="370" y2="-135" stroke="#ec4899" strokeWidth="1.5" opacity="0.75" />

            {/* Door Frame facing West towards Corridor */}
            <g transform="translate(170, -85)">
              <line x1="-20" y1="-5" x2="-20" y2="-35" stroke="#ec4899" strokeWidth="1.5" />
              <line x1="0" y1="-15" x2="0" y2="-45" stroke="#ec4899" strokeWidth="1.5" />
              <line x1="-20" y1="-35" x2="0" y2="-45" stroke="#ec4899" strokeWidth="2" />
              <rect x="-38" y="-55" width="46" height="9" rx="2" fill="#0f172a" stroke="#ec4899" strokeWidth="1" />
              <text x="-15" y="-49" fill="#f472b6" fontSize="5.5" fontWeight="bold" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                STE-03 · ART
              </text>
            </g>

            {/* Drafting Easel with Vector Art Display */}
            <g transform="translate(325, -95)">
              {/* Tripod wooden legs */}
              <line x1="0" y1="-30" x2="-14" y2="15" stroke="#78350f" strokeWidth="1.8" />
              <line x1="0" y1="-30" x2="14" y2="15" stroke="#78350f" strokeWidth="1.8" />
              <line x1="0" y1="-30" x2="0" y2="18" stroke="#451a03" strokeWidth="1.5" />
              {/* Canvas on Easel */}
              <polygon points="-16,-22 16,-22 14,4 -18,4" fill="#f8fafc" stroke="#ec4899" strokeWidth="1.2" />
              {/* Vibrant abstract illustration */}
              <circle cx="-4" cy="-9" r="6" fill="#ec4899" opacity="0.8" />
              <polygon points="2,-14 10,-4 0,-4" fill="#3b82f6" opacity="0.75" />
              <line x1="-12" y1="0" x2="10" y2="0" stroke="#f59e0b" strokeWidth="1.5" />
            </g>

            {/* Color Swatch Palette on Right Wall */}
            <g transform="translate(315, -145)">
              <polygon points="-18,-15 18,-33 18,-7 -18,11" fill="#1e293b" stroke="#ec4899" strokeWidth="1" />
              <circle cx="-8" cy="-5" r="2.5" fill="#f43f5e" />
              <circle cx="0" cy="-9" r="2.5" fill="#ec4899" />
              <circle cx="8" cy="-13" r="2.5" fill="#a855f7" />
              <circle cx="-8" cy="2" r="2.5" fill="#3b82f6" />
              <circle cx="0" cy="-2" r="2.5" fill="#10b981" />
              <circle cx="8" cy="-6" r="2.5" fill="#f59e0b" />
            </g>
          </g>

          {/* SUITE 04 (South-West): DEVOPS - SERVER NOC & VAULT */}
          <g id="suite-devops" onClick={() => handleDeskClick('devops')}>
            {/* Room Diamond Floor */}
            <polygon
              points="-270,45 -170,95 -270,145 -370,95"
              fill="url(#opsFloorGrad)"
              stroke="#2563eb"
              strokeWidth="2"
            />
            {/* Floor Slab 3D Edges */}
            <polygon points="-170,95 -170,103 -270,153 -270,145" fill="#061226" />
            <polygon points="-370,95 -370,103 -270,153 -270,145" fill="#030914" />

            {/* Cooling Floor Grates (Perforated metal grilles) */}
            {[-2, -1, 0, 1, 2].map((gIdx) => (
              <g key={`grate-${gIdx}`} opacity="0.45">
                <line
                  x1={-270 + gIdx * 16 - 20}
                  y1={95 + gIdx * 8 - 10}
                  x2={-270 + gIdx * 16 + 20}
                  y2={95 + gIdx * 8 + 10}
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                  strokeDasharray="2 2"
                />
              </g>
            ))}

            {/* Rear Left Wall */}
            <polygon
              points="-370,95 -370,45 -270,-5 -270,45"
              fill="url(#glassWallLeft)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            {/* Rear Right Wall */}
            <polygon
              points="-270,45 -270,-5 -170,45 -170,95"
              fill="url(#glassWallRight)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            <line x1="-370" y1="45" x2="-270" y2="-5" stroke="#3b82f6" strokeWidth="1.5" opacity="0.75" />
            <line x1="-270" y1="-5" x2="-170" y2="45" stroke="#3b82f6" strokeWidth="1.5" opacity="0.75" />

            {/* Door Frame facing East towards Corridor */}
            <g transform="translate(-170, 95)">
              <line x1="0" y1="-15" x2="0" y2="-45" stroke="#3b82f6" strokeWidth="1.5" />
              <line x1="20" y1="-5" x2="20" y2="-35" stroke="#3b82f6" strokeWidth="1.5" />
              <line x1="0" y1="-45" x2="20" y2="-35" stroke="#3b82f6" strokeWidth="2" />
              <rect x="-6" y="-55" width="46" height="9" rx="2" fill="#0f172a" stroke="#3b82f6" strokeWidth="1" />
              <text x="17" y="-49" fill="#60a5fa" fontSize="5.5" fontWeight="bold" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                STE-04 · NOC
              </text>
            </g>

            {/* Blade Server Racks with Blinking LEDs */}
            <g transform="translate(-325, 65)">
              {/* Rack 1 */}
              <polygon points="0,-45 22,-34 0,-23 -22,-34" fill="#334155" stroke="#3b82f6" strokeWidth="1" />
              <polygon points="22,-34 22,12 0,23 0,-23" fill="#1e293b" />
              <polygon points="-22,-34 -22,12 0,23 0,-23" fill="#0f172a" />
              {/* Server Blade Slots & LEDs */}
              {[ -18, -8, 2, 12 ].map((slotY, i) => (
                <g key={`slot-${i}`}>
                  <line x1="4" y1={slotY} x2="18" y2={slotY - 7} stroke="#475569" strokeWidth="1.2" />
                  <circle cx="8" cy={slotY - 1} r="1.2" fill={i % 2 === 0 ? '#34d399' : '#38bdf8'} className="animate-pulse" />
                  <circle cx="14" cy={slotY - 4} r="1.2" fill={i === 2 ? '#f43f5e' : '#34d399'} />
                </g>
              ))}
              {/* Blue Rotating Beacon on top of Rack */}
              <circle cx="0" cy="-34" r="3" fill="#38bdf8" className="animate-ping" opacity="0.85" />
              <circle cx="0" cy="-34" r="2.5" fill="#2563eb" />
            </g>

            {/* Telemetry Status Monitor on Rear Wall */}
            <g transform="translate(-240, 20)">
              <polygon points="-20,-5 20,-25 20,5 -20,25" fill="#0f172a" stroke="#3b82f6" strokeWidth="1" />
              <text x="0" y="-8" fill="#60a5fa" fontSize="4.5" textAnchor="middle" fontFamily="monospace">
                UPTIME: 99.99%
              </text>
              <line x1="-14" y1="2" x2="14" y2="-12" stroke="#38bdf8" strokeWidth="1.2" />
            </g>
          </g>

          {/* SUITE 05 (South-East): QA - TESTING LAB */}
          <g id="suite-qa" onClick={() => handleDeskClick('qa')}>
            {/* Room Diamond Floor */}
            <polygon
              points="270,45 370,95 270,145 170,95"
              fill="url(#qaFloorGrad)"
              stroke="#0891b2"
              strokeWidth="2"
            />
            {/* Floor Slab 3D Edges */}
            <polygon points="370,95 370,103 270,153 270,145" fill="#04181f" />
            <polygon points="170,95 170,103 270,153 270,145" fill="#020d12" />

            {/* Cleanroom Diagnostic Grid Crosshairs */}
            <g opacity="0.4">
              <line x1="270" y1="65" x2="270" y2="125" stroke="#06b6d4" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="220" y1="95" x2="320" y2="95" stroke="#06b6d4" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx="270" cy="95" r="15" fill="none" stroke="#06b6d4" strokeWidth="0.8" strokeDasharray="2 2" />
            </g>

            {/* Rear Left Wall */}
            <polygon
              points="170,95 170,45 270,-5 270,45"
              fill="url(#glassWallLeft)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            {/* Rear Right Wall */}
            <polygon
              points="270,45 270,-5 370,45 370,95"
              fill="url(#glassWallRight)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            <line x1="170" y1="45" x2="270" y2="-5" stroke="#06b6d4" strokeWidth="1.5" opacity="0.75" />
            <line x1="270" y1="-5" x2="370" y2="45" stroke="#06b6d4" strokeWidth="1.5" opacity="0.75" />

            {/* Door Frame facing West towards Corridor */}
            <g transform="translate(170, 95)">
              <line x1="-20" y1="-5" x2="-20" y2="-35" stroke="#06b6d4" strokeWidth="1.5" />
              <line x1="0" y1="-15" x2="0" y2="-45" stroke="#06b6d4" strokeWidth="1.5" />
              <line x1="-20" y1="-35" x2="0" y2="-45" stroke="#06b6d4" strokeWidth="2" />
              <rect x="-38" y="-55" width="46" height="9" rx="2" fill="#0f172a" stroke="#06b6d4" strokeWidth="1" />
              <text x="-15" y="-49" fill="#22d3ee" fontSize="5.5" fontWeight="bold" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                STE-05 · LAB
              </text>
            </g>

            {/* Oscilloscope Bench with Sine Wave Display */}
            <g transform="translate(325, 75)">
              <polygon points="0,-18 20,-9 0,0 -20,-9" fill="#1e293b" stroke="#06b6d4" strokeWidth="1" />
              <polygon points="20,-9 20,10 0,19 0,0" fill="#0f172a" />
              <polygon points="-20,-9 -20,10 0,19 0,0" fill="#090d16" />
              {/* Cathode Screen */}
              <polygon points="-16,-7 -2,-14 -2,-2 -16,5" fill="#083344" stroke="#06b6d4" strokeWidth="1" />
              {/* Green Sine Wave */}
              <path d="M -14,-1 Q -11,-7 -9,-2 T -4,-4" fill="none" stroke="#34d399" strokeWidth="1.2" className="animate-pulse" />
              {/* Control Dials */}
              <circle cx="6" cy="-2" r="1.5" fill="#94a3b8" />
              <circle cx="12" cy="-5" r="1.5" fill="#94a3b8" />
            </g>

            {/* Bug Tracker Severity Checklist on Wall */}
            <g transform="translate(240, 20)">
              <polygon points="-20,-25 20,-5 20,25 -20,5" fill="#0f172a" stroke="#06b6d4" strokeWidth="1" />
              <text x="0" y="-8" fill="#22d3ee" fontSize="4.5" textAnchor="middle" fontFamily="monospace">
                TEST RUNS: 100%
              </text>
              <circle cx="-10" cy="2" r="1.5" fill="#34d399" />
              <circle cx="-2" cy="6" r="1.5" fill="#34d399" />
              <circle cx="6" cy="10" r="1.5" fill="#38bdf8" />
            </g>
          </g>

          {/* SUITE 06 (South): WEBDEV - STAGING DECK */}
          <g id="suite-webdev" onClick={() => handleDeskClick('webdev')}>
            {/* Room Diamond Floor */}
            <polygon
              points="0,130 110,185 0,240 -110,185"
              fill="url(#webFloorGrad)"
              stroke="#0284c7"
              strokeWidth="2"
            />
            {/* Floor Slab 3D Edges */}
            <polygon points="110,185 110,193 0,248 0,240" fill="#061826" />
            <polygon points="-110,185 -110,193 0,248 0,240" fill="#030c14" />

            {/* Viewport Alignment Grid Marks on Floor */}
            <polygon
              points="0,150 75,187 0,224 -75,187"
              fill="none"
              stroke="#0ea5e9"
              strokeWidth="1"
              strokeDasharray="4 2"
              opacity="0.35"
            />
            <text x="0" y="165" fill="#0ea5e9" fontSize="5" textAnchor="middle" fontFamily="JetBrains Mono, monospace" opacity="0.6">
              1920 × 1080 STAGING VIEWPORT
            </text>

            {/* Glass Balustrade Dividers at Entrance */}
            <line x1="-110" y1="185" x2="-25" y2="142" stroke="#0ea5e9" strokeWidth="2" opacity="0.65" />
            <line x1="25" y1="142" x2="110" y2="185" stroke="#0ea5e9" strokeWidth="2" opacity="0.65" />

            {/* Glass partition posts */}
            {[-100, -70, -40, 40, 70, 100].map((px) => {
              const py = 185 - (Math.abs(px) - 25) * 0.5;
              return (
                <line
                  key={`balustrade-${px}`}
                  x1={px}
                  y1={py}
                  x2={px}
                  y2={py - 14}
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                  opacity="0.7"
                />
              );
            })}

            {/* Suite Door Entrance Placard at North Corner */}
            <g transform="translate(0, 130)">
              <rect x="-24" y="-12" width="48" height="9" rx="2" fill="#0f172a" stroke="#0ea5e9" strokeWidth="1" />
              <text x="0" y="-6" fill="#38bdf8" fontSize="5.5" fontWeight="bold" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                STE-06 · STAGING
              </text>
            </g>

            {/* Multi-Device Matrix Test Rack (Mobile + Tablet stand) */}
            <g transform="translate(-65, 175)">
              {/* Brushed aluminum stand */}
              <polygon points="0,-12 16,-4 0,4 -16,-4" fill="#334155" stroke="#64748b" strokeWidth="1" />
              <polygon points="16,-4 16,6 0,14 0,4" fill="#1e293b" />
              <polygon points="-16,-4 -16,6 0,14 0,4" fill="#0f172a" />
              {/* Tablet screen */}
              <rect x="-12" y="-22" width="24" height="15" rx="1.5" fill="#0f172a" stroke="#38bdf8" strokeWidth="1" />
              <rect x="-10" y="-20" width="20" height="11" fill="#0284c7" opacity="0.6" />
              {/* Phone screen mounted on side */}
              <rect x="14" y="-16" width="7" height="13" rx="1" fill="#0f172a" stroke="#38bdf8" strokeWidth="0.8" />
              <circle cx="17.5" cy="-5" r="0.6" fill="#38bdf8" />
            </g>

            {/* Staging Status Beacon Lamp */}
            <g transform="translate(65, 175)">
              <ellipse cx="0" cy="5" rx="5" ry="2.5" fill="#1e293b" stroke="#0ea5e9" strokeWidth="0.8" />
              <line x1="0" y1="5" x2="0" y2="-20" stroke="#64748b" strokeWidth="1.5" />
              <circle cx="0" cy="-22" r="3.5" fill="#10b981" className="animate-pulse" />
              <circle cx="0" cy="-22" r="2" fill="#34d399" />
            </g>
          </g>

          {/* ======================================================== */}
          {/* 3. CORRIDOR ENVIRONMENTAL PROPS & CAMPUS FURNITURE       */}
          {/* ======================================================== */}
          <g id="corridor-props">
            {/* Vending Machine in West Wing Gallery Alcove */}
            <g transform="translate(-270, 5)">
              {/* Shadow */}
              <ellipse cx="0" cy="14" rx="16" ry="7" fill="#000000" opacity="0.5" />
              {/* Machine Cabinet */}
              <polygon points="0,-32 16,-23 0,-14 -16,-23" fill="#334155" stroke="#475569" strokeWidth="1" />
              <polygon points="16,-23 16,10 0,19 0,-14" fill="#1e293b" stroke="#334155" strokeWidth="1" />
              <polygon points="-16,-23 -16,10 0,19 0,-14" fill="#0f172a" stroke="#334155" strokeWidth="1" />
              {/* Neon Header "SNACK" */}
              <polygon points="-14,-21 0,-13 0,-7 -14,-15" fill="#f43f5e" />
              {/* Glass Display Front showing soda cans */}
              <polygon points="-14,-13 0,-5 0,11 -14,3" fill="#020617" stroke="#38bdf8" strokeWidth="0.8" />
              <circle cx="-10" cy="-5" r="1.4" fill="#ef4444" />
              <circle cx="-5" cy="-2" r="1.4" fill="#3b82f6" />
              <circle cx="-10" cy="0" r="1.4" fill="#10b981" />
              <circle cx="-5" cy="3" r="1.4" fill="#f59e0b" />
              {/* Keypad & Coin Slot */}
              <rect x="4" y="-8" width="6" height="4" fill="#020617" stroke="#38bdf8" strokeWidth="0.5" />
              <line x1="7" y1="2" x2="7" y2="7" stroke="#38bdf8" strokeWidth="1" />
            </g>

            {/* Water Cooler in East Wing Gallery Alcove */}
            <g transform="translate(270, 5)">
              {/* Shadow */}
              <ellipse cx="0" cy="14" rx="14" ry="6" fill="#000000" opacity="0.45" />
              {/* Dispenser Base Cabinet */}
              <polygon points="0,-12 12,-5 0,2 -12,-5" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8" />
              <polygon points="12,-5 12,12 0,19 0,2" fill="#cbd5e1" />
              <polygon points="-12,-5 -12,12 0,19 0,2" fill="#94a3b8" />
              {/* Inverted Translucent Water Bottle on Top */}
              <polygon points="0,-28 8,-23 0,-18 -8,-23" fill="#38bdf8" opacity="0.85" />
              <polygon points="8,-23 8,-14 0,-9 0,-18" fill="#0284c7" opacity="0.8" />
              <polygon points="-8,-23 -8,-14 0,-9 0,-18" fill="#0369a1" opacity="0.8" />
              {/* Air bubble in water */}
              <circle cx="-2" cy="-21" r="1" fill="#ffffff" opacity="0.75" />
              {/* Spigots (Cold Blue & Hot Red) */}
              <circle cx="-3" cy="5" r="1.2" fill="#3b82f6" />
              <circle cx="3" cy="8" r="1.2" fill="#ef4444" />
            </g>

            {/* Industrial Floor Cable Conduits (tube.mjs style running from NOC to Coder and WebDev) */}
            <g id="cable-channels" opacity="0.8">
              {/* Conduit from DevOps to Coder along West Corridor */}
              <path
                d="M -260,90 Q -250,5 -260,-80"
                fill="none"
                stroke="#1e293b"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M -260,90 Q -250,5 -260,-80"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeDasharray="4 6"
              />
              <path
                d="M -258,90 Q -248,5 -258,-80"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="1.5"
              />

              {/* Conduit from Central Plaza into WebDev */}
              <path
                d="M -10,40 L -10,135"
                fill="none"
                stroke="#1e293b"
                strokeWidth="5"
              />
              <path
                d="M -10,40 L -10,135"
                fill="none"
                stroke="#ec4899"
                strokeWidth="1.5"
              />

              {/* Clamps holding conduits to the floor */}
              <rect x="-263" y="-30" width="6" height="3" fill="#64748b" rx="1" />
              <rect x="-263" y="15" width="6" height="3" fill="#64748b" rx="1" />
              <rect x="-13" y="80" width="6" height="3" fill="#64748b" rx="1" />
            </g>

            {/* Architectural Potted Ficus Plants placed around Corridor Junctions */}
            {[
              { x: -85, y: -55 },
              { x: 85, y: -55 },
              { x: -85, y: 55 },
              { x: 85, y: 55 },
            ].map((p, idx) => (
              <g key={`ficus-${idx}`} transform={`translate(${p.x}, ${p.y})`}>
                {/* Shadow */}
                <ellipse cx="0" cy="12" rx="12" ry="6" fill="#000000" opacity="0.4" />
                {/* Planter pot */}
                <polygon points="0,0 12,6 0,12 -12,6" fill="#475569" stroke="#334155" strokeWidth="1" />
                <polygon points="12,6 12,15 0,21 0,12" fill="#1e293b" />
                <polygon points="-12,6 -12,15 0,21 0,12" fill="#0f172a" />
                {/* Lush layered ficus leaves */}
                <circle cx="0" cy="-6" r="10" fill="#065f46" opacity="0.9" />
                <circle cx="-5" cy="-12" r="8" fill="#047857" opacity="0.9" />
                <circle cx="5" cy="-14" r="9" fill="#10b981" opacity="0.85" />
                <circle cx="0" cy="-20" r="7" fill="#34d399" opacity="0.8" />
              </g>
            ))}

            {/* Central Atrium Wayfinding Information Kiosk */}
            <g transform="translate(0, -5)">
              <polygon points="0,-16 10,-10 0,-4 -10,-10" fill="#38bdf8" opacity="0.6" />
              <polygon points="10,-10 10,6 0,12 0,-4" fill="#0f172a" stroke="#38bdf8" strokeWidth="0.8" />
              <polygon points="-10,-10 -10,6 0,12 0,-4" fill="#020617" stroke="#38bdf8" strokeWidth="0.8" />
              {/* Holographic Suite Direction Arrows */}
              <text x="0" y="2" fill="#38bdf8" fontSize="4.5" textAnchor="middle" fontFamily="monospace">
                CAMPUS HUB
              </text>
            </g>
          </g>

          {/* ======================================================== */}
          {/* 4. INTER-CABINET TASK RUNNER COURIER & DATA PACKETS      */}
          {/* ======================================================== */}
          <g id="task-courier-system">
            {/* SVG Motion Path definition for Task Courier */}
            <path
              id="courierTrack"
              d={aStarCourierPath}
              fill="none"
              stroke="none"
            />

            {/* Courier Automaton moving along the track */}
            <g className="cursor-pointer">
              <animateMotion
                dur="6s"
                repeatCount="indefinite"
                rotate="auto"
              >
                <mpath href="#courierTrack" />
              </animateMotion>

              {/* Shadow under courier */}
              <ellipse cx="0" cy="5" rx="10" ry="5" fill="#000000" opacity="0.5" />

              {/* Autonomous Walking Agent on Own Legs */}
              <g transform="translate(0, -12)">
                <ModularCharacter
                  skin={customSkins[activeSenderId] || getAgentSkin(activeSenderId)}
                  pose="walking"
                  scale={0.82}
                  facing={isFacingLeft ? 'left' : 'right'}
                />
              </g>

              {/* Floating Courier Role Badge */}
              <g transform="translate(0, -28)">
                <rect x="-30" y="-8" width="60" height="13" rx="6.5" fill="#0f172a" stroke="#38bdf8" strokeWidth="1" />
                <text x="0" y="1" fill="#38bdf8" fontSize="6.5" fontWeight="bold" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                  ⚡ TASK COURIER
                </text>
              </g>
            </g>

            {/* Glowing High-Speed Data Pulses traveling continuously on corridor lines */}
            <circle r="3.5" fill="#38bdf8" filter="url(#glowLight)">
              <animateMotion
                dur="4s"
                repeatCount="indefinite"
                path="M -270,-80 L 0,5 L 270,100"
              />
            </circle>
            <circle r="3.5" fill="#ec4899" filter="url(#glowLight)">
              <animateMotion
                dur="4.5s"
                repeatCount="indefinite"
                path="M 270,-80 L 0,5 L 0,165"
              />
            </circle>
            <circle r="3.5" fill="#10b981" filter="url(#glowLight)">
              <animateMotion
                dur="5s"
                repeatCount="indefinite"
                path="M 0,-150 L 0,5 L -270,100"
              />
            </circle>
          </g>

          {/* --- PLACED THE SIMS OFFICE PROPS --- */}
          <g id="placed-office-props">
            {Object.values(campusGrid.tiles)
              .filter((t) => Boolean(t.propId))
              .map((tile) => {
                const { isoX, isoY } = gridToIso(tile.x, tile.y);
                return (
                  <g key={`prop-${tile.x},${tile.y}`} transform={`translate(${isoX}, ${isoY})`}>
                    <OfficeProp propId={tile.propId!} />
                  </g>
                );
              })}
          </g>

          {/* --- THE SIMS INTERACTIVE TILE GRID LAYER --- */}
          {buildMode && (
            <g id="sims-interactive-grid">
              {Object.values(campusGrid.tiles).map((tile) => {
                const points = getIsometricPolygonPoints(tile.x, tile.y);
                const isHovered = hoveredTileKey === `${tile.x},${tile.y}`;
                return (
                  <RenderIsometricTile
                    key={`${tile.x},${tile.y}`}
                    tile={tile}
                    points={points}
                    isHovered={isHovered}
                    onMouseEnter={() => setHoveredTileKey(`${tile.x},${tile.y}`)}
                    onMouseLeave={() => setHoveredTileKey(null)}
                    onClick={() => handleTileClick(tile.x, tile.y)}
                  />
                );
              })}
            </g>
          )}

          {/* --- DYNAMICALLY ASSIGNED SIMS SUITES --- */}
          {Object.values(campusGrid.rooms)
            .filter((r) => !WORKSTATION_CONFIG[r.ownerAgentId])
            .map((customRoom) => {
              const { isoX, isoY } = gridToIso(customRoom.deskCoord.x, customRoom.deskCoord.y);
              return (
                <g key={customRoom.id} transform={`translate(${isoX}, ${isoY})`}>
                  <ellipse cx="0" cy="5" rx="35" ry="18" fill="rgba(15, 23, 42, 0.7)" stroke={customRoom.color || '#10b981'} strokeWidth="1" />
                  <rect x="-24" y="-14" width="48" height="28" rx="4" fill="#1e293b" stroke="#334155" strokeWidth="1" />
                  <rect x="-14" y="-10" width="28" height="18" rx="2" fill="#0f172a" stroke={customRoom.color || '#10b981'} strokeWidth="0.8" />
                  <g transform="translate(0, -16)">
                    <ModularCharacter skin={getAgentSkin('coder')} pose="seated_sleep" scale={0.85} />
                  </g>
                  <text x="0" y="24" textAnchor="middle" fill={customRoom.color || '#34d399'} fontSize="9" fontFamily="monospace" fontWeight="600">
                    {customRoom.name}
                  </text>
                </g>
              );
            })}

          {/* ======================================================== */}
          {/* 5. INTERACTIVE WORKSTATIONS & AUTOMATON AGENTS           */}
          {/* ======================================================== */}
          {Object.entries(WORKSTATION_CONFIG).map(([id, conf]) => {
            const agent = getAgentData(id);
            const pos = conf.deskPos;
            const isSelected = selectedAgentId?.toLowerCase() === id;
            const isHovered = hoveredAgentId === id;
            const isWorking = agent.status === 'working';
            const isBlocked = agent.status === 'blocked' || agent.status === 'defect';
            const statusColor = deskStatusColor(agent.status);
            const assignment = agent.workflow_assignment ?? null;
            const badgeLabel = assignment
              ? `${assignment.assignment === 'approver' ? 'approve ' : ''}${assignment.node}`
              : '';
            const badgeW = Math.max(70, badgeLabel.length * 6.2 + 30);

            return (
              <g
                key={id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className="cursor-pointer transition-all duration-200"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeskClick(id);
                }}
                data-testid={`desk-${id}`}
                onMouseEnter={() => setHoveredAgentId(id)}
                onMouseLeave={() => setHoveredAgentId(null)}
              >
                {/* Station Selection / Hover Floor Ring */}
                {(isSelected || isHovered) && (
                  <ellipse
                    cx="0"
                    cy="25"
                    rx={isSelected ? '65' : '55'}
                    ry={isSelected ? '32' : '27'}
                    fill="none"
                    stroke={isSelected ? conf.accentColor : '#64748b'}
                    strokeWidth={isSelected ? '2.5' : '1.5'}
                    strokeDasharray={isSelected ? '6 3' : 'none'}
                    className={isSelected ? 'animate-pulse' : ''}
                    opacity="0.85"
                  />
                )}

                {/* Desk Shadow */}
                <ellipse cx="0" cy="22" rx="48" ry="22" fill="#000000" opacity="0.45" />

                {/* --- DESK RENDERING ACCORDING TO ROLE --- */}
                {conf.deskType === 'executive' && (
                  /* Tyler: Executive Mahogany Desk & Strategy Monitor */
                  <g id="tyler-desk">
                    <ellipse cx="0" cy="-8" rx="14" ry="7" fill="#1e1b4b" />
                    <polygon points="-12,-8 12,-8 10,-32 -10,-32" fill="#0f172a" stroke="#312e81" strokeWidth="1.5" />
                    <polygon points="0,-10 46,13 0,36 -46,13" fill="url(#mahoganyGrad)" stroke="#78350f" strokeWidth="1.5" />
                    <polygon points="46,13 46,26 0,49 0,36" fill="#1c0d02" />
                    <polygon points="-46,13 -46,26 0,49 0,36" fill="#0f0701" />
                    <line x1="-38" y1="13" x2="0" y2="32" stroke="#f59e0b" strokeWidth="1.2" opacity="0.7" />
                    <line x1="0" y1="32" x2="38" y2="13" stroke="#f59e0b" strokeWidth="1.2" opacity="0.7" />
                    {/* Laptop Screen */}
                    <polygon points="-10,-1 10,-1 12,-16 -8,-16" fill="#38bdf8" opacity="0.9" />
                    <polygon points="-12,-1 12,-1 8,6 -8,6" fill="#334155" />
                    {/* Coffee Cup */}
                    <circle cx="28" cy="18" r="3.5" fill="#f8fafc" />
                    <circle cx="28" cy="18" r="2.2" fill="#78350f" />
                  </g>
                )}

                {conf.deskType === 'code' && (
                  /* Coder: Triple Curved Monitor Matrix Desk */
                  <g id="coder-desk">
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#064e3b" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#022c22" stroke="#10b981" strokeWidth="1.5" />
                    <polygon points="0,-8 48,16 0,40 -48,16" fill="#1e293b" stroke="#10b981" strokeWidth="1.5" />
                    <polygon points="48,16 48,28 0,52 0,40" fill="#0f172a" />
                    <polygon points="-48,16 -48,28 0,52 0,40" fill="#090d16" />
                    {/* Center Screen */}
                    <polygon points="-14,-2 14,-2 14,-24 -14,-24" fill="url(#screenCodeGrad)" stroke="#10b981" strokeWidth="1.2" />
                    {/* Left Angled Screen */}
                    <polygon points="-36,8 -16,-1 -16,-23 -36,-14" fill="#022c22" stroke="#10b981" strokeWidth="1" />
                    {/* Right Angled Screen */}
                    <polygon points="16,-1 36,8 36,-14 16,-23" fill="#022c22" stroke="#10b981" strokeWidth="1" />
                    <line x1="-10" y1="-18" x2="10" y2="-18" stroke="#34d399" strokeWidth="1" opacity="0.8" />
                    <line x1="-10" y1="-12" x2="6" y2="-12" stroke="#34d399" strokeWidth="1" opacity="0.8" />
                    <line x1="-10" y1="-6" x2="12" y2="-6" stroke="#34d399" strokeWidth="1" opacity="0.8" />
                    <polygon points="-12,12 12,12 10,18 -10,18" fill="#0f172a" stroke="#10b981" strokeWidth="0.8" />
                  </g>
                )}

                {conf.deskType === 'art' && (
                  /* Artist: Creative Drafting Tablet & Palette Desk */
                  <g id="artist-desk">
                    <ellipse cx="0" cy="-6" rx="12" ry="6" fill="#831843" />
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#334155" stroke="#ec4899" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#1e293b" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#0f172a" />
                    <polygon points="-18,4 18,4 14,-18 -14,-18" fill="url(#screenArtGrad)" stroke="#ec4899" strokeWidth="1.5" />
                    <line x1="5" y1="1" x2="15" y2="7" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="28" cy="-5" r="7" fill="none" stroke="#f472b6" strokeWidth="1" strokeDasharray="2 2" className="animate-spin" />
                  </g>
                )}

                {conf.deskType === 'ops' && (
                  /* DevOps: Terminal Desk & Server Rack Unit */
                  <g id="ops-desk">
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#1e3a8a" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#0f172a" stroke="#3b82f6" strokeWidth="1.5" />
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#1e293b" stroke="#3b82f6" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#0f172a" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#090d16" />
                    <polygon points="-24,0 -2,-11 -2,-32 -24,-21" fill="url(#screenOpsGrad)" stroke="#3b82f6" strokeWidth="1.2" />
                    <polygon points="2,-11 24,0 24,-21 2,-32" fill="url(#screenOpsGrad)" stroke="#3b82f6" strokeWidth="1.2" />
                    <line x1="-20" y1="-14" x2="-6" y2="-21" stroke="#60a5fa" strokeWidth="1.5" />
                    <line x1="6" y1="-21" x2="20" y2="-14" stroke="#60a5fa" strokeWidth="1.5" />
                  </g>
                )}

                {conf.deskType === 'qa' && (
                  /* QA: Testing Workstation & Verification Terminal */
                  <g id="qa-desk">
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#164e63" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#083344" stroke="#06b6d4" strokeWidth="1.5" />
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#1e293b" stroke="#06b6d4" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#0f172a" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#090d16" />
                    <polygon points="-18,0 18,0 15,-22 -15,-22" fill="url(#screenQaGrad)" stroke="#06b6d4" strokeWidth="1.5" />
                    <circle cx="-8" cy="-11" r="2.5" fill="#34d399" />
                    <circle cx="0" cy="-11" r="2.5" fill="#34d399" />
                    <circle cx="8" cy="-11" r="2.5" fill="#38bdf8" />
                    <polygon points="-28,14 -12,22 -16,28 -32,20" fill="#f8fafc" stroke="#64748b" strokeWidth="1" />
                  </g>
                )}

                {conf.deskType === 'web' && (
                  /* WebDev: Browser Window & Device Preview Desk */
                  <g id="webdev-desk">
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#0c4a6e" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#082f49" stroke="#0ea5e9" strokeWidth="1.5" />
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#1e293b" stroke="#0ea5e9" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#0f172a" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#090d16" />
                    <polygon points="-22,0 22,0 22,-26 -22,-26" fill="url(#screenWebGrad)" stroke="#0ea5e9" strokeWidth="1.2" />
                    <rect x="-22" y="-26" width="44" height="5" fill="#0369a1" />
                    <circle cx="-18" cy="-23.5" r="1.1" fill="#f87171" />
                    <circle cx="-14.5" cy="-23.5" r="1.1" fill="#fbbf24" />
                    <circle cx="-11" cy="-23.5" r="1.1" fill="#34d399" />
                    <rect x="-18" y="-18" width="16" height="6" rx="1" fill="#38bdf8" opacity="0.85" />
                    <rect x="1" y="-18" width="17" height="6" rx="1" fill="#818cf8" opacity="0.75" />
                    <rect x="-18" y="-9" width="36" height="5" rx="1" fill="#22d3ee" opacity="0.6" />
                    <rect x="27" y="2" width="8" height="14" rx="1.5" fill="#0f172a" stroke="#38bdf8" strokeWidth="1" />
                    <rect x="28.5" y="4" width="5" height="9" fill="#0ea5e9" opacity="0.7" />
                  </g>
                )}

                {/* --- MODULAR CHARACTER SEATED AT WORKSTATION (WORKING VS SLEEPING) --- */}
                <g transform="translate(0, -16)">
                  <ModularCharacter
                    skin={customSkins[id] || getAgentSkin(id, conf.role)}
                    pose={isWorking ? 'seated_work' : 'seated_sleep'}
                    scale={0.88}
                  />
                </g>

                {/* --- FLOATING STATUS BUBBLE & AGENT LABEL --- */}
                <g id="floating-status" transform="translate(0, -68)">
                  <rect
                    x="-55"
                    y="-16"
                    width="110"
                    height="24"
                    rx="12"
                    fill="#0f172a"
                    stroke={isSelected ? conf.accentColor : '#334155'}
                    strokeWidth={isSelected ? '2' : '1'}
                    className="drop-shadow-lg"
                  />
                  <circle
                    cx="-42"
                    cy="-4"
                    r="4"
                    fill={statusColor}
                    className={isWorking || isBlocked ? 'animate-ping' : ''}
                  />
                  <circle
                    cx="-42"
                    cy="-4"
                    r="3.5"
                    fill={statusColor}
                  />

                  <text
                    x="-32"
                    y="0"
                    fill="#f8fafc"
                    fontSize="11"
                    fontWeight="600"
                    fontFamily="Inter, sans-serif"
                  >
                    {conf.name}
                  </text>
                  <text
                    x="28"
                    y="0"
                    fill={conf.accentColor}
                    fontSize="9"
                    fontWeight="500"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {agent.status}
                  </text>

                  {/* Active workflow node badge above the desk */}
                  {assignment && (
                    <g transform="translate(0, -32)" data-testid={`desk-badge-${id}`}>
                      <title>{`${assignment.current_task} — ${assignment.run_status}`}</title>
                      <rect
                        x={-badgeW / 2}
                        y="-14"
                        width={badgeW}
                        height="20"
                        rx="10"
                        fill="#020617"
                        stroke={statusColor}
                        strokeWidth="1.5"
                        className={isWorking ? 'animate-pulse' : ''}
                      />
                      <polygon points="0,10 -4,6 4,6" fill={statusColor} />
                      <text
                        x="0"
                        y="0"
                        fill={statusColor}
                        fontSize="9.5"
                        textAnchor="middle"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="600"
                      >
                        ⎇ {badgeLabel}
                      </text>
                    </g>
                  )}

                  {/* Tool Call Balloon / Speech Bubble if active */}
                  {agent.last_tool_call && (
                    <g transform={`translate(0, ${assignment ? -58 : -32})`}>
                      <rect
                        x="-65"
                        y="-14"
                        width="130"
                        height="20"
                        rx="6"
                        fill="#1e293b"
                        stroke="#475569"
                        strokeWidth="1"
                        className="drop-shadow-md"
                      />
                      <polygon points="0,6 -4,0 4,0" fill="#1e293b" />
                      <text
                        x="0"
                        y="0"
                        fill="#38bdf8"
                        fontSize="9"
                        textAnchor="middle"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="500"
                      >
                        ⚡ {agent.last_tool_call.tool_name || agent.last_tool_call.event_type}
                      </text>
                    </g>
                  )}
                </g>
              </g>
            );
          })}

          {/* ======================================================== */}
          {/* 6. WORKFLOW QUICK-PREVIEW POPOVER FOR CLICKED DESK       */}
          {/* ======================================================== */}
          {popoverAgent && popoverAssignment && popoverPos && (
            <foreignObject
              x={
                popoverPos.x + 50 + POPOVER_W > 500
                  ? popoverPos.x - 50 - POPOVER_W
                  : popoverPos.x + 50
              }
              y={Math.max(-280, Math.min(80, popoverPos.y - 120))}
              width={POPOVER_W}
              height={POPOVER_H}
            >
              <div
                role="dialog"
                aria-label={`${popoverAgent.profile_name} workflow step`}
                data-testid="workflow-popover"
                onClick={(e) => e.stopPropagation()}
                className="h-full bg-slate-900/95 border border-cyan-500/60 rounded-xl shadow-2xl p-3 text-[11px] text-slate-200 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">{popoverAgent.profile_name}</span>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={popoverAgent.status} size="sm" showAnimation={false} />
                    <button
                      onClick={() => setPopoverId(null)}
                      className="text-slate-400 hover:text-white"
                      aria-label="Close"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-cyan-300 font-mono">
                  <GitBranch size={11} />
                  {popoverAssignment.node}
                  <span className="text-slate-500">({popoverAssignment.role})</span>
                </div>
                <p className="font-medium leading-snug line-clamp-2">{popoverAssignment.current_task}</p>
                <div className="font-mono text-[10px] text-slate-400 leading-snug">
                  <div>run {popoverAssignment.run_id} · {popoverAssignment.run_status}</div>
                  <div className="truncate">
                    {popoverAssignment.task_id
                      ? `bridge ${popoverAssignment.task_id}`
                      : popoverAssignment.gate_id
                      ? `gate ${popoverAssignment.gate_id}`
                      : 'awaiting Bridge submission'}
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setPopoverId(null);
                      onOpenWorkflow?.(
                        popoverAssignment.run_id,
                        popoverAssignment.node,
                        popoverAgent.profile_name
                      );
                    }}
                    disabled={!onOpenWorkflow}
                    className="flex-1 flex items-center justify-center gap-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-md px-2 py-1 transition disabled:opacity-50"
                  >
                    <ExternalLink size={11} />
                    Open in Process Studio
                  </button>
                  <button
                    onClick={() => {
                      setPopoverId(null);
                      onSelectAgent(popoverAgent.id);
                    }}
                    className="flex items-center gap-1 border border-slate-700 hover:border-slate-500 rounded-md px-2 py-1 text-slate-300 transition"
                    title="Agent details"
                  >
                    <User size={11} />
                  </button>
                </div>
              </div>
            </foreignObject>
          )}
        </svg>
      </div>
    </div>
  );
};
