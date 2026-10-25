# Frontend Build & Delivery — Agent Office

## Overview

The frontend is a Vite + React + TypeScript SPA located in `web/`. It is built
with [Bun](https://bun.sh) and produces a static artifact in `web/dist/` suitable
for any static-file host.

This document covers:
- Local development setup
- CI pipeline (GitHub Actions)
- Static delivery / release provisioning
- Pending work (backend gate, dist untracking)

---

## Local Development

```bash
# Prerequisites: Bun ≥ 1.4.3, Node 18+/20+/22+ on PATH
#   (Vite 6 engines: ^18.0.0 || ^20.0.0 || >=22.0.0)
cd web
bun install --frozen-lockfile

# Dev server (proxies /api → localhost:8080)
bun run dev

# Type-check (no emit)
bun run typecheck

# Lint (warnings expected; errors block)
bun run lint

# Unit tests (run from repo root for full pass)
cd ..
bun test web/src

# Production build
cd web
bun run build
# Output: web/dist/   (~1.7 MB on-disk, ~186 KB gzip main chunk)
```

The dev server proxies `/api` to `http://127.0.0.1:8080` (configured in
`web/vite.config.ts`). The backend is not required for build or frontend-only
tests.

---

## CI Pipeline

**File:** `.github/workflows/frontend-ci.yml`

**Triggers:**
- Push to `feature/**` or `develop`
- PR targeting `feature/**`, `develop`, or `main`

Push to `main` does **not** trigger this workflow.

**Jobs (single job: `frontend`):**

| Step | Command | Must pass |
|---|---|---|
| Install deps | `bun install --frozen-lockfile` | yes |
| Typecheck | `bun run typecheck` (tsc --noEmit) | yes |
| Lint | `bun run lint` (ESLint) | yes (errors); warnings allowed |
| Tests | `bun test web/src` (from repo root) | yes — 265 pass, 0 fail baseline |
| Build | `bun run build` (Vite production) | yes |
| Upload artifact | `actions/upload-artifact@v4` | yes |

**Artifact:**
- Name: `agent-office-web-<commit-SHA>`
- Path: `web/dist/**` (source maps excluded)
- Retention: 14 days

**Pinned action versions** (verified from upstream tags, 2026-10-25):

| Action | Tag | Commit SHA |
|---|---|---|
| `actions/checkout` | v4.2.2 | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `oven-sh/setup-bun` | v2.0.2 | `735343b667d3e6f658f44d0eca948eb6282f2b76` |
| `actions/upload-artifact` | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

**Backend gate:** The Python backend test suite has a known failing baseline on
`feature/ao-query-01-transport-and-state-polling`. The backend is intentionally
**excluded** from this workflow. A backend CI job is tracked as a pending item on
AO-BUILD-01, not yet implemented. Frontend CI is not gated on backend health.

---

## Static Delivery / Release Provisioning

`web/dist/` is the complete deployable artifact. It contains:

```
dist/
  index.html                       # SPA entry
  assets/
    index-<hash>.js                # Main bundle (~649 KB min / ~186 KB gzip)
    index-<hash>.css               # Tailwind + component styles (~88 KB)
    PixiOfficeCanvas-<hash>.js     # Pixi rendering (~294 KB)
    PixiOfficeCanvas-<hash>.css
    WebGLRenderer-<hash>.js
    WebGPURenderer-<hash>.js
    ... (Pixi sub-chunks)
    sample/                        # Tycoon sprite atlas (public assets)
  vendor/
    telegram-web-app.js            # Telegram Mini App SDK (~117 KB vendored)
```

### Serving

Any static file server works. The SPA uses client-side routing; configure the
server to serve `index.html` for all non-asset paths (e.g. Caddy `try_files`,
nginx `try_files $uri $uri/ /index.html`).

### Obtaining a build artifact

**From CI (recommended):** After any green CI run on the target branch, download
the artifact `agent-office-web-<commit-SHA>` from the GitHub Actions run page.
No download automation is currently provided — this is a manual step via the
GitHub UI or `gh run download`.

**Local rebuild:**
```bash
cd web
bun install --frozen-lockfile
bun run build
# Artifact is now in web/dist/
```

### Chunk size warning

Vite warns that `index-<hash>.js` exceeds 500 KB (measured: 649 KB min / 186 KB
gzip on this build). This warning is non-blocking and does not affect build
correctness. The main bundle contains React, TanStack Query, and application
logic; Pixi rendering is already split into a separate lazy chunk
(`PixiOfficeCanvas-<hash>.js`). Further code-splitting is tracked as a
follow-up.

---

## Pending Work

### Pending: Untrack `web/dist/` from git

`web/dist/` is currently tracked in git (22 files, ~1.8 MB on disk, measured
this build). This is redundant once CI produces the artifact from source. This
cleanup is a pending item on AO-BUILD-01; do not execute without owner approval.

**Dry-run removal summary** (do not execute until owner approves):

```diff
# Untrack the entire dist tree in one command (run from repo root):
  git rm -r --cached -- web/dist

# Add to .gitignore so it is never re-tracked:
# File: web/.gitignore
+ dist/
```

**Precondition before executing:** A real CI run on the target branch must
complete green, confirming the artifact is reproducible from source. That
precondition has **not** yet been established — it will be confirmed once this
workflow runs on GitHub Actions and a green run is observed.

### Pending: Backend CI job

Add a second job to `frontend-ci.yml` (or a separate workflow) running
`python3 -m unittest discover tests` once the backend baseline is clean.
Tracked as a pending item on AO-BUILD-01 (owner creation of a separate ticket
is pending).

---

*Document created: AO-BUILD-01 | Branch: feature/ao-query-01-transport-and-state-polling*
