import {
  pointInPolygon,
  pointToSegmentDistance,
  imageRectFromPaintPx,
  freehandBoundsFromPathPx,
  clipBoundsFromClipNPx,
} from './selection.js';

export function getImagePaintForLayerIndex(layers, layerIndex) {
  const list = Array.isArray(layers) ? layers : [];
  const layer = list[layerIndex];
  if (!layer) return null;
  const paints = Array.isArray(layer.paints) ? layer.paints : [];
  return paints.find((p) => p && p.kind === 'image' && p.blob instanceof Blob) || null;
}

export function getFreehandPaintForLayerIndex(layers, layerIndex) {
  const list = Array.isArray(layers) ? layers : [];
  const layer = list[layerIndex];
  if (!layer) return null;
  const paints = Array.isArray(layer.paints) ? layer.paints : [];
  return paints.find((p) => p && p.kind === 'freehand' && Array.isArray(p.pathN) && p.pathN.length >= 2) || null;
}

export function getImageRectPxForLayerIndex(layers, layerIndex, overlaySize) {
  const paint = getImagePaintForLayerIndex(layers, layerIndex);
  if (!paint || !overlaySize) return null;
  return imageRectFromPaintPx(paint, overlaySize.w, overlaySize.h);
}

export function getClipPolyPxForLayerIndex(layers, layerIndex, overlaySize) {
  const list = Array.isArray(layers) ? layers : [];
  const layer = list[layerIndex];
  const clipN = layer && Array.isArray(layer.clipPathN) ? layer.clipPathN : null;
  if (!clipN || clipN.length < 3 || !overlaySize) return null;
  return clipN.map((q) => [q[0] * overlaySize.w, q[1] * overlaySize.h]);
}

export function getFreehandBoundsPxForLayerIndex(layers, layerIndex, overlaySize) {
  const paint = getFreehandPaintForLayerIndex(layers, layerIndex);
  if (!paint || !overlaySize) return null;
  return freehandBoundsFromPathPx(paint.pathN, paint.thickness, overlaySize.w, overlaySize.h);
}

export function getClipBoundsPxForClipN(clipN, overlaySize) {
  if (!overlaySize) return null;
  return clipBoundsFromClipNPx(clipN, overlaySize.w, overlaySize.h);
}

export function getClipHandleAtPoint(bounds, px, py) {
  if (!bounds) return '';
  const hx = bounds.maxX;
  const hy = bounds.maxY;
  const r = 18;
  return Math.hypot(px - hx, py - hy) <= r ? 'se' : '';
}

export function getImageHandleAtPoint(rect, px, py) {
  if (!rect) return '';
  const hx = rect.x + rect.w;
  const hy = rect.y + rect.h;
  const r = 18;
  const dx = px - hx;
  const dy = py - hy;
  return Math.hypot(dx, dy) <= r ? 'se' : '';
}

export function hitTestTopmostImageLayer(layers, px, py, overlaySize) {
  const list = Array.isArray(layers) ? layers : [];
  if (!overlaySize || overlaySize.w <= 0 || overlaySize.h <= 0) return -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const rect = getImageRectPxForLayerIndex(list, i, overlaySize);
    if (!rect) continue;
    const inside = px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
    const onHandle = !!getImageHandleAtPoint(rect, px, py);
    if (inside || onHandle) return i;
  }
  return -1;
}

export function hitTestTopmostClipLayer(layers, px, py, overlaySize) {
  const list = Array.isArray(layers) ? layers : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const polyPx = getClipPolyPxForLayerIndex(list, i, overlaySize);
    if (!polyPx) continue;
    if (pointInPolygon(px, py, polyPx)) return i;
  }
  return -1;
}

export function hitTestTopmostFreehandLayer(layers, px, py, overlaySize) {
  const list = Array.isArray(layers) ? layers : [];
  if (!overlaySize) return -1;

  for (let i = list.length - 1; i >= 0; i--) {
    const paint = getFreehandPaintForLayerIndex(list, i);
    if (!paint) continue;
    const pathN = Array.isArray(paint.pathN) ? paint.pathN : [];
    if (pathN.length < 2) continue;

    const tRaw = Number(paint.thickness);
    const thickness = Number.isFinite(tRaw) ? Math.max(1, Math.min(100, Math.round(tRaw))) : 1;
    const tol = Math.max(6, thickness * 0.75);

    let hit = false;
    for (let j = 1; j < pathN.length; j++) {
      const a = pathN[j - 1];
      const b = pathN[j];
      if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
      const ax = Number(a[0]) * overlaySize.w;
      const ay = Number(a[1]) * overlaySize.h;
      const bx = Number(b[0]) * overlaySize.w;
      const by = Number(b[1]) * overlaySize.h;
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      if (pointToSegmentDistance(px, py, ax, ay, bx, by) <= tol) {
        hit = true;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}