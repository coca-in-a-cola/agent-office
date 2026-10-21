import { TileData } from '../../../grid/gridTypes';
import { gridToIso } from '../../../grid/gridMath';

export interface IsometricTileProps {
  tile: TileData;
  points: string;
  isHovered: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * 1. IsometricFloorTile:
 * - Base diamond polygon with bevel edge
 * - Themed surface inlays:
 *   - mahogany: parquet plank lines with rich reddish wood grain highlights
 *   - dev-grid: dark slate base with neon emerald/cyan circuit traces
 *   - creative-bay: pastel studio tile with geometric dot grid
 *   - server-noc: perforated ventilation grille with blue underglow
 *   - qa-cleanroom: sterile white clinical tile with crosshair registration marks
 *   - staging-deck: slate test mat with measurement ticks
 *   - corridor: cybernetic corridor strip with dual cyan LED conduits and directional chevron arrows
 */
export function IsometricFloorTile({
  tile,
  points,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: IsometricTileProps) {
  const { isoX, isoY } = gridToIso(tile.x, tile.y);
  const theme = tile.type === 'corridor' ? 'corridor' : tile.floorTheme || 'dev-grid';

  // Base 4 diamond vertices
  // Top: (isoX, isoY - 16)
  // Right: (isoX + 32, isoY)
  // Bottom: (isoX, isoY + 16)
  // Left: (isoX - 32, isoY)
  const leftX = isoX - 32;
  const leftY = isoY;
  const rightX = isoX + 32;
  const rightY = isoY;
  const botX = isoX;
  const botY = isoY + 16;
  const topX = isoX;
  const topY = isoY - 16;

  // 2.5D bevel skirt below bottom edges (height = 3px)
  const bevelH = 3;
  const bevelLeftPoints = `${leftX},${leftY} ${botX},${botY} ${botX},${botY + bevelH} ${leftX},${leftY + bevelH}`;
  const bevelRightPoints = `${botX},${botY} ${rightX},${rightY} ${rightX},${rightY + bevelH} ${botX},${botY + bevelH}`;

  const renderSurfaceInlay = () => {
    switch (theme) {
      case 'mahogany':
        return (
          <g id={`inlay-mahogany-${tile.x}-${tile.y}`}>
            {/* Parquet plank seam lines dividing tile into 3 parallel parquet planks */}
            <line
              x1={isoX - 16}
              y1={isoY - 8}
              x2={isoX + 16}
              y2={isoY + 8}
              stroke="#451a03"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <line
              x1={isoX - 16}
              y1={isoY - 7.5}
              x2={isoX + 16}
              y2={isoY + 8.5}
              stroke="rgba(254, 215, 170, 0.35)"
              strokeWidth="0.6"
            />

            {/* Alternating parquet transverse joints */}
            <line
              x1={isoX - 8}
              y1={isoY - 4}
              x2={isoX + 8}
              y2={isoY - 12}
              stroke="#451a03"
              strokeWidth="1"
            />
            <line
              x1={isoX - 24}
              y1={isoY + 4}
              x2={isoX - 8}
              y2={isoY + 12}
              stroke="#451a03"
              strokeWidth="1"
            />
            <line
              x1={isoX + 8}
              y1={isoY + 4}
              x2={isoX + 24}
              y2={isoY - 4}
              stroke="#451a03"
              strokeWidth="1"
            />

            {/* Reddish wood grain subtle curved highlight accents */}
            <path
              d={`M ${isoX - 20},${isoY + 1} Q ${isoX - 10},${isoY + 3} ${isoX - 4},${isoY + 6}`}
              fill="none"
              stroke="rgba(251, 191, 36, 0.4)"
              strokeWidth="0.7"
              strokeLinecap="round"
            />
            <path
              d={`M ${isoX - 2},${isoY - 9} Q ${isoX + 6},${isoY - 7} ${isoX + 14},${isoY - 3}`}
              fill="none"
              stroke="rgba(254, 215, 170, 0.4)"
              strokeWidth="0.7"
              strokeLinecap="round"
            />
            <path
              d={`M ${isoX + 2},${isoY + 5} Q ${isoX + 10},${isoY + 7} ${isoX + 20},${isoY + 2}`}
              fill="none"
              stroke="rgba(251, 191, 36, 0.35)"
              strokeWidth="0.7"
              strokeLinecap="round"
            />

            {/* Polished wood varnish gloss sheen on upper facet */}
            <polygon
              points={`${topX},${topY + 1} ${isoX + 18},${isoY - 7} ${isoX},${isoY + 2} ${isoX - 18},${isoY - 7}`}
              fill="rgba(255, 255, 255, 0.12)"
            />
          </g>
        );

      case 'dev-grid':
        return (
          <g id={`inlay-dev-grid-${tile.x}-${tile.y}`}>
            {/* Dark slate inner matrix border */}
            <polygon
              points={`${topX},${topY + 2} ${rightX - 3},${rightY} ${botX},${botY - 2} ${leftX + 3},${leftY}`}
              fill="none"
              stroke="#1e293b"
              strokeWidth="0.8"
            />

            {/* Neon Emerald circuit track 1 */}
            <path
              d={`M ${leftX + 8},${leftY - 4} L ${isoX - 6},${isoY - 7} L ${isoX + 12},${isoY - 7} L ${rightX - 8},${rightY - 4}`}
              fill="none"
              stroke="#10b981"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Neon Cyan circuit track 2 */}
            <path
              d={`M ${leftX + 12},${leftY + 6} L ${isoX - 8},${isoY + 6} L ${isoX + 6},${isoY - 1} L ${rightX - 12},${rightY + 6}`}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Circuit Solder Pads */}
            <circle cx={isoX - 6} cy={isoY - 7} r="1.5" fill="#34d399" />
            <circle cx={isoX - 6} cy={isoY - 7} r="0.7" fill="#ffffff" />
            <circle cx={isoX + 12} cy={isoY - 7} r="1.5" fill="#34d399" />
            <circle cx={isoX + 12} cy={isoY - 7} r="0.7" fill="#ffffff" />
            <circle cx={isoX - 8} cy={isoY + 6} r="1.4" fill="#22d3ee" />
            <circle cx={isoX + 6} cy={isoY - 1} r="1.4" fill="#22d3ee" />

            {/* Center Micro-SMD Component */}
            <polygon
              points={`${isoX - 4},${isoY} ${isoX},${isoY - 2} ${isoX + 4},${isoY} ${isoX},${isoY + 2}`}
              fill="#0f172a"
              stroke="#38bdf8"
              strokeWidth="0.6"
            />
          </g>
        );

      case 'creative-bay':
        return (
          <g id={`inlay-creative-bay-${tile.x}-${tile.y}`}>
            {/* Fine pastel drafting grid lines */}
            <line
              x1={isoX - 16}
              y1={isoY - 8}
              x2={isoX + 16}
              y2={isoY + 8}
              stroke="#c7d2fe"
              strokeWidth="0.6"
              strokeDasharray="2 2"
            />
            <line
              x1={isoX - 16}
              y1={isoY + 8}
              x2={isoX + 16}
              y2={isoY - 8}
              stroke="#c7d2fe"
              strokeWidth="0.6"
              strokeDasharray="2 2"
            />

            {/* Geometric studio dot grid */}
            {[
              { x: isoX - 14, y: isoY, c: '#818cf8' },
              { x: isoX - 7, y: isoY - 3.5, c: '#a78bfa' },
              { x: isoX, y: isoY - 7, c: '#ec4899' },
              { x: isoX + 7, y: isoY - 3.5, c: '#a78bfa' },
              { x: isoX + 14, y: isoY, c: '#818cf8' },
              { x: isoX - 7, y: isoY + 3.5, c: '#a78bfa' },
              { x: isoX, y: isoY + 7, c: '#ec4899' },
              { x: isoX + 7, y: isoY + 3.5, c: '#a78bfa' },
            ].map((dot, idx) => (
              <circle key={idx} cx={dot.x} cy={dot.y} r="1.2" fill={dot.c} />
            ))}

            {/* Center registration crosshair */}
            <circle cx={isoX} cy={isoY} r="3" fill="none" stroke="#818cf8" strokeWidth="0.6" />
            <line x1={isoX - 2.5} y1={isoY} x2={isoX + 2.5} y2={isoY} stroke="#6366f1" strokeWidth="0.8" />
            <line x1={isoX} y1={isoY - 2.5} x2={isoX} y2={isoY + 2.5} stroke="#6366f1" strokeWidth="0.8" />
          </g>
        );

      case 'server-noc':
        return (
          <g id={`inlay-server-noc-${tile.x}-${tile.y}`}>
            {/* Blue glowing aperture under ventilation grille */}
            <polygon
              points={`${topX},${topY + 3} ${rightX - 5},${rightY} ${botX},${botY - 3} ${leftX + 5},${leftY}`}
              fill="#0369a1"
              opacity="0.35"
            />
            <ellipse cx={isoX} cy={isoY} rx="16" ry="8" fill="#0284c7" opacity="0.45" />
            <ellipse cx={isoX} cy={isoY} rx="8" ry="4" fill="#38bdf8" opacity="0.6" />

            {/* Perforated ventilation grille slots */}
            {[-8, -4, 0, 4, 8].map((offset, i) => (
              <line
                key={`grille-${i}`}
                x1={isoX - 14 + Math.abs(offset) * 0.7}
                y1={isoY + offset * 0.5 - 2}
                x2={isoX + 14 - Math.abs(offset) * 0.7}
                y2={isoY + offset * 0.5 + 2}
                stroke="#0b0f19"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            ))}
            {[-8, -4, 0, 4, 8].map((offset, i) => (
              <line
                key={`glow-${i}`}
                x1={isoX - 13 + Math.abs(offset) * 0.7}
                y1={isoY + offset * 0.5 - 2}
                x2={isoX + 13 - Math.abs(offset) * 0.7}
                y2={isoY + offset * 0.5 + 2}
                stroke="#38bdf8"
                strokeWidth="0.6"
                strokeLinecap="round"
                opacity="0.85"
              />
            ))}

            {/* Corner chassis hex bolts */}
            <circle cx={isoX} cy={topY + 4} r="1.3" fill="#64748b" stroke="#1e293b" strokeWidth="0.5" />
            <circle cx={rightX - 6} cy={rightY} r="1.3" fill="#64748b" stroke="#1e293b" strokeWidth="0.5" />
            <circle cx={isoX} cy={botY - 4} r="1.3" fill="#64748b" stroke="#1e293b" strokeWidth="0.5" />
            <circle cx={leftX + 6} cy={leftY} r="1.3" fill="#64748b" stroke="#1e293b" strokeWidth="0.5" />
          </g>
        );

      case 'qa-cleanroom':
        return (
          <g id={`inlay-qa-cleanroom-${tile.x}-${tile.y}`}>
            {/* Quadrant divider clinical lines */}
            <line x1={topX} y1={topY + 2} x2={botX} y2={botY - 2} stroke="#cbd5e1" strokeWidth="0.7" />
            <line x1={leftX + 3} y1={leftY} x2={rightX - 3} y2={rightY} stroke="#cbd5e1" strokeWidth="0.7" />

            {/* Central Optical Calibration Target */}
            <circle cx={isoX} cy={isoY} rx={undefined} ry={undefined} r="5.5" fill="none" stroke="#0ea5e9" strokeWidth="0.8" />
            <circle cx={isoX} cy={isoY} r="2.2" fill="none" stroke="#0284c7" strokeWidth="0.6" />
            <circle cx={isoX} cy={isoY} r="0.8" fill="#0284c7" />

            {/* Crosshair registration marks */}
            <line x1={isoX - 7} y1={isoY} x2={isoX - 3.5} y2={isoY} stroke="#0ea5e9" strokeWidth="0.9" />
            <line x1={isoX + 3.5} y1={isoY} x2={isoX + 7} y2={isoY} stroke="#0ea5e9" strokeWidth="0.9" />
            <line x1={isoX} y1={isoY - 4} x2={isoX} y2={isoY - 2} stroke="#0ea5e9" strokeWidth="0.9" />
            <line x1={isoX} y1={isoY + 2} x2={isoX} y2={isoY + 4} stroke="#0ea5e9" strokeWidth="0.9" />

            {/* Corner alignment brackets */}
            <path
              d={`M ${isoX - 16},${isoY - 6} L ${isoX - 18},${isoY - 5} L ${isoX - 18},${isoY - 3}`}
              fill="none"
              stroke="#64748b"
              strokeWidth="0.8"
            />
            <path
              d={`M ${isoX + 16},${isoY + 6} L ${isoX + 18},${isoY + 5} L ${isoX + 18},${isoY + 3}`}
              fill="none"
              stroke="#64748b"
              strokeWidth="0.8"
            />
          </g>
        );

      case 'staging-deck':
        return (
          <g id={`inlay-staging-deck-${tile.x}-${tile.y}`}>
            {/* Grid subdivisions */}
            <line x1={isoX - 16} y1={isoY - 8} x2={isoX + 16} y2={isoY + 8} stroke="#475569" strokeWidth="0.6" strokeDasharray="3 2" />
            <line x1={isoX - 16} y1={isoY + 8} x2={isoX + 16} y2={isoY - 8} stroke="#475569" strokeWidth="0.6" strokeDasharray="3 2" />

            {/* Measurement tick marks along North-West edge (Left to Top) */}
            {[0.2, 0.4, 0.6, 0.8].map((t, i) => {
              const px = leftX + (topX - leftX) * t;
              const py = leftY + (topY - leftY) * t;
              const len = i % 2 === 0 ? 3 : 1.8;
              return (
                <line
                  key={`tick-nw-${i}`}
                  x1={px}
                  y1={py}
                  x2={px + len}
                  y2={py + len * 0.5}
                  stroke="#cbd5e1"
                  strokeWidth="0.8"
                />
              );
            })}

            {/* Measurement tick marks along North-East edge (Top to Right) */}
            {[0.2, 0.4, 0.6, 0.8].map((t, i) => {
              const px = topX + (rightX - topX) * t;
              const py = topY + (rightY - topY) * t;
              const len = i % 2 === 0 ? 3 : 1.8;
              return (
                <line
                  key={`tick-ne-${i}`}
                  x1={px}
                  y1={py}
                  x2={px - len}
                  y2={py + len * 0.5}
                  stroke="#cbd5e1"
                  strokeWidth="0.8"
                />
              );
            })}

            {/* Safety hazard corner chevron markings */}
            <polygon
              points={`${leftX + 2},${leftY} ${leftX + 8},${leftY - 3} ${leftX + 8},${leftY - 1} ${leftX + 4},${leftY + 1}`}
              fill="#f59e0b"
            />
            <polygon
              points={`${rightX - 2},${rightY} ${rightX - 8},${rightY + 3} ${rightX - 8},${rightY + 1} ${rightX - 4},${rightY - 1}`}
              fill="#f59e0b"
            />
          </g>
        );

      case 'corridor':
      default:
        return (
          <g id={`inlay-corridor-${tile.x}-${tile.y}`}>
            {/* Dual cyan LED conduits running along Left-to-Bottom and Top-to-Right */}
            {/* Conduit 1 (Left-to-Bottom, offset inward) */}
            <line
              x1={leftX + 6}
              y1={leftY + 3}
              x2={botX - 4}
              y2={botY - 2}
              stroke="#06b6d4"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <line
              x1={leftX + 6}
              y1={leftY + 3}
              x2={botX - 4}
              y2={botY - 2}
              stroke="#a5f3fc"
              strokeWidth="0.8"
              strokeLinecap="round"
            />

            {/* Conduit 2 (Top-to-Right, offset inward) */}
            <line
              x1={topX + 4}
              y1={topY + 2}
              x2={rightX - 6}
              y2={rightY - 3}
              stroke="#06b6d4"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <line
              x1={topX + 4}
              y1={topY + 2}
              x2={rightX - 6}
              y2={rightY - 3}
              stroke="#a5f3fc"
              strokeWidth="0.8"
              strokeLinecap="round"
            />

            {/* Directional chevron arrows indicating traffic circulation */}
            <path
              d={`M ${isoX - 5},${isoY - 3} L ${isoX},${isoY} L ${isoX + 5},${isoY - 3}`}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={`M ${isoX - 5},${isoY + 2} L ${isoX},${isoY + 5} L ${isoX + 5},${isoY + 2}`}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />

            {/* Anti-slip center runner plate */}
            <polygon
              points={`${isoX - 6},${isoY} ${isoX},${isoY - 3} ${isoX + 6},${isoY} ${isoX},${isoY + 3}`}
              fill="#1e293b"
              stroke="#334155"
              strokeWidth="0.6"
            />
          </g>
        );
    }
  };

  // 4-Tone Anatomy Floor Palette
  const getPalette = () => {
    switch (theme) {
      case 'mahogany':
        return {
          fill: '#78350f',
          stroke: '#9a3412',
          bevelLeft: '#361204',
          bevelRight: '#571c08',
        };
      case 'dev-grid':
        return {
          fill: '#090d16',
          stroke: '#1e293b',
          bevelLeft: '#020617',
          bevelRight: '#0f172a',
        };
      case 'creative-bay':
        return {
          fill: '#f5f3ff',
          stroke: '#c7d2fe',
          bevelLeft: '#ddd6fe',
          bevelRight: '#ede9fe',
        };
      case 'server-noc':
        return {
          fill: '#0f172a',
          stroke: '#0284c7',
          bevelLeft: '#020617',
          bevelRight: '#1e293b',
        };
      case 'qa-cleanroom':
        return {
          fill: '#f8fafc',
          stroke: '#cbd5e1',
          bevelLeft: '#94a3b8',
          bevelRight: '#cbd5e1',
        };
      case 'staging-deck':
        return {
          fill: '#1e293b',
          stroke: '#475569',
          bevelLeft: '#0f172a',
          bevelRight: '#334155',
        };
      case 'corridor':
      default:
        return {
          fill: '#0a0f1d',
          stroke: '#0284c7',
          bevelLeft: '#020617',
          bevelRight: '#111827',
        };
    }
  };

  const pal = getPalette();

  return (
    <g
      id={`tile-floor-${tile.x}-${tile.y}`}
      className="cursor-pointer select-none"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 2.5D Bevel Skirt (Physical Slab Base) */}
      <polygon points={bevelLeftPoints} fill={pal.bevelLeft} />
      <polygon points={bevelRightPoints} fill={pal.bevelRight} />

      {/* Main Diamond Top Surface */}
      <polygon
        points={points}
        fill={pal.fill}
        stroke={isHovered ? '#fbbf24' : pal.stroke}
        strokeWidth={isHovered ? 1.8 : 0.9}
        className="transition-colors duration-150"
      />

      {/* Surface Inlay Artwork */}
      {renderSurfaceInlay()}

      {/* Hover State Glow Overlay */}
      {isHovered && (
        <polygon
          points={points}
          fill="rgba(245, 158, 11, 0.28)"
          stroke="#fbbf24"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}

/**
 * 2. IsometricWallTile:
 * - True 2.5D vertical extrusion rising upward by wallHeight (~40px) above tile diamond
 * - Light-facing plane (East face, lighter tone) and Shadow-facing plane (South face, darker tone)
 * - Translucent glass partition with cartoon specular diagonal reflection slashes
 * - Top structural cap rail with corner pillar rivets/bolts
 * - Supports: 'wall_n', 'wall_w', 'corner_nw'
 */
export function IsometricWallTile({
  tile,
  points,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: IsometricTileProps) {
  const { isoX, isoY } = gridToIso(tile.x, tile.y);
  const wallH = 40; // True 2.5D vertical extrusion height

  // Base diamond vertices
  const leftX = isoX - 32;
  const leftY = isoY;
  const rightX = isoX + 32;
  const rightY = isoY;
  const botX = isoX;
  const botY = isoY + 16;

  // Extruded vertical positions (-wallH)
  const leftTopY = leftY - wallH;
  const botTopY = botY - wallH;
  const rightTopY = rightY - wallH;

  const isWallN = tile.type === 'wall_n' || tile.type === 'corner_nw';
  const isWallW = tile.type === 'wall_w' || tile.type === 'corner_nw';
  const isCorner = tile.type === 'corner_nw';

  // Dado baseboard height = 9px, Cap rail height = 6px
  const dadoH = 9;
  const capH = 6;

  return (
    <g
      id={`tile-wall-${tile.type}-${tile.x}-${tile.y}`}
      className="cursor-pointer select-none"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 1. Underlying Base Floor Diamond */}
      <polygon
        points={points}
        fill="#0f172a"
        stroke="#1e293b"
        strokeWidth="0.8"
      />

      {/* 2. South-Facing Wall Plane (Runs along Left -> Bottom; Shadow plane) */}
      {isWallN && (
        <g id={`wall-south-face-${tile.x}-${tile.y}`}>
          {/* Main vertical extrusion background (Shadow tone) */}
          <polygon
            points={`${leftX},${leftTopY} ${botX},${botTopY} ${botX},${botY} ${leftX},${leftY}`}
            fill="#090d16"
            stroke="#020617"
            strokeWidth="0.8"
          />

          {/* Lower architectural dado / kickplate */}
          <polygon
            points={`${leftX},${leftY - dadoH} ${botX},${botY - dadoH} ${botX},${botY} ${leftX},${leftY}`}
            fill="#1e293b"
            stroke="#0f172a"
            strokeWidth="0.6"
          />

          {/* Translucent Glass Partition (South face shadow tint) */}
          <polygon
            points={`${leftX},${leftTopY + capH} ${botX},${botTopY + capH} ${botX},${botY - dadoH} ${leftX},${leftY - dadoH}`}
            fill="rgba(14, 165, 233, 0.22)"
            stroke="rgba(56, 189, 248, 0.3)"
            strokeWidth="0.6"
          />

          {/* Cartoon Specular Diagonal Reflection Slashes on Glass */}
          <polygon
            points={`${leftX + 8},${leftY - dadoH - 3} ${leftX + 16},${leftY - dadoH - 12} ${leftX + 19},${leftY - dadoH - 12} ${leftX + 11},${leftY - dadoH - 3}`}
            fill="rgba(255, 255, 255, 0.25)"
          />
          <polygon
            points={`${leftX + 18},${leftY - dadoH - 4} ${leftX + 23},${leftY - dadoH - 10} ${leftX + 25},${leftY - dadoH - 10} ${leftX + 20},${leftY - dadoH - 4}`}
            fill="rgba(255, 255, 255, 0.25)"
          />

          {/* Top Structural Cap Rail (South Shadow Face) */}
          <polygon
            points={`${leftX},${leftTopY} ${botX},${botTopY} ${botX},${botTopY + capH} ${leftX},${leftTopY + capH}`}
            fill="#334155"
            stroke="#1e293b"
            strokeWidth="0.6"
          />

          {/* Top Cap Rail Horizontal Top Surface (Highlight facet) */}
          <polygon
            points={`${leftX},${leftTopY} ${leftX + 3},${leftTopY - 1.5} ${botX + 3},${botTopY - 1.5} ${botX},${botTopY}`}
            fill="#64748b"
          />
        </g>
      )}

      {/* 3. East-Facing Wall Plane (Runs along Bottom -> Right; Light-facing plane) */}
      {isWallW && (
        <g id={`wall-east-face-${tile.x}-${tile.y}`}>
          {/* Main vertical extrusion background (Midtone/Light tone) */}
          <polygon
            points={`${botX},${botTopY} ${rightX},${rightTopY} ${rightX},${rightY} ${botX},${botY}`}
            fill="#111827"
            stroke="#1e293b"
            strokeWidth="0.8"
          />

          {/* Lower architectural dado / kickplate (Light face) */}
          <polygon
            points={`${botX},${botY - dadoH} ${rightX},${rightY - dadoH} ${rightX},${rightY} ${botX},${botY}`}
            fill="#334155"
            stroke="#1e293b"
            strokeWidth="0.6"
          />

          {/* Translucent Glass Partition (East face lighter translucent tint) */}
          <polygon
            points={`${botX},${botTopY + capH} ${rightX},${rightTopY + capH} ${rightX},${rightY - dadoH} ${botX},${botY - dadoH}`}
            fill="rgba(56, 189, 248, 0.32)"
            stroke="rgba(125, 211, 252, 0.45)"
            strokeWidth="0.6"
          />

          {/* Cartoon Specular Diagonal Reflection Slashes on Glass */}
          <polygon
            points={`${botX + 8},${botY - dadoH - 4} ${botX + 16},${botY - dadoH - 13} ${botX + 19},${botY - dadoH - 13} ${botX + 11},${botY - dadoH - 4}`}
            fill="rgba(255, 255, 255, 0.25)"
          />
          <polygon
            points={`${botX + 18},${botY - dadoH - 5} ${botX + 23},${botY - dadoH - 11} ${botX + 25},${botY - dadoH - 11} ${botX + 20},${botY - dadoH - 5}`}
            fill="rgba(255, 255, 255, 0.25)"
          />

          {/* Top Structural Cap Rail (East Light Face) */}
          <polygon
            points={`${botX},${botTopY} ${rightX},${rightTopY} ${rightX},${rightTopY + capH} ${botX},${botTopY + capH}`}
            fill="#475569"
            stroke="#334155"
            strokeWidth="0.6"
          />

          {/* Top Cap Rail Horizontal Top Surface (High specular tone) */}
          <polygon
            points={`${botX},${botTopY} ${botX + 3},${botTopY - 1.5} ${rightX + 3},${rightTopY - 1.5} ${rightX},${rightTopY}`}
            fill="#94a3b8"
          />
        </g>
      )}

      {/* 4. Structural Corner Pillar & Rivets (For corner_nw or junction mullion) */}
      {isCorner && (
        <g id={`corner-pillar-${tile.x}-${tile.y}`}>
          {/* Vertical Corner Column at vertex Bot */}
          <rect
            x={botX - 2.5}
            y={botTopY - 1}
            width="5"
            height={wallH + 1}
            fill="#1e293b"
            stroke="#0f172a"
            strokeWidth="0.8"
            rx="0.5"
          />
          {/* Column lit facet */}
          <line
            x1={botX}
            y1={botTopY}
            x2={botX}
            y2={botY}
            stroke="#64748b"
            strokeWidth="1"
          />
          {/* Top pillar cap */}
          <polygon
            points={`${botX - 2.5},${botTopY - 1} ${botX},${botTopY - 2.5} ${botX + 2.5},${botTopY - 1} ${botX},${botTopY + 0.5}`}
            fill="#cbd5e1"
            stroke="#475569"
            strokeWidth="0.5"
          />
          {/* Pillar Rivets / Bolts */}
          <circle cx={botX - 1} cy={botTopY + 7} r="1.1" fill="#cbd5e1" stroke="#0f172a" strokeWidth="0.4" />
          <circle cx={botX - 1} cy={botTopY + 20} r="1.1" fill="#cbd5e1" stroke="#0f172a" strokeWidth="0.4" />
          <circle cx={botX - 1} cy={botY - 4} r="1.1" fill="#cbd5e1" stroke="#0f172a" strokeWidth="0.4" />
        </g>
      )}

      {/* Non-corner end mullion bolts */}
      {!isCorner && isWallN && (
        <g id={`mullion-rivets-n-${tile.x}-${tile.y}`}>
          <circle cx={botX - 1} cy={botTopY + 3} r="1" fill="#94a3b8" stroke="#1e293b" strokeWidth="0.4" />
          <circle cx={leftX + 2} cy={leftTopY + 3} r="1" fill="#94a3b8" stroke="#1e293b" strokeWidth="0.4" />
        </g>
      )}
      {!isCorner && isWallW && (
        <g id={`mullion-rivets-w-${tile.x}-${tile.y}`}>
          <circle cx={botX + 1} cy={botTopY + 3} r="1" fill="#cbd5e1" stroke="#1e293b" strokeWidth="0.4" />
          <circle cx={rightX - 2} cy={rightTopY + 3} r="1" fill="#cbd5e1" stroke="#1e293b" strokeWidth="0.4" />
        </g>
      )}

      {/* Hover Highlight Overlay */}
      {isHovered && (
        <polygon
          points={points}
          fill="rgba(245, 158, 11, 0.28)"
          stroke="#fbbf24"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}

/**
 * 3. IsometricDoorTile:
 * - Vertical jamb posts with top header lintel
 * - Translucent sliding door leaf with neon status indicator light (green)
 * - Floor threshold with safety chevron striping
 * - Supports: 'door_n', 'door_w'
 */
export function IsometricDoorTile({
  tile,
  points,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: IsometricTileProps) {
  const { isoX, isoY } = gridToIso(tile.x, tile.y);
  const wallH = 40;

  const leftX = isoX - 32;
  const leftY = isoY;
  const rightX = isoX + 32;
  const rightY = isoY;
  const botX = isoX;
  const botY = isoY + 16;

  const isDoorN = tile.type === 'door_n';

  // Vertical jamb positions (-wallH)
  const leftTopY = leftY - wallH;
  const botTopY = botY - wallH;
  const rightTopY = rightY - wallH;

  return (
    <g
      id={`tile-door-${tile.type}-${tile.x}-${tile.y}`}
      className="cursor-pointer select-none"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 1. Base Walkable Floor Diamond */}
      <polygon
        points={points}
        fill="#0f172a"
        stroke="#1e293b"
        strokeWidth="0.8"
      />

      {/* 2. Floor Threshold with Safety Chevron Striping */}
      {isDoorN ? (
        <g id={`door-threshold-n-${tile.x}-${tile.y}`}>
          {/* Threshold Plate along Left -> Bot edge */}
          <polygon
            points={`${leftX + 2},${leftY} ${leftX + 7},${leftY - 2.5} ${botX + 2},${botY - 5} ${botX - 3},${botY - 2.5}`}
            fill="#1e293b"
            stroke="#334155"
            strokeWidth="0.6"
          />
          {/* Alternating Amber/Slate Safety Chevrons */}
          {[0.2, 0.4, 0.6, 0.8].map((t, idx) => {
            const cx = leftX + 4 + (botX - leftX) * t;
            const cy = leftY - 2 + (botY - leftY) * t;
            return (
              <polygon
                key={`chev-n-${idx}`}
                points={`${cx - 2},${cy - 1} ${cx + 1},${cy} ${cx - 1},${cy + 1} ${cx - 4},${cy}`}
                fill={idx % 2 === 0 ? '#f59e0b' : '#0f172a'}
              />
            );
          })}
        </g>
      ) : (
        <g id={`door-threshold-w-${tile.x}-${tile.y}`}>
          {/* Threshold Plate along Bot -> Right edge */}
          <polygon
            points={`${botX + 2},${botY - 2.5} ${botX - 3},${botY - 5} ${rightX - 7},${rightY - 2.5} ${rightX - 2},${rightY}`}
            fill="#1e293b"
            stroke="#334155"
            strokeWidth="0.6"
          />
          {/* Alternating Amber/Slate Safety Chevrons */}
          {[0.2, 0.4, 0.6, 0.8].map((t, idx) => {
            const cx = botX + (rightX - botX) * t;
            const cy = botY - 3 + (rightY - botY) * t;
            return (
              <polygon
                key={`chev-w-${idx}`}
                points={`${cx - 2},${cy - 1} ${cx + 1},${cy} ${cx - 1},${cy + 1} ${cx - 4},${cy}`}
                fill={idx % 2 === 0 ? '#f59e0b' : '#0f172a'}
              />
            );
          })}
        </g>
      )}

      {/* 3. Doorway Framework: Jamb Posts & Header Lintel */}
      {isDoorN ? (
        <g id={`door-frame-n-${tile.x}-${tile.y}`}>
          {/* Left Vertical Jamb Post */}
          <polygon
            points={`${leftX},${leftTopY} ${leftX + 5},${leftTopY + 2.5} ${leftX + 5},${leftY + 2.5} ${leftX},${leftY}`}
            fill="#334155"
            stroke="#0f172a"
            strokeWidth="0.6"
          />

          {/* Right Vertical Jamb Post */}
          <polygon
            points={`${botX - 5},${botTopY - 2.5} ${botX},${botTopY} ${botX},${botY} ${botX - 5},${botY - 2.5}`}
            fill="#1e293b"
            stroke="#0f172a"
            strokeWidth="0.6"
          />

          {/* Top Header Lintel Spanning between posts */}
          <polygon
            points={`${leftX},${leftTopY} ${botX},${botTopY} ${botX},${botTopY + 7} ${leftX},${leftTopY + 7}`}
            fill="#475569"
            stroke="#1e293b"
            strokeWidth="0.7"
          />
          {/* Lintel Top Cap Facet */}
          <polygon
            points={`${leftX},${leftTopY} ${leftX + 3},${leftTopY - 1.5} ${botX + 3},${botTopY - 1.5} ${botX},${botTopY}`}
            fill="#94a3b8"
          />

          {/* Translucent Sliding Door Leaf (Partially Slid Open) */}
          <polygon
            points={`${leftX + 6},${leftTopY + 8} ${leftX + 22},${leftTopY + 16} ${leftX + 22},${leftY - 4} ${leftX + 6},${leftY - 12}`}
            fill="rgba(56, 189, 248, 0.28)"
            stroke="#38bdf8"
            strokeWidth="0.6"
          />
          {/* Diagonal Cartoon Specular Slash on Door Leaf */}
          <polygon
            points={`${leftX + 10},${leftY - 13} ${leftX + 17},${leftY - 20} ${leftX + 19},${leftY - 20} ${leftX + 12},${leftY - 13}`}
            fill="rgba(255, 255, 255, 0.25)"
          />
          {/* Door Handle Rail */}
          <line
            x1={leftX + 20}
            y1={leftTopY + 16}
            x2={leftX + 20}
            y2={leftY - 6}
            stroke="#e2e8f0"
            strokeWidth="1.2"
            strokeLinecap="round"
          />

          {/* Neon Status Indicator Light (Green - Active / Granted) */}
          <g id={`door-status-led-n-${tile.x}-${tile.y}`}>
            <rect
              x={(leftX + botX) / 2 - 4}
              y={(leftTopY + botTopY) / 2 + 1}
              width="8"
              height="3.5"
              rx="1.5"
              fill="#0f172a"
              stroke="#334155"
              strokeWidth="0.5"
            />
            {/* Glowing Green Halo */}
            <circle
              cx={(leftX + botX) / 2}
              cy={(leftTopY + botTopY) / 2 + 2.75}
              r="3.5"
              fill="#10b981"
              opacity="0.4"
            />
            {/* Neon Green LED Center */}
            <circle
              cx={(leftX + botX) / 2}
              cy={(leftTopY + botTopY) / 2 + 2.75}
              r="1.5"
              fill="#34d399"
            />
            <circle
              cx={(leftX + botX) / 2}
              cy={(leftTopY + botTopY) / 2 + 2.75}
              r="0.6"
              fill="#ffffff"
            />
          </g>
        </g>
      ) : (
        <g id={`door-frame-w-${tile.x}-${tile.y}`}>
          {/* Left Vertical Jamb Post (at Bot) */}
          <polygon
            points={`${botX},${botTopY} ${botX + 5},${botTopY - 2.5} ${botX + 5},${botY - 2.5} ${botX},${botY}`}
            fill="#334155"
            stroke="#0f172a"
            strokeWidth="0.6"
          />

          {/* Right Vertical Jamb Post (at Right) */}
          <polygon
            points={`${rightX - 5},${rightTopY + 2.5} ${rightX},${rightTopY} ${rightX},${rightY} ${rightX - 5},${rightY + 2.5}`}
            fill="#475569"
            stroke="#1e293b"
            strokeWidth="0.6"
          />

          {/* Top Header Lintel Spanning between posts */}
          <polygon
            points={`${botX},${botTopY} ${rightX},${rightTopY} ${rightX},${rightTopY + 7} ${botX},${botTopY + 7}`}
            fill="#64748b"
            stroke="#334155"
            strokeWidth="0.7"
          />
          {/* Lintel Top Cap Facet */}
          <polygon
            points={`${botX},${botTopY} ${botX + 3},${botTopY - 1.5} ${rightX + 3},${rightTopY - 1.5} ${rightX},${rightTopY}`}
            fill="#cbd5e1"
          />

          {/* Translucent Sliding Door Leaf (Partially Slid Open) */}
          <polygon
            points={`${botX + 6},${botTopY + 8} ${botX + 22},${botTopY} ${botX + 22},${botY - 20} ${botX + 6},${botY - 12}`}
            fill="rgba(56, 189, 248, 0.28)"
            stroke="#38bdf8"
            strokeWidth="0.6"
          />
          {/* Diagonal Cartoon Specular Slash on Door Leaf */}
          <polygon
            points={`${botX + 10},${botY - 14} ${botX + 17},${botY - 19} ${botX + 19},${botY - 19} ${botX + 12},${botY - 14}`}
            fill="rgba(255, 255, 255, 0.25)"
          />
          {/* Door Handle Rail */}
          <line
            x1={botX + 20}
            y1={botTopY + 2}
            x2={botX + 20}
            y2={botY - 18}
            stroke="#e2e8f0"
            strokeWidth="1.2"
            strokeLinecap="round"
          />

          {/* Neon Status Indicator Light (Green - Active / Granted) */}
          <g id={`door-status-led-w-${tile.x}-${tile.y}`}>
            <rect
              x={(botX + rightX) / 2 - 4}
              y={(botTopY + rightTopY) / 2 + 1}
              width="8"
              height="3.5"
              rx="1.5"
              fill="#0f172a"
              stroke="#334155"
              strokeWidth="0.5"
            />
            {/* Glowing Green Halo */}
            <circle
              cx={(botX + rightX) / 2}
              cy={(botTopY + rightTopY) / 2 + 2.75}
              r="3.5"
              fill="#10b981"
              opacity="0.4"
            />
            {/* Neon Green LED Center */}
            <circle
              cx={(botX + rightX) / 2}
              cy={(botTopY + rightTopY) / 2 + 2.75}
              r="1.5"
              fill="#34d399"
            />
            <circle
              cx={(botX + rightX) / 2}
              cy={(botTopY + rightTopY) / 2 + 2.75}
              r="0.6"
              fill="#ffffff"
            />
          </g>
        </g>
      )}

      {/* Hover Highlight Overlay */}
      {isHovered && (
        <polygon
          points={points}
          fill="rgba(245, 158, 11, 0.28)"
          stroke="#fbbf24"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}

/**
 * 4. Master RenderIsometricTile:
 * Renders appropriate floor, wall, door, or corridor component
 */
export function RenderIsometricTile({
  tile,
  points,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  tile: TileData;
  points: string;
  isHovered: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  if (tile.type === 'empty') {
    return (
      <polygon
        points={points}
        fill={isHovered ? 'rgba(245, 158, 11, 0.2)' : 'rgba(30, 41, 59, 0.35)'}
        stroke={isHovered ? '#fbbf24' : 'rgba(71, 85, 105, 0.25)'}
        strokeWidth={isHovered ? 1.5 : 0.8}
        strokeDasharray={isHovered ? undefined : '2 2'}
        className="cursor-pointer transition-colors duration-150"
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );
  }

  if (tile.type === 'floor' || tile.type === 'corridor') {
    return (
      <IsometricFloorTile
        tile={tile}
        points={points}
        isHovered={isHovered}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );
  }

  if (
    tile.type === 'wall_n' ||
    tile.type === 'wall_w' ||
    tile.type === 'corner_nw'
  ) {
    return (
      <IsometricWallTile
        tile={tile}
        points={points}
        isHovered={isHovered}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );
  }

  if (tile.type === 'door_n' || tile.type === 'door_w') {
    return (
      <IsometricDoorTile
        tile={tile}
        points={points}
        isHovered={isHovered}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );
  }

  return (
    <IsometricFloorTile
      tile={tile}
      points={points}
      isHovered={isHovered}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}
