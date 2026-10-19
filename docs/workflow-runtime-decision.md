# AO-GRAPH-01: Runtime Decision and Executable Compatibility Evidence

Date: 2026-10-19. Status: recommendation for independent manager acceptance,
not a deployed durable runtime. Source architecture:
`/home/tyler/agent-office-ledger/AO-WORKFLOW-ARCHITECTURE-01.md`, read completely.
The current brief explicitly authorizes this increment ahead of the older
The Spec sequencing. Other active work is unchanged.

## Decision

Recommend a minimal, fail-closed SQLite Workflow Core extension for the first
single-host release workflow. Reuse the existing Office SQLite infrastructure
and migration conventions, but NOT its fail-open write APIs or event dispatcher
as the authority for transitions. Give Core a dedicated repository/connection
boundary and an independently supervised, browser-independent coordinator.
Do not build a universal BPMN engine or another job execution queue.

This is a technology choice for a bounded milestone, conditional on GRAPH-02
passing crash/reconciliation acceptance. It is not evidence that the current
Office plugin already supplies durable orchestration. No supervisor or service
was installed or changed in GRAPH-01.

## Local Source Mapping

| Source | Observed contract and consequence |
| --- | --- |
| `agent_office/storage.py:178-240` | OfficeStorage opens explicit-path SQLite with WAL, foreign keys, busy timeout and a process-local RLock. Reuse storage technology, not an assumption of cross-process coordination from RLock. |
| `agent_office/storage.py:39-57,245-279` | Fail-open writes/migrations return fallbacks; migration scripts are not a workflow transition transaction. Authoritative Core needs fail-closed errors and explicit atomic migrations/transitions. |
| `agent_office/storage.py:608-651,988-1036` | Event rows use INSERT OR IGNORE; sink is best-effort telemetry. Duplicate telemetry insertion does not prove duplicate successor prevention. |
| `agent_office/events.py:50-159` | Bounded in-memory queue drops oldest telemetry; dispatcher catches callback failures. Neither is a durable command or completion inbox. |
| `agent_office/hooks.py:47-177` | Lifecycle hooks create telemetry events and intentionally fail open; they must not be the sole progress mechanism. |
| `agent_office/server.py:120-226,493-523` | HTTP projects Office state and serves assets; browser/server request lifetimes must not own workflow progress. Default workstations are presentation fallback, not real activity evidence. |
| `tests/test_storage.py`, `test_hooks.py`, `test_server.py`, `test_dogfooding.py` | Existing tests cover temp storage, fail-open hooks, HTTP projections and Hermes loading. New proof remains separate; no production semantics changed. |

Read-only Bridge comparison uses local
`/home/tyler/workspaces/stage2-infra/src/task_bridge/` sources, never imports or
constructs a real Bridge, reads its DB, or calls a live endpoint:

| Bridge source | Integration implication |
| --- | --- |
| `bridge.py:136-210` | submit_task accepts explicit idempotency_key and returns task ID; get_task reads status. Persist attempt identity before submitting and the returned ID afterward. |
| `storage.py:44,197-281` | Tasks have a UNIQUE idempotency key. Source-level intended duplicate handling is useful, but the submit path retries a failed save and can still return a generated ID: reconcile status before trusting an ambiguous acknowledgement. Real concurrency behavior was NOT exercised. |
| `bridge.py:218-268,327-382` | Bridge owns cancel, acquisition and process launch. Core only requests these actions; never starts/kills executors or acquires heavy slots directly. |
| `admission.py:156-273,291-300` | HeavyAdmissionLock and ProjectAdmissionLock own execution admission. Office must not copy their locks or implement a competing capacity policy. |
| `models.py:28-37,46-92` | TaskState is queued/running/succeeded/failed/cancelled/needs_approval/degraded; task has run_ids, artifacts, git_sha and exit_code. Workflow outcomes are a separate typed interpretation, not replacement task lifecycle. |
| `continuation.py:68-191` | Existing continuation selects queued portfolio work or an authorized successor; it is not a graph-version-aware transition engine. GRAPH-02 must designate ONE successor authority for workflow-owned tasks. |
| `storage.py:608-746`, `continuation.py:194-232` | Durable wake has separate delivery/ack/consume fields; consume occurs before continuation evaluation. It is not atomic with a separate workflow DB transition. A lost wake must be recoverable via stored task correlation/status reconciliation. Do not treat consume as successful graph advancement. |

Workflow Core alone owns definitions, graph versions, runs, node attempts,
transition policy, evidence and approvals. Bridge alone owns jobs, execution
lifecycle, admission and its existing outbox. Hermes retains agent events and
authorization. Studio and Tycoon are projections of Core plus Bridge evidence,
not independent state authorities. Cosmetic XP cannot satisfy acceptance.

## Alternative: Temporal

Temporal is the one mature durable-runtime alternative considered. Comparison
is architectural, not a current SDK/API compatibility claim. No internet or
provider probe, install, Temporal server start or Temporal workflow was run.
Local Python distribution inspection found no Temporal-named distribution in
the default interpreter. No Temporal dependency appears in the inspected Office
package manifests; no Python dependency manifest exists at the repository root.
These facts do not establish whether another environment has Temporal installed.

| Dimension | Minimal SQLite extension | Temporal alternative, unexercised here |
| --- | --- | --- |
| Dependency fit | Python stdlib SQLite already used by Office; fixture actually runs on it. No new dependency required for proof. | Would add a Python SDK plus a reachable durable Temporal service and workers; versions, deployment and compatibility would need a separately authorized offline/local evaluation. No version is claimed compatible. |
| Recovery | Must implement journal/inbox, submit reconciliation, due timers, bounded retries and worker lease/fencing correctly. Proof covers only the subset below. | History replay, durable timers and worker recovery are strengths of the runtime design; Office/Bridge adapter behavior and replay safety remain unmeasured. |
| Execution ownership | Coordinator only records workflow commands and submits to Bridge. SQLite intent records are not an executor queue. | Activities must be thin Bridge submit/status/reconcile adapters, NOT a second pool executing software jobs outside Bridge admission. |
| Versioning | Immutable definition/hash per run, explicit audited migration only. | Workflow replay/code evolution adds deployment/version compatibility obligations; a versioned Office graph is still necessary. |
| Operations | Small single-host surface; supervise coordinator, backups, migrations and bounded writer contention. Multi-host HA is not promised. | Additional service availability, retention, upgrades, persistence and worker operations. Can justify that cost later when durable coordination scope grows. |
| Main risk | Bespoke coordination correctness and operational maintenance. | More infrastructure plus adapter/replay correctness; adopting a mature engine does not remove external-effect ambiguity. |

Choose SQLite now because the narrow first workflow fits the current single-host
Python/SQLite system and the critical local transaction/reopen pattern has been
executed. This is not a performance benchmark or proof of superiority over
Temporal. Revisit for multi-host coordination, HA requirements or many complex
long-lived workflows; do not stretch this fixture into a general engine.

## Executed Proof and Limits

`tests/workflow_proof/` creates only unique TemporaryDirectory databases.
Workflow tables coexist with the actual Office schema using its explicit-path
connection. Fixture transitions bypass fail-open decorators and use BEGIN
IMMEDIATE, atomic receipt/result/successor commit, and SQL uniqueness.
FakeBridge has a separate persistent SQLite database and only submit identity
semantics. It never executes jobs. No production code imports this package.

The 11 behavioral tests cover:

- A running v1 process follows v1 even after a different v2 is defined.
- Redefinition, mutation and append to a sealed graph fail; unknown version runs fail.
- Foreign Bridge task ID cannot complete a persisted node_attempt.
- Connection reopen preserves result, correlation, receipt and successor.
- Same delivery and new-envelope duplicate completion cannot create another successor.
- Mid-transition SQLite failure rolls back receipt, result and successor together.
- Fake Bridge acceptance followed by lost local acknowledgement reconciles to one task.
- Two distinct Python child processes commit/exit and redeliver without duplicating jobs.

The last test is real process exit/reopen, NOT a SIGKILL or interrupted executor
test. The fixture uses one attempt per node, linear success edges and trusted
curated graph definitions. It has no graph validator, task-status adapter,
multi-coordinator lease, timer/retry scheduler, approval enforcement, join/loop
interpreter, publication executor or artifact-content verification. Artifact
strings demonstrate persistence only, not verified cryptographic content.
The fake's UNIQUE-key contract is deliberately stronger evidence than an
in-memory mock, but is NOT measured real Bridge compatibility or exactly-once
external effects. No throughput, power-loss or storage-corruption claim is made.

Observed commands, all local:

| Command | Actual result |
| --- | --- |
| `python -m unittest discover -s tests/workflow_proof -t . -v` | 11 tests, exit 0 (final repeat 0.448s). |
| `python -m unittest discover -s tests -p 'test_*.py'` | 90 tests, exit 0 (final repeat 2.657s): 79 existing + 11 proof, no skips reported. Existing Hermes bootstrap re-execs to its Python 3.14 environment. |
| `bun run build` in `web/` | Exit 0, Vite 6.4.4, 1580 modules, 1.95s; existing node_modules used. This is a build, not deployment or publication. |
| `npm run build` in `web/` | Exit 127: npm absent. Used the repository's existing Bun toolchain instead, no install. |
| LSP diagnostics on all 3 new Python files | Unavailable: basedpyright not installed, installation previously declined. No clean type-check claim. AST parsing succeeded for all three. |

Initial proof run passed 9 tests before adding sealed-append/unknown-version
checks. First combined discovery failed with one import error (80 collected:
79 existing tests plus failed proof-module import) because Hermes bootstrap
changed package resolution. Fixed proof import to relative; subsequent native
discovery and explicit proof runs passed. Existing suite reports resource
warnings for HTTPError/SQLite cleanup; unchanged and not hidden.
Default standalone environment observed: Python 3.11.2 / SQLite 3.40.1.

## Required Release Semantics for GRAPH-02

First release path, after authorized change:
implementation/commits -> independent acceptance of the ordinary user path ->
build -> exact-built-artifact check -> publication plus readback -> owner delivery.
Acceptance is independent of implementation; artifact check is not replaced by
source tests, and completion is not replaced by a manager wake or build success.

Every definition declares inputs, role/allowed executor/model, budget, timeout,
expected artifacts, permitted outcomes and approval requirements. Pin a canonical
definition hash/version per run. Editing creates a new version, never mutates a
running one. Migration is a separate authorized, audited operation, out of initial
scope. Core records (run, node, iteration, attempt) -> Bridge task ID and observed
Bridge run_ids; it does not issue a new ID merely because a callback was lost.

| Outcome | Required allowed transition, not yet exercised by this proof |
| --- | --- |
| success | Advance only with typed evidence for this input SHA/artifact hash and required independent acceptance. |
| defect | Bounded implementation correction loop; invalidate downstream checks after code changes. |
| timeout | Persist evidence and Bridge exit/status; inspect preserved changes before choosing an authorized recovery attempt. Never blindly rerun publication. |
| failure | Explicit safe recovery/inspection route, otherwise visible blocked state; do not silently stop unrelated portfolio work. |
| cancel | Ask Bridge to cancel execution; record observed cancellation; no automatic successor or resubmission. |
| quota | Visible blocked/quota reason, bounded due-time recheck or approved alternate model; never endless provider probing. |
| approval-wait | Persist gate, approver, scope and evidence identity; no submission past gate until approval. Approval expiry/revocation is visible. |

Proposed GRAPH-02 bounds: at most 2 execution attempts per logical node iteration,
one defect correction loop (2 total implementation iterations), and at most 3
transient transport reconciliation attempts with 2/4/8-second due-time backoff.
Exhaustion blocks that run visibly. These are proposed milestone policies, not
Bridge-global limits and not implemented by the fixture. Persist counters and
due times; restart must not reset them. Side-effecting nodes never automatically
retry an ambiguous outcome; reconcile first, then require scoped authorization
where necessary. Bridge remains the only execution admission authority.

Topology must represent branches, joins and bounded feedback, not just a DAG.
For GRAPH-02 use explicit all-of joins over named predecessor attempts in the
same iteration, excluding superseded attempts, with one unique activation per
join/iteration. Do not release on first completion. Terminal failure routes must
block or explicitly cancel unresolved siblings through Bridge, not deadlock.
No dynamic fanout, arbitrary BPMN gateways or unbounded cycles in this milestone.
Prove all-of duplicate/restart behavior and loop exhaustion before enabling them;
this GRAPH-01 fixture demonstrates neither joins nor loops.

Acceptance/build/check evidence binds source SHA, artifact digest, producer and
reviewer identity, command/exit, and approval scope. Any input mutation makes
dependent acceptance/build/check/publication authorization stale. Publication
consumes exactly the checked bytes/digest and records destination/readback.
Delivery is separately evidenced and acknowledged, not inferred from job exit.

Debugger pause/retry/recheck can re-evaluate pure checks or open a new authorized
attempt; it must never replay an external publication or owner message from
history. Persist publication intent and external identity/idempotency token;
after an ambiguous response reconcile destination/readback before further action.
Exactly-once external effects are NOT claimed. Keep completion receipt, workflow
transition, manager delivery and consumption acknowledgement separately visible.

## Exact Next Boundary: AO-GRAPH-02

After independent manager acceptance, implement ONE versioned release workflow
in `agent_office/workflow/` with a fail-closed repository, immutable definitions,
transition reducer, persisted attempts/inbox/command intents/evidence/gates and
a headless coordinator entry point. Add a narrow injectable Bridge port with
submit/status/cancel/reconcile; integration must reuse the current public Bridge
interfaces and admission, not alter foreign sources or invoke continuation as a
second successor engine. Explicitly disable graph-unaware successor decisions
for workflow-owned tasks through an agreed integration contract; if that cannot
be done from the Office side, obtain separate authorization before Bridge edits.

Implement only the release path and bounded policies above. Test through an
isolated Bridge sandbox, including interrupted executor, restart after terminal
Bridge state before inbox delivery, transition failure, lost submit ack,
duplicate events, independent acceptance rejection, artifact mutation, approval
wait, join/loop bounds and publication reconciliation. A supervisor lifecycle
contract and browser-independent progress test are required; actual service
installation requires separate authorization. Keep real publication/delivery
behind adapters and explicit owner-approved targets, never use production in
fault-injection tests.

Out of GRAPH-02: Process Studio editing/visual debugger (GRAPH-03), Tycoon visual
changes (GRAPH-04), live owner-visible dogfooding/publication (GRAPH-05), generic
BPMN, multi-host HA, portfolio scheduling replacement, Notion/Telegram setup,
and changing Hermes internals. Do not start GRAPH-02 within this increment.
