import React from 'react';
import { X, Trash2, Clock, ShieldAlert, Cpu } from 'lucide-react';
import { EditorNode } from '../../editorTypes';
import '../../styles/components/node-properties-panel.scss';

interface NodePropertiesPanelProps {
  node: EditorNode | null;
  errors?: string[];
  onClose: () => void;
  onUpdateNode: (updated: EditorNode) => void;
  onDeleteNode: (nodeId: string) => void;
}

export const NodePropertiesPanel: React.FC<NodePropertiesPanelProps> = ({
  node,
  errors = [],
  onClose,
  onUpdateNode,
  onDeleteNode,
}) => {
  if (!node) return null;

  const handleChange = (field: keyof EditorNode, value: any) => {
    onUpdateNode({
      ...node,
      [field]: value,
    });
  };

  const handleDeadlineChange = (field: 'execution_timeout_seconds' | 'queue_timeout_seconds', value: number) => {
    onUpdateNode({
      ...node,
      deadlines: {
        ...node.deadlines,
        [field]: Number.isNaN(value) ? undefined : value,
      },
    });
  };

  const handleBudgetChange = (field: 'max_attempts' | 'max_subagents', value: number) => {
    onUpdateNode({
      ...node,
      budgets: {
        ...node.budgets,
        [field]: Number.isNaN(value) ? undefined : value,
      },
    });
  };

  return (
    <div className="ps-node-properties">
      <div className="ps-node-properties__header">
        <div className="ps-node-properties__title-group">
          <Cpu size={16} className="ps-node-properties__title-icon" />
          <h3 className="ps-node-properties__title">Node Properties</h3>
        </div>
        <button
          onClick={onClose}
          className="ps-node-properties__close-btn"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {errors.length > 0 && (
        <div className="ps-node-properties__errors">
          <span className="ps-node-properties__errors-title">
            <ShieldAlert size={12} /> Validation Issues:
          </span>
          <ul className="ps-node-properties__errors-list">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="ps-node-properties__content">
        {/* Node ID & Type */}
        <div className="ps-node-properties__meta-box">
          <div className="ps-node-properties__meta-row">
            <span className="ps-node-properties__meta-label">ID:</span>
            <span className="ps-node-properties__meta-val-id">{node.id}</span>
          </div>
          <div className="ps-node-properties__meta-row">
            <span className="ps-node-properties__meta-label">Type:</span>
            <span className="ps-node-properties__meta-val-type">{node.type}</span>
          </div>
        </div>

        {/* Name */}
        <div className="ps-node-properties__field">
          <label className="ps-node-properties__label">Node Name</label>
          <input
            type="text"
            value={node.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="ps-node-properties__input"
          />
        </div>

        {/* Role */}
        <div className="ps-node-properties__field">
          <label className="ps-node-properties__label">Competency Role</label>
          <select
            value={node.role || ''}
            onChange={(e) => handleChange('role', e.target.value || undefined)}
            className="ps-node-properties__select"
          >
            <option value="">(None / System)</option>
            <option value="webdev">webdev (Senior Web Engineer)</option>
            <option value="qa">qa (Independent Acceptance)</option>
            <option value="coder">coder (Game Developer)</option>
            <option value="devops">devops (Infrastructure)</option>
            <option value="tyler">tyler (Orchestrator)</option>
          </select>
        </div>

        {/* Goal */}
        <div className="ps-node-properties__field">
          <label className="ps-node-properties__label">Goal / Description</label>
          <textarea
            rows={3}
            value={node.goal || ''}
            onChange={(e) => handleChange('goal', e.target.value)}
            className="ps-node-properties__textarea"
            placeholder="What does this step accomplish?"
          />
        </div>

        {/* Deadlines / Timeouts */}
        <div className="ps-node-properties__section-box">
          <div className="ps-node-properties__section-title">
            <Clock size={13} className="ps-node-properties__section-icon" />
            <span>Timeouts & Deadlines</span>
          </div>

          <div>
            <label className="ps-node-properties__sub-label">
              Execution Timeout (seconds)
            </label>
            <input
              type="number"
              min={10}
              max={86400}
              step={30}
              value={node.deadlines?.execution_timeout_seconds ?? ''}
              onChange={(e) =>
                handleDeadlineChange('execution_timeout_seconds', parseInt(e.target.value, 10))
              }
              placeholder="e.g. 1800"
              className="ps-node-properties__number-input"
            />
          </div>

          <div>
            <label className="ps-node-properties__sub-label">
              Queue Timeout (seconds)
            </label>
            <input
              type="number"
              min={10}
              max={7200}
              step={30}
              value={node.deadlines?.queue_timeout_seconds ?? ''}
              onChange={(e) =>
                handleDeadlineChange('queue_timeout_seconds', parseInt(e.target.value, 10))
              }
              placeholder="e.g. 300"
              className="ps-node-properties__number-input"
            />
          </div>
        </div>

        {/* Budgets */}
        <div className="ps-node-properties__section-box">
          <span className="ps-node-properties__section-title">
            Execution Budgets
          </span>

          <div className="ps-node-properties__budget-grid">
            <div>
              <label className="ps-node-properties__sub-label">Max Attempts</label>
              <input
                type="number"
                min={1}
                max={20}
                value={node.budgets?.max_attempts ?? ''}
                onChange={(e) => handleBudgetChange('max_attempts', parseInt(e.target.value, 10))}
                className="ps-node-properties__number-input"
              />
            </div>
            <div>
              <label className="ps-node-properties__sub-label">Max Subagents</label>
              <input
                type="number"
                min={0}
                max={10}
                value={node.budgets?.max_subagents ?? ''}
                onChange={(e) => handleBudgetChange('max_subagents', parseInt(e.target.value, 10))}
                className="ps-node-properties__number-input"
              />
            </div>
          </div>
        </div>

        {/* Port Listing Summary */}
        <div className="ps-node-properties__ports">
          <span className="ps-node-properties__ports-title">
            Ports ({node.ports.length})
          </span>
          <div className="ps-node-properties__ports-list">
            {node.ports.map((p) => (
              <div
                key={p.id}
                className="ps-node-properties__port-item"
              >
                <div className="ps-node-properties__port-left">
                  <span
                    className={`ps-node-properties__port-dot ${
                      p.kind === 'control'
                        ? 'ps-node-properties__port-dot--control'
                        : p.kind === 'status'
                        ? 'ps-node-properties__port-dot--status'
                        : 'ps-node-properties__port-dot--data'
                    }`}
                  />
                  <span className="ps-node-properties__port-name">{p.name}</span>
                </div>
                <span className="ps-node-properties__port-meta">
                  {p.direction === 'input' ? 'in' : 'out'} · {p.kind}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Delete Node Action */}
      <div className="ps-node-properties__delete-section">
        <button
          onClick={() => onDeleteNode(node.id)}
          className="ps-node-properties__delete-btn"
        >
          <Trash2 size={13} />
          <span>Delete Node</span>
        </button>
      </div>
    </div>
  );
};
