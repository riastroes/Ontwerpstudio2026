// Pointer-down helpers: start interaction states only.

// Starts dragging/resizing for image layers after a hit test.
export function tryStartImageLayerDrag(args) {
  const {
    self,
    evt,
    p,
    interactionMode,
    overlay,
    hitTestTopmostImageLayer,
    getImageRectPxForLayerIndex,
    getImageHandleAtPoint,
    drawOverlayPath,
  } = args;

  if (!self || !overlay) return false;
  if (interactionMode !== 'select' || self.toolMode === 'crop') return false;

  const hitIdx = hitTestTopmostImageLayer(p[0], p[1]);
  if (hitIdx < 0) return false;

  self.setLayerSelectionSingle(hitIdx);
  self.renderLayersList();
  drawOverlayPath();

  const rect = getImageRectPxForLayerIndex(hitIdx);
  const handle = getImageHandleAtPoint(rect, p[0], p[1]);
  self.isDraggingImage = true;
  self.imagePointerId = evt.pointerId;
  self.imageLayerIndex = hitIdx;
  self.imageDragMode = handle ? 'resize' : 'move';
  self.imageStartPos = p;
  self.imageStartPlacement = rect
    ? { xN: rect.xN, yN: rect.yN, wN: rect.wN, hN: rect.hN }
    : { xN: 0, yN: 0, wN: 0.25, hN: 0.25 };

  overlay.setPointerCapture(evt.pointerId);
  overlay.style.cursor = self.imageDragMode === 'resize' ? 'nwse-resize' : 'grabbing';
  evt.preventDefault();
  return true;
}

// Starts dragging selected freehand paths (and selected shapes with them).
export function tryStartFreehandLayerDrag(args) {
  const {
    self,
    evt,
    p,
    interactionMode,
    overlay,
    hitTestTopmostFreehandLayer,
    getFreehandPaintForLayerIndex,
    drawOverlayPath,
  } = args;

  if (!self || !overlay) return false;
  if (interactionMode !== 'select' || self.toolMode === 'crop') return false;

  const freeIdx = hitTestTopmostFreehandLayer(p[0], p[1]);
  if (freeIdx < 0) return false;

  const selectedSet = new Set(self.getSelectedLayerIndices());
  if (!selectedSet.has(freeIdx)) {
    self.setLayerSelectionSingle(freeIdx);
  } else {
    self.setActiveLayerIndex(freeIdx);
    self.syncActiveShapeToLayerIndex(freeIdx);
  }
  self.renderLayersList();
  drawOverlayPath();

  self.isDraggingFreehand = true;
  self.freehandPointerId = evt.pointerId;
  self.freehandStartPos = p;

  const selected = self.getSelectedLayerIndices();
  self.freehandTargetIndices = selected.filter((i) => !!getFreehandPaintForLayerIndex(i));
  if (!Array.isArray(self.freehandTargetIndices) || self.freehandTargetIndices.length === 0) {
    self.freehandTargetIndices = [freeIdx];
  }

  self.freehandShapeTargetIndices = selected.filter((i) => {
    const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
    const layer = layers[i];
    return layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
  });

  self.freehandStartPathByIndex = new Map();
  for (const i of self.freehandTargetIndices) {
    const paint = getFreehandPaintForLayerIndex(i);
    const pathN = paint && Array.isArray(paint.pathN) ? paint.pathN : null;
    if (!pathN || pathN.length < 2) continue;
    self.freehandStartPathByIndex.set(i, pathN.map((q) => [q[0], q[1]]));
  }

  self.freehandShapeStartClipByIndex = new Map();
  for (const i of self.freehandShapeTargetIndices) {
    const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
    const layer = layers[i];
    if (!layer || !Array.isArray(layer.clipPathN) || layer.clipPathN.length < 3) continue;
    self.freehandShapeStartClipByIndex.set(i, layer.clipPathN.map((q) => [q[0], q[1]]));
  }

  overlay.setPointerCapture(evt.pointerId);
  overlay.style.cursor = 'grabbing';
  evt.preventDefault();
  return true;
}

// Starts marquee selection on empty canvas in select mode.
export function tryStartBoxSelection(args) {
  const { self, evt, p, interactionMode, overlay, drawOverlayPath } = args;
  if (!self || !overlay) return false;
  if (interactionMode !== 'select') return false;

  self.isBoxSelecting = true;
  self.boxSelectPointerId = evt.pointerId;
  self.boxSelectStartPos = p;
  self.boxSelectRectPx = { x: p[0], y: p[1], w: 0, h: 0 };
  self.boxSelectMoved = false;
  overlay.setPointerCapture(evt.pointerId);
  overlay.style.cursor = 'crosshair';
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

// Starts a new draw stroke in draw mode.
export function startDrawStroke(args) {
  const { self, evt, p, overlay, drawOverlayPath } = args;
  if (!self || !overlay) return false;

  self.setLayerSelectionSingle(-1);
  self.renderLayersList();
  drawOverlayPath();

  self.isDrawing = true;
  self.drawPointerId = evt.pointerId;
  overlay.setPointerCapture(evt.pointerId);
  self.drawPath = [p];
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

// Starts crop rectangle interaction in crop mode.
export function tryStartCropSelection(args) {
  const { self, evt, p, overlay, drawOverlayPath } = args;
  if (!self || !overlay) return false;
  if (self.toolMode !== 'crop') return false;

  self.isCropping = true;
  self.cropPointerId = evt.pointerId;
  self.cropStartPos = p;
  self.cropPendingPos = p;
  self.cropRectPx = { x: p[0], y: p[1], w: 0, h: 0 };
  overlay.setPointerCapture(evt.pointerId);
  overlay.style.cursor = 'crosshair';
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

function startShapeResize(self, evt, p, overlay, layerIndex, baseClipN, handleBounds) {
  self.isResizingShape = true;
  self.shapeResizePointerId = evt.pointerId;
  self.shapeResizeLayerIndex = layerIndex;

  const selectedIndices = typeof self.getSelectedLayerIndices === 'function' ? self.getSelectedLayerIndices() : [];
  const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
  self.shapeResizeTargetIndices = selectedIndices
    .filter((i) => Number.isFinite(i) && i >= 0 && i < layers.length)
    .filter((i) => {
      const layer = layers[i];
      return layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
    });
  if (!Array.isArray(self.shapeResizeTargetIndices) || self.shapeResizeTargetIndices.length === 0) {
    self.shapeResizeTargetIndices = [layerIndex];
  }

  self.shapeResizeStartClipByIndex = new Map();
  for (const i of self.shapeResizeTargetIndices) {
    const layer = layers[i];
    if (!layer || !Array.isArray(layer.clipPathN) || layer.clipPathN.length < 3) continue;
    self.shapeResizeStartClipByIndex.set(i, layer.clipPathN.map((q) => [q[0], q[1]]));
  }

  self.shapeResizeStartPos = p;
  self.shapeResizeStartClipPathN = Array.isArray(baseClipN) ? baseClipN.map((q) => [q[0], q[1]]) : null;
  self.shapeResizeStartBounds = handleBounds;
  self.shapeResizeStartDist = handleBounds ? Math.max(0.000001, Math.hypot(p[0] - handleBounds.cx, p[1] - handleBounds.cy)) : 0.000001;

  overlay.setPointerCapture(evt.pointerId);
  overlay.style.cursor = 'nwse-resize';
  evt.preventDefault();
}

function startShapeDrag(self, evt, p, overlay, layerIndex, baseClipN) {
  self.isDraggingShape = true;
  self.dragPointerId = evt.pointerId;
  self.dragLayerIndex = layerIndex;
  self.dragStartPos = p;
  self.dragStartClipPathN = Array.isArray(baseClipN) ? baseClipN.map((q) => [q[0], q[1]]) : null;

  const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
  const selected = self.getSelectedLayerIndices();
  self.dragTargetIndices = selected.filter((i) => {
    const layer = layers[i];
    return layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
  });
  if (!Array.isArray(self.dragTargetIndices) || self.dragTargetIndices.length === 0) self.dragTargetIndices = [layerIndex];

  self.dragStartClipByIndex = new Map();
  for (const i of self.dragTargetIndices) {
    const layer = layers[i];
    if (!layer || !Array.isArray(layer.clipPathN) || layer.clipPathN.length < 3) continue;
    self.dragStartClipByIndex.set(i, layer.clipPathN.map((q) => [q[0], q[1]]));
  }

  self.dragPendingPos = p;
  overlay.setPointerCapture(evt.pointerId);
  overlay.style.cursor = 'grabbing';
  evt.preventDefault();
}

// Starts clip-layer select/drag/resize flow when clicking an existing shape.
export function tryStartClipLayerInteraction(args) {
  const {
    self,
    evt,
    p,
    interactionMode,
    overlay,
    hitTestTopmostClipLayer,
    getSelectedClipBoundsPx,
    getClipBoundsPxForClipN,
    getClipHandleAtPoint,
    getClipPolyPxForLayerIndex,
    pointInPolygon,
    drawOverlayPath,
  } = args;

  if (!self || !overlay) return false;
  if (interactionMode !== 'select' || self.toolMode === 'crop') return false;

  const clipIdx = hitTestTopmostClipLayer(p[0], p[1]);
  if (clipIdx < 0) return false;

  if (evt.shiftKey) {
    self.toggleLayerSelection(clipIdx);
    self.renderLayersList();
    drawOverlayPath();
    evt.preventDefault();
    return true;
  }

  if (evt.pointerType === 'pen') {
    const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
    const layer = layers[clipIdx];
    const groupId = layer && typeof layer.groupId === 'string' && layer.groupId.trim() ? layer.groupId.trim() : '';
    const selected = self.selectedLayerIndices instanceof Set ? self.selectedLayerIndices : new Set();
    const isAlreadySelected = selected.has(clipIdx);

    if (!isAlreadySelected) {
      const next = new Set(selected);
      if (groupId) {
        for (let i = 0; i < layers.length; i++) {
          const l = layers[i];
          if (l && typeof l.groupId === 'string' && l.groupId === groupId) next.add(i);
        }
      } else {
        next.add(clipIdx);
      }
      self.selectedLayerIndices = next;
    }

    self.setActiveLayerIndex(clipIdx);
    self.syncActiveShapeToLayerIndex(clipIdx);
  } else {
    self.setLayerSelectionSingle(clipIdx);
  }
  self.renderLayersList();
  drawOverlayPath();

  const layers = self.canvasLayers && Array.isArray(self.canvasLayers.layers) ? self.canvasLayers.layers : [];
  const clickedLayer = layers[clipIdx];
  const clickedClipN = clickedLayer && Array.isArray(clickedLayer.clipPathN) && clickedLayer.clipPathN.length >= 3 ? clickedLayer.clipPathN : null;

  const handleBounds = getSelectedClipBoundsPx() || getClipBoundsPxForClipN(self.activeClipPathN);
  const handle = getClipHandleAtPoint(handleBounds, p[0], p[1]);
  if (handle) {
    const baseClip = clickedClipN || (Array.isArray(self.activeClipPathN) ? self.activeClipPathN : null);
    startShapeResize(self, evt, p, overlay, clipIdx, baseClip, handleBounds);
    return true;
  }

  const polyPx = getClipPolyPxForLayerIndex(clipIdx);
  if (polyPx && pointInPolygon(p[0], p[1], polyPx)) {
    const baseClip = clickedClipN || (Array.isArray(self.activeClipPathN) ? self.activeClipPathN : null);
    startShapeDrag(self, evt, p, overlay, clipIdx, baseClip);
    return true;
  }

  return true;
}

// Starts drag/resize for the currently active selection shape.
export function tryStartActiveSelectionInteraction(args) {
  const {
    self,
    evt,
    p,
    interactionMode,
    overlay,
    getOverlaySize,
    getSelectedClipBoundsPx,
    getClipBoundsPxForClipN,
    getClipHandleAtPoint,
    pointInPolygon,
  } = args;

  if (!self || !overlay) return false;
  if (interactionMode !== 'select') return false;
  if (!Array.isArray(self.activeClipPathN) || self.activeClipPathN.length < 3) return false;

  const handleBounds = getSelectedClipBoundsPx() || getClipBoundsPxForClipN(self.activeClipPathN);
  const handle = getClipHandleAtPoint(handleBounds, p[0], p[1]);
  if (handle) {
    const activeIdx = Number.isFinite(self.activeLayerIndex) ? self.activeLayerIndex : -1;
    startShapeResize(self, evt, p, overlay, activeIdx, self.activeClipPathN, handleBounds);
    return true;
  }

  const { w, h } = getOverlaySize();
  const polyPx = self.activeClipPathN.map((q) => [q[0] * w, q[1] * h]);
  if (pointInPolygon(p[0], p[1], polyPx)) {
    const activeIdx = Number.isFinite(self.activeLayerIndex) ? self.activeLayerIndex : -1;
    startShapeDrag(self, evt, p, overlay, activeIdx, self.activeClipPathN);
    return true;
  }

  return false;
}
