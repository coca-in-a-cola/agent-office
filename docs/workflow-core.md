# Workflow Core (AO-GRAPH-02)

Date: 2026-10-19. Status: implemented and tested locally. Not deployed, no
supervisor installed, not wired into the Hermes plugin or HTTP server.

## Modules (`agent_office/workflow/`)

| File | Responsibility |
| --- | --- |
| `definitions.py` | Immutable `NodeDefinition` / `WorkflowDefinition`. Every node must declare all 7 outcome branches. Hash = `sha256:` over canonical JSON (nodes, transitions, roles), independent of declaration order. Joins are rejected (not supported in this milestone). |
| `storage.py` | `WorkflowRepository`: own SQLite connection, `BEGIN IMMEDIATE` per mutation, rollback on any exception, no fallbacks. Triggers/indices: immutable definitions, run pinned to `definition_hash`, one active attempt per run, immutable unique `attempt_id <-> task_id`, append-only journal and receipts. |
| `engine.py` | `WorkflowEngine` reducer. A single transaction writes the receipt, attempt result, journal entry, successor attempt and its Bridge command intent (outbox). It never calls Bridge itself. |
| `coordinator.py` | Headless `Coordinator.run_once()` / `run_forever(stop)`. It resumes due quota waits, executes pending `submit`/`cancel`/`inspect` intents through the port, and polls submitted attempts. Assumes one coordinator per DB (no lease). |
| `bridge_port.py` | `BridgePort` protocol, `TaskBridgeAdapter` (injected public `TaskBridge` object, evidence read from a `workflow-evidence.json` artifact), `FakeBridge` (persistent SQLite, fault injection). |
| `release_workflow.py` | v1 release graph: implementation → acceptance → build → artifact_check → publication → delivery. |

## Outcome policy

| Outcome | Behaviour |
| --- | --- |
| success | The engine checks the evidence before advancing: artifact digests, required fields, `source_sha` matching the current implementation, a producer different from `independent_of` nodes, and digests matching the built artifact. Publication also needs an approved gate for that digest. Evidence that fails these checks is recorded as a failure. |
| defect | The target node starts a new iteration (max 2 per node per run). That node and everything after it lose their evidence (marked stale). Once the limit is reached, the run is blocked. |
| timeout | The attempt is marked `timed_out` and an inspect intent is written. Inspection reconciles the task in Bridge and asks Bridge to stop the task if it is still running. If the work completed and the evidence checks out, the run advances with no rerun. Otherwise there is one bounded recovery attempt that records the preserved SHA. Side-effecting nodes are blocked instead. Time a task spends queued in Bridge does not count toward the deadline. |
| failure | The graph routes it, usually to `@retry`: at most 2 attempts per iteration, then the run is blocked. Publication and delivery always go to blocked. Only this run stops; other runs keep going. |
| cancel | Operator cancel writes a cancel intent. It reconciles by idempotency key, so it also catches a submit whose acknowledgement was lost. Bridge does the cancelling and the run ends `cancelled`. A cancel coming from Bridge itself is terminal and starts no successor. |
| quota | The run waits in `quota_wait` with `due_at`, rechecking after 60, then 300, then 900 s. After that it is blocked. There is no tight retry loop. |
| approval_wait | Before publication starts, a gate is created with scope `publish:<built digest>`. Approval must match that scope. Rejection, expiry and revocation each block the run, and revocation also cancels any in-flight task. A Bridge `needs_approval` state parks the attempt behind its own gate. |

Duplicates are no-ops. An event_id already seen writes nothing; a new event for an attempt that is already resolved is stored as a `duplicate` receipt. Poll and wake events use deterministic ids (`bridge:<task>:<state>`, `deadline:<attempt>`). Bridge idempotency keys are `agent-office-workflow:<run>/<node>/<iteration>/<attempt>`. Before every submit, the coordinator reconciles by that key. A failed transport call is retried after 2, 4 and 8 s, and the run is blocked after the 4th failure.

## Not in scope / limits

- Joins and parallel branches; Process Studio and Tycoon wiring; migrating an existing run to a new version; a multi-coordinator lease.
- Real publication and delivery adapters. Release nodes are Bridge tasks, and the engine only checks the evidence they return.
- `continuation.py` has not yet been told to stop picking successors for workflow-owned tasks. That needs an agreed integration contract and separate authorization before any Bridge edit.
- No exactly-once guarantee for external effects. The `FakeBridge` UNIQUE key models the idempotency Bridge intends, not measured concurrency.
