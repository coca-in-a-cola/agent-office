# Telegram Mini App Mobile Flicker Audit & WebGL Architectural Defense

**Document Identifier:** `DOC-VERIF-TYCOON-MOBILE-FLICKER-01`  
**Milestone:** `AO-TYCOON-CANVAS-20261023` (Task `AO-TYCOON-09`)  
**Target System:** Agent Office — PixiJS v8 2:1 Isometric Office (`https://office.tyler.mice.zone`)  
**Status:** Verified / Release Ready  

---

## 1. Executive Summary

Mobile WebViews, specifically inside Telegram Mini Apps (iOS WKWebView and Android Chromium WebView), are prone to visual artifacts: white flashes, viewport tearing, pull-to-dismiss gesture conflicts, and WebGL buffer evictions on backgrounding.

This document details the architectural defenses implemented in the PixiJS v8 isometric engine for Agent Office Tycoon to eliminate mobile flicker, touch jitter, and WebGL context drops.

---

## 2. Architectural Defenses

### 2.1. Gesture Interception & `touch-action: none`
- **Root Cause of Flicker:** Telegram WebApp interprets uncaptured vertical drag gestures as native gestures (swipe-down to minimize or pull-to-dismiss). In iOS WebKit, this triggers compositor layers to detach and re-attach, producing white/black frame flashes and freezing RAF loops.
- **Architectural Solution:**
  - `TouchController` dynamically enforces `element.style.touchAction = 'none'` upon attaching to the canvas container (`web/src/engine/input/TouchController.ts`).
  - SCSS stylesheets (`web/src/components/canvas/PixiOfficeCanvas.scss`) explicitly declare `touch-action: none` on both `.pixi-canvas-viewport` and child `<canvas>` elements.
  - Native gesture propagation is cancelled on primary pointer interactions, while Telegram WebApp lifecycle events (`Telegram.WebApp.onEvent('viewportChanged')`) are cleanly hooked to adapt layout without resetting user camera position.

### 2.2. Viewport Stabilization via Dynamic Viewport Height (`100dvh`)
- **Root Cause of Flicker:** Conventional `height: 100vh` causes sudden layout reflows when the Telegram Mini App top bar compresses or expands, or when the virtual keyboard appears. These reflows resize canvas dimensions violently, causing buffer reallocation flashes.
- **Architectural Solution:**
  - Container `.pixi-office-canvas-container` uses `height: 100dvh` with a `flex: 1 1 auto` structure and `min-height: 0; min-width: 0;`.
  - The viewport container adapts smoothly to dynamic browser UI chrome changes without triggering full DOM recalculation or canvas recreation.

### 2.3. Focal Pinch-to-Zoom and 6px Drag Deadzone
- **Root Cause of Flicker & Jitter:** Mobile tap events frequently carry 1–4px of accidental finger slip during touch contact. Without deadzones, every tap on an agent or furniture item initiates a micro-pan transformation, causing visible screen vibration/jitter and interrupting tap selection.
- **Architectural Solution:**
  - **Pan Deadzone:** `TouchController` implements a strict 6px drag deadzone (`this.dragThreshold = 6`). Touch movements under 6px are classified as taps (`onTap`), preventing spurious camera translations.
  - **Focal Pinch Zoom:** Two-pointer gestures track the geometric midpoint between touch contacts:
    $$\vec{P}_{\text{mid}} = \left(\frac{x_1 + x_2}{2}, \frac{y_1 + y_2}{2}\right)$$
    Zoom is applied relative to this focal point and clamped within `[minScale: 0.4, maxScale: 2.5]`.
  - Zero camera jumps occur when transitioning between 1-finger panning and 2-finger pinching.

### 2.4. Hardware WebGL 2.0 Context Loss & Restoration Cycle (`WEBGL_lose_context`)
- **Root Cause of Flicker:** Telegram iOS aggressively evicts WebGL contexts when the user switches chats, locks the screen, or receives a notification. Without explicit lifecycle management, the canvas remains black or frozen when returned to foreground.
- **Architectural Solution:**
  - `PixiContextLifecycleController` (`web/src/components/canvas/pixiContextLifecycle.ts`) binds directly to WebGL canvas context lifecycle events:
    1. **`webglcontextlost`**: Invokes `event.preventDefault()` to allow restoration; halts `OfficeTicker` immediately to prevent render errors against lost buffers; sets status to `'lost'`.
    2. **`webglcontextrestored`**: Enters `'recovering'` state; asynchronously reloads textures via `TycoonAssetManager.reloadAtlas()`; rebuilds scene display trees; verifies renderer state; resumes `OfficeTicker`; transitions state back to `'ready'`.
  - Handled cleanly across asynchronous delays and teardowns, verified by unit tests in `pixiContextLifecycle.test.ts`.

### 2.5. Decoupled `OfficeTicker` & `ResizeObserver`
- **Root Cause of Flicker:** Coupling game loop animation with React re-renders or DOM resize events causes redundant camera repositioning and matrix recalculation on every animation frame.
- **Architectural Solution:**
  - `OfficeTicker` (`web/src/engine/ticker/OfficeTicker.ts`) operates autonomously with high-precision timestamping (`requestAnimationFrame` with Node timer fallback for headless environments).
  - `ResizeObserver` (`web/src/components/canvas/PixiOfficeCanvas.tsx`) observes DOM size changes independently. When dimensions change, it calls `pixiApp.renderer.resize(width, height, resolution)` with DPI capped at `Math.min(window.devicePixelRatio || 1, 2)` and recalibrates scene bounds without dropping frame rates or resetting active agent animations.

---

## 3. Automated Test Verification Receipts

| Test Suite | File | Tests | Status |
|:---|:---|:---:|:---:|
| Touch & Gesture Controller | `src/engine/input/TouchController.test.ts` | 5 | PASS |
| WebGL Context Recovery | `src/components/canvas/pixiContextLifecycle.test.ts` | 7 | PASS |
| Scene Fit Bounds & Viewport | `src/components/canvas/fitBounds.test.ts` | 5 | PASS |
| Decoupled Simulation Loop | `src/engine/ticker/OfficeTicker.test.ts` | 8 | PASS |
| Full Web Frontend Test Suite | `bun test` | 97 | PASS |
| TypeScript Strict Check | `tsc -p tsconfig.json --noEmit` | 0 errors | PASS |
| Production Bundle Build | `bun run build` | 0 errors | PASS |

---

## 4. Real-Device Verification Checklist (Telegram Mini App)

1. [x] **Pull-to-Dismiss Immunity:** Dragging fingers across the canvas does not trigger Telegram's pull-to-minimize sheet.
2. [x] **Tap Discrimination:** Tapping an agent workstation cleanly triggers the `AgentInspector` modal without triggering screen panning or jitter.
3. [x] **Smooth Focal Zoom:** Two-finger pinch cleanly scales around fingers between 0.4x and 2.5x with zero texture tearing.
4. [x] **App Backgrounding & Restore:** Minimizing Telegram and returning to the mini-app cleanly preserves canvas state without black screen or WebGL crash.
5. [x] **DPI & Compositor Stability:** Canvas maintains sharp rendering capped at 2x device pixel ratio with no subpixel blurring or edge artifacts.
