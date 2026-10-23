import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Container } from 'pixi.js';
import { fitBounds, type SceneBounds } from './fitBounds';
import { PixiContextLifecycleController, type ContextRecoveryState } from './pixiContextLifecycle';
import { TouchController } from '../../engine/input/TouchController';
import {
  TycoonAssetManager,
  type MiroAnimationMode,
} from './tycoonAssets';
import './PixiOfficeCanvas.scss';

interface PixiOfficeCanvasProps {
  onClosePreview?: () => void;
}

export const PixiOfficeCanvas: React.FC<PixiOfficeCanvasProps> = ({ onClosePreview }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PixiContextLifecycleController | null>(null);
  const setAnimationModeRef = useRef<((mode: MiroAnimationMode) => void) | null>(null);
  const animationModeRef = useRef<MiroAnimationMode>('typing');

  const [initError, setInitError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const [contextState, setContextState] = useState<ContextRecoveryState>('ready');
  const [contextError, setContextError] = useState<string | null>(null);
  const [animationMode, setAnimationModeState] = useState<MiroAnimationMode>('typing');

  const handleToggleAnimation = useCallback(() => {
    setAnimationModeState((prev) => {
      const nextMode: MiroAnimationMode = prev === 'typing' ? 'idle' : 'typing';
      animationModeRef.current = nextMode;
      if (setAnimationModeRef.current) {
        setAnimationModeRef.current(nextMode);
      }
      return nextMode;
    });
  }, []);

  const handleRetryContext = async () => {
    if (controllerRef.current) {
      await controllerRef.current.handleContextRestored();
    } else {
      setRetryNonce((n) => n + 1);
    }
  };

  const handleRetryAssetLoad = () => {
    setAssetError(null);
    setRetryNonce((n) => n + 1);
  };

  useEffect(() => {
    let isCancelled = false;
    let app: Application | null = null;
    let isInitialized = false;
    let lifecycleController: PixiContextLifecycleController | null = null;
    let touchController: TouchController | null = null;

    setIsInitializing(true);
    setInitError(null);
    setAssetError(null);
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
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          resolution,
          autoDensity: true,
          backgroundColor: 0x0f1d1a, // Sage-dark background matching Walnut & Sage diorama
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

        // Input touch & pointer controller
        touchController = new TouchController({
          onTransform: (transform) => {
            if (isCancelled) return;
            worldContainer.position.set(transform.x, transform.y);
            worldContainer.scale.set(transform.scale);
          },
        });
        if (containerRef.current) {
          touchController.attach(containerRef.current);
        }

        // Load the artist-2d texture atlas with visible error handling
        let spritesheet: any = null;
        try {
          spritesheet = await TycoonAssetManager.loadAtlas(false);
        } catch (loadErr: any) {
          console.error('Failed to load Tycoon asset atlas:', loadErr);
          if (!isCancelled) {
            setAssetError(loadErr?.message || 'Failed to load own_tycoon_atlas.json');
            setIsInitializing(false);
          }
          return;
        }

        if (isCancelled) {
          touchController?.detach();
          touchController = null;
          if (app) {
            try {
              app.destroy(true, { children: true });
            } catch (destroyErr) {
              console.warn('Error during Pixi app destroy after cancel:', destroyErr);
            }
            app = null;
          }
          return;
        }

        let roomBounds: SceneBounds | null = null;
        const fitScene = () => {
          if (isCancelled || !roomBounds || !containerRef.current) return;
          const { clientWidth: width, clientHeight: height } = containerRef.current;
          if (width <= 0 || height <= 0) return;
          pixiApp.renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
          const fit = fitBounds(roomBounds, width, height);
          worldContainer.scale.set(fit.scale);
          worldContainer.position.set(fit.x, fit.y);
          touchController?.setTransform({ x: fit.x, y: fit.y, scale: fit.scale });
        };

        const buildScene = () => {
          if (isCancelled || !pixiApp.renderer || !spritesheet) return;

          for (const child of worldContainer.removeChildren()) {
            child.destroy({ children: true });
          }

          // Build depth-sorted diorama with atlas floor, wall, ficus, chair, miro, desk
          const diorama = TycoonAssetManager.buildDiorama(
            spritesheet,
            0,
            0,
            animationModeRef.current
          );

          if (isCancelled) {
            diorama.rootContainer.destroy({ children: true });
            return;
          }

          setAnimationModeRef.current = diorama.setAnimationMode;
          worldContainer.addChild(diorama.rootContainer);

          // Capture the entire untransformed room, not a tile-grid estimate.
          // Animation never re-fits the camera.
          const bounds = diorama.rootContainer.getLocalBounds();
          roomBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
          fitScene();
        };

        if (isCancelled) return;

        // Render initial frame
        buildScene();
        if (pixiApp.renderer) {
          pixiApp.render();
        }

        if (isCancelled) return;

        // Attach WebGL context lifecycle controller
        lifecycleController = new PixiContextLifecycleController();
        controllerRef.current = lifecycleController;

        lifecycleController.attach({
          canvas: pixiApp.canvas,
          ticker: pixiApp.ticker,
          onRestore: async () => {
            // 1. Dispose old sprites before unloading textures so display tree doesn't reference dead textures
            for (const child of worldContainer.removeChildren()) {
              child.destroy({ children: true });
            }
            setAnimationModeRef.current = null;

            // 2. Real texture atlas reload/resource recreation on restore required
            try {
              spritesheet = await TycoonAssetManager.loadAtlas(true);
            } catch (err: any) {
              console.error('Texture atlas reload failed during context restoration:', err);
              throw new Error(`Texture atlas recreation failed: ${err?.message || err}`);
            }

            buildScene();
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

        if (isCancelled) {
          touchController?.detach();
          touchController = null;
          lifecycleController.detach();
          controllerRef.current = null;
          return;
        }

        // Include flex/header reflow, without rebuilding sprites or restarting animation.
        const resizeObserver = new ResizeObserver(fitScene);
        resizeObserver.observe(containerRef.current!);
        window.addEventListener('resize', fitScene);

        if (!isCancelled) {
          setIsInitializing(false);
        }

        return () => {
          touchController?.detach();
          resizeObserver.disconnect();
          window.removeEventListener('resize', fitScene);
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
      setAnimationModeRef.current = null;
      cleanupPromise.then((cleanupFn) => {
        if (typeof cleanupFn === 'function') {
          cleanupFn();
        }
      });

      // Teardown controller detach BEFORE destroying Pixi application
      if (touchController) {
        touchController.detach();
        touchController = null;
      }

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

      // Cleanup texture ownership safely without breaking shared cache
      TycoonAssetManager.unloadAtlas().catch((err) => {
        console.warn('Error unloading Tycoon atlas during cleanup:', err);
      });
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
          <span className="sample-review-pill">Sample Art • Pending Review</span>
          <h1 className="preview-label">Walnut &amp; Sage — 3×3 Diorama</h1>
          <span className="preview-subtext">(AO-TYCOON-01)</span>
        </div>

        <div className="preview-metadata">
          <div className="animation-toggle-group">
            <span className="toggle-label">Miro:</span>
            <button
              type="button"
              className={`toggle-mode-btn ${animationMode === 'idle' ? 'active' : ''}`}
              onClick={handleToggleAnimation}
              title="Toggle Miro between Idle pose and Typing animation (6 fps)"
            >
              {animationMode === 'typing' ? 'Typing (6 fps)' : 'Idle'}
            </button>
          </div>

          <span className="meta-item">
            Grid: <strong>3×3 (2:1 Dimetric)</strong>
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
      ) : assetError ? (
        <div className="pixi-error-container" role="alert">
          <div className="error-card">
            <h3>Atlas Asset Loading Failed</h3>
            <p>
              Failed to load the sample Tycoon texture atlas (/assets/sample/own_tycoon_atlas.json).
            </p>
            <div className="error-details">{assetError}</div>
            <button
              type="button"
              className="retry-btn"
              onClick={handleRetryAssetLoad}
            >
              Retry Asset Load
            </button>
          </div>
        </div>
      ) : (
        <div className="pixi-viewport-wrapper" ref={containerRef}>
          {isInitializing && (
            <div className="pixi-loading-indicator">
              <div className="spinner" />
              <span>Loading Atlas & Initializing PixiJS v8...</span>
            </div>
          )}

          {(contextState === 'lost' || contextState === 'recovering') && (
            <div className="pixi-recovering-indicator" role="status" aria-live="polite">
              <div className="spinner" />
              <span>
                {contextState === 'lost'
                  ? 'WebGL context lost. Awaiting restoration...'
                  : 'Restoring WebGL context & reloading texture atlas...'}
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
        <div className="hud-stat">Animation: <span>{animationMode.toUpperCase()} (6fps)</span></div>
        <div className="hud-stat">Art: <span>Walnut & Sage (Sample)</span></div>
      </footer>
    </section>
  );
};
