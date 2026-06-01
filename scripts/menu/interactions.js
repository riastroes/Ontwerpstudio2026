export function isValidPathN(pathN, minPoints) {
  return Array.isArray(pathN) && pathN.length >= Math.max(2, Number(minPoints) || 2);
}

export function translatePathN(pathN, dxN, dyN) {
  if (!Array.isArray(pathN)) return [];
  return pathN
    .map((q) => [Number(q && q[0]) + dxN, Number(q && q[1]) + dyN])
    .filter((q) => Array.isArray(q) && q.length === 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]));
}

export function clampDeltaToUnitForPaths(paths, dxN, dyN) {
  const list = Array.isArray(paths) ? paths : [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const path of list) {
    if (!Array.isArray(path)) continue;
    for (const q of path) {
      if (!Array.isArray(q) || q.length < 2) continue;
      const x = Number(q[0]);
      const y = Number(q[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return { dxN, dyN };
  }

  const minDx = -minX;
  const maxDx = 1 - maxX;
  const minDy = -minY;
  const maxDy = 1 - maxY;

  return {
    dxN: Math.max(minDx, Math.min(maxDx, dxN)),
    dyN: Math.max(minDy, Math.min(maxDy, dyN)),
  };
}

export function collectPathsFromIndexMap(startPathByIndex, indices, minPoints) {
  if (!(startPathByIndex instanceof Map)) return [];
  const idxList = Array.isArray(indices) ? indices : [];
  const out = [];
  for (const idx of idxList) {
    const pathN = startPathByIndex.get(idx);
    if (isValidPathN(pathN, minPoints)) out.push(pathN);
  }
  return out;
}

export function getBoundsForPaths(paths, minPoints) {
  const list = Array.isArray(paths) ? paths : [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const path of list) {
    if (!isValidPathN(path, minPoints)) continue;
    for (const q of path) {
      if (!Array.isArray(q) || q.length < 2) continue;
      const x = Number(q[0]);
      const y = Number(q[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    cxN: (minX + maxX) / 2,
    cyN: (minY + maxY) / 2,
    curW: Math.max(0.000001, maxX - minX),
    curH: Math.max(0.000001, maxY - minY),
  };
}

export function clampResizeFactorToUnit(paths, bounds, factor, minDim) {
  const list = Array.isArray(paths) ? paths : [];
  const b = bounds && Number.isFinite(bounds.cxN) && Number.isFinite(bounds.cyN) ? bounds : null;
  if (!b || !Number.isFinite(factor) || factor <= 0) return factor;

  let nextFactor = factor;
  const safeMinDim = Number.isFinite(minDim) ? Math.max(0.000001, minDim) : 0.03;
  const minFactor = Math.max(safeMinDim / b.curW, safeMinDim / b.curH);
  if (nextFactor < minFactor) nextFactor = minFactor;

  if (nextFactor > 1) {
    let maxFactor = Infinity;
    for (const clipN of list) {
      if (!isValidPathN(clipN, 3)) continue;
      for (const q of clipN) {
        if (!Array.isArray(q) || q.length < 2) continue;
        const dx = Number(q[0]) - b.cxN;
        const dy = Number(q[1]) - b.cyN;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
        if (dx > 0) maxFactor = Math.min(maxFactor, (1 - b.cxN) / dx);
        else if (dx < 0) maxFactor = Math.min(maxFactor, (0 - b.cxN) / dx);
        if (dy > 0) maxFactor = Math.min(maxFactor, (1 - b.cyN) / dy);
        else if (dy < 0) maxFactor = Math.min(maxFactor, (0 - b.cyN) / dy);
      }
    }
    if (Number.isFinite(maxFactor) && maxFactor > 0) nextFactor = Math.min(nextFactor, maxFactor);
  }

  return nextFactor;
}

export function computeImagePlacementFromDrag(startPlacement, dragMode, dxPx, dyPx, overlayW, overlayH) {
  if (!startPlacement) return null;
  const w = Math.max(1, Number(overlayW) || 1);
  const h = Math.max(1, Number(overlayH) || 1);

  let xN = Number.isFinite(startPlacement.xN) ? startPlacement.xN : 0;
  let yN = Number.isFinite(startPlacement.yN) ? startPlacement.yN : 0;
  let wN = Number.isFinite(startPlacement.wN) ? startPlacement.wN : 0.25;
  let hN = Number.isFinite(startPlacement.hN) ? startPlacement.hN : 0.25;

  if (dragMode === 'move') {
    xN = xN + dxPx / w;
    yN = yN + dyPx / h;
    xN = Math.max(0, Math.min(1 - wN, xN));
    yN = Math.max(0, Math.min(1 - hN, yN));
  } else if (dragMode === 'resize') {
    const minN = 0.03;
    const aspect = hN > 0.0001 ? wN / hN : 1;
    const delta = Math.abs(dxPx / w) > Math.abs(dyPx / h) ? dxPx / w : dyPx / h;
    let nextW = wN + delta;
    nextW = Math.max(minN, Math.min(1, nextW));
    let nextH = aspect > 0.0001 ? nextW / aspect : nextW;
    nextH = Math.max(minN, Math.min(1, nextH));
    if (xN + nextW > 1) nextW = Math.max(minN, 1 - xN);
    if (aspect > 0.0001) nextH = Math.max(minN, nextW / aspect);
    if (yN + nextH > 1) nextH = Math.max(minN, 1 - yN);
    wN = nextW;
    hN = nextH;
  }

  return {
    xN: Math.max(0, Math.min(1, xN)),
    yN: Math.max(0, Math.min(1, yN)),
    wN: Math.max(0, Math.min(1, wN)),
    hN: Math.max(0, Math.min(1, hN)),
  };
}

export function getShapeResizeTransform(startClips, startBounds, startDist, pointerPos, minDim) {
  const list = Array.isArray(startClips) ? startClips : [];
  const pb = startBounds && Number.isFinite(startBounds.cx) && Number.isFinite(startBounds.cy)
    ? startBounds
    : null;
  const p = Array.isArray(pointerPos) && pointerPos.length >= 2 ? pointerPos : null;
  if (!pb || !p) return null;

  const safeStartDist = Number.isFinite(startDist)
    ? Math.max(0.000001, startDist)
    : 0.000001;
  const curDist = Math.max(0.000001, Math.hypot(p[0] - pb.cx, p[1] - pb.cy));
  let factor = curDist / safeStartDist;
  if (!(Number.isFinite(factor) && factor > 0)) return null;

  const bounds = getBoundsForPaths(list, 3);
  if (!bounds) return null;
  factor = clampResizeFactorToUnit(list, bounds, factor, Number.isFinite(minDim) ? minDim : 0.03);

  return { cxN: bounds.cxN, cyN: bounds.cyN, factor };
}

export function scalePathNAroundCenter(pathN, cxN, cyN, factor) {
  if (!isValidPathN(pathN, 3)) return [];
  return pathN
    .map((q) => [
      Math.max(0, Math.min(1, cxN + (Number(q[0]) - cxN) * factor)),
      Math.max(0, Math.min(1, cyN + (Number(q[1]) - cyN) * factor)),
    ])
    .filter((q) => Array.isArray(q) && q.length === 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]));
}