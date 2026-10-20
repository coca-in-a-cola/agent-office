import React from 'react';
import { X, Trash2, Clock, ShieldAlert, Cpu } from 'lucide-react';
import { EditorNode } from '../../editorTypes';

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
    <div className="w-80 border-l border-slate-800 bg-[#0b1120] p-4 flex flex-col h-full overflow-y-auto text-xs">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-cyan-400" />
          <h3 className="font-bold text-slate-100 text-sm">Node Properties</h3>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {errors.length > 0 && (
        <div className="mb-3 p-2.5 rounded-lg border border-rose-500/50 bg-rose-950/40 text-rose-200 text-[11px] space-y-1">
          <span className="font-bold flex items-center gap-1 text-rose-400">
            <ShieldAlert size={12} /> Validation Issues:
          </span>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3.5 flex-1">
        {/* Node ID & Type */}
        <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 space-y-1 font-mono text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-500">ID:</span>
            <span className="text-cyan-300 font-semibold">{node.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Type:</span>
            <span className="text-purple-300 font-semibold">{node.type}</span>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-slate-400 text-[11px] font-medium mb-1">Node Name</label>
          <input
            type="text"
            value={node.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-slate-400 text-[11px] font-medium mb-1">Competency Role</label>
          <select
            value={node.role || ''}
            onChange={(e) => handleChange('role', e.target.value || undefined)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
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
        <div>
          <label className="block text-slate-400 text-[11px] font-medium mb-1">Goal / Description</label>
          <textarea
            rows={3}
            value={node.goal || ''}
            onChange={(e) => handleChange('goal', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none resize-none"
            placeholder="What does this step accomplish?"
          />
        </div>

        {/* Deadlines / Timeouts */}
        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2.5">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-[11px]">
            <Clock size={13} className="text-orange-400" />
            <span>Timeouts & Deadlines</span>
          </div>

          <div>
            <label className="block text-slate-400 text-[10px] mb-0.5">
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
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-[11px] focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-[10px] mb-0.5">
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
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-[11px] focus:border-cyan-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Budgets */}
        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2.5">
          <span className="text-slate-300 font-semibold text-[11px] block">
            Execution Budgets
          </span>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-400 text-[10px] mb-0.5">Max Attempts</label>
              <input
                type="number"
                min={1}
                max={20}
                value={node.budgets?.max_attempts ?? ''}
                onChange={(e) => handleBudgetChange('max_attempts', parseInt(e.target.value, 10))}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-[11px] focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[10px] mb-0.5">Max Subagents</label>
              <input
                type="number"
                min={0}
                max={10}
                value={node.budgets?.max_subagents ?? ''}
                onChange={(e) => handleBudgetChange('max_subagents', parseInt(e.target.value, 10))}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-[11px] focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Port Listing Summary */}
        <div className="space-y-1.5">
          <span className="text-slate-400 font-semibold text-[11px] block">
            Ports ({node.ports.length})
          </span>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {node.ports.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-1.5 bg-slate-950/60 rounded border border-slate-800/80 font-mono text-[10px]"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      p.kind === 'control'
                        ? 'bg-orange-400'
                        : p.kind === 'status'
                        ? 'bg-amber-400'
                        : 'bg-cyan-400'
                    }`}
                  />
                  <span className="text-slate-200 truncate">{p.name}</span>
                </div>
                <span className="text-slate-500 uppercase text-[9px] shrink-0">
                  {p.direction === 'input' ? 'in' : 'out'} · {p.kind}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Delete Node Action */}
      <div className="pt-4 border-t border-slate-800 mt-4">
        <button
          onClick={() => onDeleteNode(node.id)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800/60 text-rose-200 font-semibold transition text-xs"
        >
          <Trash2 size={13} />
          <span>Delete Node</span>
        </button>
      </div>
    </div>
  );
};
