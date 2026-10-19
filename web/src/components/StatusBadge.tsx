import React from 'react';
import { AgentStatus } from '../types';
import {
  Code2,
  Compass,
  CheckCircle2,
  AlertOctagon,
  UserCheck,
  Moon,
  Bug,
} from 'lucide-react';

interface StatusBadgeProps {
  status: AgentStatus;
  size?: 'sm' | 'md' | 'lg';
  showAnimation?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showAnimation = true,
}) => {
  const normalized = status.toLowerCase() as AgentStatus;

  const config = {
    working: {
      label: 'Working',
      bg: 'bg-emerald-950/80',
      border: 'border-emerald-500/50',
      text: 'text-emerald-300',
      glow: 'shadow-[0_0_12px_rgba(16,185,129,0.25)]',
      icon: Code2,
      indicator: (
        <span className="flex items-center gap-0.5 ml-1">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-dot-1" />
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-dot-2" />
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-dot-3" />
        </span>
      ),
    },
    researching: {
      label: 'Researching',
      bg: 'bg-blue-950/80',
      border: 'border-blue-500/50',
      text: 'text-blue-300',
      glow: 'shadow-[0_0_12px_rgba(59,130,246,0.25)]',
      icon: Compass,
      indicator: (
        <span className="relative flex h-2 w-2 ml-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
      ),
    },
    review: {
      label: 'Review',
      bg: 'bg-amber-950/80',
      border: 'border-amber-500/50',
      text: 'text-amber-300',
      glow: 'shadow-[0_0_12px_rgba(245,158,11,0.25)]',
      icon: CheckCircle2,
      indicator: (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-1 animate-pulse" />
      ),
    },
    blocked: {
      label: 'Blocked',
      bg: 'bg-rose-950/80',
      border: 'border-rose-500/50',
      text: 'text-rose-300',
      glow: 'shadow-[0_0_12px_rgba(244,63,94,0.3)]',
      icon: AlertOctagon,
      indicator: (
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 ml-1 animate-ping" />
      ),
    },
    awaiting_human: {
      label: 'Awaiting human',
      bg: 'bg-purple-950/80',
      border: 'border-purple-500/50',
      text: 'text-purple-300',
      glow: 'shadow-[0_0_12px_rgba(168,85,247,0.3)]',
      icon: UserCheck,
      indicator: (
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 ml-1 animate-beacon" />
      ),
    },
    defect: {
      label: 'Defect',
      bg: 'bg-orange-950/80',
      border: 'border-orange-500/50',
      text: 'text-orange-300',
      glow: 'shadow-[0_0_12px_rgba(249,115,22,0.3)]',
      icon: Bug,
      indicator: (
        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 ml-1 animate-pulse" />
      ),
    },
    idle: {
      label: 'Idle',
      bg: 'bg-slate-900/80',
      border: 'border-slate-700/60',
      text: 'text-slate-400',
      glow: '',
      icon: Moon,
      indicator: (
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 ml-1 opacity-60" />
      ),
    },
  }[normalized] || {
    label: normalized,
    bg: 'bg-slate-900/80',
    border: 'border-slate-700',
    text: 'text-slate-400',
    glow: '',
    icon: Moon,
    indicator: null,
  };

  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3.5 py-1.5 gap-2',
  }[size];

  const iconSizes = {
    sm: 11,
    md: 13,
    lg: 16,
  }[size];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border backdrop-blur-sm transition-all duration-200 ${config.bg} ${config.border} ${config.text} ${config.glow} ${sizeClasses}`}
    >
      <Icon size={iconSizes} className="shrink-0" />
      <span>{config.label}</span>
      {showAnimation && config.indicator}
    </span>
  );
};
