// Pointer-finish helpers: clear interaction state and commit results.

// Finalizes crop interaction and applies cropped canvas content.
export function tryFinishCropping(args) {
  const { self, evt, overlay, getOverlaySize, clamp01, drawOverlayPath } = args;
  if (!self || !overlay || !self.isCropping) return false;
  if (self.cropPointerId !== evt.pointerId) return true;

  self.isCropping = false;
  self.cropPointerId = null;

  const start = self.cropStartPos;
  const end = self.cropPendingPos;
  self.cropStartPos = null;
  self.cropPendingPos = null;

  const { w, h } = getOverlaySize();

  let cropCanvas = null;
  if (Array.isArray(start) && Array.isArray(end)) {
    const x0 = Math.min(start[0], end[0]);
    const y0 = Math.min(start[1], end[1]);
    const x1 = Math.max(start[0], end[0]);
    const y1 = Math.max(start[1], end[1]);
    const rw = x1 - x0;
    const rh = y1 - y0;
    const minPx = 6;

    if (rw >= minPx && rh >= minPx) {
      self.cropRectN = {
        x: clamp01(x0 / w),
        y: clamp01(y0 / h),
        w: clamp01(rw / w),
        h: clamp01(rh / h),
      };

      cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(rw);
      cropCanvas.height = Math.round(rh);
      const ctx = cropCanvas.getContext('2d');
      if (ctx && self.canvas instanceof HTMLCanvasElement) {
        ctx.drawImage(self.canvas, x0, y0, rw, rh, 0, 0, rw, rh);
        if (typeof self.applyCropResultToLayers === 'function') {
          self.applyCropResultToLayers(cropCanvas);
        } else {
          console.error('[FOUT] applyCropResultToLayers is geen functie op', self);
        }
      }
    }
  }

  self.cropRectPx = null;
  self.toolMode = 'draw';
  overlay.style.cursor = 'crosshair';
  drawOverlayPath();
  evt.preventDefault();
  return true;
}

// Ends shape drag interaction.
export function tryFinishDraggingShape(args) {
  const { self, evt, overlay } = args;
  if (!self || !overlay || !self.isDraggingShape) return false;
  if (self.dragPointerId !== evt.pointerId) return true;

  self.isDraggingShape = false;
  self.dragPointerId = null;
  self.dragLayerIndex = -1;
  self.dragStartPos = null;
  self.dragStartClipPathN = null;
  self.dragPendingPos = null;
  self.dragTargetIndices = null;
  self.dragStartClipByIndex = null;
  if (self.dragRaf) {
    window.cancelAnimationFrame(self.dragRaf);
    self.dragRaf = 0;
  }
  overlay.style.cursor = 'crosshair';
  evt.preventDefault();
  return true;
}

// Ends shape resize interaction.
export function tryFinishResizingShape(args) {
  const { self, evt, overlay } = args;
  if (!self || !overlay || !self.isResizingShape) return false;
  if (self.shapeResizePointerId !== evt.pointerId) return true;

  self.isResizingShape = false;
  self.shapeResizePointerId = null;
  self.shapeResizeLayerIndex = -1;
  self.shapeResizeStartPos = null;
  self.shapeResizeStartClipPathN = null;
  self.shapeResizeStartBounds = null;
  self.shapeResizeStartDist = 0;
  self.shapeResizeTargetIndices = null;
  self.shapeResizeStartClipByIndex = null;
  overlay.style.cursor = 'crosshair';
  evt.preventDefault();
  return true;
}

// Ends image drag/resize interaction.
export function tryFinishDraggingImage(args) {
  const { self, evt, overlay } = args;
  if (!self || !overlay || !self.isDraggingImage) return false;
  if (self.imagePointerId !== evt.pointerId) return true;

  self.isDraggingImage = false;
  self.imagePointerId = null;
  self.imageLayerIndex = -1;
  self.imageDragMode = '';
  self.imageStartPos = null;
  self.imageStartPlacement = null;
  overlay.style.cursor = 'crosshair';
  evt.preventDefault();
  return true;
}

// Ends freehand drag interaction.
export function tryFinishDraggingFreehand(args) {
  const { self, evt, overlay } = args;
  if (!self || !overlay || !self.isDraggingFreehand) return false;
  if (self.freehandPointerId !== evt.pointerId) return true;

  self.isDraggingFreehand = false;
  self.freehandPointerId = null;
  self.freehandStartPos = null;
  self.freehandTargetIndices = null;
  self.freehandStartPathByIndex = null;
  self.freehandShapeTargetIndices = null;
  self.freehandShapeStartClipByIndex = null;
  overlay.style.cursor = 'crosshair';
  evt.preventDefault();
  return true;
}

// Finalizes marquee selection and applies new selection set.
export function tryFinishBoxSelection(args) {
  const { self, evt, overlay, collectLayerIndicesInRect, drawOverlayPath } = args;
  if (!self || !overlay || !self.isBoxSelecting) return false;
  if (self.boxSelectPointerId !== evt.pointerId) return true;

  const rect = self.boxSelectRectPx;
  const moved = !!self.boxSelectMoved;

  self.isBoxSelecting = false;
  self.boxSelectPointerId = null;
  self.boxSelectStartPos = null;
  self.boxSelectRectPx = null;
  self.boxSelectMoved = false;

  if (moved && rect && rect.w >= 3 && rect.h >= 3) {
    const hits = collectLayerIndicesInRect(rect);
    if (hits.length > 0) {
      self.selectedLayerIndices = new Set(hits);
      const active = hits[hits.length - 1];
      self.setActiveLayerIndex(active);
      self.syncActiveShapeToLayerIndex(active);
    } else {
      self.setLayerSelectionSingle(-1);
    }
  } else {
    self.setLayerSelectionSingle(-1);
  }

  self.renderLayersList();
  drawOverlayPath();
  overlay.style.cursor = 'crosshair';
  evt.preventDefault();
  return true;
}

// Finalizes drawing and commits freehand or shape path.
export function tryFinishDrawing(args) {
  const { self, evt, overlay, drawOverlayPath } = args;
  if (!self || !overlay || !self.isDrawing) return false;
  if (self.drawPointerId !== evt.pointerId) return true;

  self.isDrawing = false;
  self.drawPointerId = null;

  const path = Array.isArray(self.drawPath) ? self.drawPath.slice() : [];
  self.drawPath = [];
  if (path.length < 2) return true;

  const rect = overlay.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const pathN = path
    .map((p) => [Math.max(0, Math.min(1, p[0] / w)), Math.max(0, Math.min(1, p[1] / h))])
    .filter((p) => Array.isArray(p) && p.length === 2);

  if (self.toolMode === 'free-draw') {
    if (Array.isArray(pathN) && pathN.length >= 2 && self.canvasLayers && typeof self.canvasLayers.addFreehandLineLayer === 'function') {
      self.canvasLayers.addFreehandLineLayer(pathN, self.currentColor, self.currentThickness);
      self.renderLayersList();
    }
  } else if (Array.isArray(pathN) && pathN.length >= 3) {
    self.activeClipPathN = pathN.slice();
    self.activeClipKey = self.makeClipKey(self.activeClipPathN);
    self.activeClipPathsN = null;
    self.applyToActiveShape();
    self.renderLayersList();
  }

  drawOverlayPath();
  evt.preventDefault();
  return true;
}
