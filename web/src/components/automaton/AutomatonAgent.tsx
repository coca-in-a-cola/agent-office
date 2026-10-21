import React from 'react';

interface AutomatonAgentProps {
  agentId: string;
  status: string;
  accentColor: string;
  deskType: 'executive' | 'art' | 'code' | 'ops' | 'qa' | 'web';
  isWorking: boolean;
  isSelected: boolean;
}

export const AutomatonAgent: React.FC<AutomatonAgentProps> = ({
  agentId,
  status,
  accentColor,
  deskType,
  isWorking,
  isSelected,
}) => {
  const normStatus = status.toLowerCase();
  const isBlocked = normStatus === 'blocked' || normStatus === 'error';
  const statusClass = isWorking ? 'status-working' : isBlocked ? 'status-blocked' : 'status-idle';

  return (
    <g
      className={`automaton-root ${statusClass}`}
      transform="translate(0, -10)"
      data-agent={agentId}
      data-testid={`automaton-${agentId}`}
    >
      {/* Selection Glow Footprint */}
      {isSelected && (
        <ellipse
          cx="0"
          cy="-4"
          rx="18"
          ry="9"
          fill="none"
          stroke={accentColor}
          strokeWidth="1.5"
          strokeDasharray="4 2"
          opacity="0.8"
        />
      )}

      {/* Main Articulated Chassis Group */}
      <g className="automaton-chassis">
        {/* Shadow under seat/chassis */}
        <ellipse cx="0" cy="-6" rx="12" ry="6" fill="#000000" opacity="0.4" />

        {/* Lower Hip / Swivel Pivot */}
        <rect x="-6" y="-12" width="12" height="6" rx="2" fill="#0f172a" stroke="#334155" strokeWidth="1" />
        <circle cx="0" cy="-9" r="2" fill="#475569" />

        {/* Torso / Heavy Machined Chassis */}
        <path
          d="M -11,-12 L 11,-12 L 13,-28 L -13,-28 Z"
          fill="#1e293b"
          stroke={isSelected ? accentColor : '#475569'}
          strokeWidth="1.2"
        />
        {/* Chest Accent Plate & Rivets */}
        <rect x="-8" y="-26" width="16" height="11" rx="1.5" fill="#0f172a" stroke="#334155" strokeWidth="0.8" />
        <circle cx="-6" cy="-24" r="0.8" fill="#94a3b8" />
        <circle cx="6" cy="-24" r="0.8" fill="#94a3b8" />
        <circle cx="-6" cy="-17" r="0.8" fill="#94a3b8" />
        <circle cx="6" cy="-17" r="0.8" fill="#94a3b8" />

        {/* Role-Specific Chest Feature */}
        {deskType === 'executive' && (
          /* Tyler: Golden Ticker Tape Meter */
          <g>
            <rect x="-5" y="-23" width="10" height="5" fill="#451a03" stroke="#f59e0b" strokeWidth="0.8" />
            <line x1="-3" y1="-20.5" x2="3" y2="-20.5" stroke="#fbbf24" strokeWidth="1" strokeDasharray="1 1" />
          </g>
        )}

        {deskType === 'code' && (
          /* Coder: Dual Core Memory Tubes */
          <g>
            <rect x="-5" y="-23" width="4" height="6" rx="1" fill="#064e3b" stroke="#10b981" strokeWidth="0.6" />
            <rect x="1" y="-23" width="4" height="6" rx="1" fill="#064e3b" stroke="#10b981" strokeWidth="0.6" />
            <circle cx="-3" cy="-20" r="1" fill="#34d399" />
            <circle cx="3" cy="-20" r="1" fill="#34d399" />
          </g>
        )}

        {deskType === 'art' && (
          /* Artist: Spectrum Core Crystal */
          <polygon
            points="0,-24 4,-20 0,-16 -4,-20"
            fill="#ec4899"
            stroke="#fbcfe8"
            strokeWidth="0.8"
            className="automaton-lens"
          />
        )}

        {deskType === 'ops' && (
          /* DevOps: Rack Exhaust Grill */
          <g>
            <line x1="-5" y1="-23" x2="5" y2="-23" stroke="#3b82f6" strokeWidth="1" />
            <line x1="-5" y1="-20.5" x2="5" y2="-20.5" stroke="#3b82f6" strokeWidth="1" />
            <line x1="-5" y1="-18" x2="5" y2="-18" stroke="#3b82f6" strokeWidth="1" />
          </g>
        )}

        {deskType === 'qa' && (
          /* QA: Pulse Radar Dial */
          <g>
            <circle cx="0" cy="-20.5" r="3.5" fill="#083344" stroke="#06b6d4" strokeWidth="0.8" />
            <circle cx="0" cy="-20.5" r="1.5" fill="#22d3ee" className="automaton-lens" />
          </g>
        )}

        {deskType === 'web' && (
          /* WebDev: Fiber Optic Hub */
          <g>
            <circle cx="0" cy="-20.5" r="3" fill="#082f49" stroke="#0ea5e9" strokeWidth="0.8" />
            <circle cx="-1.5" cy="-20.5" r="0.8" fill="#38bdf8" />
            <circle cx="1.5" cy="-20.5" r="0.8" fill="#38bdf8" />
          </g>
        )}

        {/* Flexible Corrugated Neck */}
        <rect x="-4" y="-31" width="8" height="3" rx="1" fill="#334155" />
        <line x1="-3" y1="-29.5" x2="3" y2="-29.5" stroke="#64748b" strokeWidth="0.8" />

        {/* --- HEAD UNITS (Role-Tailored) --- */}
        {deskType === 'executive' && (
          /* Tyler: Crown Antenna & Brass Executive Helm */
          <g id="tyler-automaton-head">
            {/* Main Head Box */}
            <rect x="-9" y="-44" width="18" height="13" rx="3" fill="#0f172a" stroke="#d97706" strokeWidth="1.2" />
            {/* Brass Eyepiece Plate */}
            <rect x="-7" y="-40" width="14" height="6" rx="2" fill="#1e1b4b" stroke="#f59e0b" strokeWidth="1" />
            <circle cx="-3.5" cy="-37" r="1.8" fill="#fbbf24" className="automaton-lens" />
            <circle cx="3.5" cy="-37" r="1.8" fill="#fbbf24" className="automaton-lens" />
            {/* Crown Transceiver */}
            <g className="automaton-antenna">
              <path d="M -7,-44 L -4,-51 L 0,-47 L 4,-51 L 7,-44" fill="none" stroke="#f59e0b" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="0" cy="-47" r="1.2" fill="#fbbf24" />
            </g>
          </g>
        )}

        {deskType === 'code' && (
          /* Coder: 4:3 CRT Terminal Screen Head */
          <g id="coder-automaton-head">
            {/* CRT Housing */}
            <rect x="-10" y="-45" width="20" height="14" rx="2.5" fill="#0f172a" stroke="#059669" strokeWidth="1.2" />
            {/* Phosphor Screen */}
            <rect x="-8" y="-43" width="16" height="10" rx="1.5" fill="#022c22" stroke="#10b981" strokeWidth="0.8" />
            {/* Matrix Glyph Wave / Eye Scan */}
            <path
              d="M -6,-38 L -3,-40 L 0,-36 L 3,-40 L 6,-38"
              fill="none"
              stroke="#34d399"
              strokeWidth="1.2"
              className="automaton-screen-glow"
            />
            {/* Antenna with green beacon */}
            <g className="automaton-antenna">
              <line x1="0" y1="-45" x2="0" y2="-52" stroke="#10b981" strokeWidth="1" />
              <circle cx="0" cy="-52" r="1.5" fill="#34d399" className="automaton-lens" />
            </g>
          </g>
        )}

        {deskType === 'art' && (
          /* Artist: Optical Turret Head with Aperture Lenses */
          <g id="artist-automaton-head">
            {/* Spherical Base */}
            <circle cx="0" cy="-38" r="8" fill="#1e293b" stroke="#db2777" strokeWidth="1.2" />
            {/* Multi-Lens Ocular Array */}
            <circle cx="-2.5" cy="-39" r="3.2" fill="#831843" stroke="#f472b6" strokeWidth="1" />
            <circle cx="-2.5" cy="-39" r="1.8" fill="#ec4899" className="automaton-lens" />
            <circle cx="3.5" cy="-36.5" r="2" fill="#831843" stroke="#f472b6" strokeWidth="0.8" />
            <circle cx="3.5" cy="-36.5" r="1" fill="#f472b6" />
            {/* Stylus Antenna */}
            <g className="automaton-antenna">
              <line x1="4" y1="-44" x2="9" y2="-51" stroke="#ec4899" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="9" cy="-51" r="1.4" fill="#f472b6" />
            </g>
          </g>
        )}

        {deskType === 'ops' && (
          /* DevOps: Industrial Server Block Head with Dual Exhaust */
          <g id="devops-automaton-head">
            {/* Armored Helmet */}
            <polygon
              points="-9,-32 9,-32 8,-44 -8,-44"
              fill="#0f172a"
              stroke="#2563eb"
              strokeWidth="1.2"
            />
            {/* Horizontal Blue Visor */}
            <rect x="-6" y="-39" width="12" height="3" rx="1" fill="#1e3a8a" stroke="#60a5fa" strokeWidth="0.8" />
            <line x1="-5" y1="-37.5" x2="5" y2="-37.5" stroke="#93c5fd" strokeWidth="1.2" className="automaton-lens" />
            {/* Dual Twin Exhaust Chimneys */}
            <rect x="-7" y="-48" width="3" height="4" fill="#1e293b" stroke="#3b82f6" strokeWidth="0.8" />
            <rect x="4" y="-48" width="3" height="4" fill="#1e293b" stroke="#3b82f6" strokeWidth="0.8" />
          </g>
        )}

        {deskType === 'qa' && (
          /* QA: Cylindrical Scanner Head with Crosshair Ocular */
          <g id="qa-automaton-head">
            {/* Main Drum */}
            <rect x="-8.5" y="-44" width="17" height="13" rx="4" fill="#083344" stroke="#0891b2" strokeWidth="1.2" />
            {/* Single Large Monocle Loupe */}
            <circle cx="0" cy="-37.5" r="4.5" fill="#0e7490" stroke="#22d3ee" strokeWidth="1" />
            <circle cx="0" cy="-37.5" r="2.2" fill="#06b6d4" className="automaton-lens" />
            {/* Crosshair ticks */}
            <line x1="-3" y1="-37.5" x2="3" y2="-37.5" stroke="#cffafe" strokeWidth="0.8" />
            <line x1="0" y1="-40.5" x2="0" y2="-34.5" stroke="#cffafe" strokeWidth="0.8" />
            {/* Side sensor fin */}
            <polygon points="8.5,-40 12,-38 8.5,-36" fill="#06b6d4" />
          </g>
        )}

        {deskType === 'web' && (
          /* WebDev: Celestial Gyroscope / Dome Head */
          <g id="webdev-automaton-head">
            {/* Glass Globe Dome */}
            <circle cx="0" cy="-38" r="7.5" fill="#0c4a6e" stroke="#0284c7" strokeWidth="1.2" />
            {/* Internal Floating Satellite Core */}
            <circle cx="0" cy="-38" r="3.2" fill="#38bdf8" className="automaton-lens" />
            {/* Orbital Wire Ring */}
            <ellipse cx="0" cy="-38" rx="9" ry="3.5" fill="none" stroke="#7dd3fc" strokeWidth="0.8" transform="rotate(-20 0 -38)" />
            {/* Miniature Dish Antenna */}
            <g className="automaton-antenna">
              <line x1="-3" y1="-45" x2="-6" y2="-51" stroke="#38bdf8" strokeWidth="1" />
              <path d="M -8,-53 A 3 3 0 0 1 -4,-49" fill="none" stroke="#38bdf8" strokeWidth="1.2" />
            </g>
          </g>
        )}

        {/* --- ARTICULATED ROBOTIC ARMS --- */}
        {/* Left Arm */}
        <g className="automaton-arm-left">
          {/* Shoulder Pivot */}
          <circle cx="-13" cy="-25" r="2.2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
          {/* Upper Arm Segment */}
          <line x1="-13" y1="-25" x2="-18" y2="-15" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
          {/* Elbow Joint */}
          <circle cx="-18" cy="-15" r="1.8" fill="#1e293b" stroke="#94a3b8" strokeWidth="0.6" />
          {/* Forearm & Tool Clamp */}
          <line x1="-18" y1="-15" x2="-10" y2="-6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
          {/* Gripper Hand */}
          <circle cx="-9" cy="-5" r="1.6" fill={accentColor} />
        </g>

        {/* Right Arm */}
        <g className="automaton-arm-right">
          {/* Shoulder Pivot */}
          <circle cx="13" cy="-25" r="2.2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
          {/* Upper Arm Segment */}
          <line x1="13" y1="-25" x2="18" y2="-15" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
          {/* Elbow Joint */}
          <circle cx="18" cy="-15" r="1.8" fill="#1e293b" stroke="#94a3b8" strokeWidth="0.6" />
          {/* Forearm & Tool Clamp */}
          <line x1="18" y1="-15" x2="10" y2="-6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
          {/* Gripper Hand */}
          <circle cx="9" cy="-5" r="1.6" fill={accentColor} />
        </g>
      </g>
    </g>
  );
};
