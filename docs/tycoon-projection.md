# Tycoon View workflow projection (AO-GRAPH-04)

Tycoon View (isometric office and employee roster) shows Workflow Core runs
on the office desks. Desk state comes from the workflow database: runs, node
attempts with their Bridge task IDs, and approval gates. There is no
animation timer and no mock loop.

## Which desk does a node

| Node role              | Desk     |
|------------------------|----------|
| `implementer`          | `coder`  |
| `independent_reviewer` | `qa`     |
| `builder`              | `devops` |
| `artifact_checker`     | `qa`     |
| `publisher`            | `devops` |
| `owner_liaison`        | `tyler`  |

A role that is not in this table goes to a desk with the role's name. If that
desk does not exist yet, it is added as a minimal agent. Approval gates also
show on `tyler`, the manager who approves them.

## Desk status rules

Only the run's current node counts. Finished runs (`completed`, `cancelled`)
show nothing, so their desks are idle.

| Run status                      | Desk status                                  |
|---------------------------------|----------------------------------------------|
| `running`, `cancelling`         | `working`                                    |
| `waiting_approval`              | `review` (performer desk and manager desk)   |
| `blocked`, last attempt defect  | `defect`                                     |
| `blocked`, `inspecting`, `quota_wait` | `blocked` (`inspecting` = after a timeout) |
| no live run                     | `idle`, unless office hooks reported a status |

## `/api/state` fields per agent

- `current_task`: `"<run title> — <node>"`. The run title is `inputs.title`.
  If there is no title, the goal is used, and if there is no goal, the run ID.
- `active_task_id`: the Bridge task ID of the node attempt. It is `null`
  before Bridge accepts the attempt and while an approval gate is pending.
- `workflow_run_id` and `workflow_node`.
- `workflow_assignment`: the full main assignment (attempt, gate, run status,
  reason). `workflow_assignments` lists every live run on this desk. The most
  recently updated run comes first and sets the desk status.

`meta.workflow_projection` is `ok`, `disabled` (no workflow service) or
`error`. The projection is fail-open: if it raises an error, `/api/state`
still returns the office data and leaves the workflow fields empty.

Code: `WorkflowService.workstation_assignments()` in
`agent_office/workflow/service.py`, `apply_workflow_projection()` in
`agent_office/storage.py`, and `get_office_state()` in
`agent_office/server.py`.

## UI linking

- Isometric Office: each desk with a workflow step shows a `⎇ node` badge
  above it. Clicking that desk opens a quick preview with the node, run, and
  Bridge task or gate. **Open in Process Studio** switches tabs, selects the
  run and node, and draws a dashed cyan ring around the node. Clicking a desk
  with no workflow step opens the agent inspector, as before.
- Employee Roster: a node pill appears next to the agent name, and a
  "Workflow Step" card shows the step. Clicking either one jumps to the run.
- Agent inspector: lists all workflow assignments of the agent, with links.

## Limits

- The role-to-desk table is fixed in code. It is not read from agent profiles.
- The link to Process Studio is kept only in memory. Reloading the page clears
  it and does not reopen the run.
- No browser end-to-end test exists. The UI was checked with
  `bun run build` and type-check only.
