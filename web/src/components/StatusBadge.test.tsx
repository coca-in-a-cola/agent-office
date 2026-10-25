import { describe, expect, it } from 'bun:test';
import { plugin } from 'bun';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import type { AgentStatus } from '../types';

plugin({
  name: 'scss-mock',
  setup(build) {
    build.onLoad({ filter: /\.scss$/ }, () => ({
      contents: '',
      loader: 'js',
    }));
  },
});

const { StatusBadge } = await import('./StatusBadge');

describe('StatusBadge component', () => {
  const statuses: { status: AgentStatus; modifier: string; label: string; indicatorClass: string }[] = [
    { status: 'working', modifier: 'working', label: 'Working', indicatorClass: 'sb-dot-group' },
    { status: 'researching', modifier: 'researching', label: 'Researching', indicatorClass: 'sb-ping-wrapper' },
    { status: 'review', modifier: 'review', label: 'Review', indicatorClass: 'sb-pulse-dot--review' },
    { status: 'blocked', modifier: 'blocked', label: 'Blocked', indicatorClass: 'sb-ping-dot--blocked' },
    { status: 'awaiting_human', modifier: 'awaiting-human', label: 'Awaiting human', indicatorClass: 'sb-beacon-dot' },
    { status: 'defect', modifier: 'defect', label: 'Defect', indicatorClass: 'sb-pulse-dot--defect' },
    { status: 'idle', modifier: 'idle', label: 'Idle', indicatorClass: 'sb-idle-dot' },
  ];

  const sizes: ('sm' | 'md' | 'lg')[] = ['sm', 'md', 'lg'];

  it.each(statuses)('renders status $status with modifier and label', ({ status, modifier, label, indicatorClass }) => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(StatusBadge, { status })
    );

    expect(html).toContain('status-badge');
    expect(html).toContain(`status-badge--${modifier}`);
    expect(html).toContain(`status-badge--md`);
    expect(html).toContain(label);
    expect(html).toContain(indicatorClass);
  });

  it.each(sizes)('renders size $size correctly', (size) => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(StatusBadge, { status: 'working', size })
    );

    expect(html).toContain(`status-badge--${size}`);
  });

  it('omits indicator when showAnimation is false', () => {
    for (const { status, indicatorClass } of statuses) {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(StatusBadge, { status, showAnimation: false })
      );

      expect(html).not.toContain(indicatorClass);
    }
  });

  it('renders fallback status safely', () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(StatusBadge, { status: 'custom_state' as AgentStatus })
    );

    expect(html).toContain('status-badge--idle');
    expect(html).toContain('custom state');
  });
});
