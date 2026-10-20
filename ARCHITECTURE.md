# Agent Office: Architecture Map & System Boundaries

This document provides a comprehensive architectural map of **Agent Office**, detailing its component pipelines, execution lifecycle, runtime ownership, authentication and trust boundaries, and product-versus-deployment configuration separation.

---

## 1. High-Level System Overview

Agent Office provides operational observability, state projection, and deterministic release orchestration for autonomous agents running under the [Hermes Agent framework](https://hermes-agent.nousresearch.com/docs).

The system integrates four core layers:
1. **Telemetry & Hook Ingestion**: Passive event taps inside the Hermes agent runtime.
2. **State Projection & Storage**: SQLite-backed local projections of agent presence, desk status, and task assignments.
3. **Workflow Core**: A deterministic, fail-closed finite state machine (FSM) executing multi-stage agent workflows through an immutable outbox pattern.
4. **Visual Web Planes**:
   - **Tycoon View**: Isometric 2.5D office visualizing employee desks, live monitors, and workflow task assignments.
   - **Process Studio**: `@xyflow/react` node graph inspector displaying workflow definitions, run states, evidence digests, and operator controls.

```
+-----------------------------------------------------------------------------------+
|                            Hermes Agent Runtime Environment                       |
|   Session Lifecycle / LLM Calls / Tool Execution Events                           |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (fail-open hook callbacks)
                                          v
+-----------------------------------------------------------------------------------+
|                        Agent Office Hermes Plugin Adapter                         |
|   `agent_office/hooks.py` -> `agent_office/events.py`                             |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (structured event stream)
                                          v
+-----------------------------------------------------------------------------------+
|                         Ingestion & Projection Engine                             |
|   `agent_office/storage.py` (OfficeStorage SQLite)                                |
|   - Agent presence & operational stats                                            |
|   - Workstation desk mapping (resolve_bridge_workstation)                         |
|   - Task Bridge read-only monitor ingestion (/api/agents/{id}/monitor)            |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (state query & workflow linking)
                                          v
+-----------------------------------------------------------------------------------+
|                                Workflow Core (FSM)                                |
|   `agent_office/workflow/`                                                        |
|   - Immutable Hashed Definitions (`definitions.py`)                              |
|   - Fail-Closed SQLite Repository (`storage.py`)                                  |
|   - Deterministic Reducer Engine (`engine.py`)                                    |
|   - Background Headless Coordinator (`coordinator.py`)                           |
|   - Activation & Writer-Stop Barriers (`activation.py`)                          |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (BridgePort protocol: submit/cancel/inspect)
                                          v
+-----------------------------------------------------------------------------------+
|                         Sole Task Bridge Execution Queue                          |
|   `agent_office/workflow/bridge_port.py`                                          |
|   - TaskBridgeAdapter (injected TaskBridge / tasks.db)                            |
|   - FakeBridge (in-memory / isolated test fixture)                                |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (REST API / WebSocket / SSE projection)
                                          v
+-----------------------------------------------------------------------------------+
|                         Presentation & Operator Plane                             |
|   `agent_office/server.py` (HTTP API Server)                                      |
|                                                                                   |
|   +----------------------------------+  +-------------------------------------+   |
|   | Tycoon View (web/src/App.tsx)    |  | Process Studio (XYFlow Graph View)  |   |
|   | - Isometric Office SVG           |  | - Run Inspector & Node Badges       |   |
|   | - Employee Roster                |  | - Operator Controls (Pause/Retry)   |   |
|   | - Workstation Monitor Terminal   |  | - Node Editor Draft Canvas (WIP)    |   |
|   +----------------------------------+  +-------------------------------------+   |
+-----------------------------------------------------------------------------------+
```

---

## 2. End-to-End Pipeline & Data Flow

### 2.1 Hermes Plugin Hooks to Event Ingestion
- **Hook Attachment**: Hermes loads plugins via `plugin.yaml` or `manifest.yaml`, resolving `agent_office:register`.
- **Lifecycle Taps**: The plugin registers listeners for `session_start`, `session_end`, `before_turn`, `after_turn`, `before_tool_call`, and `after_tool_call`.
- **Fail-Open Dispatch**: Hook listeners (`agent_office/hooks.py`) forward callbacks to the singleton `EventDispatcher` (`agent_office/events.py`). Listener execution is wrapped in safe exception barriers to prevent telemetry exceptions from interrupting agent execution.
- **Event Persistence**: The event sink projects events into `OfficeStorage` (`agent_office/storage.py`), tracking active sessions, tool latencies, and agent activity logs.

### 2.2 Ingestion & Workstation Projection
- **Read-Only Bridge Ingestion**: When configured with `--task-bridge-db <tasks.db>`, Agent Office periodically reads the external Task Bridge SQLite database in `mode=ro`.
- **Workstation Assignment**: Tasks are mapped to specific office desks via `resolve_bridge_workstation`:
  1. Explicit tags in metadata (`workstation: <id>`, `role: <id>`, `[godot]`, `[web]`).
  2. Model category heuristics (e.g., generator models mapped to Artist).
  3. Domain keywords (e.g., Godot/GDScript to Coder; React/Vite/TypeScript to WebDev).
  4. Fallback default workstation.
- **Live Monitoring**: The terminal stream for each workstation is extracted from task artifacts (`stdout.log` / `stderr.log`) or working directory files, served via `GET /api/agents/{id}/monitor` and `GET /api/tasks/{task_id}/log`.

### 2.3 Workflow Core Execution Engine
- **Immutable Definitions**: Workflows are declared as `WorkflowDefinition` models with directed acyclic nodes and transitions. Definitions are canonicalized into JSON and hashed using `SHA-256`. A workflow run is permanently pinned to its initial `definition_hash`.
- **Atomic Reducer Pattern**: The `WorkflowEngine` operates as a pure state reducer. In a single database transaction (`BEGIN IMMEDIATE`), the engine:
  1. Validates the event receipt and idempotency key.
  2. Updates attempt status, verification receipts, and node iteration counters.
  3. Writes transition records into an append-only journal.
  4. Computes successor nodes and enqueues command intents (`submit`, `cancel`, `inspect`) into an outbox table.
- **Durable Activation Barrier**: Successor nodes are not scheduled optimistically. `agent_office/workflow/activation.py` verifies that preceding attempts reached authoritative terminal state before releasing successor execution tokens.

### 2.4 Sole Task Bridge Execution Queue
- **Exclusive Worker Interface**: Workflow Core does not spawn subprocesses directly. The coordinator communicates exclusively through the `BridgePort` protocol (`agent_office/workflow/bridge_port.py`).
- **Idempotent Dispatch**: Every task dispatched to Task Bridge carries an idempotency key structured as:
  `agent-office-workflow:<run_id>/<node_id>/<iteration>/<attempt_id>`
- **Outbox Coordinator**: The headless `Coordinator` thread (`agent_office/workflow/coordinator.py`) periodically wakes up to:
  1. Check due quota waits and backoff timers.
  2. Pull pending intents from the workflow repository outbox.
  3. Execute bridge submissions, cancellations, and inspections.
  4. Poll in-flight attempts and ingest completion receipts.

### 2.5 Presentation & Visual Planes
- **Process Studio**:
  - Rendered with `@xyflow/react` inside `web/src/components/process_studio/`.
  - Visualizes node order, status badges (`pending`, `running`, `completed`, `failed`, `blocked`, `quota_wait`, `approval_wait`), iteration counters, and execution evidence.
  - Exposes operator commands: `pause`, `resume`, `cancel`, `retry`, and `approve`.
- **Tycoon View**:
  - Rendered with responsive SVG inside `web/src/components/IsometricOffice.tsx`.
  - Displays desks, active employees, tool execution indicators, and live terminal windows.
  - Workflow runs are projected onto desks: if an employee is assigned to an active workflow node, their desk displays the workflow badge and links directly into Process Studio.

---

## 3. Runtime Ownership & Auth / Trust Boundaries

```
+-----------------------------------------------------------------------------------+
| Process Boundary 1: Hermes Agent CLI / Runner                                    |
| - Runs under the developer's user identity.                                       |
| - Executes Hermes plugin hooks synchronously or asynchronously.                   |
| - Interacts with local storage via SQLite or HTTP bridge.                        |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
| Process Boundary 2: Agent Office HTTP Server (`agent_office/server.py`)           |
| - Owns the HTTP listener, REST endpoints, and static web bundle hosting.          |
| - Hosts the background Workflow Coordinator thread.                               |
| - Connects to local `office.sqlite3` and `workflow.sqlite3`.                     |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
| Process Boundary 3: Task Bridge Subsystem                                         |
| - Manages worker agent subprocesses, execution environments, and sandboxes.       |
| - Owns `tasks.db` and execution artifacts directory.                              |
| - Agent Office accesses Task Bridge via BridgePort (injected API or read-only DB).|
+-----------------------------------------------------------------------------------+
```

### 3.1 Authentication & Authorization Model
- **Bearer Token Verification**: Requests to protected `/api/workflow/*` endpoints require `Authorization: Bearer <token>`. The server verifies tokens against `AGENT_OFFICE_AUTH_TOKEN` (or programmatic server configuration).
- **Basic Auth Support**: `Authorization: Basic <base64>` is verified against `AGENT_OFFICE_BASIC_AUTH` or configured credentials map.
- **Header Impersonation Denial**: Headers such as `X-Actor-ID`, `X-Actor-Role`, `X-Remote-User`, and `X-Forwarded-User` are explicitly rejected with HTTP 403 unless verified credentials accompany the request.
- **CSRF & Origin Policy**: State-changing POST requests require matching `Origin` or `Referer` headers matching the server host and port, preventing cross-site scripting attacks from arbitrary origins.
- **Role & Actor Grants**: Actions are governed by explicit permission sets:
  - `managing_director`: Full control (`create_run`, `pause`, `resume`, `cancel`, `retry`, `approve`, `publish_artifact`, `publish_definition`, `read_logs`).
  - `operator`: Routine operational control (`create_run`, `pause`, `resume`, `cancel`, `retry`, `read_logs`).
  - `guest`: Read-only access.
- **Definition vs. Artifact Grant Separation**: Publishing a workflow definition (`publish_definition`) requires a distinct grant from authorizing deployment/artifact releases (`publish_artifact`). Privelege escalation between graph authoring and production release is strictly blocked.

### 3.2 Evidence Provenance & Reviewer Independence
- **Digest Fingerprinting**: Artifact outputs from workflow tasks are fingerprinted with cryptographic hashes (`compute_evidence_fingerprint`) and stored as immutable `EvidenceRef` records.
- **Author/Reviewer Independence**: A node marked `independent_of: ["implementation"]` (such as `acceptance` or `code_review`) validates that the actor or agent who produced the implementation cannot approve or provide acceptance evidence for their own work.
- **Exact-Intent Approval Gates**: Approval gates require exact scope matching (e.g., `publish:<sha256-digest>`). An approval token cannot be repurposed across different runs, different nodes, or altered artifact digests.

---

## 4. Sole Task Bridge Execution Queue & Writer-Stop Barrier

### 4.1 Task Bridge Execution Queue Contract
Task Bridge serves as the sole queue and execution engine for agent tasks. Agent Office does not maintain secondary worker pools or parallel execution runtimes.
- Commands enqueued in Workflow Core (`submit`, `cancel`, `inspect`) target Task Bridge tasks.
- The coordinator relies on Task Bridge task IDs to track progress, monitor timeouts, and capture evidence artifacts.

### 4.2 Durable Writer-Stop Barrier (AO-NE-05)
A critical invariant in autonomous agent orchestration is preventing **split-brain concurrent execution**: a timed-out or cancelled agent must not continue writing code or modifying files after a successor recovery task has started.

1. **Timeout Inspection**: When an attempt reaches its configured deadline (excluding time spent waiting in the Task Bridge queue), the attempt is marked `timed_out` and an `inspect` intent is written.
2. **Authoritative Stop Observation**: Before launching a recovery successor, the coordinator queries BridgePort to verify that the target task has reached a confirmed terminal state (`failed`, `cancelled`, or stopped).
3. **Reconciliation Barrier**: If Task Bridge reports that the task cannot be confirmed stopped (or if transport to Bridge fails), the workflow enters `reconciliation_required` state. It **durably blocks** successor activation until an operator or recovery probe confirms that the previous writer process has terminated.

---

## 5. Implementation Status: Complete vs. Incomplete Features

| Subsystem / Capability | Status | Implementation Details |
| :--- | :--- | :--- |
| **Hermes Hook Ingestion** | **Complete** | Full lifecycle hooks in `agent_office/hooks.py` with fail-open dispatch in `agent_office/events.py`. |
| **SQLite State Projections** | **Complete** | `agent_office/storage.py` tracks agent presence, operational metrics, and workstation mappings. |
| **Workstation Monitor** | **Complete** | Terminal log tailing via `/api/agents/{id}/monitor` and `/api/tasks/{task_id}/log` from Task Bridge artifacts. |
| **Workflow Engine & FSM** | **Complete** | Deterministic reducer in `agent_office/workflow/engine.py` with 7 standard outcome transitions. |
| **Outbox Coordinator** | **Complete** | Headless polling loop in `agent_office/workflow/coordinator.py` with exponential backoff and quota recovery. |
| **Tycoon View UI** | **Complete** | Isometric 2.5D visual office in `web/src/components/IsometricOffice.tsx` linked to workflow runs. |
| **Process Studio Graph** | **Complete** | `@xyflow/react` visual graph, attempt timeline, run inspector, and execution controls. |
| **Node Editor Schemas** | **Complete** | JSON Schema v1 in `schemas/node-editor-v1.schema.json` and normative contracts in `docs/node-editor-contracts.md`. |
| **Draft Editor Backend API** | **Complete** | Draft CRUD and validation endpoints in `agent_office/editor/` (`save`, `load`, `validate`, `publish`). |
| **Writer-Stop Barrier** | **Incomplete / Guarded** | Engine rejects unconfirmed timeouts as `reconciliation_required`. Full end-to-end integration requires active Task Bridge stop receipts. |
| **External Release Adapters** | **Incomplete** | Release tasks use Bridge task evidence checking; external publishing plugins are stubbed. |
| **Workflow Graph Joins** | **Incomplete** | Linear and branching sequences supported; converging join nodes (`joined` token) are not yet in engine. |
| **Visual Graph Editing UI** | **In-Progress** | Node Editor UI components are present in workspace (`ConflictModal`, `EditorNodeComponent`, `NodeCatalogModal`), pending frontend integration into main navigation. |
| **Distributed Multi-Coordinator** | **Incomplete** | Single coordinator thread per database is assumed; distributed leases across multiple hosts are not implemented. |
| **Continuation Exclusion** | **Incomplete** | Task Bridge continuation heuristics must be updated to avoid auto-picking successors for workflow-managed tasks. |

---

## 6. Product Configuration Boundaries

To maintain clean separation between the **reusable Agent Office product** and **specific deployment environments**, the following boundaries must be observed:

```
+-----------------------------------------------------------------------------------+
| DISTRIBUTABLE PRODUCT (Clean Repository)                                          |
| - Core Python packages (`agent_office/`)                                          |
| - Standard web frontend source & compiled assets (`web/`)                         |
| - Generic release schemas & normative contracts (`schemas/`, `docs/`)             |
| - Plugin entrypoints (`manifest.yaml`, `plugin.yaml`)                             |
| - Test suites with mock fixtures (`tests/`)                                       |
+-----------------------------------------------------------------------------------+
                                          |
                                    Configuration
                                      Boundary
                                          |
+-----------------------------------------------------------------------------------+
| EXTERNAL DEPLOYMENT ENVIRONMENT (Private Configuration & State)                   |
| - Authentication secrets (`AGENT_OFFICE_AUTH_TOKEN`, `AGENT_OFFICE_BASIC_AUTH`)   |
| - Model provider keys & routing policies (`JEV_API_KEY`, custom model catalogs)   |
| - Employee rosters, names, and customized avatars                                 |
| - Local filesystem paths (`--task-bridge-db`, `--task-bridge-artifacts-dir`)       |
| - Runtime databases (`office.sqlite3`, `workflow.sqlite3`)                        |
| - Live task logs & process outputs                                                |
+-----------------------------------------------------------------------------------+
```

### 6.1 Safe Generic Configuration Example
Deployment settings should be passed via environment variables or CLI flags without embedding private values in repository code:

```bash
# Server & Port Configuration
export AGENT_OFFICE_PORT=8080
export AGENT_OFFICE_HOST="127.0.0.1"

# Security & Authentication
export AGENT_OFFICE_AUTH_TOKEN="generic-secure-random-token-min32chars"
export AGENT_OFFICE_BASIC_AUTH="operator:generic-secure-password"

# Task Bridge Integration Paths
export TASK_BRIDGE_DB="/var/lib/task-bridge/tasks.db"
export TASK_BRIDGE_ARTIFACTS_DIR="/var/lib/task-bridge/artifacts"

# Database Storage Paths
export AGENT_OFFICE_DB="/var/lib/agent-office/office.sqlite3"
export AGENT_OFFICE_WORKFLOW_DB="/var/lib/agent-office/workflow.sqlite3"
```

### 6.2 Decoupling Roadmap (Pending Extraction)
The codebase currently contains several hardcoded deployment values that must be extracted to external configuration during the next refactoring increment:
1. **Persona & Roster Extraction**:
   - `agent_office/server.py` (`DEFAULT_AGENTS`) and `web/src/App.tsx` hardcode employee identities (including the executive persona "Tyler").
   - *Followup*: Load employee roster dynamically from a configurable JSON/YAML file or `/api/config/roster`.
2. **Model Catalog Decoupling**:
   - `agent_office/server.py` and `agent_office/workflow/release_workflow.py` hardcode specific provider and model identifiers.
   - *Followup*: Load available model routes and priority chains from a configuration file rather than hardcoding provider IDs.
3. **Local Filesystem Paths in Tests**:
   - Several unit tests (`tests/test_dogfooding.py`, `tests/test_workflow_engine.py`, `tests/test_workflow_activation.py`) contain hardcoded `/home/tyler/...` references.
   - *Followup*: Parameterize test paths using `tempfile.TemporaryDirectory` and environment variables.

---

## 7. Related Documentation

- [README.md](README.md) - Product overview, quickstart, installation, and testing guide.
- [docs/workflow-core.md](docs/workflow-core.md) - Workflow Core engine and outcome policies.
- [docs/process-studio.md](docs/process-studio.md) - Process Studio HTTP API and UI specifications.
- [docs/workstation-monitor.md](docs/workstation-monitor.md) - Workstation Monitor and Task Bridge ingestion rules.
- [docs/tycoon-projection.md](docs/tycoon-projection.md) - Tycoon View workflow projections.
- [docs/node-editor-contracts.md](docs/node-editor-contracts.md) - Normative contracts for Node Editor v1.
- [docs/workflow-runtime-decision.md](docs/workflow-runtime-decision.md) - Architectural decisions and runtime constraints.
