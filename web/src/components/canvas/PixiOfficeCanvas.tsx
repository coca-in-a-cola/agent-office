import React, { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { PixiContextLifecycleController, type ContextRecoveryState } from './pixiContextLifecycle';
import './PixiOfficeCanvas.scss';

interface PixiOfficeCanvasProps {
  onClosePreview?: () => void;
}

export const PixiOfficeCanvas: React.FC<PixiOfficeCanvasProps> = ({ onClosePreview }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PixiContextLifecycleController | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const [contextState, setContextState] = useState<ContextRecoveryState>('ready');
  const [contextError, setContextError] = useState<string | null>(null);

  const handleRetryContext = async () => {
    if (controllerRef.current) {
      await controllerRef.current.handleContextRestored();
    } else {
      setRetryNonce((n) => n + 1);
    }
  };

  useEffect(() => {
    let isCancelled = false;
    let app: Application | null = null;
    let isInitialized = false;
    let lifecycleController: PixiContextLifecycleController | null = null;

    setIsInitializing(true);
    setInitError(null);
    setContextState('ready');
    setContextError(null);

    const initPixi = async () => {
      try {
        if (!containerRef.current) return;

        // Enforce maximum DPI cap of 2 for performance & memory stability
        const resolution = Math.min(window.devicePixelRatio || 1, 2);

        const pixiApp = new Application();
        app = pixiApp;

        // Version-correct PixiJS v8 Application init with explicit WebGL preference
        await pixiApp.init({
          preference: 'webgl',
          resizeTo: containerRef.current,
          resolution,
          autoDensity: true,
          backgroundColor: 0x0b0f19,
          antialias: true,
        });

        if (isCancelled) {
          pixiApp.destroy(true, { children: true });
          return;
        }

        isInitialized = true;
        if (containerRef.current && pixiApp.canvas) {
          containerRef.current.appendChild(pixiApp.canvas);
        }

        // Scene root container
        const worldContainer = new Container();
        pixiApp.stage.addChild(worldContainer);

        // 3x3 2:1 Isometric Grid configuration
        const GRID_SIZE = 3;
        const TILE_W = 96;
        const TILE_H = 48; // 2:1 ratio
        const HALF_W = TILE_W / 2;
        const HALF_H = TILE_H / 2;

        const updateSceneLayout = () => {
          if (!pixiApp.renderer) return;

          worldContainer.removeChildren();

          const screenW = pixiApp.screen.width;
          const screenH = pixiApp.screen.height;

          // Center the 3x3 grid within viewport
          const originX = screenW / 2;
          const originY = screenH / 2 - 20;

          // 1. Draw 3x3 Isometric Floor Tiles
          const floorGraphics = new Graphics();

          for (let gy = 0; gy < GRID_SIZE; gy++) {
            for (let gx = 0; gx < GRID_SIZE; gx++) {
              // 2:1 isometric coordinate transformation
              const tileCenterX = originX + (gx - gy) * HALF_W;
              const tileCenterY = originY + (gx + gy) * HALF_H;

              // Alternating subtle tile shades
              const isEven = (gx + gy) % 2 === 0;
              const tileColor = isEven ? 0x1e293b : 0x192231;
              const borderColor = (gx === 1 && gy === 1) ? 0x3b82f6 : 0x334155;

              // Draw isometric diamond
              floorGraphics
                .poly([
                  tileCenterX, tileCenterY - HALF_H,
                  tileCenterX + HALF_W, tileCenterY,
                  tileCenterX, tileCenterY + HALF_H,
                  tileCenterX - HALF_W, tileCenterY,
                ])
                .fill({ color: tileColor })
                .stroke({ width: 1.5, color: borderColor, alpha: (gx === 1 && gy === 1) ? 0.9 : 0.6 });
            }
          }
          worldContainer.addChild(floorGraphics);

          // 2. Draw Placeholder Desk on center tile (gx: 1, gy: 1)
          const deskGridX = 1;
          const deskGridY = 1;
          const deskCenterX = originX + (deskGridX - deskGridY) * HALF_W;
          const deskCenterY = originY + (deskGridX + deskGridY) * HALF_H;

          const deskGraphics = new Graphics();

          // Desk dimensions
          const deskW = 54;
          const deskH = 27; // 2:1 ratio
          const deskHalfW = deskW / 2;
          const deskHalfH = deskH / 2;
          const deskElevation = 24; // Height from floor to desktop

          const topCenterY = deskCenterY - deskElevation;

          // Drop shadow on floor
          deskGraphics
            .poly([
              deskCenterX, deskCenterY - deskHalfH * 0.9,
              deskCenterX + deskHalfW * 1.1, deskCenterY,
              deskCenterX, deskCenterY + deskHalfH * 1.1,
              deskCenterX - deskHalfW * 1.1, deskCenterY,
            ])
            .fill({ color: 0x070a10, alpha: 0.5 });

          // Desk front-left face (extrusion)
          deskGraphics
            .poly([
              deskCenterX - deskHalfW, topCenterY,
              deskCenterX, topCenterY + deskHalfH,
              deskCenterX, deskCenterY,
              deskCenterX - deskHalfW, deskCenterY - deskHalfH,
            ])
            .fill({ color: 0x1e293b })
            .stroke({ width: 1, color: 0x0f172a, alpha: 0.8 });

          // Desk front-right face (extrusion)
          deskGraphics
            .poly([
              deskCenterX, topCenterY + deskHalfH,
              deskCenterX + deskHalfW, topCenterY,
              deskCenterX + deskHalfW, deskCenterY - deskHalfH,
              deskCenterX, deskCenterY,
            ])
            .fill({ color: 0x0f172a })
            .stroke({ width: 1, color: 0x090d16, alpha: 0.8 });

          // Desktop surface (top isometric diamond)
          deskGraphics
            .poly([
              deskCenterX, topCenterY - deskHalfH,
              deskCenterX + deskHalfW, topCenterY,
              deskCenterX, topCenterY + deskHalfH,
              deskCenterX - deskHalfW, topCenterY,
            ])
            .fill({ color: 0x2563eb })
            .stroke({ width: 1.5, color: 0x60a5fa, alpha: 0.9 });

          // Placeholder Computer Monitor atop desk
          const monitorBaseY = topCenterY - 4;
          const monitorW = 20;
          const monitorH = 14;

          // Monitor stand
          deskGraphics
            .rect(deskCenterX - 2, monitorBaseY - 4, 4, 5)
            .fill({ color: 0x64748b });

          // Monitor screen back/frame
          deskGraphics
            .rect(deskCenterX - monitorW / 2, monitorBaseY - monitorH - 4, monitorW, monitorH)
            .fill({ color: 0x0f172a })
            .stroke({ width: 1, color: 0x38bdf8 });

          // Monitor active screen glow
          deskGraphics
            .rect(deskCenterX - (monitorW - 4) / 2, monitorBaseY - monitorH - 2, monitorW - 4, monitorH - 4)
            .fill({ color: 0x38bdf8 });

          worldContainer.addChild(deskGraphics);

          // 3. Technical Preview Labels via Pixi Text
          const titleText = new Text({
            text: 'AO-TYCOON-01 PREVIEW: 3x3 2:1 ISOMETRIC GRID',
            style: {
              fontFamily: 'monospace',
              fontSize: 12,
              fill: 0x94a3b8,
              letterSpacing: 1,
            },
          });
          titleText.anchor.set(0.5, 1);
          titleText.position.set(originX, originY - 2.5 * HALF_H);
          worldContainer.addChild(titleText);

          const deskLabel = new Text({
            text: 'PLACEHOLDER DESK (1,1)',
            style: {
              fontFamily: 'monospace',
              fontSize: 10,
              fill: 0x38bdf8,
              fontWeight: 'bold',
            },
          });
          deskLabel.anchor.set(0.5, 0);
          deskLabel.position.set(deskCenterX, deskCenterY + deskHalfH + 10);
          worldContainer.addChild(deskLabel);
        };

        // Render initial frame
        updateSceneLayout();

        // Attach WebGL context lifecycle controller
        lifecycleController = new PixiContextLifecycleController();
        controllerRef.current = lifecycleController;

        lifecycleController.attach({
          canvas: pixiApp.canvas,
          ticker: pixiApp.ticker,
          onRestore: async () => {
            // Rebuild procedural scene and force render upon context restoration
            updateSceneLayout();
            if (pixiApp.renderer) {
              pixiApp.render();
            }
          },
          onStateChange: (state) => {
            if (!isCancelled) {
              setContextState(state);
              if (state === 'ready') {
                setContextError(null);
              }
            }
          },
          onError: (err) => {
            if (!isCancelled) {
              setContextError(err.message || 'WebGL context restoration failed');
            }
          },
        });

        // Handle resize events
        const handleResize = () => {
          if (!isCancelled && pixiApp.renderer) {
            updateSceneLayout();
          }
        };

        window.addEventListener('resize', handleResize);

        if (!isCancelled) {
          setIsInitializing(false);
        }

        // Cleanup listener attachment
        return () => {
          window.removeEventListener('resize', handleResize);
        };
      } catch (err: any) {
        console.error('Failed to initialize PixiJS application:', err);
        if (!isCancelled) {
          setInitError(err?.message || 'WebGL / WebGPU initialization failed');
          setIsInitializing(false);
        }
      }
    };

    const cleanupPromise = initPixi();

    return () => {
      isCancelled = true;
      cleanupPromise.then((cleanupFn) => {
        if (typeof cleanupFn === 'function') {
          cleanupFn();
        }
      });

      // Teardown controller detach BEFORE destroying Pixi application
      if (controllerRef.current) {
        controllerRef.current.detach();
        controllerRef.current = null;
      }

      if (app) {
        if (isInitialized) {
          try {
            if (app.canvas && app.canvas.parentElement) {
              app.canvas.remove();
            }
            app.destroy(true, { children: true });
          } catch (e) {
            console.warn('Error during Pixi app cleanup:', e);
          }
        }
      }
    };
  }, [retryNonce]);

  return (
    <section className="pixi-office-canvas-container" aria-label="Tycoon Canvas Technical Preview">
      <header className="pixi-canvas-header">
        <div className="preview-badge-group">
          <span className={`status-pill ${contextState}`}>
            <span className="dot" />
            {contextState === 'lost'
              ? 'WebGL Lost'
              : contextState === 'recovering'
              ? 'Restoring WebGL...'
              : contextState === 'error'
              ? 'Restore Failed'
              : 'PIXI.JS v8 (WebGL)'}
          </span>
          <span className="preview-label">Tycoon Canvas Technical Preview</span>
          <span className="preview-subtext">(AO-TYCOON-01)</span>
        </div>

        <div className="preview-metadata">
          <span className="meta-item">
            Grid: <strong>3×3 (2:1 Isometric)</strong>
          </span>
          <span className="meta-item">
            DPI Cap: <strong>2× Max</strong>
          </span>
          {onClosePreview && (
            <button
              type="button"
              className="retry-btn"
              style={{
                padding: '0.25rem 0.6rem',
                fontSize: '0.75rem',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '4px',
                color: '#e2e8f0',
                cursor: 'pointer',
              }}
              onClick={onClosePreview}
            >
              Exit Preview
            </button>
          )}
        </div>
      </header>

      {initError ? (
        <div className="pixi-error-container" role="alert">
          <div className="error-card">
            <h3>Renderer Initialization Failed</h3>
            <p>
              PixiJS v8 failed to initialize a WebGL/WebGPU context on this device.
              Please check your browser hardware acceleration settings.
            </p>
            <div className="error-details">{initError}</div>
            <button
              type="button"
              className="retry-btn"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              Retry Initialization
            </button>
          </div>
        </div>
      ) : (
        <div className="pixi-viewport-wrapper" ref={containerRef}>
          {isInitializing && (
            <div className="pixi-loading-indicator">
              <div className="spinner" />
              <span>Initializing PixiJS v8 Engine...</span>
            </div>
          )}

          {(contextState === 'lost' || contextState === 'recovering') && (
            <div className="pixi-recovering-indicator" role="status" aria-live="polite">
              <div className="spinner" />
              <span>
                {contextState === 'lost'
                  ? 'WebGL context lost. Awaiting restoration...'
                  : 'Restoring WebGL context & isometric scene...'}
              </span>
            </div>
          )}

          {contextState === 'error' && (
            <div className="pixi-error-container context-error-overlay" role="alert">
              <div className="error-card">
                <h3>WebGL Context Restoration Failed</h3>
                <p>
                  The GPU context was interrupted and automatic restoration encountered an error.
                </p>
                {contextError && <div className="error-details">{contextError}</div>}
                <div className="error-actions">
                  <button
                    type="button"
                    className="retry-btn"
                    onClick={handleRetryContext}
                  >
                    Retry Context Restore
                  </button>
                  <button
                    type="button"
                    className="retry-btn secondary"
                    onClick={() => setRetryNonce((n) => n + 1)}
                  >
                    Reinitialize Canvas
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="pixi-canvas-footer">
        <div className="hud-stat">Renderer: <span>PixiJS v8 (WebGL)</span></div>
        <div className="hud-stat">DPI Ratio: <span>{Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)}x</span></div>
        <div className="hud-stat">Context: <span className={`state-${contextState}`}>{contextState.toUpperCase()}</span></div>
        <div className="hud-stat">Entity: <span>Desk (gx:1, gy:1)</span></div>
      </footer>
    </section>
  );
};
