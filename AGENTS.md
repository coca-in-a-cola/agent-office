# Agent-Office — AI Agent Onboarding Guide

This file is the single entry point for any AI coding agent working on this repository.
Read it before touching any code. All agents must follow it.

## Quick Status

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Index:** CodeGraph graph index at `.codegraph/` (141 files, 3 496 nodes, 7 964 edges)

## Install / Init (first time in this repo)

```bash
# 1. Python backend — no pyproject.toml/setup.py exists; no pip install step needed.
#    Requires Python 3.11+ (uses standard library only: sqlite3, http.server, etc.)
#    Optional: create a virtualenv first:
#    python3 -m venv .venv && source .venv/bin/activate

# 2. Frontend deps (web/)
cd web && bun install && cd ..

# 3. Initialize CodeGraph index (first checkout only; skip if .codegraph/ already present)
#    Use the actual path to your local checkout:
export PATH="/home/tyler/.hermes/tools/node-26.7.0-linux-x64/bin:$PATH"
export CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1
codegraph init .

# 4. Verify CodeGraph index is fresh (see Sync section below)
```

## CodeGraph Index — explore before editing

**Use `codegraph_explore` first.** The index maps every symbol, import, and call edge
so you understand blast radius before changing anything.

### MCP server (all profiles: coder / webdev / qa / devops)

The `codegraph` MCP server is configured in each profile's `config.yaml`:

```yaml
mcp_servers:
  codegraph:
    command: /home/tyler/.hermes/tools/node-26.7.0-linux-x64/bin/codegraph
    args: [serve, --mcp]
    env:
      CODEGRAPH_TELEMETRY: '0'
      DO_NOT_TRACK: '1'
      PATH: /home/tyler/.hermes/tools/node-26.7.0-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    sampling:
      enabled: false
    enabled: true
```

> **Daemon lifecycle:** `codegraph serve --mcp` launches a **persistent background daemon**
> for the duration of the Hermes session that started it — it is NOT a single on-demand
> stdio call that exits between requests. Each Hermes profile spawns its own independent
> process tree (parent node wrapper + codegraph worker + watchdog child). The watchdog
> exits cleanly when the parent pipe closes (session ends). Multiple concurrent sessions
> each own their own daemon; there is no shared singleton.
> Use `codegraph daemons` to inspect or stop running instances.
> The `--no-watch` flag disables the file watcher but does not change the persistent model.
> Node.js must be on `PATH` inside the subprocess — the `env.PATH` above ensures this.

### CLI fallback (when MCP is unavailable)

```bash
# Adjust PATH to wherever codegraph is installed on this host.
# On this host it is installed at the path below; installed globally it may already be on PATH.
export PATH="/home/tyler/.hermes/tools/node-26.7.0-linux-x64/bin:$PATH"
export CODEGRAPH_TELEMETRY=0
export DO_NOT_TRACK=1
# Note: flag is -p/--path (not --project)
codegraph explore "your question" -p /path/to/your/checkout
```

### Verify connection

```bash
HERMES_HOME=/home/tyler/.hermes/profiles/coder hermes mcp test codegraph
# Expected: ✓ Connected  ✓ Tools discovered: 1
```

## Sync / Freshness

The index auto-syncs via file watcher while the MCP server is running. On a fresh checkout
or after a rebase, force a full sync:

```bash
# Adjust PATH to wherever codegraph is installed on this host.
export PATH="/home/tyler/.hermes/tools/node-26.7.0-linux-x64/bin:$PATH"
export CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1
# Positional path argument — no --project flag
codegraph index /path/to/your/checkout
```

Check index freshness using the documented status command:

```bash
codegraph status /path/to/your/checkout
# ✓ Index is up to date  (pendingChanges: added=0 modified=0 removed=0)
```

> `status` is the authoritative freshness check. Do **not** rely on `.codegraph/codegraph.db`
> mtime vs. latest git commit — mtime only reflects last write, not whether uncommitted
> changes have been indexed.

## Excludes

`codegraph.json` at repo root lists excluded paths. Currently excluded:

```
dist, node_modules, .bun, __pycache__, *.py[cod],
.pytest_cache, .coverage, htmlcov, artifacts,
.omo, .codegraph, *.egg-info, *.min.js, *.map
```

`.codegraph/` is listed in `.gitignore` at the repo root — this is **correct and must be
preserved**. Excluding from git does not delete the local index; it only prevents the
binary database from being committed. The index persists across agent sessions on the
local filesystem.

## Explore — example calls

```
codegraph_explore(query="server main entry point", projectPath="<repo-root>")
codegraph_explore(query="polling transport state machine", projectPath="<repo-root>")
codegraph_explore(query="AuthService loginUser session", projectPath="<repo-root>")
```

## Status / Tests

```bash
# Run the test suite (uses stdlib unittest — no pytest needed)
python3 -m unittest discover tests

# Run specific suites
python3 -m unittest tests/test_hooks.py tests/test_storage.py tests/test_server.py

# Backend server (dev — uses FakeBridge by default)
python3 -m agent_office.server --port 8080
```

## Workspace State

- **Untracked artifacts:** `artifacts/` — do not delete, they are QA evidence
- Do **not** reset, `git clean`, or broad-format any files in this branch
- Use `git status` to identify dirty/untracked files; preserve all uncommitted work

## Known Limitations

- **Graph is structural, not dynamic:** CodeGraph traces static import/call edges.
  Frontend → backend call flows (HTTP fetch, WebSocket events) are **not** proven by the
  graph; they require manual cross-reference or runtime tracing.
- **Index covers Python + TypeScript:** other file types (YAML, JSON, Markdown) are parsed
  for symbols but edge coverage is limited.
- **No auth-required calls in index:** routes protected by middleware show symbol presence
  but the runtime auth path is not graph-traversable.
