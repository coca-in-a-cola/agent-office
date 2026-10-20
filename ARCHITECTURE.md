# Agent Office: Architecture Map & System Boundaries

This document provides a comprehensive architectural map of **Agent Office**, detailing its component pipelines, execution lifecycle, runtime ownership, authentication and trust boundaries, and product-versus-deployment configuration separation.

---

## 1. High-Level System Overview

Agent Office provides operational observability, state projection, and deterministic release orchestration for autonomous agents running under the [Hermes Agent framework](https://hermes-agent.nousresearch.com/docs).

The system integrates four core layers:
1. **Telemetry & Hook Ingestion**: Fail-open event taps inside the Hermes agent runtime.
2. **State Projection & Storage**: SQLite-backed local projections of agent presence, desk status, and task assignments.
3. **Workflow Core**: A deterministic, fail-closed finite state machine (FSM) executing multi-stage agent workflows through an immutable outbox pattern.
4. **Visual Web Planes**:
   - **Tycoon View**: Isometric 2.5D visual office projecting employee desks, workstation monitors, and workflow task assignments.
   - **Process Studio**: Interactive `@xyflow/react` node graph inspector displaying workflow definitions, run states, evidence digests, and operator controls.

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
|   - Activation & Guarded Writer-Stop Barriers (`activation.py`)                  |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (BridgePort protocol: submit/cancel/inspect)
                                          v
+-----------------------------------------------------------------------------------+
|                         Sole Task Bridge Execution Queue                          |
|   `agent_office/workflow/bridge_port.py`                                          |
|   - TaskBridgeAdapter (injected TaskBridge / tasks.db)                            |
|   - FakeBridge (persistent SQLite stand-in fixture)                              |
+-----------------------------------------------------------------------------------+
                                          |
                                          | (HTTP REST API / State Polling)
                                          v
+-----------------------------------------------------------------------------------+
|                         Presentation & Operator Plane                             |
|   `agent_office/server.py` (HTTP API Server)                                      |
|                                                                                   |
|   +----------------------------------+  +-------------------------------------+   |
|   | Tycoon View (web/src/App.tsx)    |  | Process Studio (XYFlow Graph View)  |   |
|   | - Isometric Office SVG           |  | - Run Inspector & Node Badges       |   |
|   | - Employee Roster                |  | - Operator Controls (Pause/Retry)   |   |
|   | - Workstation Monitor Terminal   |  | - Node Editor UI (Uncommitted WIP)  |   |
|   +----------------------------------+  +-------------------------------------+   |
+-----------------------------------------------------------------------------------+
```

---

## 2. End-to-End Pipeline & Data Flow

### 2.1 Hermes Plugin Hooks to Event Ingestion
- **Plugin Manifest & Discovery**: Hermes discovers and loads plugins via `manifest.yaml` and `plugin.yaml`, resolving entrypoint `agent_office:register`.
  - Authoritative manifest hook declarations: `session_start`, `session_end`, `before_turn`, `after_turn`, `before_tool_call`, `after_tool_call`.
  - Extended compatibility hook aliases: `on_session_start`, `on_session_end`, `pre_llm_call`, `post_llm_call`, `pre_tool_call`, `post_tool_call`.
- **Installation Prerequisites**: The plugin is installed by placing or symlinking the repository root into `~/.hermes/plugins/agent-office` or specifying its path in Hermes configuration.
- **Fail-Open Dispatch**: Hook listeners in `agent_office/hooks.py` forward callbacks to the singleton `EventDispatcher` (`agent_office/events.py`). All listener execution is wrapped in defensive exception handlers to guarantee that telemetry or storage errors never disrupt agent execution turns.
- **Event Persistence**: The event sink projects events into `OfficeStorage` (`agent_office/storage.py`), tracking active sessions, tool latencies, and agent activity logs in SQLite.

### 2.2 Ingestion & Workstation Projection
- **Read-Only Bridge Ingestion**: When launched with `--task-bridge-db <tasks.db>`, Agent Office periodically queries the external Task Bridge SQLite database in read-only mode (`mode=ro`).
- **Workstation Assignment**: Tasks are mapped to specific office desks via `resolve_bridge_workstation`:
  1. Explicit tags in metadata (`workstation: <id>`, `role: <id>`, `[godot]`, `[web]`).
  2. Model category heuristics (e.g., generator models mapped to Artist).
  3. Domain keywords (e.g., Godot/GDScript to Coder; React/Vite/TypeScript to WebDev).
  4. Fallback default workstation.
- **Workstation Terminal Monitoring**: Terminal output is obtained from task execution artifacts (`stdout.log` / `stderr.log`) or working directories, served via HTTP polling endpoints `GET /api/agents/{id}/monitor` and `GET /api/tasks/{task_id}/log`. Note that Agent Office uses standard HTTP REST requests; WebSockets and Server-Sent Events (SSE) are not implemented.

### 2.3 Workflow Core Execution Engine
- **Immutable Definitions**: Workflows are declared as `WorkflowDefinition` models with directed acyclic nodes and transitions. Definitions are canonicalized into JSON and hashed using `SHA-256`. A workflow run is permanently pinned to its initial `definition_hash`.
- **Atomic Reducer Pattern**: The `WorkflowEngine` operates as a pure state reducer. In a single database transaction (`BEGIN IMMEDIATE`), the engine:
  1. Validates the event receipt and idempotency key.
  2. Updates attempt status, verification receipts, and node iteration counters.
  3. Writes transition records into an append-only journal.
  4. Computes successor nodes and enqueues command intents (`submit`, `cancel`, `inspect`) into an outbox table.
- **Activation Boundary**: Successor nodes are scheduled through `agent_office/workflow/activation.py`, verifying that preceding attempts reached terminal state before releasing successor execution tokens.

### 2.4 Sole Task Bridge Execution Queue & FakeBridge
- **Sole Execution Boundary**: Workflow Core does not spawn worker subprocesses directly. The coordinator communicates exclusively through the `BridgePort` abstraction (`agent_office/workflow/bridge_port.py`).
- **External Dependency Prerequisites**: Live task execution requires the external `task_bridge` Python package (e.g. from `stage2-infra/src/task_bridge`) to be importable on `sys.path`, along with an active `tasks.db` database and execution artifacts directory.
- **FakeBridge Persistent Stand-in**: When running without Task Bridge, Agent Office utilizes `FakeBridge`—a persistent SQLite database (`workflow-fake-bridge.sqlite3`) storing `tasks` and `calls` tables. FakeBridge models Bridge's idempotency contract (`UNIQUE(idempotency_key)`) for testing and UI simulation without spawning live processes. It is NOT an ephemeral in-memory mock.
- **Idempotent Dispatch**: Every task dispatched carries a deterministic idempotency key:
  `agent-office-workflow:<run_id>/<node_id>/<iteration>/<attempt_id>`
- **Outbox Coordinator**: The background `Coordinator` thread (`agent_office/workflow/coordinator.py`) periodically wakes up to:
  1. Check due quota waits and backoff timers.
  2. Pull pending intents from the workflow repository outbox.
  3. Execute bridge submissions, cancellations, and inspections.
  4. Poll in-flight attempts and ingest completion receipts.

### 2.5 Presentation & Visual Planes
- **Process Studio**:
  - Rendered with `@xyflow/react` inside `web/src/components/process_studio/`.
  - Visualizes node order, status badges (`pending`, `running`, `completed`, `failed`, `blocked`, `quota_wait`, `approval_wait`), iteration counters, and execution evidence.
  - Exposes operator commands: `pause`, `resume`, `cancel`, `retry`, and `approve`.
  - *Tracked vs. Working Tree State*: Formal node editor contracts (v1 schemas and backend draft CRUD/validation APIs) are committed. Interactive visual node editor UI components (`EditorView.tsx`, `ConflictModal.tsx`, `NodeCatalogModal.tsx`) currently exist in the local working tree as uncommitted prototype code and are not shipped in the tracked release.
- **Tycoon View**:
  - Rendered with responsive SVG inside `web/src/components/IsometricOffice.tsx`.
  - Displays desks, active employees, tool execution indicators, and live terminal windows.
  - Workflow runs are projected onto desks: if an employee is assigned to an active workflow node, their desk displays the workflow badge and links into Process Studio.

---

## 3. Runtime Ownership & Auth / Trust Boundaries

```
+-----------------------------------------------------------------------------------+
| Process Boundary 1: Hermes Agent CLI / Runner                                    |
| - Runs under developer user identity.                                             |
| - Executes Hermes plugin hooks synchronously or asynchronously.                   |
| - Interacts with local storage via SQLite or HTTP bridge.                        |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
| Process Boundary 2: Agent Office HTTP Server (`agent_office/server.py`)           |
| - Owns HTTP listener, REST endpoints, and static web bundle hosting.             |
| - Hosts background Workflow Coordinator thread.                                   |
| - Connects to local `office.sqlite3` and `workflow.sqlite3`.                     |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
| Process Boundary 3: Task Bridge Subsystem (External)                              |
| - Manages worker agent subprocesses, execution environments, and sandboxes.       |
| - Owns `tasks.db` and execution artifacts directory.                              |
| - Agent Office accesses Task Bridge via BridgePort (injected API or read-only DB).|
+-----------------------------------------------------------------------------------+
```

### 3.1 Intended Security Model vs. Current Implementation State (AO-NE-06)

> **WARNING: NOT SECURITY-READY FOR UNTRUSTED DEPLOYMENTS**  
> The current working server implementation contains unaccepted security defects. It must NOT be exposed to untrusted networks or multi-tenant environments.

#### Intended Security Contract (Target State)
The target security architecture specifies strict defense-in-depth:
1. **Authenticated Operations**: All state-changing workflow operations require verified credentials (`Authorization: Bearer <token>` or `Authorization: Basic <credentials>`).
2. **Explicit Role Grants**: Operations are restricted by role (`managing_director`, `operator`, `guest`).
3. **Separation of Authoring and Release**: Graph definition publishing (`publish_definition`) requires distinct authorization from releasing production artifacts (`publish_artifact`).
4. **Header Impersonation Denial**: Headers like `X-Actor-ID` or `X-Remote-User` must be rejected unless accompanied by verified administrative credentials.
5. **CSRF & Origin Verification**: Mutating requests require matching `Origin` or `Referer` headers matching the server bind address.

#### Current Insecure / Unaccepted Implementation State (AO-NE-06)
Independent verification has identified critical defects in the current server code:
- **Hardcoded Local Token Bypass**: `agent_office/server.py` accepts a hardcoded static token string as valid authentication, allowing unauthorized callers with knowledge of the code to bypass credential validation.
- **Loopback Auto-Trust Bypass**: The server automatically grants full `managing_director` administrative privileges to unauthenticated requests originating from loopback IP addresses (`127.0.0.1`, `::1`, `localhost`) whenever authentication is not explicitly enforced.
- **Unverified Origin / CSRF Defenses**: While origin-checking logic is present in `server.py`, CSRF validation remains unaccepted pending independent penetration review.
- **Unaccepted Exact-Intent Binding**: Cryptographic approval bindings (`publish:<sha256>`) are defined conceptually, but end-to-end cryptographic enforcement across all state transitions is not verified.

Remediation of these defects is scheduled for follow-up security hardening. Until resolved, deployments must restrict server binding to isolated environments.

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

### 4.2 Durable Writer-Stop Barrier (AO-NE-05: Incomplete & Unaccepted)
A fundamental safety requirement in autonomous agent orchestration is preventing **split-brain concurrent execution**: a timed-out or cancelled agent must not continue writing code or modifying files after a successor recovery task has started.

1. **Timeout Inspection**: When an attempt reaches its configured deadline (excluding time spent waiting in the Task Bridge queue), the attempt is marked `timed_out` and an `inspect` intent is written.
2. **Guarded Reconciliation Barrier**: Before launching a recovery successor, the coordinator queries BridgePort to verify that the target task has reached a confirmed terminal state. If Task Bridge reports that the task cannot be confirmed stopped (or if transport fails), the workflow enters `reconciliation_required` state, blocking successor activation.
3. **Unaccepted State & Limitations**:
   - **Authoritative writer exclusion from database terminal state is NOT verified and remains unaccepted**.
   - The coordinator's `reconciliation_required` state prevents local successor dispatch, but true process-level writer exclusion requires active Task Bridge process-termination receipts that are not yet available or verified.
   - Never assume that a task marked `timed_out` in Workflow Core guarantees that the underlying worker process has ceased filesystem or database writes.

---

## 5. Implementation Status: Complete vs. Incomplete Features

| Subsystem / Capability | Status | Implementation Details |
| :--- | :--- | :--- |
| **Hermes Hook Ingestion** | **Complete** | Lifecycle hooks in `agent_office/hooks.py` with fail-open dispatch in `agent_office/events.py`. |
| **SQLite State Projections** | **Complete** | `agent_office/storage.py` tracks agent presence, operational metrics, and workstation mappings. |
| **Workstation Monitor** | **Complete** | Terminal log tailing via `/api/agents/{id}/monitor` and `/api/tasks/{task_id}/log` using HTTP polling. |
| **Workflow Engine & FSM** | **Complete** | Deterministic reducer in `agent_office/workflow/engine.py` with 7 standard outcome transitions. |
| **Outbox Coordinator** | **Complete** | Headless polling loop in `agent_office/workflow/coordinator.py` with backoff and quota recovery. |
| **Tycoon View UI** | **Complete** | Isometric 2.5D visual office in `web/src/components/IsometricOffice.tsx` linked to workflow runs. |
| **Process Studio Graph** | **Complete** | `@xyflow/react` visual graph, attempt timeline, run inspector, and operator execution controls. |
| **Node Editor Schemas (v1)** | **Complete** | JSON Schema v1 in `schemas/node-editor-v1.schema.json` and normative contracts in `docs/node-editor-contracts.md`. |
| **Draft Editor Backend API** | **Complete** | Draft CRUD and validation endpoints in `agent_office/editor/` (`save`, `load`, `validate`, `publish`). |
| **Visual Node Editor UI** | **In-Progress / Uncommitted** | Canvas editor components exist only in the working tree as uncommitted prototype files; not shipped. |
| **Writer-Stop Barrier (AO-NE-05)** | **Incomplete / Unaccepted** | Engine blocks unconfirmed timeouts as `reconciliation_required`. Authoritative writer exclusion from database terminal state is unverified and unaccepted; requires external Task Bridge stop receipts. |
| **Authentication & Security (AO-NE-06)** | **Insecure / Unaccepted Defects** | Working server implementation contains unaccepted security defects (static token bypass and loopback auto-trust); NOT security-ready. |
| **External Release Adapters** | **Incomplete** | Release tasks verify evidence hashes; external deployment plugins are stubbed. |
| **Workflow Graph Joins** | **Incomplete** | Sequential steps and branching supported; converging join nodes (`joined` token) are not yet in engine. |
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

### 6.1 Supported Configuration Settings & Pending Parameters
The following environment variables are actually read by current source code:

```bash
# Telemetry Database Path (read by agent_office/storage.py)
export AGENT_OFFICE_DB_PATH="/var/lib/agent-office/office.sqlite3"

# Authentication Secrets (read by agent_office/server.py)
# WARNING: Current server implementation has unaccepted security defects (AO-NE-06)
export AGENT_OFFICE_AUTH_TOKEN="generic-secure-random-token-min32chars"
export AGENT_OFFICE_BASIC_AUTH="operator:generic-secure-password"

# Optional Jev Router Settings (read by agent_office/routing.py)
export JEV_API_KEY="generic-router-api-key"
export JEV_ENDPOINT="https://router.example.com"
```

*Pending Environment Configuration*: Other deployment parameters (such as `--host`, `--port`, `--db-path`, `--workflow-db`, `--task-bridge-db`, and `--task-bridge-artifacts-dir`) must be passed via CLI arguments to `python3 -m agent_office.server`. Unified environment variable configuration for these CLI parameters is pending future implementation.

### 6.2 Decoupling Roadmap (Pending Extraction)
The codebase currently contains several hardcoded deployment values that must be extracted to external configuration during the next refactoring increment:
1. **Persona & Roster Extraction**:
   - `agent_office/server.py` (`DEFAULT_AGENTS`) and `web/src/App.tsx` hardcode employee identities (including the executive persona "Tyler").
   - *Followup*: Load employee roster dynamically from a configurable JSON/YAML file or `/api/config/roster`.
2. **Model Catalog Decoupling**:
   - `agent_office/server.py` and `agent_office/workflow/release_workflow.py` hardcode specific provider and model identifiers.
   - Proposed model-policy arrays and routing strategies are architectural capabilities; specific model endpoints and catalogs must be supplied via runtime configuration rather than hardcoded in source.
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
