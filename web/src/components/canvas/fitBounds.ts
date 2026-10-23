export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fit in CSS pixels; renderer resolution must not change the camera transform. */
export function fitBounds(bounds: SceneBounds, width: number, height: number) {
  const padding = Math.min(24, Math.max(12, Math.min(width, height) * 0.05));
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(
    availableWidth / Math.max(1, bounds.width),
    availableHeight / Math.max(1, bounds.height),
  );
  return {
    scale,
    x: width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: height / 2 - (bounds.y + bounds.height / 2) * scale,
    padding,
  };
}
