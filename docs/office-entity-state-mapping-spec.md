# Office-Entity State Mapping Spec
## Process / Node / Executor → Tycoon-View Office-Entity State

**Version:** 1.0.0  
**Task:** t_6cbcdec4  
**Applies to:** Agent Office — Tycoon View  
**Downstream tasks:** t_b5c2b2fb (backend projector), t_03cb1202 (UI lifecycle decoupling)

---

## 1. Purpose and Scope

This spec is the single authoritative source for how runtime events map onto
Tycoon-View office entities: employees, rooms, and workstations. Any code that
reads, writes, or reacts to office-entity state MUST derive that state solely
from the event definitions in this document. No separate "office state" table
or shadow store is permitted.

Three hard rules apply everywhere in this spec:

1. **Single truth.** Visual state (employee location, workstation occupancy,
   idle/blocked/working status) is a pure deterministic read-projection of
   the same event log that the Workflow Core engine and the Coordinator write.
   No mirror table, no cached copy. If the projection is rebuilt from the
   event log at any point it must produce identical results.

2. **No decorative statuses.** A visual status such as "working", "blocked",
   or "idle" is only shown if it is derivable from an event already present in
   the event log. A status that cannot be traced back to a concrete event MUST
   NOT be displayed. UI-only or animation-driven statuses are forbidden.

3. **XP and Competence are structurally independent.** They share no data
   source, no update trigger, and no derivation path. Changes to one MUST NOT
   propagate to the other.

---

## 2. Terminology

| Term | Definition |
|------|-----------|
| **Process** | A workflow run: a pinned instance of a WorkflowDefinition with a unique `run_id`. Rows in `workflow_runs`. |
| **Node** | A single step in the workflow graph. Each attempt is a row in `workflow_attempts`. |
| **Executor** | The Bridge task (profile/agent) that performs a node attempt. Identified by `task_id` in `workflow_attempts`. |
| **Employee** | Tycoon-View entity: one per named agent profile. Maps 1:1 to an agent desk in `agents` table. |
| **Room** | Tycoon-View entity: a named area of the office representing a workflow node or stage (e.g. "implementation", "review"). |
| **Workstation** | Tycoon-View entity: a slot on an employee's desk where an active task is shown. At most one per employee at any time. |
| **Event log** | The append-only sequence: `workflow_attempts`, `workflow_journals`, `workflow_intent_log`, `workflow_receipts`, plus any coordinator heartbeats. These rows are the ONLY truth source. |

---

## 3. Entity-to-Runtime Mapping

### 3.1 Employee = Executor (agent profile)

An Employee corresponds to one named agent profile. The profile name is the
stable identifier. The employee's presence or absence in a Room and the
state of their Workstation are derived entirely from run/node/executor events.

```
Employee identity:  agent_name (string, matches agents.agent_id)
Exists when:        an agents row for that profile exists in office storage
Not in a room:      no active attempt for that agent in a non-terminal run
```

### 3.2 Room = Workflow Node / Stage

A Room represents the logical stage of work described by a node's role. The
set of rooms is implied by the roles that have ever appeared in
`workflow_attempts.role` for the current definition. Rooms are NOT stored
explicitly; they are derived by grouping attempts by role.

```
Room identity:  attempt.role (string, e.g. "implementer", "independent_reviewer")
Room occupant:  the employee whose current active attempt has that role
Empty room:     no active attempt with that role in any non-terminal run
```

### 3.3 Workstation = Active Task Slot

A Workstation is occupied exactly when an executor is performing an attempt
that has not yet reached a terminal state. Only one workstation per employee
can be occupied simultaneously (the most recently updated active run takes
precedence when two runs claim the same desk — see Section 5.4).

```
Workstation occupant:   attempts.executor_profile (or derived from role-to-desk table)
Occupied since:         attempts.submitted_at (when Bridge accepted the attempt)
Vacant:                 no row in workflow_attempts matches
                            status IN ('pending','submitted')
                        for that employee's desk
```

---

## 4. State Machine: Employee ↔ Node Transitions

Employee-to-room transitions are driven ONLY by the events listed in this
section. Any transition not listed here MUST NOT occur.

### 4.1 Employee States

```
┌───────────────────────────────────────────────────────────────────────┐
│                        EMPLOYEE STATE MACHINE                         │
│                                                                       │
│   +--------+   RUN_STARTED / ATTEMPT_SUBMITTED                        │
│   │  IDLE  │ ─────────────────────────────────► ┌──────────┐         │
│   +--------+                                    │ WORKING  │         │
│       ▲                                         └──────────┘         │
│       │  ATTEMPT_TERMINAL (succeeded/cancelled)       │               │
│       │◄──────────────────────────────────────────────┘               │
│       │                                               │               │
│       │                        ATTEMPT_BLOCKED        ▼               │
│       │                        TIMEOUT_INSPECTING  ┌─────────┐       │
│       │◄────────────────────────────────────────── │ BLOCKED │       │
│       │  RUN_COMPLETED / RUN_CANCELLED              └─────────┘       │
│       │                                               │               │
│       │                        APPROVAL_WAIT          ▼               │
│       │                                           ┌────────┐         │
│       │◄────────────────────────────────────────── │ REVIEW │         │
│       │  GATE_APPROVED / GATE_REJECTED             └────────┘         │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.2 Employee State Definitions

| State | Display | Condition (derivable from event log) |
|-------|---------|--------------------------------------|
| IDLE | "idle" | No active attempt (`status IN ('pending','submitted')`) for this employee in any non-terminal run |
| WORKING | "working" | Attempt has `status = 'submitted'` AND run has `status IN ('running','cancelling')` |
| BLOCKED | "blocked" | Run has `status IN ('blocked','inspecting','quota_wait')` with this employee's last attempt on that run |
| REVIEW | "review" | Run has `status = 'waiting_approval'`; applies to both the performing employee and the manager (tyler desk) |
| DEFECT | "defect" | Run has `status = 'blocked'` AND last attempt for this employee has `status = 'defect'` |

### 4.3 Allowed Transitions

The following state transitions are valid. Any other transition is an error.

| From | To | Trigger Event |
|------|----|---------------|
| IDLE | WORKING | `attempt.status` transitions to `submitted` (Bridge accepted) |
| WORKING | IDLE | `run.status` transitions to `completed` or `cancelled` |
| WORKING | BLOCKED | `attempt.status` transitions to `timed_out`, `failed`, `quota` OR `run.status` → `blocked`, `inspecting`, `quota_wait` |
| WORKING | REVIEW | `run.status` transitions to `waiting_approval` |
| WORKING | DEFECT | `attempt.status` transitions to `defect` AND `run.status` → `blocked` |
| BLOCKED | WORKING | `attempt.status` transitions to `submitted` (retry authorized, coordinator submits next attempt) |
| BLOCKED | IDLE | `run.status` transitions to `cancelled` |
| REVIEW | WORKING | Approval gate approved, next node attempt `submitted` |
| REVIEW | IDLE | Gate rejected/revoked → `run.status` → `blocked` or `cancelled` |
| REVIEW | BLOCKED | Gate expired → `run.status` → `blocked` |
| DEFECT | WORKING | Retry authorized: `attempt.status` → `submitted` for retry attempt |
| DEFECT | IDLE | `run.status` → `cancelled` |
| * | IDLE | `run.status` → `completed` (run finished successfully) |

---

## 5. Event → State Mapping Table

This is the canonical lookup table. For every workflow event kind, the
Projector reads the described fields and applies the described office-state
change. No other event kinds produce office-state changes.

### 5.1 Process-Level Events (workflow_runs table changes)

| Event Kind | Trigger Condition | Office-State Change |
|-----------|-------------------|---------------------|
| `run_started` | New row inserted into `workflow_runs` with `status = 'running'` | Workstation for the start-node role becomes PENDING (waiting for first attempt submit) |
| `run_completed` | `workflow_runs.status` → `completed` | All employees on this run → IDLE; workstations cleared |
| `run_cancelled` | `workflow_runs.status` → `cancelled` | All employees on this run → IDLE; workstations cleared |
| `run_paused` | Journal entry `kind = 'paused'` | No office state change (process-level control, not executor state) |
| `run_resumed` | Journal entry `kind = 'resumed'` | No office state change (restores coordinator polling; next event will be attempt submit) |

### 5.2 Node-Level Events (workflow_attempts table changes)

| Event Kind | Trigger Condition | Office-State Change |
|-----------|-------------------|---------------------|
| `attempt_pending` | `workflow_attempts.status = 'pending'` inserted | No visible change (Bridge not yet notified); workstation occupancy reserved |
| `attempt_submitted` | `workflow_attempts.status` → `submitted` (Bridge `task_id` set) | Employee desk → WORKING; workstation shows `current_task`, `active_task_id`, `workflow_run_id`, `workflow_node` |
| `attempt_succeeded` | `workflow_attempts.status` → `succeeded` | Node complete; if run advancing to next node: same desk → IDLE briefly, then next role's desk → WORKING (from that role's attempt_submitted) |
| `attempt_failed` | `workflow_attempts.status` → `failed` | Employee desk → BLOCKED if max attempts reached; else stays WORKING during retry |
| `attempt_timed_out` | `workflow_attempts.status` → `timed_out` | Employee desk → BLOCKED (`inspecting`); `run.status` → `inspecting` |
| `attempt_defect` | `workflow_attempts.status` → `defect` | Employee desk → DEFECT if max defect iterations reached; else WORKING on new iteration |
| `attempt_quota` | `workflow_attempts.status` → `quota` | Employee desk → BLOCKED; `run.status` → `quota_wait` |
| `attempt_cancelled` | `workflow_attempts.status` → `cancelled` | Employee desk → IDLE |
| `attempt_awaiting_approval` | `workflow_attempts.status` → `awaiting_approval` | Employee desk → REVIEW; manager desk (tyler) → REVIEW |

### 5.3 Executor-Level Events (Bridge task status changes)

These arrive via Bridge polling in the Coordinator. They create attempt status
changes (which then trigger the events in 5.2 above). There is no direct
mapping from Bridge task status to office state; the indirection through
`workflow_attempts` is mandatory.

| Bridge Task Status | Workflow Attempt Outcome | Derives Via |
|-------------------|--------------------------|-------------|
| `succeeded` | `succeeded` or `defect` (based on evidence.verdict) | attempt_succeeded / attempt_defect |
| `failed` | `failed`, `quota`, or `timeout` (based on error text) | attempt_failed / attempt_quota / attempt_timed_out |
| `cancelled` | `cancelled` | attempt_cancelled |
| `needs_approval` | `awaiting_approval` | attempt_awaiting_approval |
| `running` / `queued` | (no terminal outcome yet) | No office-state change until terminal |

### 5.4 Conflict Resolution: Multiple Runs on One Desk

When two non-terminal runs both claim the same employee desk, the most
recently updated run wins: `MAX(workflow_runs.updated_at)` for runs that have
this employee's desk. This is the same rule as `WorkflowService.workstation_assignments()`.

---

## 6. Derivability Rule (No Decorative Statuses)

Rule: A status value MUST have an exact row in one of the following tables
that caused it. If no such row exists, the status MUST be omitted or rendered
as "idle".

Provable derivation path for each status:

```
WORKING  ←── workflow_attempts WHERE status='submitted'
              AND workflow_runs WHERE status IN ('running','cancelling')

BLOCKED  ←── workflow_runs WHERE status IN ('blocked','inspecting','quota_wait')
              AND workflow_attempts WHERE status IN ('failed','timed_out','quota')

REVIEW   ←── workflow_runs WHERE status='waiting_approval'

DEFECT   ←── workflow_runs WHERE status='blocked'
              AND workflow_attempts WHERE status='defect' (last attempt for this run)

IDLE     ←── (negation) none of the above conditions are true
```

Any status not derivable from one of these paths is a decorative status and
is FORBIDDEN. Specifically:

- Status set by a UI animation timer: FORBIDDEN.
- Status "inherited" from a previous run after that run is terminal: FORBIDDEN.
- Status "predicted" before a Bridge submission is confirmed: FORBIDDEN.
- Hardcoded default status in the `agents` table that is not reset by an event: FORBIDDEN.

---

## 7. XP vs Competence: Structural Separation

XP and Competence are distinct metrics with no shared state, no shared data
source, and no derivation path from one to the other.

### 7.1 XP (Experience Points) — Cosmetic Progression Metric

| Attribute | Value |
|-----------|-------|
| **Purpose** | Visual progression indicator; cosmetic badge; employee "leveling" in the Tycoon game layer |
| **Scope** | Per-employee aggregate, not per-task or per-run |
| **Data source** | Dedicated XP ledger: an append-only table `employee_xp_events (employee_id, run_id, node, delta, reason, created_at)` |
| **Update trigger** | Workflow run reaches `completed` status (success path only). XP is credited once per completed run per employee who had a submitted attempt on that run. |
| **Stored in** | `employee_xp_events` table (agent_office/storage, NOT workflow storage) |
| **Read by** | Tycoon-View cosmetic rendering only |
| **Never used for** | Routing decisions, capability assessment, task assignment, model selection |

XP update rule: when `workflow_runs.status` → `completed`, for each
employee desk that had `attempt.status = 'succeeded'` on that run, insert
one row into `employee_xp_events` with `delta = 1` and `reason = run_id`.
Duplicate inserts for the same `(employee_id, run_id)` pair MUST be
idempotent (UNIQUE constraint + INSERT OR IGNORE).

### 7.2 Competence — Functional Capability Metric

| Attribute | Value |
|-----------|-------|
| **Purpose** | Functional filter: determines which workflow node roles an executor profile is authorized to claim |
| **Scope** | Per-executor-profile, per-role |
| **Data source** | Executor profile configuration: `agent.capabilities[]` list in the agents table (populated by human operator or profile registration, never by workflow events) |
| **Update trigger** | ONLY by explicit operator action (profile update, capability grant/revoke). NEVER by running a workflow. NEVER by accumulating XP. |
| **Stored in** | `agents` table, `capabilities` JSON column |
| **Read by** | Workflow coordinator (role eligibility check before submitting), not by Tycoon View |
| **Never read from** | XP ledger, workflow_attempts, workflow_runs |

### 7.3 Separation Invariants

The following operations are structurally forbidden:

| Forbidden operation | Reason |
|--------------------|--------|
| Deriving competence from XP total or XP threshold | XP is cosmetic; competence is functional |
| Updating XP when competence changes | Different data sources, different triggers |
| Sharing a table or column between XP and competence | Would create a shared truth source |
| Reading `employee_xp_events` to authorize task submission | Would create an XP → competence derivation |
| Reading `agents.capabilities` to calculate XP | Would create a competence → XP derivation |
| Any formula `competence = f(XP)` or `XP = f(competence)` | Direct derivation |

Schema enforcement: the two data stores MUST NOT have a foreign-key or trigger
relationship with each other. Any query that JOINs `employee_xp_events` and
`agents.capabilities` for a business-logic decision (not a debug report)
MUST be rejected in code review.

---

## 8. Event Stream Identity

The event stream that the Projector consumes is the same event stream that the
Workflow Core engine writes. There is no separate "office event bus". The
Projector reads from these tables:

| Table | Contains |
|-------|---------|
| `workflow_runs` | Run lifecycle: status, `updated_at` |
| `workflow_attempts` | Attempt lifecycle: status, `task_id`, `role`, `submitted_at`, `updated_at` |
| `workflow_journals` | Operator commands (pause, resume, cancel_requested, approved, retry_authorized) |
| `workflow_receipts` | Deduplication: event_id already applied |
| `workflow_intent_log` | Coordinator intent execution (submit, cancel, inspect) |
| `workflow_gates` | Approval gates: scope, status |
| `agents` | Employee desk identity, capabilities |
| `employee_xp_events` | XP ledger (cosmetic only) |

The Projector MUST NOT write to `workflow_runs`, `workflow_attempts`, or any
workflow storage table. It is a read-only consumer. Any state it materializes
(e.g. a cached office state snapshot for `/api/state`) is a derivative artifact
and MUST be rebuildable by re-reading the tables above.

---

## 9. Rebuildability Requirement

The office entity state MUST be fully rebuildable from the event log at any
time. Procedure:

1. Clear any materialized office-state cache (do NOT clear `employee_xp_events`
   or `agents.capabilities` — those are primary stores, not caches).
2. Query `workflow_attempts` and `workflow_runs` to reconstruct current
   WORKING / BLOCKED / REVIEW / DEFECT / IDLE state for each employee.
3. Reconstruct XP totals by aggregating `employee_xp_events` (SUM of delta
   per employee_id).
4. The result MUST be identical to what was last cached.

This is the acceptance criterion for t_b5c2b2fb (backend projector task):
given a recorded sequence of events, the projector deterministically
reproduces correct office states.

---

## 10. Zero Duplicate Truth Source Checklist

| Question | Ruling |
|----------|--------|
| Is there a separate "office state" table that stores employee status independently of workflow_attempts? | FORBIDDEN |
| Can an employee be shown as "working" without a submitted attempt in workflow_attempts? | FORBIDDEN |
| Can an employee be shown as "idle" while having a submitted attempt in an active run? | FORBIDDEN |
| Are there two different tables that both store "current node for employee X"? | FORBIDDEN |
| Is XP stored in the same table as competence, or derived from it? | FORBIDDEN |
| Are decorative or hardcoded statuses present in the agents table that persist after a run ends? | FORBIDDEN |
| Does the Tycoon projector write any rows to workflow tables? | FORBIDDEN |
| Does the Workflow engine read from employee_xp_events for routing? | FORBIDDEN |

---

## 11. Relationship to Existing Code

The existing implementation in `WorkflowService.workstation_assignments()`
(agent_office/workflow/service.py) and `apply_workflow_projection()`
(agent_office/storage.py) partially satisfies this spec but has two gaps:

1. The `agents` table retains workflow projection fields (current_task,
   active_task_id, workflow_run_id, workflow_node) written by
   `apply_workflow_projection()`. These fields are a CACHE, not a truth source.
   The t_b5c2b2fb projector task MUST treat them as a cache that can be
   discarded and rebuilt, never as the primary store.

2. The XP ledger (`employee_xp_events`) does not exist yet. It MUST be created
   as part of t_b5c2b2fb. Until it exists, XP is not shown in the UI
   (not forbidden — just not implemented).

The competence field (`agents.capabilities`) already exists and is populated
by profile registration. No change needed to that field's data source.

---

## 12. Summary of Decisions for Downstream Workers

These decisions are made here and MUST be carried into t_b5c2b2fb and t_03cb1202:

| Decision | Value |
|----------|-------|
| Primary event log | workflow_runs + workflow_attempts + workflow_journals (read-only by projector) |
| Office state cache fields | current_task, active_task_id, workflow_run_id, workflow_node in agents table |
| Cache rebuild trigger | On every `/api/state` request AND on every coordinator tick |
| XP storage | employee_xp_events (append-only, in office storage db) |
| XP update trigger | run_completed event only, once per (employee, run) pair |
| Competence storage | agents.capabilities JSON column |
| Competence update trigger | Operator action only, never by workflow |
| Conflict rule (two runs, one desk) | Most recently updated run wins (MAX updated_at) |
| Projector is stateless? | YES — it reads event tables, produces derived state, never writes workflow tables |
| Office UI crash isolates processes? | YES — projector reconnects by reading event log from last known position (t_03cb1202) |
