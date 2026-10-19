# Process Studio (AO-GRAPH-03)

Date: 2026-10-19. Status: implemented and tested locally. Not deployed.

Process Studio is the web plane for Workflow Core (see `workflow-core.md`):
it shows the pinned workflow graph, the state of each run and its evidence,
and offers the safe operator commands. The HTTP server is only a client of
the engine; progress never depends on a browser being open.

## Pieces

| Where | Responsibility |
| --- | --- |
| `agent_office/workflow/service.py` | `WorkflowService`: registers the canonical release definition, renders JSON views (definitions, run summaries, run detail with per-node badge states and allowed actions) and routes commands through `WorkflowEngine`. One lock serialises the shared SQLite connection; `start()` runs the coordinator in a background thread. |
| `agent_office/workflow/engine.py` | New operator controls: `pause_run`, `resume_run`, `authorize_retry`. |
| `agent_office/workflow/coordinator.py` | Skips paused runs (no submit, quota recheck or polling). Cancel intents still reach Bridge. |
| `agent_office/server.py` | `/api/workflow/*` routes, JSON errors, CORS. `main()` wires the service. |
| `web/src/components/process_studio/` | `GraphView`, `RunInspector`, `DebugControls`, `WorkflowSelector`, `NodeStatusBadge`, `ProcessStudio`. |
| `web/src/App.tsx` | Top navigation: **Process Studio** (default) and **Tycoon View** (isometric office). |

## REST API

All responses are JSON. Errors are `{"status": "error", "message": ...}`
with 400 (invalid input or a command not allowed in the current state),
404 (unknown run, definition or route), 500 (unexpected) or 503 (server
started without a workflow service).

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /api/workflow/definitions` | — | `definitions[]` (hash, name, version, node_count, canonical) and `canonical_hash` |
| `GET /api/workflow/definitions/{hash}` | — | nodes, `roles`, `allowed_transitions`, `node_order` (success path) |
| `POST /api/workflow/runs` | `goal` (required; or `inputs.goal`), optional `repo`, `working_dir`, `run_id`, `definition_hash` (default: canonical) | 201 with run detail |
| `GET /api/workflow/runs` | — | `runs[]` summaries and `summary` counts per status |
| `GET /api/workflow/runs/{id}` | — | run, `current_attempt` (with Task Bridge `task_id`), `attempts[]`, `node_states`, `gates`, `pending_gate`, `timeline`, `logs`, `evidence_digests`, `actions`, `bridge` |
| `POST /api/workflow/runs/{id}/pause` | optional `actor`, `reason` | run detail |
| `POST /api/workflow/runs/{id}/resume` | optional `actor`, `reason` | run detail |
| `POST /api/workflow/runs/{id}/cancel` | optional `reason` | cancel intent goes to Bridge; run detail |
| `POST /api/workflow/runs/{id}/approve` | `approver`, `scope` (required), optional `gate_id` | `result.gate_id`, `result.attempt_id` |
| `POST /api/workflow/runs/{id}/retry` | optional `actor`, `reason`, `confirm_side_effect` (bool) | `result.attempt_id` |

Every command is recorded in the run's transition journal (`paused`,
`resumed`, `cancel_requested`, `approved`, `retry_authorized`).

## Command rules

- **Pause** stops this run only. While paused, the coordinator does not
  submit new attempts, recheck quota or read Bridge outcomes. A task that is
  already running in Bridge keeps running. Its result, and any deadline, is
  applied after resume.
- **Cancel** works on a paused run too, and always goes through Bridge.
- **Approve** needs the exact gate scope (for publication:
  `publish:<built digest>`). A stale or mismatched scope is refused.
- **Retry** is allowed only for a `blocked` run whose current node's last
  attempt `failed` or `timed_out`. It re-runs that node only, in the same
  iteration, and allows at most one attempt beyond `max_attempts`.
  Side-effecting nodes (publication, delivery) also need
  `confirm_side_effect: true`. An attempt whose Bridge submission was never
  confirmed is refused, so a retry cannot duplicate work Bridge may already
  have.

## Running locally

```
python3 -m agent_office.server --port 8080
```

The workflow DB defaults to `workflow.sqlite3` next to the office DB. With
`--task-bridge-db <tasks.db>` (and `task_bridge` importable) the real Task
Bridge is used. Without it, a non-executing `FakeBridge` is used and run
details report `"bridge": "fake"`: tasks are created but nothing runs.
`--coordinator-interval 0` disables the background loop, and
`--no-workflow` turns off the API.

## Limits

- Graph editing (creating the next definition version) is not in the UI yet.
  The graph is read-only.
- Execution logs are coordinator intents, Bridge receipts and engine
  reasons. Executor stdout is not streamed.
- No authentication: the approver ID is self-declared. Bind the server to
  localhost only.
