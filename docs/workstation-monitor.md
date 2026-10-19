# Workstation Monitor and Task Bridge ingestion (AO-UI-01)

Tycoon View shows Task Bridge workers as office employees. Each employee has
a "monitor": a terminal that shows the log of the task they are working on.
The Coder now does Godot game work only. A new WebDev employee does the web
work.

## Employees

| id       | Role                     | Skills                                                              |
|----------|--------------------------|---------------------------------------------------------------------|
| `coder`  | Game Developer (Godot)   | godot4, gdscript, c_sharp, shaders, physics, rendering              |
| `webdev` | Web Engineer             | react, typescript, tailwind, vite, web_apis, browser_testing, performance |

WebDev is at server grid position `[2, 0]`. In the isometric office, its
sky-blue desk is in the front-right corner.

## Task Bridge ingestion

Start the server with `--task-bridge-db <tasks.db>`. Agent Office then reads
the Bridge database in read-only mode (`mode=ro`) on every `/api/state` call.
It never writes to Bridge. Logs are looked up in this order:

1. The `stdout.log` and `stderr.log` paths in the task's `artifacts` list.
2. `<artifacts dir>/<task_id>/`. Set this folder with
   `--task-bridge-artifacts-dir`. By default it is Bridge's own default:
   `$TASK_BRIDGE_ARTIFACTS_DIR`, then `$XDG_STATE_HOME/task-bridge/artifacts`,
   then `~/.local/state/task-bridge/artifacts`.
3. The task's working directory.

### Which desk gets a task

The rules are checked in this order (`resolve_bridge_workstation`):

1. **Explicit tag**: the project id, title or goal contains
   `workstation: webdev` (or `role:`, `desk:`, `assignee:`, `agent:`), or a
   tag in brackets such as `[godot]`. Recognized names: `webdev`, `web`,
   `frontend`, `godot`, `coder`, `devops`, `qa`, `artist`, `tyler`, and a few
   more.
2. **Execution model**: generator models (`tripo`, `hunyuan`, `meshy`) go to
   Artist.
3. **Keywords**: a keyword match in the title counts 3 points, a match in the
   goal counts 1. Godot, GDScript and shader words go to `coder`. React,
   TypeScript, Vite and web words go to `webdev`.
4. If nothing matches, the task goes to `tyler`.

### Desk status

- A `running` Bridge task sets the desk to `working`. It also sets
  `active_task_id` and `current_task`.
- A workflow assignment always wins over a Bridge task. A Bridge task that
  belongs to a workflow attempt is not counted a second time.
- Each agent also gets `bridge_task` (its running task) and `bridge_tasks`
  (its 5 most recent tasks).
- `meta.bridge_ingestion` is `ok`, `disabled` or `error`. Ingestion is
  fail-open: if the Bridge DB is missing, the office still loads.
- `is_live` is true when the task is `running` and its recorded `pid` is
  alive. If no pid is recorded, `is_live` follows the Bridge state.

## API

- `GET /api/agents/{id}/monitor[?tail=N]`: returns the agent's status, model
  and task, and `is_live`. It also returns the last N lines (default 100,
  maximum 1000) of `stdout_tail` and `stderr_tail`.
  - `source` is `task_bridge` when the agent has an active or recent Bridge
    task.
  - `source` is `activity` when there is no Bridge task but there are hook
    activity events. The `activity` field holds those lines.
  - Otherwise `source` is `idle`.
  - An unknown agent returns 404.
- `GET /api/tasks/{task_id}/log`: returns the task summary (state, model,
  executor, duration) and the raw `stdout` and `stderr` (the last 512 KB, with
  a `truncated` flag). It also returns `artifacts` with each file's size. An
  unknown task returns 404. If no Bridge is configured, it returns 503.

## UI

- In the agent inspector, **Workstation Monitor** (Terminal Live Stream)
  replaces the old "Recent Tool Executions" section. It is a black-and-green
  terminal that follows the end of the log. While the agent is `working`, it
  polls every 3 seconds. When there is nothing to show, it says "Agent
  workstation is idle (waiting for dispatch)".
- Clicking the task badge opens the **Task Bridge drill-down** modal. It has
  tabs for the stdout log, the stderr log and the artifacts. While the worker
  is alive, it refreshes every 3 seconds.
- The roster shows a "Bridge Task" card for agents that run a Bridge task.

## Limits

- Only terminal logs are shown. Streaming the screen of GUI workers is planned
  for later.
- The Claude executor writes `--output-format json`. Its stdout stays empty
  until the run ends, so a running Claude task often shows only stderr.
- The working-directory fallback can show logs from an older task that ran
  in the same folder.
- The heuristic router in `agent_office/routing.py` still keeps its own older
  Coder profile. It has no WebDev profile yet.
