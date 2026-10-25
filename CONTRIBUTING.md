# Contributing to Agent Office

## Tooling Requirements

| Tool | Version |
|------|---------|
| Node.js | 26.x (host runtime; no pinned minimum — use whatever is on `PATH`) |
| Bun | 1.4.3 observed; no lockfile pin — install via `bun install` as usual |
| Python | 3.11+ (uses `dataclasses`, `typing`, and other 3.11 stdlib features) |

> **Editor TypeScript SDK** — VS Code users: the workspace setting `typescript.tsdk` points to
> `web/node_modules/typescript/lib`.  Accept the workspace SDK prompt when VS Code offers it so
> diagnostics match the project compiler.

> **CodeGraph** — `codegraph.json` at the repo root is the project **config file** (exclude
> patterns, entry points, etc.), not a committed index.  The runtime index lives in `.codegraph/`
> which is git-ignored.  To re-index after large structural changes run:
> ```sh
> CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 \
>   codegraph index .
> ```
> CodeGraph 1.6.2 must be available on `PATH` (e.g. via your Hermes toolchain or a local install).

---

## Install

```sh
# Frontend dependencies (run from the web/ directory)
cd web
bun install
```

Python dependencies are part of the Hermes plugin runtime; no extra `pip install` step is needed
for the backend test suite.

---

## Common commands (run from repo root unless noted)

| Purpose | Command |
|---------|---------|
| Type-check frontend | `bun run typecheck` |
| Lint frontend | `bun run lint` |
| Check formatting (known legacy debt — expected failures) | `bun run format:check` |
| Frontend unit tests | `cd web && bun test` |
| Backend unit tests | `python3 -m unittest discover tests` |
| Production build *(modifies tracked `dist/`; AO-BUILD-01 pending)* | `bun run build` |

All root scripts delegate to `cd web && bun run <script>` as defined in the root `package.json`.

---

## Lint & formatting status

- **Errors (0 expected):** Lint must exit clean; no errors should be introduced.  Fix any error
  you introduce before committing.
- **Warnings:** Pre-existing legacy warnings exist.  Do not silence them en masse; fix them
  incrementally as you touch affected files.
- **Prettier:** A number of source files have pre-existing formatting divergence (`format:check`
  exits 1).  Do **not** bulk-reformat; format only files you are actively modifying.

---

## AGENTS.md

Automation agents working in this repo **must not** edit or bypass `AGENTS.md`.  Read it before
making changes.  Edits to `AGENTS.md` itself require explicit owner consent before they may be
committed.
