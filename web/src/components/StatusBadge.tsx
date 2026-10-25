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
import '../styles/components/status-badge.scss';

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
  const normalized = (status || '').toLowerCase() as AgentStatus;

  const config = {
    working: {
      modifier: 'working',
      label: 'Working',
      icon: Code2,
      indicator: (
        <span className="sb-dot-group">
          <span className="sb-dot sb-dot--working sb-dot--1" />
          <span className="sb-dot sb-dot--working sb-dot--2" />
          <span className="sb-dot sb-dot--working sb-dot--3" />
        </span>
      ),
    },
    researching: {
      modifier: 'researching',
      label: 'Researching',
      icon: Compass,
      indicator: (
        <span className="sb-ping-wrapper">
          <span className="sb-ping-outer" />
          <span className="sb-ping-inner" />
        </span>
      ),
    },
    review: {
      modifier: 'review',
      label: 'Review',
      icon: CheckCircle2,
      indicator: (
        <span className="sb-pulse-dot sb-pulse-dot--review" />
      ),
    },
    blocked: {
      modifier: 'blocked',
      label: 'Blocked',
      icon: AlertOctagon,
      indicator: (
        <span className="sb-ping-dot sb-ping-dot--blocked" />
      ),
    },
    awaiting_human: {
      modifier: 'awaiting-human',
      label: 'Awaiting human',
      icon: UserCheck,
      indicator: (
        <span className="sb-beacon-dot" />
      ),
    },
    defect: {
      modifier: 'defect',
      label: 'Defect',
      icon: Bug,
      indicator: (
        <span className="sb-pulse-dot sb-pulse-dot--defect" />
      ),
    },
    idle: {
      modifier: 'idle',
      label: 'Idle',
      icon: Moon,
      indicator: (
        <span className="sb-idle-dot" />
      ),
    },
  }[normalized] || {
    modifier: 'idle',
    label: (normalized || 'idle').replace(/_/g, ' '),
    icon: Moon,
    indicator: null,
  };

  const Icon = config.icon;

  const iconSizes = {
    sm: 11,
    md: 13,
    lg: 16,
  }[size];

  return (
    <span className={`status-badge status-badge--${config.modifier} status-badge--${size}`}>
      <Icon size={iconSizes} className="status-badge__icon" />
      <span>{config.label}</span>
      {showAnimation && config.indicator}
    </span>
  );
};
