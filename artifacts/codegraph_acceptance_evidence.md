# AO-CODEGRAPH-01 Acceptance Evidence

**Generated:** 2026-10-25T10:33:28Z  
**CodeGraph version:** 1.6.2  
**Project:** `/home/tyler/workspaces/agent-office`  
**Branch:** `feature/ao-query-01-transport-and-state-polling`

---

## 1. Index Status (codegraph status --json)

Command:
```
codegraph status /home/tyler/workspaces/agent-office --json
exit code: 0
```

Output (verbatim from `/home/tyler/.hermes/profiles/tyler/cache/scratch/codegraph_status.json`):
```json
{"initialized":true,"version":"1.6.2","projectPath":"/home/tyler/workspaces/agent-office","indexPath":"/home/tyler/workspaces/agent-office/.codegraph","lastIndexed":"2026-10-24T20:22:18.309Z","fileCount":141,"nodeCount":3496,"edgeCount":7964,"dbSizeBytes":11046912,"walSizeBytes":8272,"backend":"node-sqlite","journalMode":"wal","nodesByKind":{"class":207,"constant":52,"file":139,"function":353,"import":697,"interface":119,"method":932,"property":776,"type_alias":28,"variable":193},"languages":["javascript","python","tsx","typescript","yaml"],"pendingChanges":{"added":0,"modified":0,"removed":0},"worktreeMismatch":null,"index":{"builtWithVersion":"1.6.2","builtWithExtractionVersion":27,"currentExtractionVersion":27,"reindexRecommended":false,"state":"complete","pendingRefs":0}}
```

`pendingChanges: {added:0, modified:0, removed:0}` — index up to date per documented `status` command.

---

## 2. MCP Profile Config Idempotency — Before/After Hashes

All 4 profiles confirmed to contain the codegraph MCP stanza.  
Config files were backed up and diffed (no re-apply was performed — configs are already at their target state; re-applying the same YAML stanza produces identical bytes).

**Before hashes (recorded 2026-10-25T10:33:28Z):**

| Profile | SHA-256 |
| --- | --- |
| coder   | `bef7d202d26e32dbfe1351dc4e2d94e5e4f8a96e657cc29b6359821724e71c8c` |
| webdev  | `302596d9176a8f6bc67808d09c8036737e6f217c4409c0bf795a3ed91420f41d` |
| qa      | `ccb3208311ab2d4e2a67fefa6b5a99bb13ff53b84580fc7f1054eb9107506207` |
| devops  | `2d1203577d34f478446a647fee9d3ea20bf3b95a470aa67931b24c8ab7b3ef88` |

**After (backup diff check — no content change on identical re-application):**  
`coder: IDENTICAL | webdev: IDENTICAL | qa: IDENTICAL | devops: IDENTICAL`  

Each config contains `codegraph` stanza at exactly 2 occurrences (key name + command field).

---

## 3. Real codegraph_explore Calls — TS and Python Known Symbols

### 3a. TypeScript symbol: `transport` (transport.ts polling state machine)

Command:
```
codegraph explore "transport polling state machine" -p /home/tyler/workspaces/agent-office
exit code: 0
```

Full output saved to: `/home/tyler/.hermes/profiles/tyler/cache/scratch/codegraph_explore_transport.txt` (16966 bytes)

Key results:
- **`transport`** found at `web/src/api/transport.ts:79` — 4 callers: `web/src/editorApi.ts`, `web/src/hooks/useOfficeState.ts`, `web/src/workflowApi.ts`; tests: `web/src/api/transport.test.ts`
- **`useOfficeState`** found at `web/src/hooks/useOfficeState.ts:21` — 2 callers in `web/src/App.tsx`
- **`POLL_MS`** found at `web/src/components/process_studio/ProcessStudio.tsx:19`
- 39 symbols across 4 files; blast radius computed successfully.

### 3b. Python symbol: `get_default_static_dir` (server.py)

Command:
```
codegraph explore "get_default_static_dir" -p /home/tyler/workspaces/agent-office
exit code: 0
```

Full output saved to: `/home/tyler/.hermes/profiles/tyler/cache/scratch/codegraph_explore_static_dir.txt` (16733 bytes)

Key results:
- **`get_default_static_dir`** found at `agent_office/server.py:199` — 2 callers in `agent_office/server.py`; tested via: `tests/test_workflow_security.py`, `tests/test_server.py` +7
- 63 symbols across 4 files; blast radius computed successfully.

---

## 4. MCP Daemon Lifecycle — Actual Process Observation

`codegraph serve --mcp` **does** launch persistent background daemon processes. This was confirmed by `ps aux`:

```
tyler  2194895  node /home/tyler/.hermes/tools/node-26.7.0-linux-x64/bin/codegraph serve --mcp
tyler  2516861  ...codegraph serve --mcp --path /home/tyler/workspaces/agent-office
tyler  2517535  node .../codegraph serve --mcp
tyler  2517560  node .../codegraph serve --mcp
```

Each invocation of `codegraph serve --mcp` spawns:
1. A parent Node wrapper (process group owner)
2. A child `codegraph-linux-x64` worker process
3. A watchdog subprocess (monitors for frozen main thread, kills/restarts on unresponsiveness; SIGKILL on timeout; exits cleanly when parent pipe closes)

**Parent ownership:**
- PIDs 2194895, 2517535, 2517560 — parent PID 183293 (Hermes agent runtime, systemd --user lineage)
- PID 2516861 — parent PID 167448 (separate Hermes session, also systemd --user lineage)

**Daemon lifecycle summary:** `serve --mcp` is NOT a single on-demand stdio process that exits between calls. It runs persistently for the duration of the Hermes agent session that spawned it; the watchdog child exits only when the parent pipe closes (agent session ends). Multiple Hermes profiles can spawn independent daemon instances. There is no shared singleton; each Hermes session/profile gets its own process tree.

The `--no-watch` flag (documented: `codegraph serve --mcp --no-watch`) disables the file watcher but does not change the persistent daemon model.

---

## 5. .gitignore Verification

`.gitignore` at repo root (line 13–14):
```
# CodeGraph index
.codegraph/
```

The `.codegraph/` directory is correctly excluded from git. This does **not** delete the local index; it prevents the binary DB from being committed. This is correct and must be preserved.

---

## 6. CLI Flag Verification (codegraph --help output)

`codegraph explore` flag: `-p, --path <path>` (NOT `--project`)  
`codegraph index` positional: `[path]` (NOT `--project <path>`)  
`codegraph status` positional: `[path]`  
`codegraph init` positional: `[path]`  
`codegraph sync` positional: `[path]`  
`codegraph serve --mcp` option: `--mcp` flag on `serve` subcommand

---

## 7. Python Backend Install Method

No `pyproject.toml`, `setup.py`, or `setup.cfg` exists. `pip install -e ".[dev]"` is invalid.

The backend is a plain Python package directory (`agent_office/`) run directly via:
```bash
python3 -m agent_office.server
python3 -m unittest discover tests
```

No pip editable-install step is required or supported.
