import {
  isValidPathN,
  translatePathN,
  clampDeltaToUnitForPaths,
  collectPathsFromIndexMap,
  computeImagePlacementFromDrag,
  getShapeResizeTransform,
  scalePathNAroundCenter,
} from './interactions.js';

// Pointer-move helpers: update active interaction previews and transforms.

// Moves selected shape layers while dragging.
export function handlePointerMoveDraggingShape(args) {
  const { self, evt, p, getOverlaySize, drawOverlayPath } = args;
  if (!self || !self.isDraggingShape) return false;
  if (self.dragPointerId !== evt.pointerId) return true;

  self.dragPendingPos = p;

  if (!self.dragRaf) {
    self.dragRaf = window.requestAnimationFrame(() => {
      self.dragRaf = 0;
      if (!self.isDraggingShape) return;
      if (!Array.isArray(self.dragStartPos) || self.dragStartPos.length < 2) return;
      if (!Array.isArray(self.dragPendingPos) || self.dragPendingPos.length < 2) return;

      const movedIndices = Array.isArray(self.dragTargetIndices) && self.dragTargetIndices.length ? self.dragTargetIndices : [];
      const hasLayerStarts = self.dragStartClipByIndex instanceof Map && movedIndices.length;
      if (!hasLayerStarts) {
        if (!isValidPathN(self.dragStartClipPathN, 3)) return;
      }

      const { w, h } = getOverlaySize();
      const dx = self.dragPendingPos[0] - self.dragStartPos[0];
      const dy = self.dragPendingPos[1] - self.dragStartPos[1];
      let dxN = dx / w;
      let dyN = dy / h;

      const boundsPaths = self.dragStartClipByIndex instanceof Map && movedIndices.length
        ? collectPathsFromIndexMap(self.dragStartClipByIndex, movedIndices, 3)
        : (isValidPathN(self.dragStartClipPathN, 3) ? [self.dragStartClipPathN] : []);
      const clamped = clampDeltaToUnitForPaths(boundsPaths, dxN, dyN);
      dxN = clamped.dxN;
      dyN = clamped.dyN;

      const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
      if (self.dragStartClipByIndex instanceof Map && movedIndices.length) {
        for (const idx of movedIndices) {
          const layer = layers[idx];
          const clipN = self.dragStartClipByIndex.get(idx);
          if (!layer || !Array.isArray(clipN) || clipN.length < 3) continue;
          const nextClipN = translatePathN(clipN, dxN, dyN);
          if (nextClipN.length < 3) continue;
          const nextKey = self.makeClipKey(nextClipN);
          layer.clipPathN = nextClipN;
          layer.clipKey = nextKey;
          if (idx === self.dragLayerIndex || idx === self.activeLayerIndex) {
            self.activeClipPathN = nextClipN.slice();
            self.activeClipKey = nextKey;
          }
        }

        self.canvasLayers.redrawAllLayers();
        drawOverlayPath();
        return;
      }

      const nextClipN = translatePathN(self.dragStartClipPathN, dxN, dyN);
      if (nextClipN.length < 3) return;
      const nextKey = self.makeClipKey(nextClipN);
      self.activeClipPathN = nextClipN.slice();
      self.activeClipKey = nextKey;
      drawOverlayPath();
    });
  }

  evt.preventDefault();
  return true;
}

// Resizes selected shape layers while dragging a resize handle.
export function handlePointerMoveResizingShape(args) {
  const { self, evt, p, drawOverlayPath, getClipBoundsPxForClipN } = args;
  if (!self || !self.isResizingShape) return false;
  if (self.shapeResizePointerId !== evt.pointerId) return true;
  if (!Array.isArray(self.shapeResizeStartClipPathN) || self.shapeResizeStartClipPathN.length < 3) return true;

  const startBounds = self.shapeResizeStartBounds || getClipBoundsPxForClipN(self.shapeResizeStartClipPathN);
  if (!startBounds) return true;
  const startDist = Number.isFinite(self.shapeResizeStartDist) ? self.shapeResizeStartDist : 0.000001;

  const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
  const targets = Array.isArray(self.shapeResizeTargetIndices) && self.shapeResizeTargetIndices.length
    ? self.shapeResizeTargetIndices
    : [Number.isFinite(self.shapeResizeLayerIndex) ? self.shapeResizeLayerIndex : -1];

  const startClips = [];
  for (const idx of targets) {
    if (!(Number.isFinite(idx) && idx >= 0 && idx < layers.length)) continue;
    const baseClip = self.shapeResizeStartClipByIndex instanceof Map ? self.shapeResizeStartClipByIndex.get(idx) : null;
    if (Array.isArray(baseClip) && baseClip.length >= 3) startClips.push(baseClip);
  }
  if (startClips.length === 0) startClips.push(self.shapeResizeStartClipPathN);

  const transform = getShapeResizeTransform(startClips, startBounds, startDist, p, 0.03);
  if (!transform) return true;
  const cxN = transform.cxN;
  const cyN = transform.cyN;
  const factor = transform.factor;

  let changedAny = false;
  for (const idx of targets) {
    if (!(Number.isFinite(idx) && idx >= 0 && idx < layers.length)) continue;
    const layer = layers[idx];
    if (!layer || !Array.isArray(layer.clipPathN) || layer.clipPathN.length < 3) continue;
    const baseClip = self.shapeResizeStartClipByIndex instanceof Map ? self.shapeResizeStartClipByIndex.get(idx) : null;
    const startClip = Array.isArray(baseClip) && baseClip.length >= 3 ? baseClip : layer.clipPathN;

    const nextClipN = scalePathNAroundCenter(startClip, cxN, cyN, factor);
    if (nextClipN.length < 3) continue;

    const nextKey = self.makeClipKey(nextClipN);
    layer.clipPathN = nextClipN;
    layer.clipKey = nextKey;
    changedAny = true;
    if (typeof self.canvasLayers.scheduleVisibleColorsCompute === 'function') {
      self.canvasLayers.scheduleVisibleColorsCompute(idx).catch(() => {});
    }

    if (idx === self.activeLayerIndex || idx === self.shapeResizeLayerIndex) {
      self.activeClipPathN = nextClipN.slice();
      self.activeClipKey = nextKey;
    }
  }

  if (!changedAny && Array.isArray(self.shapeResizeStartClipPathN) && self.shapeResizeStartClipPathN.length >= 3) {
    const nextClipN = scalePathNAroundCenter(self.shapeResizeStartClipPathN, cxN, cyN, factor);
    if (nextClipN.length >= 3) {
      const nextKey = self.makeClipKey(nextClipN);
      self.activeClipPathN = nextClipN.slice();
      self.activeClipKey = nextKey;
      changedAny = true;
    }
  }

  if (changedAny) {
    self.canvasLayers.redrawAllLayers();
    self.renderLayersList();
    drawOverlayPath();
  }
  evt.preventDefault();
  return true;
}

// Moves or resizes the active image layer.
export function handlePointerMoveDraggingImage(args) {
  const { self, evt, p, getOverlaySize, drawOverlayPath, getImagePaintForLayerIndex } = args;
  if (!self || !self.isDraggingImage) return false;
  if (self.imagePointerId !== evt.pointerId) return true;
  if (!Array.isArray(self.imageStartPos) || self.imageStartPos.length < 2) return true;
  if (!self.imageStartPlacement) return true;
  const idx = self.imageLayerIndex;
  if (idx < 0) return true;

  const paint = getImagePaintForLayerIndex(idx);
  if (!paint) return true;

  const { w, h } = getOverlaySize();
  const dx = p[0] - self.imageStartPos[0];
  const dy = p[1] - self.imageStartPos[1];
  const nextPlacement = computeImagePlacementFromDrag(self.imageStartPlacement, self.imageDragMode, dx, dy, w, h);
  if (!nextPlacement) return true;

  paint.xN = nextPlacement.xN;
  paint.yN = nextPlacement.yN;
  paint.wN = nextPlacement.wN;
  paint.hN = nextPlacement.hN;

  self.canvasLayers.redrawAllLayers();
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

// Moves selected freehand paths (and selected shapes) as one group.
export function handlePointerMoveDraggingFreehand(args) {
  const { self, evt, p, getOverlaySize, drawOverlayPath, getFreehandPaintForLayerIndex } = args;
  if (!self || !self.isDraggingFreehand) return false;
  if (self.freehandPointerId !== evt.pointerId) return true;
  if (!Array.isArray(self.freehandStartPos) || self.freehandStartPos.length < 2) return true;
  if (!(self.freehandStartPathByIndex instanceof Map)) return true;
  if (!(self.freehandShapeStartClipByIndex instanceof Map)) return true;

  const movedFreehandIndices = Array.isArray(self.freehandTargetIndices) && self.freehandTargetIndices.length ? self.freehandTargetIndices : [];
  const movedShapeIndices = Array.isArray(self.freehandShapeTargetIndices) && self.freehandShapeTargetIndices.length ? self.freehandShapeTargetIndices : [];
  const hasAnyTargets = movedFreehandIndices.length > 0 || movedShapeIndices.length > 0;
  if (!hasAnyTargets) return true;

  const { w, h } = getOverlaySize();
  const dx = p[0] - self.freehandStartPos[0];
  const dy = p[1] - self.freehandStartPos[1];
  let dxN = dx / w;
  let dyN = dy / h;

  const boundsPaths = [
    ...collectPathsFromIndexMap(self.freehandStartPathByIndex, movedFreehandIndices, 2),
    ...collectPathsFromIndexMap(self.freehandShapeStartClipByIndex, movedShapeIndices, 3),
  ];

  const clamped = clampDeltaToUnitForPaths(boundsPaths, dxN, dyN);
  dxN = clamped.dxN;
  dyN = clamped.dyN;

  const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
  for (const idx of movedFreehandIndices) {
    const layer = layers[idx];
    const paint = getFreehandPaintForLayerIndex(idx);
    const startPathN = self.freehandStartPathByIndex.get(idx);
    if (!layer || !paint || !Array.isArray(startPathN) || startPathN.length < 2) continue;
    paint.pathN = translatePathN(startPathN, dxN, dyN);
  }

  for (const idx of movedShapeIndices) {
    const layer = layers[idx];
    const startClipN = self.freehandShapeStartClipByIndex.get(idx);
    if (!layer || !Array.isArray(startClipN) || startClipN.length < 3) continue;
    const nextClipN = translatePathN(startClipN, dxN, dyN);
    if (nextClipN.length < 3) continue;
    layer.clipPathN = nextClipN;
    layer.clipKey = self.makeClipKey(nextClipN);
    if (idx === self.activeLayerIndex) {
      self.activeClipPathN = nextClipN.slice();
      self.activeClipKey = layer.clipKey;
    }
  }

  self.canvasLayers.redrawAllLayers();
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

// Updates live crop rectangle preview while dragging.
export function tryUpdateCroppingPreview(args) {
  const { self, evt, p, drawOverlayPath } = args;
  if (!self || !self.isCropping) return false;
  if (self.cropPointerId !== evt.pointerId) return true;
  if (!Array.isArray(self.cropStartPos) || self.cropStartPos.length < 2) return true;

  self.cropPendingPos = p;
  const x0 = self.cropStartPos[0];
  const y0 = self.cropStartPos[1];
  const x1 = p[0];
  const y1 = p[1];
  const rx = Math.min(x0, x1);
  const ry = Math.min(y0, y1);
  const rw = Math.abs(x1 - x0);
  const rh = Math.abs(y1 - y0);
  self.cropRectPx = { x: rx, y: ry, w: rw, h: rh };
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

// Updates overlay cursor feedback based on hover target.
export function updatePointerHoverCursor(args) {
  const {
    self,
    p,
    overlay,
    getOverlaySize,
    getImageRectPxForLayerIndex,
    getImageHandleAtPoint,
    hitTestTopmostFreehandLayer,
    getSelectedClipBoundsPx,
    getClipBoundsPxForClipN,
    getClipHandleAtPoint,
    pointInPolygon,
  } = args;

  if (!self || !overlay) return;

  const hasActiveClip = Array.isArray(self.activeClipPathN) && self.activeClipPathN.length >= 3;
  if (self.activeLayerIndex >= 0) {
    const imgRect = getImageRectPxForLayerIndex(self.activeLayerIndex);
    if (imgRect) {
      const handle = getImageHandleAtPoint(imgRect, p[0], p[1]);
      const inside = p[0] >= imgRect.x && p[0] <= imgRect.x + imgRect.w && p[1] >= imgRect.y && p[1] <= imgRect.y + imgRect.h;
      overlay.style.cursor = handle ? 'nwse-resize' : inside ? 'move' : 'crosshair';
      return;
    }

    const selectedSet = new Set(self.getSelectedLayerIndices());
    const freeIdx = hitTestTopmostFreehandLayer(p[0], p[1]);
    if (freeIdx >= 0 && selectedSet.has(freeIdx)) {
      overlay.style.cursor = 'move';
      return;
    }
  }

  if (self.interactionMode === 'select' && self.activeLayerIndex >= 0 && hasActiveClip) {
    const { w, h } = getOverlaySize();
    const polyPx = self.activeClipPathN.map((q) => [q[0] * w, q[1] * h]);
    const bounds = getSelectedClipBoundsPx() || getClipBoundsPxForClipN(self.activeClipPathN);
    const handle = getClipHandleAtPoint(bounds, p[0], p[1]);
    overlay.style.cursor = handle ? 'nwse-resize' : pointInPolygon(p[0], p[1], polyPx) ? 'move' : 'crosshair';
  } else {
    overlay.style.cursor = 'crosshair';
  }
}

// Updates live marquee selection rectangle while dragging.
export function tryUpdateBoxSelectionPreview(args) {
  const { self, evt, p, normalizeRectPx, drawOverlayPath } = args;
  if (!self || !self.isBoxSelecting) return false;
  if (self.boxSelectPointerId !== evt.pointerId) return true;
  if (!Array.isArray(self.boxSelectStartPos) || self.boxSelectStartPos.length < 2) return true;

  const nextRect = normalizeRectPx(self.boxSelectStartPos, p);
  if (!nextRect) return true;
  self.boxSelectRectPx = nextRect;
  self.boxSelectMoved = self.boxSelectMoved || nextRect.w >= 3 || nextRect.h >= 3;
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

// Appends pointer points to the active draw stroke.
export function tryAppendDrawPathPoint(args) {
  const { self, evt, p, minDist, drawOverlayPath } = args;
  if (!self || !self.isDrawing) return false;
  if (self.drawPointerId !== evt.pointerId) return true;
  if (!Array.isArray(self.drawPath) || self.drawPath.length === 0) return true;

  const last = self.drawPath[self.drawPath.length - 1];
  const dx = p[0] - last[0];
  const dy = p[1] - last[1];
  if (Math.hypot(dx, dy) < (Number.isFinite(minDist) ? minDist : 2)) return true;

  self.drawPath.push(p);
  drawOverlayPath();
  evt.preventDefault();
  return true;
}
