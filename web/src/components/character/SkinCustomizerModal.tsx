import { useState, useEffect } from 'react';
import { X, Palette, Sparkles, Check } from 'lucide-react';
import { CharacterSkin, CharacterHeadType, CharacterPose } from './characterTypes';
import { ModularCharacter } from './ModularCharacter';
import '../../styles/components/skin-customizer.scss';

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
    <div className="skin-customizer-modal__overlay">
      <div className="skin-customizer-modal__card">
        {/* Header */}
        <div className="skin-customizer-modal__header">
          <div className="skin-customizer-modal__title-group">
            <Palette className="skin-customizer-modal__title-icon" size={18} />
            <h2 className="skin-customizer-modal__title">Skin Customizer: {draftSkin.profileName || agentId}</h2>
          </div>
          <button onClick={onClose} className="skin-customizer-modal__close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="skin-customizer-modal__body">
          {/* Controls Left Column */}
          <div className="skin-customizer-modal__controls">
            {/* Swappable Heads */}
            <div className="skin-customizer-modal__section">
              <label className="skin-customizer-modal__section-label">
                Head Unit:
              </label>
              <div className="skin-customizer-modal__head-grid">
                {HEAD_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => setDraftSkin(s => ({ ...s, headType: type }))}
                    className={`skin-customizer-modal__head-btn ${
                      draftSkin.headType === type ? 'skin-customizer-modal__head-btn--active' : ''
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Palette Presets */}
            <div className="skin-customizer-modal__section">
              <label className="skin-customizer-modal__section-label">
                Chassis & Limb Presets:
              </label>
              <div className="skin-customizer-modal__preset-grid">
                {PRESET_PALETTES.map(p => (
                  <button
                    key={p.name}
                    onClick={() => setDraftSkin(s => ({ ...s, primaryColor: p.primary, accentColor: p.accent, jointColor: p.joint }))}
                    className="skin-customizer-modal__preset-btn"
                  >
                    <span className="skin-customizer-modal__preset-swatch" style={{ backgroundColor: p.accent }} />
                    <span className="skin-customizer-modal__preset-name">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Color Pickers */}
            <div className="skin-customizer-modal__picker-grid">
              <div className="skin-customizer-modal__picker-field">
                <label className="skin-customizer-modal__picker-label">Chassis</label>
                <input
                  type="color"
                  value={draftSkin.primaryColor}
                  onChange={e => setDraftSkin(s => ({ ...s, primaryColor: e.target.value }))}
                  className="skin-customizer-modal__picker-input"
                />
              </div>
              <div className="skin-customizer-modal__picker-field">
                <label className="skin-customizer-modal__picker-label">Accent</label>
                <input
                  type="color"
                  value={draftSkin.accentColor}
                  onChange={e => setDraftSkin(s => ({ ...s, accentColor: e.target.value }))}
                  className="skin-customizer-modal__picker-input"
                />
              </div>
              <div className="skin-customizer-modal__picker-field">
                <label className="skin-customizer-modal__picker-label">Joints</label>
                <input
                  type="color"
                  value={draftSkin.jointColor}
                  onChange={e => setDraftSkin(s => ({ ...s, jointColor: e.target.value }))}
                  className="skin-customizer-modal__picker-input"
                />
              </div>
            </div>

            {/* Accessories Toggles */}
            <div className="skin-customizer-modal__features-section">
              <label className="skin-customizer-modal__section-label">
                Accessories & Attachments:
              </label>
              <div className="skin-customizer-modal__features-grid">
                <label className="skin-customizer-modal__feature-item">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.monocle)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, monocle: e.target.checked } }))}
                    className="skin-customizer-modal__feature-checkbox"
                  />
                  <span>Monocle</span>
                </label>
                <label className="skin-customizer-modal__feature-item">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.dualExhaust)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, dualExhaust: e.target.checked } }))}
                    className="skin-customizer-modal__feature-checkbox"
                  />
                  <span>Dual Exhaust</span>
                </label>
                <label className="skin-customizer-modal__feature-item">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.antennaOrb)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, antennaOrb: e.target.checked } }))}
                    className="skin-customizer-modal__feature-checkbox"
                  />
                  <span>Antenna Beacon</span>
                </label>
                <label className="skin-customizer-modal__feature-item">
                  <input
                    type="checkbox"
                    checked={Boolean(draftSkin.features?.loupe)}
                    onChange={e => setDraftSkin(s => ({ ...s, features: { ...s.features, loupe: e.target.checked } }))}
                    className="skin-customizer-modal__feature-checkbox"
                  />
                  <span>Loupe / Lens</span>
                </label>
              </div>
            </div>
          </div>

          {/* Live Preview Stage Right Column */}
          <div className="skin-customizer-modal__stage-column">
            <div className="skin-customizer-modal__stage-header">
              <span className="skin-customizer-modal__stage-title"><Sparkles size={12} /> Live Rig Stage</span>
              <span className="skin-customizer-modal__stage-pose-name">{previewPose.replace('_', ' ')}</span>
            </div>

            {/* SVG Stage */}
            <div className="skin-customizer-modal__stage-view">
              <div className="skin-customizer-modal__stage-glow" />
              <svg viewBox="-80 -80 160 160" className="skin-customizer-modal__stage-svg">
                <ellipse cx="0" cy="40" rx="45" ry="15" fill="#000000" opacity="0.4" />
                <ModularCharacter skin={draftSkin} pose={previewPose} scale={1.25} />
              </svg>
            </div>

            {/* Pose Switcher Buttons */}
            <div className="skin-customizer-modal__pose-bar">
              {(['seated_work', 'seated_sleep', 'walking'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPreviewPose(p)}
                  className={`skin-customizer-modal__pose-btn ${
                    previewPose === p ? 'skin-customizer-modal__pose-btn--active' : ''
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
        <div className="skin-customizer-modal__footer">
          <button onClick={onClose} className="skin-customizer-modal__cancel-btn">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="skin-customizer-modal__save-btn"
          >
            <Check size={14} />
            <span>Apply Skin</span>
          </button>
        </div>
      </div>
    </div>
  );
}
