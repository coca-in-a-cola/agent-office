# Agent Office

**Agent Office** is an operational telemetry, state projection, and workflow orchestration suite designed for autonomous agents running on the [Hermes Agent framework](https://hermes-agent.nousresearch.com/docs).

It provides a visual operations plane for observing autonomous agent fleets, tracking tool executions, inspecting workstation terminal outputs, and coordinating deterministic multi-stage release workflows with cryptographic evidence verification.

---

## 1. Features & Overview

- **Hermes Telemetry Ingestion**: Plugin hook adapter capturing agent sessions, turns, tool executions, and LLM call metrics without blocking agent execution.
- **Isometric Tycoon View**: A 2.5D visual office rendered in responsive SVG, projecting real-time agent status, active tasks, and employee desk assignments.
- **Workstation Monitor**: Terminal log tailing (`stdout`/`stderr`) served via HTTP polling from worker task execution artifacts.
- **Workflow Core**: A deterministic finite-state machine (FSM) managing multi-stage software release workflows with immutable hashed definitions, fail-closed SQLite persistence, and outbox intent scheduling.
- **Process Studio**: An interactive `@xyflow/react` node graph interface displaying run timelines, node execution badges, artifact evidence digests, and safe operator controls (`pause`, `resume`, `cancel`, `retry`, `approve`).
- **Cryptographic Evidence Verification**: Planned gate enforcement requiring cryptographic artifact fingerprints (`EvidenceRef`), author/reviewer independence checks, and exact-intent approval bindings.

---

## 2. Architecture & System Map

For an in-depth architectural breakdown, runtime ownership models, trust boundaries, and execution pipeline maps, see [ARCHITECTURE.md](ARCHITECTURE.md).

```
[ Hermes Agent Runtime ]
          │  (fail-open hooks: session/turn/tool via plugin adapter)
          ▼
[ Agent Office Plugin Adapter ] (`agent_office/hooks.py`)
          │  (structured event stream)
          ▼
[ OfficeStorage (SQLite) ] (`agent_office/storage.py`)
          │  (telemetry & workstation projection)
          ▼
[ Workflow Core FSM ] (`agent_office/workflow/`)
          │  (BridgePort protocol: submit/cancel/inspect)
          ▼
[ Task Bridge Execution Queue ] (sole execution boundary)
          │  (HTTP REST API / state serialization)
          ▼
[ Web UI Plane ] (Process Studio & Tycoon View)
```

---

## 3. Feature Status: What Works vs. Incomplete

| Component / Feature | Status | Notes |
| :--- | :--- | :--- |
| **Hermes Hook Ingestion** | **Working** | Lifecycle and tool hooks fail-open; event dispatcher tested and operational. |
| **Telemetry & Office Storage** | **Working** | SQLite local projection of agent sessions, tool latencies, and desk status (`agent_office/storage.py`). |
| **Isometric Tycoon Office** | **Working** | Responsive 2.5D visual office rendering desks, status badges, and employee rosters. |
| **Workstation Monitor** | **Working** | Terminal streaming of Task Bridge `stdout`/`stderr` logs per desk via HTTP endpoints. |
| **Workflow Engine & Reducer** | **Working** | Deterministic FSM handling 7 core outcome branches (`success`, `defect`, `timeout`, `failure`, `cancel`, `quota`, `approval_wait`). |
| **Process Studio Graph View** | **Working** | Interactive XYFlow graph rendering node states, attempt history, and operator execution controls. |
| **Node Editor Contracts (v1)** | **Working** | Formal schemas in `schemas/node-editor-v1.schema.json`; backend draft save/load/validate/publish API implemented. |
| **Visual Graph Editing UI** | **In-Progress / Uncommitted** | Draft editor components exist in local working tree as uncommitted prototype code; not shipped in tracked release. |
| **Writer-Stop Barrier (AO-NE-05)** | **Incomplete / Unaccepted** | Coordinator marks missing stop receipts as `reconciliation_required` to block successor dispatch, but authoritative writer exclusion from database terminal state is not verified and remains unaccepted; requires external Task Bridge support for live stop receipts. |
| **Authentication & Security (AO-NE-06)** | **Insecure / Unaccepted Defects** | Current working server copy contains unaccepted security defects (static token bypass and loopback auto-trust); NOT security-ready for public or untrusted network deployment. |
| **External Release Adapters** | **Incomplete** | Publication and delivery nodes verify evidence hashes; real deployment plugins are currently stubbed. |
| **Workflow Graph Joins** | **Incomplete** | Sequential steps and branching supported; multi-branch convergence (join nodes) is planned for future milestones. |
| **Distributed Multi-Coordinator** | **Incomplete** | Single coordinator process/thread per database assumed; distributed leases across nodes are not implemented. |
| **Task Bridge Continuation Sync** | **Incomplete** | Task Bridge continuation heuristics need integration to avoid automatically claiming tasks owned by active workflows. |

---

## 4. Prerequisites & Dependencies

Before installing and running Agent Office, ensure your environment has:
- **Python**: Version 3.11 or later (uses standard library modules: `sqlite3`, `http.server`, `urllib`, `dataclasses`, `typing`).
- **JavaScript Runtime & Package Manager**: [Bun](https://bun.sh/) (recommended) or Node.js 18+ / npm.
- **SQLite**: Version 3.35+ (with support for `RETURNING` clauses and `IMMEDIATE` transactions).
- **Hermes Agent Plugin Prerequisites**:
  - Compatible with standard [Hermes Agent releases](https://hermes-agent.nousresearch.com/docs).
  - Plugin manifests are defined in `manifest.yaml` and `plugin.yaml` with entrypoint `agent_office:register`.
  - Installed by placing or symlinking the repository root into `~/.hermes/plugins/agent-office` or configuring the plugin path in Hermes settings.
- **Task Bridge Execution Dependency (External)**:
  - Task Bridge is an external execution engine maintained outside this repository (e.g. `stage2-infra/src/task_bridge`).
  - *With Task Bridge*: Real task execution requires the `task_bridge` Python package to be importable on `sys.path`, pointing to a valid `tasks.db` database and execution artifacts directory.
  - *Without Task Bridge*: Agent Office runs out of the box using `FakeBridge` (a persistent SQLite stand-in database) for local development, UI testing, and workflow state simulation without executing live worker subprocesses.

---

## 5. Quickstart & Installation

### 5.1 Clone & Setup Environment

```bash
# Clone the repository from authoritative origin
git clone https://github.com/coca-in-a-cola/agent-office.git
cd agent-office

# Optional: Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
```

### 5.2 Build Web Frontend

The visual plane (Process Studio and Tycoon View) is built using Vite, React, Tailwind CSS, and XYFlow.

```bash
# Navigate to web directory
cd web

# Install dependencies
bun install
# (or: npm install)

# Build production bundle into web/dist
bun run build
# (or: npm run build)

# Return to repository root
cd ..
```

### 5.3 Run Unit Tests

The backend test suite runs with Python's built-in `unittest` runner:

```bash
# Run all unit test suites
python3 -m unittest discover tests

# Or run specific test groups
python3 -m unittest tests/test_hooks.py tests/test_storage.py tests/test_server.py
python3 -m unittest tests/test_workflow_activation.py tests/test_workflow_controls.py
python3 -m unittest tests/test_node_editor_contracts.py tests/test_node_editor_backend.py
```

### 5.4 Launch Agent Office Server

Launch the integrated HTTP server and Workflow Coordinator:

```bash
# Run standalone server with SQLite-backed FakeBridge (development / testing)
python3 -m agent_office.server --port 8080

# Run with real Task Bridge integration (requires task_bridge on sys.path and tasks.db)
python3 -m agent_office.server \
  --port 8080 \
  --task-bridge-db /path/to/task-bridge/tasks.db \
  --task-bridge-artifacts-dir /path/to/task-bridge/artifacts
```

Once running, navigate to `http://localhost:8080` in your browser:
- **Process Studio**: View active release workflows, inspect node states, and issue operator commands.
- **Tycoon View**: Switch to the isometric office to view desk assignments, agent statuses, and live workstation logs.

### 5.5 CLI Options Reference

The options accepted by `python3 -m agent_office.server --help`:

| Option | Default | Description |
| :--- | :--- | :--- |
| `--host <HOST>` | `127.0.0.1` | Binding host address. |
| `--port <PORT>` | `8080` | Port for the HTTP API and web interface. |
| `--static-dir <STATIC_DIR>` | `None` | Path to static web assets (defaults to built-in `web/dist`). |
| `--db-path <DB_PATH>` | `None` | Path to SQLite database for presence and telemetry (defaults to `.local/state/agent-office/office.sqlite3`). |
| `--workflow-db <WORKFLOW_DB>` | `None` | Workflow Core SQLite path (defaults to `workflow.sqlite3` next to office DB). |
| `--task-bridge-db <TASK_BRIDGE_DB>` | `None` | Real Task Bridge `tasks.db` path (requires `task_bridge` on `sys.path`). |
| `--task-bridge-artifacts-dir <PATH>` | `None` | Task Bridge artifacts dir holding `<task_id>/stdout.log` (defaults to Bridge's own default location). |
| `--fake-bridge-db <FAKE_BRIDGE_DB>` | `None` | Persistent SQLite path for FakeBridge when no Task Bridge is given (defaults to `workflow-fake-bridge.sqlite3` next to workflow DB). |
| `--coordinator-interval <SECONDS>` | `5.0` | Seconds between coordinator ticks (0 disables the loop). |
| `--no-workflow` | `False` | Disables Workflow Core endpoints and background coordinator. |

---

## 6. Product Configuration Boundaries

To maintain clean separation between the **reusable Agent Office product** and **private deployment configurations**, all private values, keys, and environment-specific paths must remain outside distributed files.

### 6.1 Supported Configuration Settings

The following environment variables are actually read by the current codebase:

```bash
# Telemetry Database Path (read by agent_office/storage.py)
export AGENT_OFFICE_DB_PATH="/var/lib/agent-office/office.sqlite3"

# Authentication Tokens (read by agent_office/server.py)
# NOTE: Current server implementation has unaccepted security defects (see ARCHITECTURE.md)
export AGENT_OFFICE_AUTH_TOKEN="replace-with-secure-32char-random-token"
export AGENT_OFFICE_BASIC_AUTH="operator:replace-with-secure-password"

# Optional Jev Router Settings (read by agent_office/routing.py)
export JEV_API_KEY="your-router-api-key"
export JEV_ENDPOINT="https://your-router-endpoint.example.com"
```

*Pending Configuration Support*: Other deployment parameters (such as server host, port, workflow DB location, and Task Bridge paths) are currently configured exclusively via CLI options (`--host`, `--port`, `--db-path`, `--workflow-db`, `--task-bridge-db`, `--task-bridge-artifacts-dir`). Environment variable mappings for these CLI flags (`AGENT_OFFICE_HOST`, `AGENT_OFFICE_PORT`, `AGENT_OFFICE_WORKFLOW_DB`, etc.) are pending future unified configuration extraction.

### 6.2 Configuration Separation Rules

1. **Credentials & Keys**: Passwords, Bearer tokens, and LLM API keys (`JEV_API_KEY`) must never be committed to repository code or defaults.
2. **Employee Roster & Personas**: Generic roles (`webdev`, `coder`, `qa`, `devops`, `architect`) are product capabilities; custom names, avatars, and employee rosters belong in deployment configuration.
3. **Model Routing Policies**: Model dispatch schemas and routing strategies are product features; specific model catalogs, provider endpoints, and fallback chains belong in runtime settings.
4. **Filesystem Paths**: Absolute home directory paths (`/home/...`) must never be hardcoded into production code.

*Note on decoupling roadmap*: A follow-up refactoring increment is scheduled to extract remaining hardcoded deployment personas (such as the default Tyler persona in `server.py`) and specific model identifiers into dynamic configuration loaders. See [ARCHITECTURE.md](ARCHITECTURE.md#62-decoupling-roadmap-pending-extraction) for details.

---

## 7. Documentation Index

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture map, runtime ownership, trust boundaries, and execution pipeline.
- [docs/workflow-core.md](docs/workflow-core.md) - Workflow Core engine, SQLite repository, and outcome transition rules.
- [docs/process-studio.md](docs/process-studio.md) - Process Studio REST API, command controls, and UI specifications.
- [docs/workstation-monitor.md](docs/workstation-monitor.md) - Workstation Monitor and Task Bridge ingestion rules.
- [docs/tycoon-projection.md](docs/tycoon-projection.md) - Tycoon View workflow projections and desk linking.
- [docs/node-editor-contracts.md](docs/node-editor-contracts.md) - Normative contracts and typed port grammar for Node Editor v1.
- [docs/workflow-runtime-decision.md](docs/workflow-runtime-decision.md) - Architectural decisions and runtime constraints.
- [Hermes Plugin Documentation](https://hermes-agent.nousresearch.com/docs) - Authoritative Hermes agent plugin specifications.

---

## 8. License

No formal license file is currently included in this repository. All rights are reserved by the repository owner unless otherwise specified. Do not assume an open-source license until an authoritative `LICENSE` file is committed.
