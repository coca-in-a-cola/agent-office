/**
 * High-fidelity vector SVG office props rendered with crisp isometric projection
 * and stylized cartoon anatomy look.
 */

/** 1. Water Cooler: Cyan translucent carboy with rising bubbles, silver spigots, drip tray */
export function WaterCoolerProp() {
  return (
    <g id="prop-water-cooler" className="office-prop">
      <defs>
        <linearGradient id="coolerWaterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#0284c7" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0369a1" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="coolerBaseLeft" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="coolerBaseRight" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>
      </defs>

      {/* Floor Contact Shadow */}
      <ellipse cx="0" cy="3" rx="14" ry="7" fill="rgba(0, 0, 0, 0.38)" />

      {/* Cabinet Base Plinth (Dark Charcoal) */}
      <polygon points="-8,2 -8,-1 0,-5 8,-1 8,2 0,6" fill="#1e293b" />

      {/* Main Stand Cabinet - Left Face (Shadow) */}
      <polygon points="-8,-1 -8,-24 0,-28 0,-5" fill="url(#coolerBaseLeft)" stroke="#64748b" strokeWidth="0.5" />

      {/* Main Stand Cabinet - Right Face (Lit) */}
      <polygon points="0,-5 0,-28 8,-24 8,-1" fill="url(#coolerBaseRight)" stroke="#94a3b8" strokeWidth="0.5" />

      {/* Main Stand Top Diamond */}
      <polygon points="0,-28 -8,-24 0,-20 8,-24" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.5" />

      {/* Recessed Dispenser Niche */}
      <polygon points="-5,-12 -5,-21 0,-23.5 5,-21 5,-12 0,-9.5" fill="#0f172a" />

      {/* Drip Tray Grille */}
      <polygon points="-4.5,-12 0,-9.8 4.5,-12 0,-14.2" fill="#334155" stroke="#475569" strokeWidth="0.4" />
      <line x1="-3" y1="-12.3" x2="0" y2="-10.8" stroke="#64748b" strokeWidth="0.5" />
      <line x1="0" y1="-10.8" x2="3" y2="-12.3" stroke="#64748b" strokeWidth="0.5" />

      {/* Hot Water Spigot (Red Accent) */}
      <rect x="-3.2" y="-21" width="1.8" height="2.5" rx="0.5" fill="#ef4444" />
      <line x1="-2.3" y1="-18.5" x2="-2.3" y2="-16.5" stroke="#cbd5e1" strokeWidth="0.8" strokeLinecap="round" />

      {/* Cold Water Spigot (Blue Accent) */}
      <rect x="1.4" y="-21" width="1.8" height="2.5" rx="0.5" fill="#3b82f6" />
      <line x1="2.3" y1="-18.5" x2="2.3" y2="-16.5" stroke="#cbd5e1" strokeWidth="0.8" strokeLinecap="round" />

      {/* Inverted Carboy Bottle Collar */}
      <ellipse cx="0" cy="-28" rx="4.5" ry="2.2" fill="#0284c7" stroke="#0369a1" strokeWidth="0.5" />

      {/* Translucent Cyan Water Bottle Body */}
      {/* Bottle Neck & Shoulder */}
      <path
        d="M -3,-28 L -7,-33 C -8,-35 -8.5,-37 -8.5,-40 L -8.5,-47 C -8.5,-51 -5,-53 0,-53 C 5,-53 8.5,-51 8.5,-47 L 8.5,-40 C 8.5,-37 8,-35 7,-33 L 3,-28 Z"
        fill="url(#coolerWaterGrad)"
        stroke="#0284c7"
        strokeWidth="0.8"
      />

      {/* Bottle Molded Rib Lines */}
      <path d="M -8.2,-44 Q 0,-42 8.2,-44" fill="none" stroke="#7dd3fc" strokeWidth="0.6" strokeOpacity="0.7" />
      <path d="M -8.2,-39 Q 0,-37 8.2,-39" fill="none" stroke="#7dd3fc" strokeWidth="0.6" strokeOpacity="0.7" />

      {/* Specular Gloss Sheen */}
      <path
        d="M -6.5,-46 C -6.5,-49 -3,-51.5 0,-51.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1"
        strokeLinecap="round"
        strokeOpacity="0.75"
      />
      <line x1="-7" y1="-44" x2="-7" y2="-36" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" strokeOpacity="0.5" />

      {/* Rising Air Bubbles (SVG Animated) */}
      <circle cx="1.5" cy="-32" r="1.4" fill="#e0f2fe" opacity="0.85">
        <animate attributeName="cy" from="-32" to="-49" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.15;0.8;1" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="cx" values="1.5;3;0.5;2" dur="2.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="-1.8" cy="-30" r="1" fill="#bae6fd" opacity="0.7">
        <animate attributeName="cy" from="-30" to="-47" dur="1.7s" begin="0.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.8;0.8;0" keyTimes="0;0.2;0.75;1" dur="1.7s" begin="0.8s" repeatCount="indefinite" />
      </circle>

      {/* Side Mounted Cup Dispenser Tube */}
      <rect x="-10" y="-23" width="1.8" height="15" rx="0.8" fill="#e2e8f0" fillOpacity="0.7" stroke="#94a3b8" strokeWidth="0.4" />
      <line x1="-9.1" y1="-22" x2="-9.1" y2="-9" stroke="#cbd5e1" strokeWidth="0.8" />
    </g>
  );
}

/** 2. Server Rack: 19" black blade rack with blinking LEDs and cooling grille */
export function ServerRackProp() {
  return (
    <g id="prop-server-rack" className="office-prop">
      <defs>
        <linearGradient id="serverSheen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* Floor Contact Shadow */}
      <ellipse cx="0" cy="4" rx="17" ry="8" fill="rgba(0, 0, 0, 0.45)" />

      {/* Cabinet Base Plinth */}
      <polygon points="-12,3 -12,0 0,-6 14,0 14,3 0,7" fill="#090d16" />

      {/* Left Cabinet Face (Dark Depth Side) */}
      <polygon points="-12,0 -12,-48 0,-54 0,-6" fill="#0f172a" stroke="#334155" strokeWidth="0.6" />

      {/* Side Panel Louver / Emboss Lines */}
      {[-16, -24, -32, -40].map((y) => (
        <line key={y} x1="-10" y1={y + 1} x2="-2" y2={y - 3} stroke="#1e293b" strokeWidth="1" />
      ))}

      {/* Right Cabinet Face (Blade Servers Front Face) */}
      <polygon points="0,-6 0,-54 14,-48 14,0" fill="#182234" stroke="#334155" strokeWidth="0.6" />

      {/* Cabinet Top Face (Roof Exhaust) */}
      <polygon points="0,-54 -12,-48 0,-42 14,-48" fill="#334155" stroke="#475569" strokeWidth="0.5" />
      <ellipse cx="1" cy="-48" rx="4.5" ry="2.2" fill="#0f172a" stroke="#475569" strokeWidth="0.5" />
      <circle cx="1" cy="-48" r="1.5" fill="#1e293b" />

      {/* Stacked Blade Server Units */}
      {/* Unit 1 (Top Master Blade) */}
      <polygon points="1,-52 1,-46 13,-41 13,-47" fill="#0f172a" stroke="#334155" strokeWidth="0.4" />
      <circle cx="3" cy="-49.8" r="0.9" fill="#22c55e">
        <animate attributeName="opacity" values="1;0.2;1" dur="1.1s" repeatCount="indefinite" />
      </circle>
      <circle cx="5" cy="-49" r="0.9" fill="#06b6d4">
        <animate attributeName="opacity" values="0.2;1;0.2" dur="0.8s" repeatCount="indefinite" />
      </circle>
      <line x1="7" y1="-48" x2="11.5" y2="-46.2" stroke="#475569" strokeWidth="0.6" strokeDasharray="1,1" />

      {/* Unit 2 (Cluster Node) */}
      <polygon points="1,-44.5 1,-38.5 13,-33.5 13,-39.5" fill="#0f172a" stroke="#334155" strokeWidth="0.4" />
      <circle cx="3" cy="-42.3" r="0.9" fill="#22c55e" />
      <circle cx="5" cy="-41.5" r="0.9" fill="#f59e0b">
        <animate attributeName="opacity" values="1;0.1;1" dur="0.6s" repeatCount="indefinite" />
      </circle>
      <circle cx="7" cy="-40.7" r="0.9" fill="#06b6d4">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <line x1="9" y1="-39.8" x2="11.5" y2="-38.8" stroke="#38bdf8" strokeWidth="0.6" />

      {/* Unit 3 (Storage Blade Array with Drive Caddies) */}
      <polygon points="1,-37 1,-27 13,-22 13,-32" fill="#111827" stroke="#334155" strokeWidth="0.4" />
      {/* Storage drive bays */}
      {[0, 1, 2, 3].map((i) => {
        const dy = i * 2.2;
        return (
          <g key={i}>
            <line x1="3" y1={-34.5 + dy} x2="11" y2={-31.5 + dy} stroke="#1f2937" strokeWidth="1.2" />
            <circle cx="2" cy={-34.8 + dy} r="0.6" fill={i % 2 === 0 ? '#22c55e' : '#06b6d4'}>
              <animate attributeName="opacity" values="0.9;0.3;0.9" dur={`${0.7 + i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}

      {/* Unit 4 (Compute Accelerator / GPU Server) */}
      <polygon points="1,-25.5 1,-17.5 13,-12.5 13,-20.5" fill="#0f172a" stroke="#334155" strokeWidth="0.4" />
      {/* Cooling Intake Grille Slots */}
      <line x1="2.5" y1="-23.5" x2="11.5" y2="-20" stroke="#334155" strokeWidth="0.8" strokeDasharray="1.2,0.8" />
      <line x1="2.5" y1="-21.5" x2="11.5" y2="-18" stroke="#334155" strokeWidth="0.8" strokeDasharray="1.2,0.8" />
      <line x1="2.5" y1="-19.5" x2="11.5" y2="-16" stroke="#334155" strokeWidth="0.8" strokeDasharray="1.2,0.8" />
      <circle cx="12" cy="-15" r="0.8" fill="#10b981">
        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Unit 5 (Redundant Power UPS Unit) */}
      <polygon points="1,-16 1,-8 13,-3 13,-11" fill="#090d16" stroke="#334155" strokeWidth="0.4" />
      <rect x="2" y="-14" width="2" height="1.5" fill="#f59e0b" rx="0.3" />
      <line x1="6" y1="-12" x2="11.5" y2="-9.8" stroke="#374151" strokeWidth="1.5" strokeDasharray="1.5,1" />

      {/* Front Glass Reflection Sheen */}
      <polygon points="1,-53 13,-48 13,-28 1,-33" fill="url(#serverSheen)" pointerEvents="none" />
    </g>
  );
}

/** 3. Coffee Machine: Sleek espresso machine with portafilter, cup, and rising steam path */
export function CoffeeMachineProp() {
  return (
    <g id="prop-coffee-machine" className="office-prop">
      <defs>
        <linearGradient id="coffeeSteelLit" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="50%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient id="coffeeSteelDark" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
      </defs>

      {/* Floor Contact Shadow */}
      <ellipse cx="0" cy="3" rx="15" ry="7.5" fill="rgba(0, 0, 0, 0.35)" />

      {/* Solid Oak/Steel Stand Pedestal */}
      {/* Plinth */}
      <polygon points="-11,2 -11,-1 0,-6 11,-1 11,2 0,6" fill="#1e293b" />
      {/* Left Stand Face */}
      <polygon points="-11,-1 -11,-12 0,-17 0,-6" fill="#334155" stroke="#475569" strokeWidth="0.5" />
      {/* Right Stand Face */}
      <polygon points="0,-6 0,-17 11,-12 11,-1" fill="#475569" stroke="#64748b" strokeWidth="0.5" />
      {/* Countertop Diamond */}
      <polygon points="0,-17 -11,-12 0,-7 11,-12" fill="#64748b" stroke="#94a3b8" strokeWidth="0.5" />

      {/* Espresso Machine Main Body */}
      {/* Left Chassis (Matte Black / Charcoal) */}
      <polygon points="-8,-12 -8,-32 0,-36 0,-16" fill="url(#coffeeSteelDark)" stroke="#1e293b" strokeWidth="0.5" />

      {/* Right Chassis (Polished Stainless Steel) */}
      <polygon points="0,-16 0,-36 8,-32 8,-12" fill="url(#coffeeSteelLit)" stroke="#94a3b8" strokeWidth="0.5" />

      {/* Top Cup Warmer Surface */}
      <polygon points="0,-36 -8,-32 0,-28 8,-32" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.5" />
      {/* Chrome railing around top */}
      <line x1="-7" y1="-32" x2="0" y2="-35.5" stroke="#94a3b8" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="0" y1="-35.5" x2="7" y2="-32" stroke="#94a3b8" strokeWidth="0.8" strokeLinecap="round" />
      {/* Extra cups stored on top warmer */}
      <ellipse cx="-2" cy="-33" rx="1.6" ry="0.9" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.4" />
      <ellipse cx="3" cy="-31.5" rx="1.6" ry="0.9" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.4" />

      {/* Front Panel Group Head & Controls */}
      {/* Pressure Gauge Dial (Manometer) */}
      <circle cx="4" cy="-26" r="1.8" fill="#f8fafc" stroke="#475569" strokeWidth="0.5" />
      <line x1="4" y1="-26" x2="4.8" y2="-27.2" stroke="#ef4444" strokeWidth="0.5" strokeLinecap="round" />

      {/* Dispenser Group Head Cavity */}
      <polygon points="1,-21 1,-14 6,-11.5 6,-18.5" fill="#1e293b" />
      {/* Stainless Drip Tray */}
      <polygon points="0,-16 0,-13 6,-10 6,-13" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.4" />
      <line x1="1" y1="-14" x2="5" y2="-12" stroke="#64748b" strokeWidth="0.6" strokeDasharray="0.8,0.6" />

      {/* Portafilter Handle with Ergonomic Grip */}
      <path d="M 3.5,-18.5 L 6,-17.2 L 9.5,-16" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9.5" cy="-16" r="1" fill="#334155" />

      {/* Ceramic Espresso Cup */}
      <ellipse cx="3" cy="-14" rx="2.5" ry="1.4" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.5" />
      {/* Dark Coffee & Crema */}
      <ellipse cx="3" cy="-14.3" rx="1.8" ry="0.9" fill="#451a03" />
      <ellipse cx="2.7" cy="-14.4" rx="1.2" ry="0.6" fill="#b45309" opacity="0.8" />

      {/* Rising Steam Path (Animated wisps) */}
      <path
        d="M 3,-16 Q 1.5,-21 4,-26 Q 6,-31 3,-36"
        fill="none"
        stroke="#e0f2fe"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.75"
      >
        <animate
          attributeName="d"
          values="M 3,-16 Q 1.5,-21 4,-26 Q 6,-31 3,-36; M 3,-16 Q 4.5,-22 2,-27 Q 1,-32 4,-36; M 3,-16 Q 1.5,-21 4,-26 Q 6,-31 3,-36"
          dur="2.8s"
          repeatCount="indefinite"
        />
        <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2.8s" repeatCount="indefinite" />
      </path>

      <path
        d="M 4,-16.5 Q 6.5,-22 4,-28 Q 1.5,-34 4.5,-38"
        fill="none"
        stroke="#bae6fd"
        strokeWidth="0.75"
        strokeLinecap="round"
        opacity="0.5"
      >
        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2.2s" begin="0.7s" repeatCount="indefinite" />
      </path>
    </g>
  );
}

/** 4. Whiteboard: Rolling magnetic whiteboard with marker tray and KPI diagram lines */
export function WhiteboardProp() {
  return (
    <g id="prop-whiteboard" className="office-prop">
      {/* Floor Contact Shadow */}
      <ellipse cx="0" cy="3" rx="18" ry="6.5" fill="rgba(0, 0, 0, 0.32)" />

      {/* 4 Caster Wheels */}
      {[-13, -6, 6, 13].map((x, idx) => (
        <g key={idx} transform={`translate(${x}, ${idx % 2 === 0 ? 2 : 0})`}>
          <circle cx="0" cy="0" r="1.4" fill="#0f172a" />
          <circle cx="0" cy="-1.5" r="0.8" fill="#94a3b8" />
        </g>
      ))}

      {/* Aluminum Stand Legs (A-Frame) */}
      <line x1="-13" y1="1" x2="-9" y2="-13" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="-6" y1="-1" x2="-9" y2="-13" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="6" y1="-1" x2="9" y2="-13" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="13" y1="1" x2="9" y2="-13" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
      {/* Crossbar */}
      <line x1="-8.5" y1="-7" x2="8.5" y2="-7" stroke="#475569" strokeWidth="1" />

      {/* Whiteboard Outer Aluminum Frame */}
      <polygon points="-14,-14 -14,-44 14,-30 14,0" fill="#64748b" stroke="#475569" strokeWidth="0.6" />

      {/* Whiteboard Glossy Magnetic Dry-Erase Board Surface */}
      <polygon points="-13,-15 -13,-43 13,-29.5 13,-1.5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.5" />

      {/* Marker Tray along bottom border */}
      <polygon points="-12,-13 12,-1 12,1 -12,-11" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.6" />
      {/* Markers in tray */}
      {/* Red Marker */}
      <line x1="-8" y1="-10.5" x2="-4" y2="-8.5" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" />
      {/* Blue Marker */}
      <line x1="-3" y1="-8" x2="1" y2="-6" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" />
      {/* Black Marker */}
      <line x1="2" y1="-5.5" x2="6" y2="-3.5" stroke="#1e293b" strokeWidth="1.2" strokeLinecap="round" />
      {/* Eraser Block */}
      <rect x="7" y="-3.5" width="3" height="1.8" rx="0.4" fill="#334155" />

      {/* Whiteboard Diagram: KPI Charts & Diagrams */}
      {/* Target Dashed Line */}
      <line x1="-10" y1="-33" x2="10" y2="-23" stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="1.5,1.5" />

      {/* Ascending Green Growth KPI Trend Curve */}
      <path
        d="M -10,-24 Q -3,-26 2,-28 T 10,-32"
        fill="none"
        stroke="#10b981"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Peak Arrow */}
      <circle cx="10" cy="-32" r="1" fill="#10b981" />

      {/* Mini Bar Chart Columns */}
      {/* Bar 1 */}
      <line x1="-8" y1="-19" x2="-8" y2="-22" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
      {/* Bar 2 */}
      <line x1="-5" y1="-17.5" x2="-5" y2="-22" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
      {/* Bar 3 */}
      <line x1="-2" y1="-16" x2="-2" y2="-23" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />

      {/* Header Bullet Items */}
      <circle cx="-8" cy="-36" r="0.7" fill="#64748b" />
      <line x1="-6" y1="-36" x2="-1" y2="-36" stroke="#94a3b8" strokeWidth="0.7" />
      <circle cx="-8" cy="-39" r="0.7" fill="#64748b" />
      <line x1="-6" y1="-39" x2="2" y2="-39" stroke="#94a3b8" strokeWidth="0.7" />
    </g>
  );
}

/** 5. Ficus Plant: Architectural geometric pot with lush green isometric leaves */
export function FicusPlantProp() {
  return (
    <g id="prop-ficus-plant" className="office-prop">
      {/* Floor Contact Shadow */}
      <ellipse cx="0" cy="3" rx="14" ry="7" fill="rgba(0, 0, 0, 0.35)" />

      {/* Geometric Faceted Terracotta Planter Pot */}
      {/* Bottom Base */}
      <polygon points="-5,1 -5,-1 0,-3.5 5,-1 5,1 0,3.5" fill="#7c2d12" />

      {/* Left Pot Facet (Shadow side) */}
      <polygon points="-8,-12 -5,-1 0,3.5 0,-8" fill="#c2410c" stroke="#9a3412" strokeWidth="0.5" />

      {/* Right Pot Facet (Lit side) */}
      <polygon points="0,-8 0,3.5 5,-1 8,-12" fill="#ea580c" stroke="#c2410c" strokeWidth="0.5" />

      {/* Center Pot Facet (Mid tone) */}
      <polygon points="-3,-10 3,-10 0,-8" fill="#fb923c" opacity="0.3" />

      {/* Top Pot Rim Diamond */}
      <polygon points="0,-15 -8,-11 0,-7 8,-11" fill="#ea580c" stroke="#f97316" strokeWidth="0.5" />

      {/* Dark Organic Potting Soil */}
      <ellipse cx="0" cy="-11" rx="6.5" ry="3.2" fill="#29150b" />

      {/* Plant Stems */}
      <path d="M 0,-11 Q -2,-17 -1,-24" fill="none" stroke="#064e3b" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 0,-11 Q 3,-18 5,-23" fill="none" stroke="#047857" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 0,-11 Q -4,-15 -7,-19" fill="none" stroke="#065f46" strokeWidth="1.2" strokeLinecap="round" />

      {/* Lush Green Isometric Leaves */}
      {/* Deep Background Leaves (Dark Forest) */}
      <path
        d="M -1,-24 C -6,-30 -8,-25 -10,-20 C -7,-17 -3,-20 -1,-24 Z"
        fill="#064e3b"
        stroke="#047857"
        strokeWidth="0.5"
      />
      <path
        d="M 1,-24 C 5,-32 9,-28 11,-22 C 8,-18 4,-20 1,-24 Z"
        fill="#047857"
        stroke="#059669"
        strokeWidth="0.5"
      />

      {/* Mid-Tier Broad Tropical Leaves (Vibrant Emerald) */}
      <path
        d="M -2,-20 C -9,-26 -14,-21 -12,-15 C -8,-13 -4,-16 -2,-20 Z"
        fill="#059669"
        stroke="#10b981"
        strokeWidth="0.5"
      />
      {/* Center leaf vein */}
      <path d="M -2,-20 Q -7,-19 -11,-16" fill="none" stroke="#6ee7b7" strokeWidth="0.6" />

      <path
        d="M 3,-20 C 10,-25 15,-19 13,-14 C 9,-12 5,-15 3,-20 Z"
        fill="#10b981"
        stroke="#34d399"
        strokeWidth="0.5"
      />
      {/* Center leaf vein */}
      <path d="M 3,-20 Q 8,-18 12,-15" fill="none" stroke="#a7f3d0" strokeWidth="0.6" />

      {/* Top Crown Leaves (Bright Lime / Fresh Spring) */}
      <path
        d="M 0,-25 C -4,-33 0,-37 0,-38 C 1,-37 5,-33 0,-25 Z"
        fill="#34d399"
        stroke="#6ee7b7"
        strokeWidth="0.5"
      />
      <line x1="0" y1="-25" x2="0" y2="-36" stroke="#d1fae5" strokeWidth="0.6" />

      <path
        d="M -1,-23 C -3,-29 2,-32 4,-30 C 4,-26 1,-23 -1,-23 Z"
        fill="#4ade80"
        stroke="#86efac"
        strokeWidth="0.5"
      />

      {/* Drooping Foreground Leaf */}
      <path
        d="M 0,-16 C -3,-12 -2,-7 0,-5 C 2,-7 3,-12 0,-16 Z"
        fill="#10b981"
        stroke="#059669"
        strokeWidth="0.5"
      />
    </g>
  );
}

/** 6. Sofa: Retro upholstered two-seater lounge sofa with wooden peg legs */
export function SofaProp() {
  return (
    <g id="prop-sofa" className="office-prop">
      <defs>
        <linearGradient id="sofaBackLit" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id="sofaCushionLit" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>

      {/* Floor Contact Shadow */}
      <ellipse cx="0" cy="4" rx="22" ry="10.5" fill="rgba(0, 0, 0, 0.35)" />

      {/* 4 Mid-Century Tapered Wooden Peg Legs */}
      {/* Rear Left Leg */}
      <line x1="-14" y1="-6" x2="-16" y2="0" stroke="#78350f" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="-16" cy="0" r="0.8" fill="#f59e0b" />

      {/* Rear Right Leg */}
      <line x1="7" y1="-16" x2="6" y2="-10" stroke="#78350f" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="6" cy="-10" r="0.8" fill="#f59e0b" />

      {/* Front Left Leg */}
      <line x1="-9" y1="3" x2="-10" y2="7" stroke="#92400e" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="-10" cy="7" r="0.8" fill="#fbbf24" />

      {/* Front Right Leg */}
      <line x1="14" y1="-8" x2="13" y2="-3" stroke="#92400e" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="13" cy="-3" r="0.8" fill="#fbbf24" />

      {/* Walnut Plinth Base Frame */}
      <polygon points="-16,-4 -16,-1 2,8 18,0 18,-3 0,5" fill="#78350f" stroke="#451a03" strokeWidth="0.5" />

      {/* High Retro Backrest */}
      {/* Left Backrest End */}
      <polygon points="-18,-8 -18,-24 -14,-22 -14,-6" fill="#92400e" stroke="#78350f" strokeWidth="0.5" />
      {/* Main Backrest Surface */}
      <polygon points="-18,-24 -4,-31 16,-21 2,-14" fill="url(#sofaBackLit)" stroke="#b45309" strokeWidth="0.6" />
      {/* Backrest Top Edge */}
      <polygon points="-18,-24 -4,-31 0,-33 -14,-26" fill="#fbbf24" stroke="#f59e0b" strokeWidth="0.5" />

      {/* Vertical Tufting / Seam Creases on Backrest */}
      <line x1="-10" y1="-22" x2="-4" y2="-17" stroke="#b45309" strokeWidth="1" strokeDasharray="2,1.5" />
      <line x1="-2" y1="-26" x2="4" y2="-21" stroke="#b45309" strokeWidth="1" strokeDasharray="2,1.5" />
      <line x1="6" y1="-24" x2="11" y2="-20" stroke="#b45309" strokeWidth="1" strokeDasharray="2,1.5" />

      {/* Left Rounded Armrest */}
      <path
        d="M -18,-7 L -18,-14 C -18,-17 -13,-15 -13,-12 L -13,-4 Z"
        fill="#b45309"
        stroke="#78350f"
        strokeWidth="0.5"
      />
      <ellipse cx="-15.5" cy="-14.5" rx="2.5" ry="1.5" fill="#d97706" />

      {/* Two Plump Seat Cushions */}
      {/* Cushion 1 (Left Seat) */}
      <polygon points="-13,-5 -13,-9 0,-3 0,1" fill="#d97706" stroke="#b45309" strokeWidth="0.5" />
      <polygon points="-13,-9 -1,-15 3,-11 0,-3" fill="url(#sofaCushionLit)" stroke="#d97706" strokeWidth="0.5" />
      {/* Piping border */}
      <line x1="-13" y1="-9" x2="0" y2="-3" stroke="#fef3c7" strokeWidth="0.7" strokeOpacity="0.8" />

      {/* Cushion 2 (Right Seat) */}
      <polygon points="0,1 0,-3 14,-10 14,-6" fill="#d97706" stroke="#b45309" strokeWidth="0.5" />
      <polygon points="0,-3 3,-11 16,-17 14,-10" fill="url(#sofaCushionLit)" stroke="#d97706" strokeWidth="0.5" />
      {/* Piping border */}
      <line x1="0" y1="-3" x2="14" y2="-10" stroke="#fef3c7" strokeWidth="0.7" strokeOpacity="0.8" />

      {/* Right Rounded Armrest */}
      <path
        d="M 14,-6 L 14,-13 C 14,-16 19,-14 19,-11 L 19,-3 Z"
        fill="#d97706"
        stroke="#b45309"
        strokeWidth="0.5"
      />
      <ellipse cx="16.5" cy="-13.5" rx="2.5" ry="1.5" fill="#f59e0b" />

      {/* Retro Teal Accent Throw Pillow */}
      <polygon points="-12,-9 -8,-16 -4,-12 -8,-5" fill="#0d9488" stroke="#115e59" strokeWidth="0.5" />
      <polygon points="-12,-9 -8,-16 -7,-14 -10,-7" fill="#14b8a6" />
      <circle cx="-8" cy="-10.5" r="0.8" fill="#5eead4" />
    </g>
  );
}

/** Master Office Prop Selector */
export function OfficeProp({ propId }: { propId: string }) {
  switch (propId) {
    case 'cooler':
      return <WaterCoolerProp />;
    case 'server':
      return <ServerRackProp />;
    case 'coffee':
      return <CoffeeMachineProp />;
    case 'whiteboard':
      return <WhiteboardProp />;
    case 'plant':
      return <FicusPlantProp />;
    case 'sofa':
      return <SofaProp />;
    default:
      return null;
  }
}
