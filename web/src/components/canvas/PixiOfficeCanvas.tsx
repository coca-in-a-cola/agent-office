import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Container, Sprite } from 'pixi.js';
import { fitBounds, type SceneBounds } from './fitBounds';
import { PixiContextLifecycleController, type ContextRecoveryState } from './pixiContextLifecycle';
import { TouchController } from '../../engine/input/TouchController';
import {
  TycoonAssetManager,
  type MiroAnimationMode,
} from './tycoonAssets';
import {
  createOfficeRoomLayout,
  buildPixiRoomScene,
  hitTestSceneItem,
  AGENT_CONFIGS,
  type OfficeRoomLayout,
} from '../../scene/OfficeRoomScene';
import { FurnitureToolbar } from '../furniture/FurnitureToolbar';
import {
  FURNITURE_CATALOG,
  canPlaceFurniture,
  findPlacedFurnitureAt,
  getNextRotation,
  type PlacedFurnitureItem,
  type FurnitureRotation,
} from '../../grid/footprintEngine';
import { snapToGrid, isoToScreen, calculateDepthZ } from '../../engine/isometric/isoMath';
import './PixiOfficeCanvas.scss';

interface PixiOfficeCanvasProps {
  onClosePreview?: () => void;
}

export const PixiOfficeCanvas: React.FC<PixiOfficeCanvasProps> = ({ onClosePreview }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PixiContextLifecycleController | null>(null);
  const setAnimationModeRef = useRef<((mode: MiroAnimationMode) => void) | null>(null);
  const animationModeRef = useRef<MiroAnimationMode>('typing');
  const rebuildSceneRef = useRef<(() => void) | null>(null);
  const sceneModeRef = useRef<'room' | 'diorama'>('room');
  const currentLayoutRef = useRef<OfficeRoomLayout | null>(null);

  const [sceneMode, setSceneMode] = useState<'room' | 'diorama'>('room');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const [contextState, setContextState] = useState<ContextRecoveryState>('ready');
  const [contextError, setContextError] = useState<string | null>(null);
  const [animationMode, setAnimationModeState] = useState<MiroAnimationMode>('typing');

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [selectedDefId, setSelectedDefId] = useState<string | null>('desk_wood');
  const [furnitureRotation, setFurnitureRotation] = useState<FurnitureRotation>(0);
  const [isDeleteMode, setIsDeleteMode] = useState<boolean>(false);
  const [placedFurniture, setPlacedFurniture] = useState<PlacedFurnitureItem[]>([]);

  const isEditModeRef = useRef(false);
  isEditModeRef.current = isEditMode;
  const selectedDefIdRef = useRef<string | null>('desk_wood');
  selectedDefIdRef.current = selectedDefId;
  const furnitureRotationRef = useRef<FurnitureRotation>(0);
  furnitureRotationRef.current = furnitureRotation;
  const isDeleteModeRef = useRef(false);
  isDeleteModeRef.current = isDeleteMode;
  const placedFurnitureRef = useRef<PlacedFurnitureItem[]>([]);
  placedFurnitureRef.current = placedFurniture;

  const selectedAgent = AGENT_CONFIGS.find((a) => a.id === selectedAgentId);

  const handleToggleSceneMode = useCallback(() => {
    setSceneMode((prev) => {
      const nextMode = prev === 'room' ? 'diorama' : 'room';
      sceneModeRef.current = nextMode;
      if (rebuildSceneRef.current) {
        rebuildSceneRef.current();
      }
      return nextMode;
    });
  }, []);

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
          onTap: (tap) => {
            if (isCancelled) return;
            const worldPos = worldContainer.position;
            const worldScale = worldContainer.scale.x || 1;
            const localX = (tap.screenX - worldPos.x) / worldScale;
            const localY = (tap.screenY - worldPos.y) / worldScale;
            const snapped = snapToGrid(localX, localY);

            if (isEditModeRef.current) {
              if (isDeleteModeRef.current) {
                const existing = findPlacedFurnitureAt(snapped.gx, snapped.gy, placedFurnitureRef.current);
                if (existing) {
                  setPlacedFurniture((prev) => prev.filter((p) => p.id !== existing.id));
                  if (rebuildSceneRef.current) rebuildSceneRef.current();
                }
              } else if (selectedDefIdRef.current) {
                const def = FURNITURE_CATALOG[selectedDefIdRef.current];
                if (def) {
                  const check = canPlaceFurniture(
                    snapped.gx,
                    snapped.gy,
                    def,
                    furnitureRotationRef.current,
                    { width: 8, height: 8 },
                    placedFurnitureRef.current
                  );
                  if (check.valid) {
                    const newItem: PlacedFurnitureItem = {
                      id: 'furn_' + Date.now(),
                      defId: selectedDefIdRef.current,
                      gx: snapped.gx,
                      gy: snapped.gy,
                      rotation: furnitureRotationRef.current,
                    };
                    setPlacedFurniture((prev) => [...prev, newItem]);
                    if (rebuildSceneRef.current) rebuildSceneRef.current();
                  }
                }
              }
            } else if (currentLayoutRef.current) {
              const hit = hitTestSceneItem(localX, localY, currentLayoutRef.current);
              if (hit.type === 'agent' && hit.id) {
                setSelectedAgentId(hit.id);
              }
            }
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

          if (sceneModeRef.current === 'room') {
            const layout = createOfficeRoomLayout(8, 8, 0, 0);
            currentLayoutRef.current = layout;
            const room = buildPixiRoomScene(spritesheet, layout, (agentId) => {
              setSelectedAgentId(agentId);
            });

            if (isCancelled) {
              room.rootContainer.destroy({ children: true });
              return;
            }

            setAnimationModeRef.current = (mode) => {
              for (const ws of layout.workstations) {
                room.setAgentStatus(ws.agentId, mode === 'typing' ? 'working' : 'idle');
              }
            };
            worldContainer.addChild(room.rootContainer);

            // Render dynamically placed furniture items
            for (const item of placedFurnitureRef.current) {
              const def = FURNITURE_CATALOG[item.defId];
              if (!def) continue;
              const texKey = def.textureKey && spritesheet.textures[def.textureKey] ? def.textureKey : 'desk_wood';
              const furnSprite = new Sprite(spritesheet.textures[texKey]);
              furnSprite.anchor.set(0.5, 0.8);
              const { screenX, screenY } = isoToScreen(item.gx, item.gy);
              furnSprite.position.set(screenX, screenY);
              furnSprite.zIndex = calculateDepthZ(item.gx, item.gy, 35);
              worldContainer.addChild(furnSprite);
            }

            const bounds = room.rootContainer.getLocalBounds();
            roomBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
            fitScene();
          } else {
            currentLayoutRef.current = null;
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
          }
        };

        rebuildSceneRef.current = () => {
          buildScene();
          if (pixiApp.renderer) {
            pixiApp.render();
          }
        };

        pixiApp.stage.eventMode = 'static';
        pixiApp.stage.hitArea = pixiApp.screen;
        pixiApp.stage.on('pointerdown', (event) => {
          if (!isEditModeRef.current && sceneModeRef.current === 'room' && currentLayoutRef.current) {
            const local = worldContainer.toLocal(event.global);
            const hit = hitTestSceneItem(local.x, local.y, currentLayoutRef.current);
            if (hit.type === 'agent' && hit.id) {
              setSelectedAgentId(hit.id);
            }
          }
        });

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
          <h1 className="preview-label">
            {sceneMode === 'room' ? 'Walnut & Sage — 8×8 Shared Office' : 'Walnut & Sage — 3×3 Diorama'}
          </h1>
          <span className="preview-subtext">({sceneMode === 'room' ? 'AO-TYCOON-04' : 'AO-TYCOON-01'})</span>
        </div>

        <div className="preview-metadata">
          <div className="scene-toggle-group">
            <button
              type="button"
              className={`toggle-mode-btn ${sceneMode === 'room' ? 'active' : ''}`}
              onClick={handleToggleSceneMode}
            >
              8×8 Shared Office
            </button>
            <button
              type="button"
              className={`toggle-mode-btn ${sceneMode === 'diorama' ? 'active' : ''}`}
              onClick={handleToggleSceneMode}
            >
              3×3 Diorama
            </button>
          </div>

          <button
            type="button"
            className={`toggle-mode-btn ${isEditMode ? 'active' : ''}`}
            onClick={() => setIsEditMode((prev) => !prev)}
            title="Toggle Furniture Editor Mode"
          >
            {isEditMode ? 'Exit Editor' : 'Edit Furniture'}
          </button>

          {selectedAgent && (
            <div className="agent-status-chip">
              <span className="agent-dot" />
              <span>Agent: <strong>{selectedAgent.name}</strong> ({selectedAgent.role})</span>
              <button
                type="button"
                className="agent-clear-btn"
                onClick={() => setSelectedAgentId(null)}
                title="Deselect agent"
              >
                ×
              </button>
            </div>
          )}

          <div className="animation-toggle-group">
            <span className="toggle-label">{sceneMode === 'room' ? 'Agents:' : 'Miro:'}</span>
            <button
              type="button"
              className={`toggle-mode-btn ${animationMode === 'idle' ? 'active' : ''}`}
              onClick={handleToggleAnimation}
              title="Toggle animation between Idle pose and Typing (6 fps)"
            >
              {animationMode === 'typing' ? 'Typing (6 fps)' : 'Idle'}
            </button>
          </div>

          <span className="meta-item">
            Grid: <strong>{sceneMode === 'room' ? '8×8' : '3×3'} (2:1 Dimetric)</strong>
          </span>
          <span className="meta-item">
            DPI Cap: <strong>2× Max</strong>
          </span>

           <button
             type="button"
             className={`toggle-mode-btn ${isEditMode ? 'active' : ''}`}
             onClick={() => setIsEditMode((prev) => !prev)}
             title="Toggle Furniture Editor Mode"
           >
             {isEditMode ? 'Exit Editor' : 'Edit Furniture'}
           </button>
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

      {isEditMode && (
        <FurnitureToolbar
          selectedDefId={selectedDefId}
          rotation={furnitureRotation}
          isDeleteMode={isDeleteMode}
          onSelectDef={(defId) => {
            setSelectedDefId(defId);
            setIsDeleteMode(false);
          }}
          onRotate={() => setFurnitureRotation((r) => getNextRotation(r))}
          onToggleDelete={() => setIsDeleteMode((prev) => !prev)}
          onClose={() => setIsEditMode(false)}
        />
      )}
      <footer className="pixi-canvas-footer">
        <div className="hud-stat">Renderer: <span>PixiJS v8 (WebGL)</span></div>
        <div className="hud-stat">DPI Ratio: <span>{Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)}x</span></div>
        <div className="hud-stat">Context: <span className={`state-${contextState}`}>{contextState.toUpperCase()}</span></div>
        <div className="hud-stat">Animation: <span>{animationMode.toUpperCase()} (6fps)</span></div>
        <div className="hud-stat">Art: <span>Walnut & Sage (Sample)</span></div>
      </footer>

       {isEditMode && (
         <FurnitureToolbar
           selectedDefId={selectedDefId}
           rotation={furnitureRotation}
           isDeleteMode={isDeleteMode}
           onSelectDef={(defId) => {
             setSelectedDefId(defId);
             setIsDeleteMode(false);
           }}
           onRotate={() => setFurnitureRotation((r) => getNextRotation(r))}
           onToggleDelete={() => setIsDeleteMode((prev) => !prev)}
           onClose={() => setIsEditMode(false)}
         />
       )}
      </section>
  );
};
