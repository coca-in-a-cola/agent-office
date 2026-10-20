# Agent Office Node Editor: Normative Contracts & Delta Plan (v1)

**Task ID:** AO-NE-01 (Board `t_6aee5f69`)  
**Status:** Approved Machine-Readable Specification & Contract Baseline  
**Authority:** Derived from `AO-NODE-EDITOR-SPEC-v1.md` and `AO-NODE-EDITOR-SPEC-v1-contracts.md`.  
**Scope Boundary:** Concrete executable software-release grammar. Avoids unbounded BPMN engines and unconstrained shell execution.

---

## 1. Architectural Foundations & Independence of Concepts

The Node Editor architecture enforces strict orthogonality across three layers:

```
+-------------------------------------------------------------------------------+
|  1. Competency Role (webdev, coder, qa, devops, tyler)                        |
|     Defines capability scope, prompt context, and independent review bounds.  |
+-------------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------------+
|  2. Execution Adapter (omo, claude)                                           |
|     Bridge worker adapter implementing tool injection & process sandbox.      |
|     Adapters declare capabilities, never hardcode a single model.             |
+-------------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------------+
|  3. Model Dispatch Policy (priority, provider round_robin)                    |
|     Runtime selection among verified routes (Gemini 3.8 Flash, GPT-6.1, Opus) |
|     Durable cursors, atomic reservations, cooldown enforcement.               |
+-------------------------------------------------------------------------------+
```

### Invariants:
1. **No Hardcoded CLI Model**: Neither OMO nor Claude adapters assume a single fixed model. Routes are dynamically assigned per attempt by the role's policy.
2. **True Unknowns**: If an executor reports an unverified model, it is recorded as `unknown`, never falsified with the configured default.
3. **No Cross-Domain Fallback**: 3D/image generators never serve as fallback routes for code-writing tasks.

---

## 2. Machine-Readable Grammar & Typed Ports

Every graph adheres strictly to `schemas/node-editor-v1.schema.json`.

### 2.1 Port Classification

Ports are strictly typed across direction (`input` | `output`) and kind (`control` | `data` | `status`):

| Port Kind | Direction | Purpose & Behavior | Allowed Tokens / Types |
| :--- | :--- | :--- | :--- |
| **`control`** | `input` | Receives execution admission token. | `exec_in` |
| **`control`** | `output` | Emits a single terminal outcome token on attempt completion. | `success`, `defect`, `timeout`, `failure`, `cancel`, `quota_exhausted`, `accept_partial`, `recover`, `stop`, `approved`, `denied`, `expired`, `true`, `false`, `loop_body`, `loop_exit`, `joined` |
| **`status`** | `output` | Emits observable, non-terminal waiting state signals. | `quota_wait`, `approval_wait` |
| **`data`** | `input` | Accepts immutable typed values required for node execution. | `ChangeRequest`, `CommitRef`, `ArtifactRef`, `EvidenceRef`, `TaskRef`, `InspectionResult`, `ApprovalRef`, `PartialResult`, `SecretRef`, primitives |
| **`data`** | `output` | Exposes immutable typed outputs produced by the node. | Same as data input types |

### 2.2 Wire & Port Compatibility Matrix

```
Source Port Kind      Edge Kind       Target Port Kind     Validity
---------------------------------------------------------------------
control               control         control (exec_in)    VALID
data (Type A)         data            data (Type A)        VALID
data (CommitRef)      data            data (ChangeRequest) INVALID (Type mismatch)
control               data            data                 INVALID (Control is not data)
data                  control         control              INVALID (Data does not trigger exec)
status                control         control (exec_in)    INVALID (Waiting is not terminal exec)
status                status          status               VALID (Telemetry / UI monitoring only)
```

### 2.3 Waiting States vs. Terminal Execution
- `quota_wait` and `approval_wait` are **status ports**, visually distinct by color, shape, and label in Process Studio.
- An observable waiting state **does not activate ordinary successor nodes**.
- Resumption from a waiting state continues within the **same `activation_id`**, preserving retry budgets and run context.
- The terminal control output `quota_exhausted` is emitted **only** when all fallback routes and cooldown periods have been exhausted.

### 2.4 Representation of Optional Values
- Optional values distinguish explicitly between:
  - `absent`: Optional value was not produced (e.g. no commit created prior to early timeout).
  - `pending`: Upstream computation has not yet finalized.
  - `present`: Value is available and validated against its type schema.
- Missing optional data **never** generates a synthetic mock artifact.

---

## 3. Activation, Attempt & Lifecycle Hierarchy

Every execution entity is globally identifiable through a strict 5-level hierarchy:

```
run_id (Workflow Run Instance)
  └── activation_id (node_id + loop_iteration)
        └── semantic_attempt_id (logical attempt bounded by node budget)
              └── executor_try_id (adapter execution try under active policy)
                    └── bridge_task_id (concrete Bridge worker assignment)
```

### 3.1 Lifecycle Invariants
1. **Atomic Admission**: Node activation requires both an incoming `control` token and the presence of all required `data` inputs for that iteration.
2. **Single Writer & Fencing**: When a node times out, Core records a `cancel` intent and verifies complete process shutdown before any successor (or inspection task) may write to the workspace. Database locks alone do not constitute writer fencing.
3. **Idempotent Continuation**: Bridge task submissions use durable idempotency keys derived from `(run_id, activation_id, semantic_attempt_id, executor_try_id)`. Re-delivering or retrying an event never spawns a duplicate task.

---

## 4. Provenance, Artifacts & Security

### 4.1 Provenance References
All pipeline artifacts carry immutable cryptographic fingerprints:
- **`CommitRef`**: `{ repo_id: string, sha: string (40-char hex) }`.
- **`ArtifactRef`**: `{ id: string, digest: "sha256:...", size: int, media_type: string, quiescence: "quiescent_snapshot" | "unverified" }`.
- **`EvidenceRef`**: `{ producer_role, run_id, activation_id, attempt_id, bridge_task_id, graph_revision, policy_revision, input_fingerprint, criterion, result: "pass" | "defect" | "inconclusive", timestamp_iso, safe_receipt_ref }`.
- **`PartialResult`**: `{ source_activation_id, source_task_id, commit_ref, artifact_refs, consistency: "quiescent_snapshot" | "unverified", capture_time_iso, no_saved_result_reason }`.

### 4.2 Security & Secret Handling
1. **Raw Secret Ban**: No secret values, API keys, or raw tokens may appear in graph JSON, editor layout, WebSocket event streams, or LLM prompts.
2. **`SecretRef` Only**: Secrets are referenced solely via `SecretRef { secret_id, scope, allowlist }`, resolved securely on the host by authorized Bridge adapters at execution boundary.
3. **Isolated Layout**: Semantic execution definitions (`definition_hash`) are computed over semantic nodes, edges, roles, and limits. Visual layout (`layout.nodes`, `layout.viewport`) is segregated and does not alter the execution hash.

---

## 5. Deadlines, Budgets & Dispatch Policies

### 5.1 Deadlines
- **Queue Timeout (`queue_timeout_seconds`)**: Maximum allowable time an attempt may sit in the Bridge queue waiting for an available worker. **Queue time never depletes execution timeout.**
- **Execution Timeout (`execution_timeout_seconds`)**: Active execution duration starting strictly upon worker acceptance.

### 5.2 Model Dispatch Policies
1. **`priority` Strategy**: Traverses ordered candidates, selecting the first healthy route not in cooldown.
2. **`round_robin` Strategy**: Rotates across providers (e.g. Google -> OpenAI -> Anthropic) using a durable reservation cursor; candidates within each provider are evaluated in order.
3. **Quota Isolation**: A provider quota limit or rate limit triggers cooldown on that specific provider and fails over to the next compatible route without logging a software product defect.

---

## 6. Supported Node Catalog (v1 & Roadmap)

### 6.1 First Bounded Grammar (S1 Release)
- **`Start`**: Validates initial `ChangeRequest` and allocates workspace.
- **`Work`**: Sends task to Bridge; exposes `success`, `defect`, `timeout`, `failure`, `quota_exhausted`, `quota_wait`, `approval_wait`.
- **`InspectResult`**: Inspects partial execution snapshots on timeout or error; emits `accept_partial`, `recover`, or `stop`.
- **`LoopGate`**: Bounded iteration gate enforcing `max_iterations`; emits `loop_body` or `loop_exit`.
- **`IndependentAcceptance`**: Independent verification role strictly partitioned from the implementing role.
- **`Condition`**: Declarative equality/comparison checks on typed scalar fields.
- **`Approval`**: Suspends execution pending owner approval for high-impact actions.
- **`End`**: Terminal nodes recording `completed`, `stopped`, `failed`, or `cancelled`.

### 6.2 Full Roadmap Alignment (Joins & Build Pipelines)
- **`AllOfJoin`**: Fully defined in schema definitions. Awaits named correlation slots from parallel upstream branches; explicitly handles `skipped` branch propagation without deadlocking. (Gated in S1 validator until multi-worker join runner verification).
- **`Build` & `ArtifactCheck`**: Exact byte verification and digest reconciliation.
- **`Publish` & `Deliver`**: Two-phase effect execution requiring verifiable readbacks and owner receipts.

---

## 7. State Transition Table

| Current Node State | Event / Trigger | Next State | Emitted Port Token | Engine Action |
| :--- | :--- | :--- | :--- | :--- |
| **`pending`** | Control token + data inputs ready | `running` | — | Allocate attempt, submit task to Bridge |
| **`running`** | Adapter returns exit 0 with evidence | `succeeded` | `success` | Record outputs, activate successor |
| **`running`** | Test gate fails / criteria unmet | `defect` | `defect` | Route to loop gate or defect branch |
| **`running`** | Execution timer exceeds deadline | `timeout` | `timeout` | Issue cancel intent, fence writer, capture snapshot |
| **`running`** | Adapter encounters 429 / quota limit | `quota_wait` | `quota_wait` (status) | Cooldown provider, attempt fallback route |
| **`running`** | All fallback routes exhausted | `failure` | `quota_exhausted` | Terminate attempt, trigger escalation |
| **`running`** | Action requires owner approval | `approval_wait` | `approval_wait` (status) | Create approval gate, wait for signed decision |
| **`timeout`** | InspectResult finds quiescent commit | `inspecting` | `accept_partial` | Route to IndependentAcceptance |
| **`timeout`** | InspectResult finds recoverable state | `inspecting` | `recover` | Route to LoopGate for retry |
| **`timeout`** | InspectResult finds unrecoverable fault| `stopped` | `stop` | Route to End (failed) |

---

## 8. Compact Delta Plan for AO-NE-03 Implementation

This plan outlines the minimal, non-breaking delta required to implement the Node Editor backend and Process Studio UI in AO-NE-03 without altering current runtime stability.

```
                              AO-NE-03 ARCHITECTURE
                              
  +-------------------------+                 +-------------------------+
  |   Process Studio UI     |                 |  Linear Release Graph   |
  |  (@xyflow/react canvas) |                 | (Legacy / Current Runs) |
  +-------------------------+                 +-------------------------+
               |                                           |
               | (Drafts & Graph JSON)                     | (Preserved v1)
               v                                           v
  +-------------------------+                 +-------------------------+
  |  Node Editor API Routes |                 | Existing Engine Service |
  |  (/api/editor/*)        |                 | (/api/workflow/*)       |
  +-------------------------+                 +-------------------------+
               |                                           |
               +--------------------+----------------------+
                                    |
                                    v
                    +-------------------------------+
                    | Storage & Migration Adapter   |
                    | - draft_definitions table     |
                    | - canonical_graphs table      |
                    | - Backward Compatibility View |
                    +-------------------------------+
```

### 8.1 Backend Implementation Paths
1. **Storage Extension (`agent_office/storage.py`)**:
   - Add table `editor_drafts` (`draft_id`, `graph_id`, `revision`, `graph_json`, `updated_at`).
   - Add table `editor_published_graphs` (`graph_id`, `version`, `definition_hash`, `canonical_json`, `created_at`).
   - *Backward Compatibility*: Existing `workflow_definitions` and `workflow_runs` tables remain untouched. Current runs continue executing uninterrupted.
2. **Validator & Serializer (`agent_office/workflow/validator.py`)**:
   - Integrate `schemas/node-editor-v1.schema.json` via standard validation.
   - Enforce port compatibility, cycle detection via LoopGate, and deadline bounds.
3. **Canonical Hasher (`agent_office/workflow/canonical.py`)**:
   - Compute SHA-256 over sorted semantic keys, omitting `layout` and `viewport`.
4. **Transition Adapter (`agent_office/workflow/adapter.py`)**:
   - Bi-directional converter between legacy `WorkflowDefinition` (`release_workflow.py`) and node-editor graph format.

### 8.2 Web Frontend Implementation Paths (`web/src/`)
1. **Process Studio Canvas (`web/src/components/process_studio/`)**:
   - Mount `@xyflow/react` in isolated `EditorView.tsx`.
   - Implement custom node components matching typed ports (`WorkflowNodeComponent.tsx`, `TerminalNodeComponent.tsx`).
   - Color and shape encode control handles (solid diamonds), data handles (circles), and status handles (hollow rectangles).
2. **Editor API Client (`web/src/editorApi.ts`)**:
   - `GET /api/editor/drafts/:id`
   - `POST /api/editor/drafts/:id`
   - `POST /api/editor/validate`
   - `POST /api/editor/publish`

### 8.3 Scope Exclusions for AO-NE-03
- **No Universal Engine**: Only the software release process grammar is supported.
- **No Live Mutation of Running Graphs**: Running graphs retain their pinned `definition_hash`.
- **No Unsafe Execution**: Arbitrary shell execution from browser inputs is strictly rejected.
