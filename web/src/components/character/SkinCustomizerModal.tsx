import { useState, useEffect } from 'react';
import { X, Palette, Sparkles, Check } from 'lucide-react';
import { CharacterSkin, CharacterHeadType, CharacterPose } from './characterTypes';
import { ModularCharacter } from './ModularCharacter';

interface Props {
  agentId: string;
  currentSkin: CharacterSkin;
  isOpen: boolean;
  onClose: () => void;
  onSave: (agentId: string, updatedSkin: CharacterSkin) => void;
}

const HEAD_TYPES: { type: CharacterHeadType; label: string }[] = [
  { type: 'crown', label: '👑 Crown' },
  { type: 'crt', label: '📺 CRT 4:3' },
  { type: 'lens', label: '🔬 Lens Turret' },
  { type: 'server', label: '🖲️ Server Blade' },
  { type: 'scanner', label: '🔍 Loupe Scanner' },
  { type: 'dome', label: '🛰️ Gyro Dome' },
  { type: 'standard', label: '🤖 Cyber Visor' },
];

const PRESET_PALETTES = [
  { name: 'Executive Gold', primary: '#451a03', accent: '#f59e0b', joint: '#d97706' },
  { name: 'Phosphor Green', primary: '#0f172a', accent: '#10b981', joint: '#059669' },
  { name: 'Neon Magenta', primary: '#1e293b', accent: '#ec4899', joint: '#db2777' },
  { name: 'NOC Cyber Blue', primary: '#0f172a', accent: '#3b82f6', joint: '#2563eb' },
  { name: 'Cleanroom Cyan', primary: '#083344', accent: '#06b6d4', joint: '#0891b2' },
  { name: 'Staging Sky', primary: '#082f49', accent: '#0ea5e9', joint: '#0284c7' },
  { name: 'Hazard Amber', primary: '#262626', accent: '#f59e0b', joint: '#d97706' },
  { name: 'Dark Monolith', primary: '#09090b', accent: '#a1a1aa', joint: '#71717a' },
];

export function SkinCustomizerModal({ agentId, currentSkin, isOpen, onClose, onSave }: Props) {
  const [draftSkin, setDraftSkin] = useState<CharacterSkin>({ ...currentSkin });
  const [previewPose, setPreviewPose] = useState<CharacterPose>('seated_work');

  useEffect(() => {
    if (isOpen) {
      try {
        const stored = JSON.parse(localStorage.getItem('agent_office_custom_skins') || '{}');
        if (stored[agentId]) {
          setDraftSkin({ ...stored[agentId] });
          return;
        }
      } catch {
        // Ignore malformed localStorage JSON — draft falls back to the agent's current skin
      }
      setDraftSkin({ ...currentSkin });
    }
  }, [currentSkin, isOpen, agentId]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(agentId, draftSkin);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <Palette className="text-amber-400" size={18} />
            <h2 className="font-semibold text-sm sm:text-base">Skin Customizer: {draftSkin.profileName || agentId}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Controls Left Column */}
          <div className="space-y-4">
            {/* Swappable Heads */}
            <div>
              <label className="text-[11px] font-mono uppercase text-slate-400 font-semibold block mb-1.5">
                Head Unit:
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {HEAD_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => setDraftSkin(s => ({ ...s, headType: type }))}
                    className={`px-2 py-1.5 rounded text-xs font-mono transition text-left border ${
                      draftSkin.headType === type
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/80 font-bold'
                        : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800 border-slate-700/60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Palette Presets */}
            <div>
              <label className="text-[11px] font-mono uppercase text-slate-400 font-semibold block mb-1.5">
                Chassis & Limb Presets:
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESET_PALETTES.map(p => (
                  <button
                    key={p.name}
                    onClick={() => setDraftSkin(s => ({ ...s, primaryColor: p.primary, accentColor: p.accent, jointColor: p.joint }))}
                    className="flex items-center gap-2 p-1.5 rounded bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-[11px] font-mono text-left"
                  >
                    <span className="w-3.5 h-3.5 rounded-full border border-slate-600 flex-shrink-0" style={{ backgroundColor: p.accent }} />
                    <span className="truncate text-slate-300">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Color Pickers */}
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-800">
              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">Chassis</label>
                <input
                  type="color"
                  value={draftSkin.primaryColor}
                  onChange={e => setDraftSkin(s => ({ ...s, primaryColor: e.target.value }))}
                  className="w-full h-7 rounded cursor-pointer bg-slate-800 border border-slate-700 p-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">Accent</label>
                <input
                  type="color"
                  value={draftSkin.accentColor}
                  onChange={e => setDraftSkin(s => ({ ...s, accentColor: e.target.value }))}
                  className="w-full h-7 rounded cursor-pointer bg-slate-800 border border-slate-700 p-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">Joints</label>
                <input
                  type="color"
                  value={draftSkin.jointColor}
                  onChange={e => setDraftSkin(s => ({ ...s, jointColor: e.target.value }))}
                  className="w-full h-7 rounded cursor-pointer bg-slate-800 border border-slate-700 p-0.5"
                />
              </div>
            </div>

            {/* Accessories Toggles */}
            <div className="pt-2 border-t border-slate-800">
              <label className="text-[11px] font-mono uppercase text-slate-400 font-semibold block mb-1.5">
                Accessories & Attachments:
              </label>
              <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                <label className="flex items-center gap-1.5 bg-slate-800/40 p-1.5 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.monocle)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, monocle: e.target.checked } }))}
                    className="rounded bg-slate-900 border-slate-700 text-amber-500"
                  />
                  <span>Monocle</span>
                </label>
                <label className="flex items-center gap-1.5 bg-slate-800/40 p-1.5 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.dualExhaust)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, dualExhaust: e.target.checked } }))}
                    className="rounded bg-slate-900 border-slate-700 text-amber-500"
                  />
                  <span>Dual Exhaust</span>
                </label>
                <label className="flex items-center gap-1.5 bg-slate-800/40 p-1.5 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.antennaOrb)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, antennaOrb: e.target.checked } }))}
                    className="rounded bg-slate-900 border-slate-700 text-amber-500"
                  />
                  <span>Antenna Beacon</span>
                </label>
                <label className="flex items-center gap-1.5 bg-slate-800/40 p-1.5 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.loupe)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, loupe: e.target.checked } }))}
                    className="rounded bg-slate-900 border-slate-700 text-amber-500"
                  />
                  <span>Loupe / Lens</span>
                </label>
              </div>
            </div>
          </div>

          {/* Live Preview Stage Right Column */}
          <div className="flex flex-col items-center justify-between bg-slate-950/60 border border-slate-800 rounded-lg p-3">
            <div className="w-full flex items-center justify-between text-xs text-slate-400 font-mono pb-2 border-b border-slate-800/80">
              <span className="flex items-center gap-1 text-amber-300"><Sparkles size={12} /> Live Rig Stage</span>
              <span className="capitalize">{previewPose.replace('_', ' ')}</span>
            </div>

            {/* SVG Stage */}
            <div className="w-full h-48 flex items-center justify-center relative overflow-hidden my-auto">
              <div className="absolute inset-0 bg-radial-gradient from-amber-500/10 via-slate-900/0 to-transparent pointer-events-none" />
              <svg viewBox="-80 -80 160 160" className="w-40 h-40">
                <ellipse cx="0" cy="40" rx="45" ry="15" fill="#000000" opacity="0.4" />
                <ModularCharacter skin={draftSkin} pose={previewPose} scale={1.25} />
              </svg>
            </div>

            {/* Pose Switcher Buttons */}
            <div className="w-full flex items-center gap-1 pt-2 border-t border-slate-800/80">
              {(['seated_work', 'seated_sleep', 'walking'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPreviewPose(p)}
                  className={`flex-1 py-1 rounded text-[10.5px] font-mono transition capitalize ${
                    previewPose === p
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {p === 'seated_work' && '💻 Work'}
                  {p === 'seated_sleep' && '💤 Sleep'}
                  {p === 'walking' && '🚶 Walk'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-slate-800 bg-slate-900/90">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs font-mono text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs font-mono transition shadow-md"
          >
            <Check size={14} />
            <span>Apply Skin</span>
          </button>
        </div>
      </div>
    </div>
  );
}
