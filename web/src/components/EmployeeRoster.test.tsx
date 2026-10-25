import { describe, expect, it } from 'bun:test';
import { plugin } from 'bun';
import ReactDOMServer from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent, BridgeTask, WorkflowAssignment } from '../types';

try {
  plugin({
    name: 'scss-mock',
    setup(build) {
      build.onLoad({ filter: /\.scss$/ }, () => ({
        contents: '',
        loader: 'js',
      }));
    },
  });
} catch {
  // Plugin already registered in process
}

const { EmployeeRoster } = await import('./EmployeeRoster');

function renderRoster(props: Parameters<typeof EmployeeRoster>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ReactDOMServer.renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <EmployeeRoster {...props} />
    </QueryClientProvider>
  );
}

const createMockAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'agent-1',
  profile_name: 'Test Agent',
  role: 'Engineer',
  status: 'working',
  current_model: 'claude-3-5-sonnet',
  capabilities: ['coding', 'review'],
  ...overrides,
});

const createMockWorkflowAssignment = (
  overrides: Partial<WorkflowAssignment> = {}
): WorkflowAssignment => ({
  workstation: 'desk-1',
  assignment: 'performer',
  status: 'working',
  run_id: 'run-991',
  run_status: 'running',
  status_reason: null,
  definition_name: 'feature-pipeline',
  title: 'Feature Implementation',
  node: 'review-step',
  role: 'engineer',
  current_task: 'Reviewing component styling',
  attempt_id: null,
  attempt_status: null,
  iteration: 1,
  task_id: null,
  gate_id: null,
  updated_at: Date.now(),
  ...overrides,
});

const createMockBridgeTask = (overrides: Partial<BridgeTask> = {}): BridgeTask => ({
  task_id: 'bridge-task-007',
  title: 'Sync schema evolution',
  state: 'running',
  executor: 'hermes-worker',
  model: 'claude-3-5-sonnet',
  artifacts: [],
  is_live: true,
  workstation: 'desk-2',
  ...overrides,
});

describe('EmployeeRoster component SSR markup', () => {
  it('renders aside shell and empty state markup when no agents are provided', () => {
    const html = renderRoster({
      agents: [],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('employee-roster');
    expect(html).toContain('aria-label="Employee roster"');
    expect(html).toContain('roster-header');
    expect(html).toContain('0 AGENTS');
    expect(html).toContain('roster-empty');
    expect(html).toContain('No agents found matching the current filter.');
  });

  it('renders header, search input, and filter bar buttons markup', () => {
    const agent = createMockAgent({ id: 'agent-1', status: 'working' });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-header__title');
    expect(html).toContain('Employee Roster');
    expect(html).toContain('1 AGENTS');
    expect(html).toContain('roster-search__input');
    expect(html).toContain('Search agents, roles, or models...');
    expect(html).toContain('roster-filter-bar');
    expect(html).toContain('roster-filter-btn');
    expect(html).toContain('roster-filter-btn--active-all');
    expect(html).toContain('All (1)');
    expect(html).toContain('working (1)');
  });

  it('renders agent cards with semantic classes and unselected default avatar', () => {
    const agent = createMockAgent({
      id: 'agent-ops',
      profile_name: 'DevOps Lead',
      role: 'Operations',
      status: 'idle',
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-card');
    expect(html).not.toContain('roster-card--selected');
    expect(html).toContain('roster-avatar--default');
    expect(html).not.toContain('roster-avatar--selected');
    expect(html).not.toContain('roster-card__name-ping');
    expect(html).toContain('DevOps Lead');
    expect(html).toContain('Operations');
  });

  it('renders selected card modifier, ping indicator, and selected avatar modifier', () => {
    const agent = createMockAgent({
      id: 'webdev',
      profile_name: 'Tyler Web',
      role: 'webdev',
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: 'webdev',
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-card--selected');
    expect(html).toContain('roster-card__name-ping');
    expect(html).toContain('roster-avatar--selected');
  });

  it('renders webdev avatar modifier when unselected', () => {
    const agent = createMockAgent({
      id: 'webdev',
      profile_name: 'Frontend Builder',
      role: 'webdev',
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: 'other-id',
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-avatar--webdev');
    expect(html).not.toContain('roster-card--selected');
  });

  it('renders model row and model pill', () => {
    const agent = createMockAgent({
      current_model: 'openai/gpt-4o',
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-card__model-row');
    expect(html).toContain('roster-card__model-pill');
    expect(html).toContain('openai/gpt-4o');
  });

  it('renders workflow task block when workflow_assignment exists', () => {
    const agent = createMockAgent({
      workflow_assignment: createMockWorkflowAssignment({
        run_id: 'run-991',
        node: 'review-step',
        assignment: 'performer',
        status: 'working',
        run_status: 'running',
        current_task: 'Reviewing component styling',
      }),
      active_task_id: 'task-bridge-12',
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
      onOpenWorkflow: () => {},
    });

    expect(html).toContain('roster-task-block--workflow');
    expect(html).toContain('roster-task-block__label--workflow');
    expect(html).toContain('Workflow Step');
    expect(html).toContain('run-991');
    expect(html).toContain('Reviewing component styling');
    expect(html).toContain('running');
    expect(html).toContain('task-bridge-12');
  });

  it('renders bridge task block when bridge_task exists without workflow_assignment', () => {
    const agent = createMockAgent({
      bridge_task: createMockBridgeTask({
        task_id: 'bridge-task-007',
        title: 'Sync schema evolution',
        executor: 'hermes-worker',
        is_live: true,
        state: 'running',
      }),
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-task-block--bridge');
    expect(html).toContain('roster-task-block__label--bridge');
    expect(html).toContain('Bridge Task');
    expect(html).toContain('bridge-task-007');
    expect(html).toContain('Sync schema evolution');
    expect(html).toContain('hermes-worker');
    expect(html).toContain('live');
  });

  it('renders active task block when active_task exists without workflow/bridge tasks', () => {
    const agent = createMockAgent({
      active_task: {
        id: 'task-snap-1',
        title: 'Migrate SCSS selectors',
        status: 'in_progress',
        kanban_task_id: 'KAN-42',
        priority: 'high',
      },
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-task-block--task');
    expect(html).toContain('roster-task-block__label--task');
    expect(html).toContain('Active Task');
    expect(html).toContain('KAN-42');
    expect(html).toContain('Migrate SCSS selectors');
    expect(html).toContain('in_progress');
    expect(html).toContain('high');
  });

  it('renders empty task block when no task is assigned', () => {
    const agent = createMockAgent({
      workflow_assignment: null,
      bridge_task: null,
      active_task: null,
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-task-block--empty');
    expect(html).toContain('roster-task-block__empty-text');
    expect(html).toContain('No active task assigned');
  });

  it('renders tool call block with latency and preview when last_tool_call is present', () => {
    const agent = createMockAgent({
      last_tool_call: {
        id: 'act-1',
        agent_id: 'agent-1',
        event_type: 'tool_call',
        tool_name: 'patch_file',
        tool_input_preview: '{"path": "EmployeeRoster.tsx"}',
        latency_ms: 142.4,
        timestamp: Date.now(),
      },
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-tool-block');
    expect(html).toContain('roster-tool-block__label');
    expect(html).toContain('Last Tool Call');
    expect(html).toContain('142ms');
    expect(html).toContain('patch_file');
    expect(html).toContain('in: {&quot;path&quot;: &quot;EmployeeRoster.tsx&quot;}');
  });

  it('renders no-telemetry fallback when last_tool_call is not present', () => {
    const agent = createMockAgent({
      last_tool_call: null,
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-no-telemetry');
    expect(html).toContain('Awaiting telemetry events');
  });

  it('renders capabilities tags and overflow counter when capabilities exceed 4', () => {
    const agent = createMockAgent({
      capabilities: ['typescript', 'react', 'scss', 'testing', 'devops', 'architecture'],
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
    });

    expect(html).toContain('roster-capabilities');
    expect(html).toContain('roster-capability-tag');
    expect(html).toContain('typescript');
    expect(html).toContain('react');
    expect(html).toContain('scss');
    expect(html).toContain('testing');
    expect(html).not.toContain('devops');
    expect(html).toContain('roster-capability-overflow');
    expect(html).toContain('+2');
  });

  it('renders workflow assignment badge when workflow_assignment and onOpenWorkflow are provided', () => {
    const agent = createMockAgent({
      workflow_assignment: createMockWorkflowAssignment({
        run_id: 'run-88',
        node: 'build-node',
        assignment: 'approver',
        status: 'working',
        run_status: 'running',
        current_task: 'Building release',
      }),
      workflow_assignments: [
        createMockWorkflowAssignment({
          run_id: 'run-88',
          node: 'build-node',
          assignment: 'approver',
          status: 'working',
          run_status: 'running',
          current_task: 'Building release',
        }),
        createMockWorkflowAssignment({
          run_id: 'run-89',
          node: 'verify-node',
          assignment: 'performer',
          status: 'review',
          run_status: 'running',
          current_task: 'Verifying tests',
        }),
      ],
    });
    const html = renderRoster({
      agents: [agent],
      selectedAgentId: null,
      onSelectAgent: () => {},
      onOpenWorkflow: () => {},
    });

    expect(html).toContain('build-node');
    expect(html).toContain('· approve');
    expect(html).toContain('roster-card__workflow-more');
    expect(html).toContain('+1');
  });
});
