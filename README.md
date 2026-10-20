# Agent Office

**Agent Office** is an operational telemetry, state projection, and workflow orchestration suite designed for autonomous agents running on the [Hermes Agent framework](https://hermes-agent.nousresearch.com/docs).

It provides a visual operations plane for observing autonomous agent fleets, tracking tool executions, inspecting live terminal outputs, and orchestrating deterministic multi-stage release workflows with cryptographic evidence verification.

---

## 1. Features & Overview

- **Hermes Telemetry Ingestion**: Seamless hook adapter capturing agent sessions, turns, tool executions, and LLM call metrics without blocking agent execution.
- **Isometric Tycoon View**: A 2.5D visual office rendered in responsive SVG, projecting real-time agent status, active tasks, and employee desk assignments.
- **Workstation Monitor**: Live terminal log tailing (`stdout`/`stderr`) directly from worker task artifacts.
- **Workflow Core**: A deterministic finite-state machine (FSM) managing multi-stage software release workflows with immutable hashed definitions, fail-closed SQLite persistence, and outbox intent scheduling.
- **Process Studio**: An interactive `@xyflow/react` node graph interface displaying run timelines, node execution badges, artifact evidence digests, and safe operator controls (`pause`, `resume`, `cancel`, `retry`, `approve`).
- **Cryptographic Evidence Verification**: Strict gate enforcement requiring cryptographic artifact fingerprints (`EvidenceRef`), author/reviewer independence checks, and exact-intent approval bindings.

---

## 2. Architecture & System Map

For an in-depth architectural breakdown, runtime ownership models, trust boundaries, and execution pipeline maps, see [ARCHITECTURE.md](ARCHITECTURE.md).

```
[ Hermes Agent Runtime ]
          │  (fail-open hooks: session/turn/tool)
          ▼
[ Agent Office Plugin Adapter ] (`agent_office/hooks.py`)
          │  (structured event stream)
          ▼
[ OfficeStorage (SQLite) ] (`agent_office/storage.py`)
          │  (telemetry & monitor projection)
          ▼
[ Workflow Core FSM ] (`agent_office/workflow/`)
          │  (BridgePort protocol)
          ▼
[ Task Bridge Execution Queue ] (sole execution boundary)
          │  (REST API / State serialization)
          ▼
[ Web UI Plane ] (Process Studio & Tycoon View)
```

---

## 3. Feature Status: What Works vs. Incomplete

| Component / Feature | Status | Notes |
| :--- | :--- | :--- |
| **Hermes Hook Ingestion** | **Working** | Lifecycle and tool hooks fail-open; event dispatcher tested and operational. |
| **Telemetry & Office Storage** | **Working** | SQLite local projection of agent sessions, tool latencies, and desk status. |
| **Isometric Tycoon Office** | **Working** | Responsive 2.5D visual office rendering desks, status badges, and employee rosters. |
| **Workstation Monitor** | **Working** | Real-time terminal streaming of Task Bridge `stdout`/`stderr` logs per desk. |
| **Workflow Engine & Reducer** | **Working** | Deterministic FSM handling 7 core outcome branches (`success`, `defect`, `timeout`, `failure`, `cancel`, `quota`, `approval_wait`). |
| **Process Studio Graph View** | **Working** | Interactive XYFlow graph rendering node states, attempt history, and operator controls. |
| **Node Editor Contracts (v1)** | **Working** | Formal schemas in `schemas/node-editor-v1.schema.json`; backend draft save/load/validate/publish API. |
| **Writer-Stop Barrier (AO-NE-05)** | **Guarded / Incomplete** | When tasks time out, Workflow Core demands authoritative process-stop evidence before launching successor writers. If stop cannot be verified, the run durably blocks as `reconciliation_required` to prevent concurrent writes. Requires external Task Bridge support for live stop receipts. |
| **External Release Adapters** | **Incomplete** | Publication and delivery nodes verify evidence hashes; real deployment plugins are currently stubbed. |
| **Workflow Graph Joins** | **Incomplete** | Sequential steps and branching supported; multi-branch convergence (join nodes) is planned for future milestones. |
| **Visual Graph Editing UI** | **In-Progress** | Draft editor components are under development; the current web UI provides read-only inspection and execution controls. |
| **Distributed Multi-Coordinator** | **Incomplete** | Single coordinator process/thread per database assumed; distributed leases across nodes are not implemented. |
| **Task Bridge Continuation Sync** | **Incomplete** | Task Bridge continuation heuristics need integration to avoid automatically claiming tasks owned by active workflows. |

---

## 4. Prerequisites

Before installing and running Agent Office, ensure your environment has:
- **Python**: Version 3.11 or later (uses standard library modules: `sqlite3`, `http.server`, `urllib`, `dataclasses`, `typing`).
- **JavaScript Runtime & Package Manager**: [Bun](https://bun.sh/) (recommended) or Node.js 18+ / npm.
- **SQLite**: Version 3.35+ (with support for `RETURNING` clauses and `IMMEDIATE` transactions).
- **Hermes Agent**: Compatible with standard [Hermes Agent releases](https://hermes-agent.nousresearch.com/docs).
- **Task Bridge (Optional for Execution)**:
  - *With Task Bridge*: Real task execution requires access to the `task_bridge` Python package and a `tasks.db` database.
  - *Without Task Bridge*: Agent Office runs out of the box using `FakeBridge` for local testing, development, and workflow simulation without executing live worker subprocesses.

---

## 5. Quickstart & Installation

### 5.1 Clone & Setup Environment

```bash
# Clone the repository
git clone https://github.com/nousresearch/agent-office.git
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
# Run standalone server with in-memory FakeBridge (development / testing)
python3 -m agent_office.server --port 8080

# Run with real Task Bridge integration (requires tasks.db)
python3 -m agent_office.server \
  --port 8080 \
  --task-bridge-db /path/to/task-bridge/tasks.db \
  --task-bridge-artifacts-dir /path/to/task-bridge/artifacts
```

Once running, navigate to `http://localhost:8080` in your browser:
- **Process Studio**: View active release workflows, inspect node states, and issue operator commands.
- **Tycoon View**: Switch to the isometric office to view desk assignments, agent statuses, and live workstation logs.

### 5.5 CLI Options Reference

| Option | Default | Description |
| :--- | :--- | :--- |
| `--port <PORT>` | `8080` | Port for the HTTP API and web interface. |
| `--host <HOST>` | `0.0.0.0` | Bind address for the HTTP server. |
| `--db <PATH>` | `office.sqlite3` | SQLite path for agent presence and telemetry storage. |
| `--workflow-db <PATH>` | `workflow.sqlite3` | SQLite path for immutable definitions and workflow run FSM. |
| `--task-bridge-db <PATH>` | `None` | Path to Task Bridge SQLite database for live execution and logs. |
| `--task-bridge-artifacts-dir <PATH>` | `None` | Base directory containing task stdout/stderr log files. |
| `--coordinator-interval <SECONDS>` | `1.0` | Polling interval for background workflow coordinator (0 disables loop). |
| `--no-workflow` | `False` | Disables Workflow Core endpoints and coordinator entirely. |

---

## 6. Product Configuration Boundaries

To maintain clean separation between the **reusable Agent Office product** and **private deployment configurations**, all private values, keys, and environment-specific paths must remain outside distributed files.

### 6.1 Generic Configuration Template

Use environment variables to configure your deployment securely:

```bash
# Authentication & Access Control
export AGENT_OFFICE_AUTH_TOKEN="replace-with-secure-32char-random-token"
export AGENT_OFFICE_BASIC_AUTH="operator:replace-with-secure-password"

# Task Bridge Paths
export TASK_BRIDGE_DB="/var/lib/task-bridge/tasks.db"
export TASK_BRIDGE_ARTIFACTS_DIR="/var/lib/task-bridge/artifacts"

# Database Locations
export AGENT_OFFICE_DB="/var/lib/agent-office/office.sqlite3"
export AGENT_OFFICE_WORKFLOW_DB="/var/lib/agent-office/workflow.sqlite3"
```

### 6.2 Configuration Separation Rules

1. **Credentials & Keys**: Passwords, Bearer tokens, and LLM API keys (`JEV_API_KEY`) must never be committed to repository code or defaults.
2. **Employee Roster & Personas**: Generic roles (`webdev`, `coder`, `qa`, `devops`, `architect`) are product capabilities; custom names, avatars, and employee rosters belong in deployment configuration.
3. **Model Routing Policies**: Model dispatch schemas are product features; specific model catalogs, provider endpoints, and fallback chains belong in runtime settings.
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

Agent Office is licensed under the Apache 2.0 License.
