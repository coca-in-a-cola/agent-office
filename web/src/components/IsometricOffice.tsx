import React, { useState } from 'react';
import { Agent } from '../types';
import { StatusBadge } from './StatusBadge';
import { deskStatusColor } from './WorkflowAssignmentBadge';
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

// Workstation position mapping on the isometric floor plane
const WORKSTATION_CONFIG: Record<string, {
  name: string;
  role: string;
  gridX: number;
  gridY: number;
  icon: React.ElementType;
  accentColor: string;
  deskType: 'executive' | 'art' | 'code' | 'ops' | 'qa' | 'web';
}> = {
  tyler: {
    name: 'Tyler',
    role: 'Managing Director',
    gridX: 0,
    gridY: -1,
    icon: Crown,
    accentColor: '#f59e0b',
    deskType: 'executive',
  },
  coder: {
    name: 'Coder',
    role: 'Godot Dev',
    gridX: -1.4,
    gridY: 0.4,
    icon: Terminal,
    accentColor: '#10b981',
    deskType: 'code',
  },
  artist: {
    name: 'Artist',
    role: 'Artist',
    gridX: 1.4,
    gridY: -0.4,
    icon: Palette,
    accentColor: '#ec4899',
    deskType: 'art',
  },
  devops: {
    name: 'DevOps',
    role: 'DevOps',
    gridX: -0.7,
    gridY: 1.6,
    icon: Monitor,
    accentColor: '#3b82f6',
    deskType: 'ops',
  },
  qa: {
    name: 'QA',
    role: 'QA',
    gridX: 1.0,
    gridY: 1.2,
    icon: ShieldCheck,
    accentColor: '#06b6d4',
    deskType: 'qa',
  },
  // Server grid position [2, 0]: front-right corner of the floor.
  webdev: {
    name: 'WebDev',
    role: 'Web Engineer',
    gridX: 2.0,
    gridY: 1.0,
    icon: Globe,
    accentColor: '#0ea5e9',
    deskType: 'web',
  },
};

export const IsometricOffice: React.FC<IsometricOfficeProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onOpenWorkflow,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  // Desk whose workflow quick-preview popover is open.
  const [popoverId, setPopoverId] = useState<string | null>(null);

  // Convert isometric grid coordinates (gridX, gridY) to screen (X, Y)
  // Standard 2:1 isometric projection:
  // x_screen = (x - y) * TILE_WIDTH / 2
  // y_screen = (x + y) * TILE_HEIGHT / 2
  const TILE_W = 180;
  const TILE_H = 90;

  const toScreen = (gx: number, gy: number) => {
    return {
      x: (gx - gy) * (TILE_W / 2),
      y: (gx + gy) * (TILE_H / 2),
    };
  };

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
    ? toScreen(WORKSTATION_CONFIG[popoverId].gridX, WORKSTATION_CONFIG[popoverId].gridY)
    : null;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-radial-gradient overflow-hidden select-none">
      {/* Top Floating Controls */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 shadow-lg text-xs text-slate-300">
        <span className="font-semibold text-slate-200">Perspective:</span>
        <span className="text-cyan-400">Isometric 30°</span>
        <span className="text-slate-600">|</span>
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.15, 1.6))}
          className="p-1 hover:text-white hover:bg-slate-800 rounded transition"
          title="Zoom In"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.15, 0.7))}
          className="p-1 hover:text-white hover:bg-slate-800 rounded transition"
          title="Zoom Out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="p-1 hover:text-white hover:bg-slate-800 rounded transition"
          title="Reset View"
        >
          <RotateCcw size={14} />
        </button>
        <span className="text-slate-400 pl-1">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Office Floor Legend */}
      <div className="absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3 py-2 rounded-lg border border-slate-700/60 shadow-lg text-xs">
        <span className="text-slate-400 font-medium">Workstations:</span>
        {Object.entries(WORKSTATION_CONFIG).map(([id, conf]) => {
          const agent = getAgentData(id);
          const isSelected = selectedAgentId?.toLowerCase() === id;
          return (
            <button
              key={id}
              onClick={() => onSelectAgent(id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded transition border ${
                isSelected
                  ? 'bg-slate-800 border-cyan-400 text-white shadow-sm'
                  : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: conf.accentColor }}
              />
              <span className="font-medium">{conf.name}</span>
              <span className="text-[10px] text-slate-400">({conf.role})</span>
            </button>
          );
        })}
      </div>

      {/* Main Isometric SVG Canvas */}
      <div className="w-full h-full flex items-center justify-center p-4">
        <svg
          viewBox="-460 -260 920 560"
          className="w-full h-full max-h-[88vh] transition-transform duration-300 ease-out"
          style={{ transform: `scale(${zoom})` }}
        >
          <defs>
            {/* Grid Floor Pattern */}
            <linearGradient id="floorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#131b2e" />
              <stop offset="50%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#0a0f1d" />
            </linearGradient>

            <linearGradient id="tileGlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0.4" />
            </linearGradient>

            {/* Desk Gradients */}
            <linearGradient id="woodGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#451a03" />
              <stop offset="100%" stopColor="#291104" />
            </linearGradient>

            <linearGradient id="metalGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#334155" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>

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

            {/* Drop Shadows */}
            <filter id="deskShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000000" floodOpacity="0.6" />
            </filter>

            <filter id="glowLight" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Isometric Office Floor Plane (click closes the popover) */}
          <g id="office-floor" onClick={() => setPopoverId(null)}>
            {/* Outer Room Slab */}
            <polygon
              points="0,-190 420,20 0,230 -420,20"
              fill="url(#floorGrad)"
              stroke="#1e293b"
              strokeWidth="3"
            />
            {/* Floor Slab Thickness */}
            <polygon points="420,20 420,38 0,248 0,230" fill="#0f172a" />
            <polygon points="-420,20 -420,38 0,248 0,230" fill="#090d16" />

            {/* Isometric Floor Grid Lines */}
            {[-2, -1, 0, 1, 2].map((i) => {
              const p1 = toScreen(i, -2.5);
              const p2 = toScreen(i, 2.5);
              return (
                <line
                  key={`gx-${i}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#1e293b"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  opacity="0.7"
                />
              );
            })}
            {[-2, -1, 0, 1, 2].map((i) => {
              const p1 = toScreen(-2.5, i);
              const p2 = toScreen(2.5, i);
              return (
                <line
                  key={`gy-${i}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#1e293b"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  opacity="0.7"
                />
              );
            })}

            {/* Central Carpet / Rug Area */}
            <polygon
              points="0,-70 200,30 0,130 -200,30"
              fill="#1e293b"
              stroke="#334155"
              strokeWidth="1.5"
              opacity="0.4"
            />
            <polygon
              points="0,-60 180,30 0,120 -180,30"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1"
              strokeDasharray="6 6"
              opacity="0.3"
            />

            {/* Rear Translucent Glass Walls */}
            <polygon
              points="0,-190 -420,20 -420,-60 0,-270"
              fill="#0f172a"
              fillOpacity="0.4"
              stroke="#334155"
              strokeWidth="2"
            />
            <polygon
              points="0,-190 420,20 420,-60 0,-270"
              fill="#1e293b"
              fillOpacity="0.3"
              stroke="#334155"
              strokeWidth="2"
            />

            {/* Decorative Architectural Accent Lines */}
            <line x1="0" y1="-270" x2="0" y2="-190" stroke="#38bdf8" strokeWidth="2" opacity="0.6" />
            <line x1="-420" y1="-60" x2="0" y2="-270" stroke="#38bdf8" strokeWidth="1.5" opacity="0.4" />
            <line x1="420" y1="-60" x2="0" y2="-270" stroke="#818cf8" strokeWidth="1.5" opacity="0.4" />
          </g>

          {/* Office Props: Potted Plants & Server Racks in corners */}
          <g id="office-props">
            {/* Top Corner Executive Plan Board */}
            <g transform="translate(0, -180)">
              <polygon points="-40,-15 40,-15 40,35 -40,35" fill="#1e293b" stroke="#475569" strokeWidth="2" />
              <polygon points="-36,-11 36,-11 36,31 -36,31" fill="#0f172a" />
              <line x1="-30" y1="0" x2="30" y2="0" stroke="#38bdf8" strokeWidth="1.5" opacity="0.8" />
              <line x1="-30" y1="12" x2="10" y2="12" stroke="#34d399" strokeWidth="1" opacity="0.7" />
              <line x1="-30" y1="22" x2="20" y2="22" stroke="#fbbf24" strokeWidth="1" opacity="0.7" />
              <text x="0" y="-3" fill="#94a3b8" fontSize="6" textAnchor="middle" fontWeight="bold">TASK ROADMAP</text>
            </g>

            {/* Left Corner Server Cabinet */}
            <g transform="translate(-290, 70)">
              {/* Server rack box */}
              <polygon points="0,-60 30,-45 0,-30 -30,-45" fill="#334155" stroke="#475569" />
              <polygon points="30,-45 30,20 0,35 0,-30" fill="#1e293b" stroke="#475569" />
              <polygon points="-30,-45 -30,20 0,35 0,-30" fill="#0f172a" stroke="#475569" />
              {/* Blinking LEDs on server */}
              <circle cx="10" cy="-15" r="1.5" fill="#34d399" className="animate-pulse" />
              <circle cx="18" cy="-11" r="1.5" fill="#38bdf8" className="animate-pulse" />
              <circle cx="10" cy="5" r="1.5" fill="#34d399" />
              <circle cx="18" cy="9" r="1.5" fill="#f43f5e" className="animate-ping" />
            </g>

            {/* Right Corner Potted Plant */}
            <g transform="translate(300, 70)">
              <polygon points="0,0 15,7 0,15 -15,7" fill="#451a03" />
              <polygon points="15,7 15,22 0,30 0,15" fill="#291104" />
              <polygon points="-15,7 -15,22 0,30 0,15" fill="#1c0a02" />
              {/* Plant foliage */}
              <circle cx="0" cy="-8" r="14" fill="#065f46" opacity="0.9" />
              <circle cx="-6" cy="-16" r="11" fill="#047857" opacity="0.9" />
              <circle cx="6" cy="-18" r="12" fill="#10b981" opacity="0.8" />
              <circle cx="0" cy="-24" r="9" fill="#34d399" opacity="0.8" />
            </g>
          </g>

          {/* Interactive Workstations */}
          {Object.entries(WORKSTATION_CONFIG).map(([id, conf]) => {
            const agent = getAgentData(id);
            const pos = toScreen(conf.gridX, conf.gridY);
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
                onClick={() => handleDeskClick(id)}
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
                    {/* Chair */}
                    <ellipse cx="0" cy="-8" rx="14" ry="7" fill="#1e1b4b" />
                    <polygon points="-12,-8 12,-8 10,-32 -10,-32" fill="#0f172a" stroke="#312e81" strokeWidth="1.5" />
                    {/* Desk base */}
                    <polygon points="0,-10 46,13 0,36 -46,13" fill="url(#woodGrad)" stroke="#78350f" strokeWidth="1.5" />
                    <polygon points="46,13 46,26 0,49 0,36" fill="#1c0d02" />
                    <polygon points="-46,13 -46,26 0,49 0,36" fill="#0f0701" />
                    {/* Golden accent bar */}
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
                    {/* Chair */}
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#064e3b" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#022c22" stroke="#10b981" strokeWidth="1.5" />
                    {/* Desk surface */}
                    <polygon points="0,-8 48,16 0,40 -48,16" fill="url(#metalGrad)" stroke="#475569" strokeWidth="1.5" />
                    <polygon points="48,16 48,28 0,52 0,40" fill="#0f172a" />
                    <polygon points="-48,16 -48,28 0,52 0,40" fill="#090d16" />
                    {/* Triple Monitors */}
                    {/* Center Screen */}
                    <polygon points="-14,-2 14,-2 14,-24 -14,-24" fill="url(#screenCodeGrad)" stroke="#10b981" strokeWidth="1.2" />
                    {/* Left Angled Screen */}
                    <polygon points="-36,8 -16,-1 -16,-23 -36,-14" fill="#022c22" stroke="#10b981" strokeWidth="1" />
                    {/* Right Angled Screen */}
                    <polygon points="16,-1 36,8 36,-14 16,-23" fill="#022c22" stroke="#10b981" strokeWidth="1" />
                    {/* Matrix Code lines */}
                    <line x1="-10" y1="-18" x2="10" y2="-18" stroke="#34d399" strokeWidth="1" opacity="0.8" />
                    <line x1="-10" y1="-12" x2="6" y2="-12" stroke="#34d399" strokeWidth="1" opacity="0.8" />
                    <line x1="-10" y1="-6" x2="12" y2="-6" stroke="#34d399" strokeWidth="1" opacity="0.8" />
                    {/* Keyboard with RGB Glow */}
                    <polygon points="-12,12 12,12 10,18 -10,18" fill="#0f172a" stroke="#10b981" strokeWidth="0.8" />
                  </g>
                )}

                {conf.deskType === 'art' && (
                  /* Artist: Creative Drafting Tablet & Palette Desk */
                  <g id="artist-desk">
                    {/* Stool */}
                    <ellipse cx="0" cy="-6" rx="12" ry="6" fill="#831843" />
                    {/* Drafting Desk */}
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#334155" stroke="#ec4899" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#1e293b" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#0f172a" />
                    {/* Large Drawing Tablet (Cintiq style) tilted */}
                    <polygon points="-18,4 18,4 14,-18 -14,-18" fill="url(#screenArtGrad)" stroke="#ec4899" strokeWidth="1.5" />
                    {/* Stylus */}
                    <line x1="5" y1="1" x2="15" y2="7" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" />
                    {/* 3D Wireframe preview icon floating */}
                    <circle cx="28" cy="-5" r="7" fill="none" stroke="#f472b6" strokeWidth="1" strokeDasharray="2 2" className="animate-spin" />
                  </g>
                )}

                {conf.deskType === 'ops' && (
                  /* DevOps: Terminal Desk & Server Rack Unit */
                  <g id="ops-desk">
                    {/* Chair */}
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#1e3a8a" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#0f172a" stroke="#3b82f6" strokeWidth="1.5" />
                    {/* Desk */}
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#1e293b" stroke="#3b82f6" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#0f172a" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#090d16" />
                    {/* Dual Terminal Monitors */}
                    <polygon points="-24,0 -2,-11 -2,-32 -24,-21" fill="url(#screenOpsGrad)" stroke="#3b82f6" strokeWidth="1.2" />
                    <polygon points="2,-11 24,0 24,-21 2,-32" fill="url(#screenOpsGrad)" stroke="#3b82f6" strokeWidth="1.2" />
                    {/* System load metric graph bar */}
                    <line x1="-20" y1="-14" x2="-6" y2="-21" stroke="#60a5fa" strokeWidth="1.5" />
                    <line x1="6" y1="-21" x2="20" y2="-14" stroke="#60a5fa" strokeWidth="1.5" />
                  </g>
                )}

                {conf.deskType === 'qa' && (
                  /* QA: Testing Workstation & Verification Terminal */
                  <g id="qa-desk">
                    {/* Chair */}
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#164e63" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#083344" stroke="#06b6d4" strokeWidth="1.5" />
                    {/* Desk */}
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#1e293b" stroke="#06b6d4" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#0f172a" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#090d16" />
                    {/* Test Console Monitor */}
                    <polygon points="-18,0 18,0 15,-22 -15,-22" fill="url(#screenQaGrad)" stroke="#06b6d4" strokeWidth="1.5" />
                    {/* Pass/Fail indicator checks */}
                    <circle cx="-8" cy="-11" r="2.5" fill="#34d399" />
                    <circle cx="0" cy="-11" r="2.5" fill="#34d399" />
                    <circle cx="8" cy="-11" r="2.5" fill="#38bdf8" />
                    {/* Diagnostic pad */}
                    <polygon points="-28,14 -12,22 -16,28 -32,20" fill="#f8fafc" stroke="#64748b" strokeWidth="1" />
                  </g>
                )}

                {conf.deskType === 'web' && (
                  /* WebDev: Browser Window, Component Grid & Device Preview */
                  <g id="webdev-desk">
                    {/* Chair */}
                    <ellipse cx="0" cy="-6" rx="14" ry="7" fill="#0c4a6e" />
                    <polygon points="-10,-6 10,-6 9,-28 -9,-28" fill="#082f49" stroke="#0ea5e9" strokeWidth="1.5" />
                    {/* Desk */}
                    <polygon points="0,-8 46,15 0,38 -46,15" fill="#1e293b" stroke="#0ea5e9" strokeWidth="1.5" />
                    <polygon points="46,15 46,26 0,49 0,38" fill="#0f172a" />
                    <polygon points="-46,15 -46,26 0,49 0,38" fill="#090d16" />
                    {/* Wide browser monitor with tab bar */}
                    <polygon points="-22,0 22,0 22,-26 -22,-26" fill="url(#screenWebGrad)" stroke="#0ea5e9" strokeWidth="1.2" />
                    <rect x="-22" y="-26" width="44" height="5" fill="#0369a1" />
                    <circle cx="-18" cy="-23.5" r="1.1" fill="#f87171" />
                    <circle cx="-14.5" cy="-23.5" r="1.1" fill="#fbbf24" />
                    <circle cx="-11" cy="-23.5" r="1.1" fill="#34d399" />
                    {/* Component layout blocks */}
                    <rect x="-18" y="-18" width="16" height="6" rx="1" fill="#38bdf8" opacity="0.85" />
                    <rect x="1" y="-18" width="17" height="6" rx="1" fill="#818cf8" opacity="0.75" />
                    <rect x="-18" y="-9" width="36" height="5" rx="1" fill="#22d3ee" opacity="0.6" />
                    {/* Phone preview for responsive testing */}
                    <rect x="27" y="2" width="8" height="14" rx="1.5" fill="#0f172a" stroke="#38bdf8" strokeWidth="1" />
                    <rect x="28.5" y="4" width="5" height="9" fill="#0ea5e9" opacity="0.7" />
                  </g>
                )}

                {/* --- AVATAR FIGURE SEATED AT WORKSTATION --- */}
                <g id="avatar" transform="translate(0, -12)">
                  {/* Avatar Body / Torso */}
                  <ellipse cx="0" cy="-16" rx="10" ry="12" fill={conf.accentColor} opacity="0.9" />
                  {/* Avatar Head */}
                  <circle cx="0" cy="-33" r="8.5" fill="#f8fafc" stroke="#0f172a" strokeWidth="1.5" />
                  {/* Avatar Face/Visor */}
                  <rect x="-4" y="-35" width="8" height="3" rx="1.5" fill="#0f172a" />

                  {/* Typing Hand Motion Animation when Status is 'Working' */}
                  {isWorking && (
                    <g className="animate-typing">
                      <circle cx="-6" cy="-4" r="2.5" fill="#f8fafc" />
                      <circle cx="6" cy="-4" r="2.5" fill="#f8fafc" />
                    </g>
                  )}
                </g>

                {/* --- FLOATING STATUS BUBBLE & AGENT LABEL --- */}
                <g id="floating-status" transform="translate(0, -68)">
                  {/* Name Banner Pill */}
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
                  {/* Status Indicator Dot */}
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

                  {/* Profile Name & Status text */}
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

          {/* Workflow quick-preview popover for the clicked desk */}
          {popoverAgent && popoverAssignment && popoverPos && (
            <foreignObject
              x={popoverPos.x + 60 + POPOVER_W > 460 ? popoverPos.x - 60 - POPOVER_W : popoverPos.x + 60}
              y={Math.max(-255, popoverPos.y - 150)}
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
                      onOpenWorkflow?.(popoverAssignment.run_id, popoverAssignment.node,
                        popoverAgent.profile_name);
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
