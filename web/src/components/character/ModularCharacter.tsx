import React from 'react';
import {
  CharacterPose,
  CharacterSkin,
  ModularCharacterProps,
} from './characterTypes';
import './modularCharacter.scss';

interface SubPartProps {
  skin: CharacterSkin;
  pose: CharacterPose;
  isSleeping: boolean;
}

/**
 * Swappable Head Rig based on skin.headType and skin.features
 */
export const ModularHead: React.FC<SubPartProps> = ({ skin, isSleeping }) => {
  const { headType, primaryColor, accentColor, jointColor, features = {} } = skin;

  return (
    <g className="char-head-group">
      {/* Corrugated Neck Pivot */}
      <rect x="-4" y="-31" width="8" height="3" rx="1" fill="#334155" />
      <line x1="-3" y1="-29.5" x2="3" y2="-29.5" stroke="#64748b" strokeWidth="0.8" />

      {/* Head Chassis per headType */}
      {headType === 'crown' && (
        <g id={`head-crown-${skin.id}`}>
          {/* Executive Helm Base */}
          <rect
            x="-9"
            y="-44"
            width="18"
            height="13"
            rx="3"
            fill={primaryColor}
            stroke={jointColor}
            strokeWidth="1.2"
          />
          {/* Eyepiece Plate */}
          <rect
            x="-7"
            y="-40"
            width="14"
            height="6"
            rx="2"
            fill="#1e1b4b"
            stroke={accentColor}
            strokeWidth="0.8"
          />
          {/* Optics / Eyes */}
          {!isSleeping ? (
            <g className="char-eye-active">
              <circle cx="-3.5" cy="-37" r="1.8" fill={accentColor} />
              <circle cx="3.5" cy="-37" r="1.8" fill={accentColor} />
            </g>
          ) : (
            <g className="char-eye-closed">
              <line x1="-5" y1="-37" x2="-2" y2="-37" stroke={accentColor} strokeWidth="1" strokeLinecap="round" />
              <line x1="2" y1="-37" x2="5" y2="-37" stroke={accentColor} strokeWidth="1" strokeLinecap="round" />
            </g>
          )}
          {/* Tyler's Monocle */}
          {features.monocle && (
            <g className="char-monocle">
              <circle cx="3.5" cy="-37" r="2.8" fill="none" stroke="#fbbf24" strokeWidth="0.8" />
              <line x1="6.3" y1="-37" x2="8" y2="-33" stroke="#fbbf24" strokeWidth="0.6" />
            </g>
          )}
          {/* Tyler's Golden Crown */}
          {features.crown && (
            <g className="char-crown">
              <path
                d="M -7,-44 L -4,-51 L 0,-47 L 4,-51 L 7,-44"
                fill="none"
                stroke={accentColor}
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="0" cy="-47" r="1.2" fill={accentColor} />
            </g>
          )}
          {features.antennaOrb && !features.crown && (
            <g className="char-antenna">
              <line x1="0" y1="-44" x2="0" y2="-50" stroke={accentColor} strokeWidth="1" />
              <circle cx="0" cy="-50" r="1.4" fill={accentColor} />
            </g>
          )}
        </g>
      )}

      {headType === 'crt' && (
        <g id={`head-crt-${skin.id}`}>
          {/* Vintage 4:3 CRT Housing */}
          <rect
            x="-10"
            y="-45"
            width="20"
            height="14"
            rx="2.5"
            fill={primaryColor}
            stroke={jointColor}
            strokeWidth="1.2"
          />
          {/* Phosphor Screen */}
          <rect
            x="-8"
            y="-43"
            width="16"
            height="10"
            rx="1.5"
            fill="#022c22"
            stroke={accentColor}
            strokeWidth="0.8"
          />
          {/* Matrix Screen Glyphs or Eye Wave */}
          {!isSleeping ? (
            <g className="char-screen-glow char-eye-active">
              {features.crtGlyphs ? (
                <text
                  x="0"
                  y="-36.5"
                  textAnchor="middle"
                  fill={accentColor}
                  fontSize="4.5"
                  fontWeight="bold"
                  fontFamily="monospace"
                  letterSpacing="0.2"
                >
                  {features.crtGlyphs}
                </text>
              ) : (
                <path
                  d="M -6,-38 L -3,-40 L 0,-36 L 3,-40 L 6,-38"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="1.2"
                />
              )}
            </g>
          ) : (
            <g className="char-eye-closed">
              <line x1="-5" y1="-38" x2="5" y2="-38" stroke={accentColor} strokeWidth="1" strokeDasharray="1.5 1.5" />
            </g>
          )}
          {/* Top Comms Antenna */}
          {features.antennaOrb && (
            <g className="char-antenna">
              <line x1="0" y1="-45" x2="0" y2="-52" stroke={accentColor} strokeWidth="1" />
              <circle cx="0" cy="-52" r="1.5" fill={accentColor} />
            </g>
          )}
        </g>
      )}

      {headType === 'lens' && (
        <g id={`head-lens-${skin.id}`}>
          {/* Spherical Turret Base */}
          <circle cx="0" cy="-38" r="8" fill={primaryColor} stroke={jointColor} strokeWidth="1.2" />
          {/* Multi-Lens Revolver Array */}
          <circle cx="-2.5" cy="-39" r="3.2" fill="#831843" stroke="#f472b6" strokeWidth="1" />
          {!isSleeping ? (
            <circle cx="-2.5" cy="-39" r="1.8" fill={accentColor} className="char-eye-active" />
          ) : (
            <line x1="-4" y1="-39" x2="-1" y2="-39" stroke={accentColor} strokeWidth="1" />
          )}
          <circle cx="3.5" cy="-36.5" r="2" fill="#831843" stroke="#f472b6" strokeWidth="0.8" />
          <circle cx="3.5" cy="-36.5" r="1" fill={accentColor} opacity={isSleeping ? 0.3 : 1} />
          {/* Stylus / Loupe Feature */}
          {features.loupe && (
            <g className="char-loupe">
              <line x1="4" y1="-44" x2="9" y2="-51" stroke={accentColor} strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="9" cy="-51" r="1.4" fill="#f472b6" />
            </g>
          )}
        </g>
      )}

      {headType === 'server' && (
        <g id={`head-server-${skin.id}`}>
          {/* Armored Server Blade Helm */}
          <polygon
            points="-9,-32 9,-32 8,-44 -8,-44"
            fill={primaryColor}
            stroke={jointColor}
            strokeWidth="1.2"
          />
          {/* Horizontal Status Visor */}
          <rect
            x="-6"
            y="-39"
            width="12"
            height="3"
            rx="1"
            fill="#1e3a8a"
            stroke={accentColor}
            strokeWidth="0.8"
          />
          {!isSleeping ? (
            <line
              x1="-5"
              y1="-37.5"
              x2="5"
              y2="-37.5"
              stroke="#93c5fd"
              strokeWidth="1.2"
              className="char-eye-active"
            />
          ) : (
            <line x1="-2" y1="-37.5" x2="2" y2="-37.5" stroke="#93c5fd" strokeWidth="0.8" opacity="0.4" />
          )}
          {/* Status LEDs */}
          <circle cx="-5" cy="-41.5" r="0.8" fill="#22c55e" />
          <circle cx="-2.5" cy="-41.5" r="0.8" fill="#eab308" />
          <circle cx="0" cy="-41.5" r="0.8" fill={accentColor} />
          {/* Twin Cooling Exhaust Chimneys */}
          {features.dualExhaust && (
            <g className="char-dual-exhaust">
              <rect x="-7" y="-48" width="3" height="4" fill="#1e293b" stroke={accentColor} strokeWidth="0.8" />
              <rect x="4" y="-48" width="3" height="4" fill="#1e293b" stroke={accentColor} strokeWidth="0.8" />
              {/* Subtle steam / heat vent lines */}
              <line x1="-5.5" y1="-49" x2="-5.5" y2="-51" stroke="#94a3b8" strokeWidth="0.6" strokeDasharray="1 1" />
              <line x1="5.5" y1="-49" x2="5.5" y2="-51" stroke="#94a3b8" strokeWidth="0.6" strokeDasharray="1 1" />
            </g>
          )}
        </g>
      )}

      {headType === 'scanner' && (
        <g id={`head-scanner-${skin.id}`}>
          {/* Cylindrical Scanner Drum */}
          <rect
            x="-8.5"
            y="-44"
            width="17"
            height="13"
            rx="4"
            fill={primaryColor}
            stroke={jointColor}
            strokeWidth="1.2"
          />
          {/* Crosshair Ocular Loupe */}
          <circle cx="0" cy="-37.5" r="4.5" fill="#0e7490" stroke={accentColor} strokeWidth="1" />
          {!isSleeping ? (
            <>
              <circle cx="0" cy="-37.5" r="2.2" fill={accentColor} className="char-eye-active" />
              {features.loupe && (
                <>
                  <line x1="-3" y1="-37.5" x2="3" y2="-37.5" stroke="#cffafe" strokeWidth="0.8" />
                  <line x1="0" y1="-40.5" x2="0" y2="-34.5" stroke="#cffafe" strokeWidth="0.8" />
                </>
              )}
            </>
          ) : (
            <line x1="-2.5" y1="-37.5" x2="2.5" y2="-37.5" stroke="#cffafe" strokeWidth="1" />
          )}
          {/* Side Sensor Fin */}
          <polygon points="8.5,-40 12,-38 8.5,-36" fill={accentColor} />
        </g>
      )}

      {headType === 'dome' && (
        <g id={`head-dome-${skin.id}`}>
          {/* Glass Celestial Globe Dome */}
          <circle cx="0" cy="-38" r="7.5" fill={primaryColor} stroke={jointColor} strokeWidth="1.2" />
          {/* Internal Floating Satellite Core */}
          {!isSleeping ? (
            <circle cx="0" cy="-38" r="3.2" fill={accentColor} className="char-eye-active" />
          ) : (
            <circle cx="0" cy="-38" r="2" fill={accentColor} opacity="0.3" />
          )}
          {/* Orbital Wire Ring */}
          <ellipse
            cx="0"
            cy="-38"
            rx="9"
            ry="3.5"
            fill="none"
            stroke="#7dd3fc"
            strokeWidth="0.8"
            transform="rotate(-20 0 -38)"
          />
          {/* Miniature Dish Antenna */}
          {features.antennaOrb && (
            <g className="char-antenna">
              <line x1="-3" y1="-45" x2="-6" y2="-51" stroke={accentColor} strokeWidth="1" />
              <path d="M -8,-53 A 3 3 0 0 1 -4,-49" fill="none" stroke={accentColor} strokeWidth="1.2" />
            </g>
          )}
        </g>
      )}

      {headType === 'standard' && (
        <g id={`head-standard-${skin.id}`}>
          {/* Standard Automaton Chassis */}
          <rect
            x="-8"
            y="-43"
            width="16"
            height="12"
            rx="3"
            fill={primaryColor}
            stroke={jointColor}
            strokeWidth="1.2"
          />
          <rect
            x="-6"
            y="-39"
            width="12"
            height="3.5"
            rx="1"
            fill="#0f172a"
            stroke={accentColor}
            strokeWidth="0.8"
          />
          {!isSleeping ? (
            <circle cx="0" cy="-37.2" r="1.5" fill={accentColor} className="char-eye-active" />
          ) : (
            <line x1="-3" y1="-37.2" x2="3" y2="-37.2" stroke={accentColor} strokeWidth="0.8" />
          )}
          <line x1="0" y1="-43" x2="0" y2="-48" stroke={jointColor} strokeWidth="1" />
          <circle cx="0" cy="-48" r="1.2" fill={accentColor} />
        </g>
      )}

      {/* Floating zZz bubbles during seated_sleep */}
      {isSleeping && (
        <g className="char-sleep-bubbles">
          <text x="6" y="-50" className="char-zzz zzz-1" fontSize="6">z</text>
          <text x="11" y="-56" className="char-zzz zzz-2" fontSize="8">Z</text>
          <text x="16" y="-64" className="char-zzz zzz-3" fontSize="10">Z</text>
        </g>
      )}
    </g>
  );
};

/**
 * Torso (central pivot) with chest plate, rivets & core indicators
 */
export const ModularTorso: React.FC<SubPartProps> = ({ skin }) => {
  const { primaryColor, accentColor, jointColor } = skin;

  return (
    <g className="char-torso-group">
      {/* Lower Hip Swivel Pivot */}
      <rect x="-6" y="-12" width="12" height="5" rx="2" fill="#0f172a" stroke={jointColor} strokeWidth="1" />
      <circle cx="0" cy="-9.5" r="1.8" fill={jointColor} />

      {/* Main Machined Chassis Block */}
      <path
        d="M -11,-12 L 11,-12 L 13,-28 L -13,-28 Z"
        fill={primaryColor}
        stroke={jointColor}
        strokeWidth="1.2"
      />

      {/* Chest Accent Plate */}
      <rect
        x="-8"
        y="-26"
        width="16"
        height="11"
        rx="1.5"
        fill="#0f172a"
        stroke={jointColor}
        strokeWidth="0.8"
      />

      {/* Plate Rivets */}
      <circle cx="-6" cy="-24" r="0.8" fill="#94a3b8" />
      <circle cx="6" cy="-24" r="0.8" fill="#94a3b8" />
      <circle cx="-6" cy="-17" r="0.8" fill="#94a3b8" />
      <circle cx="6" cy="-17" r="0.8" fill="#94a3b8" />

      {/* Core Power Crystal / Beacon */}
      <circle cx="0" cy="-20.5" r="2.5" fill={accentColor} stroke="#ffffff" strokeWidth="0.4" />
    </g>
  );
};

/**
 * Upper Limbs: Left & Right Manipulators (shoulder, elbow, hand)
 */
export const ModularArms: React.FC<SubPartProps> = ({ skin, pose }) => {
  const { accentColor, jointColor } = skin;
  const isWorking = pose === 'seated_work';

  return (
    <>
      {/* Arm Left (Shoulder -> Elbow -> Hand) */}
      <g className="char-arm char-arm-left">
        {/* Shoulder Joint Pivot */}
        <circle cx="-13" cy="-25" r="2.2" fill="#334155" stroke={jointColor} strokeWidth="0.8" />
        {/* Upper Arm Segment */}
        <line
          x1="-13"
          y1="-25"
          x2="-18"
          y2={isWorking ? '-17' : '-15'}
          stroke="#475569"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Elbow Joint */}
        <circle cx="-18" cy={isWorking ? -17 : -15} r="1.8" fill="#1e293b" stroke={jointColor} strokeWidth="0.6" />
        {/* Forearm & Tool Clamp */}
        <line
          x1="-18"
          y1={isWorking ? '-17' : '-15'}
          x2="-10"
          y2={isWorking ? '-7' : '-6'}
          stroke="#64748b"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Gripper Hand / Tooltip */}
        <circle cx="-9" cy={isWorking ? -7 : -5} r="1.6" fill={accentColor} />
      </g>

      {/* Arm Right (Shoulder -> Elbow -> Hand) */}
      <g className="char-arm char-arm-right">
        {/* Shoulder Joint Pivot */}
        <circle cx="13" cy="-25" r="2.2" fill="#334155" stroke={jointColor} strokeWidth="0.8" />
        {/* Upper Arm Segment */}
        <line
          x1="13"
          y1="-25"
          x2="18"
          y2={isWorking ? '-17' : '-15'}
          stroke="#475569"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Elbow Joint */}
        <circle cx="18" cy={isWorking ? -17 : -15} r="1.8" fill="#1e293b" stroke={jointColor} strokeWidth="0.6" />
        {/* Forearm & Tool Clamp */}
        <line
          x1="18"
          y1={isWorking ? '-17' : '-15'}
          x2="10"
          y2={isWorking ? '-7' : '-6'}
          stroke="#64748b"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Gripper Hand / Tooltip */}
        <circle cx="9" cy={isWorking ? -7 : -5} r="1.6" fill={accentColor} />
      </g>
    </>
  );
};

/**
 * Lower Limbs: Left & Right Legs (hip, knee, foot)
 */
export const ModularLegs: React.FC<SubPartProps> = ({ skin, pose }) => {
  const { accentColor, jointColor } = skin;
  const isSeated = pose.startsWith('seated');

  return (
    <>
      {/* Left Leg */}
      <g className="char-leg char-leg-left">
        {/* Hip Joint */}
        <circle cx="-5.5" cy="-10" r="1.8" fill="#1e293b" stroke={jointColor} strokeWidth="0.8" />
        {/* Thigh */}
        <line
          x1="-5.5"
          y1="-10"
          x2="-5.5"
          y2={isSeated ? '-5' : '-4'}
          stroke="#334155"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* Knee Joint */}
        <circle cx="-5.5" cy={isSeated ? -5 : -4} r="1.5" fill={jointColor} />
        {/* Shin & Foot */}
        <line
          x1="-5.5"
          y1={isSeated ? '-5' : '-4'}
          x2={isSeated ? '-7' : '-5.5'}
          y2={isSeated ? '-1' : '2'}
          stroke="#475569"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x={isSeated ? '-9' : '-7.5'}
          y={isSeated ? '-2' : '1'}
          width="4.5"
          height="2.2"
          rx="1"
          fill={accentColor}
        />
      </g>

      {/* Right Leg */}
      <g className="char-leg char-leg-right">
        {/* Hip Joint */}
        <circle cx="5.5" cy="-10" r="1.8" fill="#1e293b" stroke={jointColor} strokeWidth="0.8" />
        {/* Thigh */}
        <line
          x1="5.5"
          y1="-10"
          x2="5.5"
          y2={isSeated ? '-5' : '-4'}
          stroke="#334155"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* Knee Joint */}
        <circle cx="5.5" cy={isSeated ? -5 : -4} r="1.5" fill={jointColor} />
        {/* Shin & Foot */}
        <line
          x1="5.5"
          y1={isSeated ? '-5' : '-4'}
          x2={isSeated ? '7' : '5.5'}
          y2={isSeated ? '-1' : '2'}
          stroke="#475569"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x={isSeated ? '4.5' : '3'}
          y={isSeated ? '-2' : '1'}
          width="4.5"
          height="2.2"
          rx="1"
          fill={accentColor}
        />
      </g>
    </>
  );
};

export interface ModularCharacterExtendedProps extends ModularCharacterProps {
  facing?: 'left' | 'right';
  style?: React.CSSProperties;
}

/**
 * Modular Character Cutout Rig
 * Autonomous skeletal character with swappable skins,
 * hardware-accelerated keyframe animation cycles, and direction mirroring.
 */
export const ModularCharacter: React.FC<ModularCharacterExtendedProps> = ({
  skin,
  pose = 'seated_idle',
  direction = 'down_iso',
  facing,
  isSelected = false,
  scale = 1,
  className = '',
  onClick,
  style,
}) => {
  const isSleeping = pose === 'seated_sleep';

  // Respect direction: 'left' or facing === 'left' applies horizontal mirroring
  const effectiveFacing = facing || (direction === 'left' ? 'left' : 'right');
  const isFacingLeft = effectiveFacing === 'left';

  const dirClass = isFacingLeft ? 'dir-left' : `dir-${direction}`;
  const poseClass = `pose-${pose}`;

  const subProps: SubPartProps = {
    skin,
    pose,
    isSleeping,
  };

  const transformParts: string[] = [];
  if (isFacingLeft) transformParts.push('scaleX(-1)');
  if (scale !== 1) transformParts.push(`scale(${scale})`);
  const computedTransform = transformParts.length > 0 ? transformParts.join(' ') : undefined;

  return (
    <g
      className={`modular-character-root ${dirClass} ${poseClass} ${className}`.trim()}
      data-agent={skin.id}
      data-pose={pose}
      data-direction={direction}
      data-facing={effectiveFacing}
      data-testid={`modular-character-${skin.id}`}
      onClick={onClick}
      style={{
        transform: computedTransform,
        ...style,
      }}
    >
      {/* Ground Shadow */}
      <ellipse cx="0" cy="1" rx="13" ry="5.5" fill="#000000" opacity="0.32" />

      {/* Selection Glow Footprint */}
      {isSelected && (
        <ellipse
          cx="0"
          cy="1"
          rx="18"
          ry="8"
          fill="none"
          stroke={skin.accentColor}
          strokeWidth="1.5"
          strokeDasharray="4 2"
          className="char-selection-halo"
        />
      )}

      {/* Lower Limbs (hip, knee, foot) */}
      <ModularLegs {...subProps} />

      {/* Torso Central Pivot */}
      <ModularTorso {...subProps} />

      {/* Upper Limbs (shoulder, elbow, hand) */}
      <ModularArms {...subProps} />

      {/* Head & Visor Sensory Array */}
      <ModularHead {...subProps} />
    </g>
  );
};

export default ModularCharacter;
