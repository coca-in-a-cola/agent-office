import React, { useState, useEffect } from 'react';
import { Agent, ModelProviderEntry } from '../types';
import { updateAgentPolicy } from '../api/agentPolicy';
import './EmployeeModelPolicyEditor.scss';

interface Props {
  agent: Agent;
}

interface DraftRow {
  provider: string;
  model: string;
}

interface LocalPolicy {
  models: ModelProviderEntry[];
  routing_strategy: 'priority' | 'round_robin';
}

export function EmployeeModelPolicyEditor({ agent }: Props) {
  const [localPolicyOverride, setLocalPolicyOverride] = useState<LocalPolicy | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftModels, setDraftModels] = useState<DraftRow[]>([]);
  const [draftStrategy, setDraftStrategy] = useState<'priority' | 'round_robin'>('priority');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local state whenever agent.id changes
  useEffect(() => {
    setLocalPolicyOverride(null);
    setIsEditing(false);
    setError(null);
  }, [agent.id]);

  const effectiveModels: ModelProviderEntry[] | undefined = localPolicyOverride
    ? localPolicyOverride.models
    : agent.models;

  const effectiveStrategy: 'priority' | 'round_robin' | undefined = localPolicyOverride
    ? localPolicyOverride.routing_strategy
    : agent.routing_strategy;

  const hasConfiguredPolicy = Array.isArray(effectiveModels) && effectiveModels.length > 0;

  const handleStartEdit = () => {
    if (hasConfiguredPolicy && effectiveModels) {
      setDraftModels(effectiveModels.map((item) => ({ provider: item.provider, model: item.model })));
    } else {
      setDraftModels([{ provider: '', model: '' }]);
    }
    setDraftStrategy(effectiveStrategy === 'round_robin' ? 'round_robin' : 'priority');
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleFieldChange = (index: number, field: 'provider' | 'model', value: string) => {
    setDraftModels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddRow = () => {
    setDraftModels((prev) => [...prev, { provider: '', model: '' }]);
  };

  const handleRemoveRow = (index: number) => {
    setDraftModels((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setDraftModels((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleMoveDown = (index: number) => {
    if (index === draftModels.length - 1) return;
    setDraftModels((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (draftModels.length === 0) {
      setError('At least one model entry is required.');
      return;
    }

    for (let i = 0; i < draftModels.length; i++) {
      const row = draftModels[i];
      if (!row.provider.trim() || !row.model.trim()) {
        setError(`Row #${i + 1} has an empty provider or model.`);
        return;
      }
    }

    const payload = {
      models: draftModels.map((row, index) => ({
        provider: row.provider.trim(),
        model: row.model.trim(),
        priority: index + 1,
      })),
      routing_strategy: draftStrategy,
    };

    setPending(true);
    try {
      const res = await updateAgentPolicy(agent.id, payload);
      setLocalPolicyOverride({
        models: res.agent.models,
        routing_strategy: res.agent.routing_strategy,
      });
      setIsEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="inspector-card employee-model-policy-editor">
      <div className="policy-header">
        <h3>Model & Policy</h3>
        {!isEditing && (
          <button
            type="button"
            className="policy-btn-edit"
            onClick={handleStartEdit}
          >
            Edit
          </button>
        )}
      </div>

      <p role="status">Saved policy only — not connected to the Hermes runtime. Saving does not change the running agent. Round Robin can be configured but is unsupported by the runtime.</p>
      <div className="policy-section">
        <span className="policy-subheading">Last Reported Model (telemetry)</span>
        <code className="policy-current-model">{agent.current_model || 'unknown'}</code>
      </div>

      {!isEditing ? (
        <div className="policy-section">
          <span className="policy-subheading">Saved Routing Policy — not applied to runtime</span>
          {hasConfiguredPolicy ? (
            <div className="policy-details">
              <div className="policy-meta-row">
                <span className="policy-meta-label">Routing Strategy:</span>
                <span className="policy-strategy-badge">
                  {effectiveStrategy === 'round_robin' ? 'Round Robin' : 'Priority'}
                </span>
              </div>
              <ol className="policy-models-list">
                {effectiveModels!.map((item, idx) => (
                  <li key={`${item.provider}-${item.model}-${idx}`} className="policy-model-item">
                    <span className="policy-rank">#{item.priority ?? idx + 1}</span>
                    <span className="policy-provider">{item.provider}</span>
                    <span className="policy-model-name">{item.model}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="policy-empty">No policy configured (unavailable)</div>
          )}
        </div>
      ) : (
        <form className="policy-edit-form" onSubmit={handleSave}>
          <div className="policy-form-group">
            <label htmlFor="routing-strategy-select" className="policy-label">
              Routing Strategy
            </label>
            <select
              id="routing-strategy-select"
              className="policy-select"
              value={draftStrategy}
              onChange={(e) => setDraftStrategy(e.target.value as 'priority' | 'round_robin')}
              disabled={pending}
            >
              <option value="priority">Priority</option>
              <option value="round_robin">Round Robin (runtime unsupported)</option>
            </select>
          </div>

          <div className="policy-models-edit-list">
            <label className="policy-label">Configured Models (Hierarchy)</label>
            {draftModels.map((row, index) => (
              <div key={index} className="policy-edit-row">
                <span className="policy-edit-rank">#{index + 1}</span>
                <input
                  type="text"
                  className="policy-input"
                  placeholder="Provider (e.g. anthropic)"
                  value={row.provider}
                  onChange={(e) => handleFieldChange(index, 'provider', e.target.value)}
                  disabled={pending}
                  aria-label={`Row ${index + 1} Provider`}
                />
                <input
                  type="text"
                  className="policy-input"
                  placeholder="Model (e.g. claude-3-7-sonnet)"
                  value={row.model}
                  onChange={(e) => handleFieldChange(index, 'model', e.target.value)}
                  disabled={pending}
                  aria-label={`Row ${index + 1} Model`}
                />
                <div className="policy-row-actions">
                  <button
                    type="button"
                    className="policy-btn-icon"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0 || pending}
                    title="Move up"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="policy-btn-icon"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === draftModels.length - 1 || pending}
                    title="Move down"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="policy-btn-icon policy-btn-danger"
                    onClick={() => handleRemoveRow(index)}
                    disabled={pending}
                    title="Remove model"
                    aria-label="Remove model"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="policy-btn-add"
              onClick={handleAddRow}
              disabled={pending}
            >
              + Add Model
            </button>
          </div>

          {error && (
            <div className="policy-error" role="alert">
              {error}
            </div>
          )}

          <div className="policy-form-actions">
            <button
              type="button"
              className="policy-btn-cancel"
              onClick={handleCancel}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="policy-btn-save"
              disabled={pending}
            >
              {pending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
