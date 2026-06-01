export function pointInPolygon(x, y, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0000001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.000001) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  return Math.hypot(px - cx, py - cy);
}

export function normalizeRectPx(a, b) {
  if (!Array.isArray(a) || a.length < 2) return null;
  if (!Array.isArray(b) || b.length < 2) return null;
  const x0 = Number(a[0]);
  const y0 = Number(a[1]);
  const x1 = Number(b[0]);
  const y1 = Number(b[1]);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

export function rectContainsRect(outer, inner) {
  if (!outer || !inner) return false;
  const eps = 0.5;
  return inner.x >= outer.x - eps
    && inner.y >= outer.y - eps
    && inner.x + inner.w <= outer.x + outer.w + eps
    && inner.y + inner.h <= outer.y + outer.h + eps;
}

export function expandGroupSelection(indices, layers) {
  const list = Array.isArray(layers) ? layers : [];
  const out = new Set(Array.isArray(indices) ? indices : []);

  for (const idx of Array.from(out)) {
    const layer = list[idx];
    const groupId = layer && typeof layer.groupId === 'string' && layer.groupId.trim() ? layer.groupId.trim() : '';
    if (!groupId) continue;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l && typeof l.groupId === 'string' && l.groupId === groupId) out.add(i);
    }
  }
  return out;
}

export function collectContainedLayerIndicesInRect(selRect, layers, getImageRectPxForLayerIndex, getFreehandBoundsPxForLayerIndex, getClipBoundsPxForLayerIndex) {
  if (!selRect || selRect.w <= 0 || selRect.h <= 0) return [];
  const list = Array.isArray(layers) ? layers : [];
  const hit = [];

  for (let i = 0; i < list.length; i++) {
    const layer = list[i];
    if (!layer || layer.isBackground === true) continue;

    const imageRect = typeof getImageRectPxForLayerIndex === 'function' ? getImageRectPxForLayerIndex(i) : null;
    if (imageRect) {
      const imgRect = { x: imageRect.x, y: imageRect.y, w: imageRect.w, h: imageRect.h };
      if (rectContainsRect(selRect, imgRect)) hit.push(i);
      continue;
    }

    const freehandRect = typeof getFreehandBoundsPxForLayerIndex === 'function' ? getFreehandBoundsPxForLayerIndex(i) : null;
    if (freehandRect) {
      if (rectContainsRect(selRect, freehandRect)) hit.push(i);
      continue;
    }

    const clipBounds = typeof getClipBoundsPxForLayerIndex === 'function' ? getClipBoundsPxForLayerIndex(i) : null;
    if (clipBounds) {
      const clipRect = {
        x: clipBounds.minX,
        y: clipBounds.minY,
        w: Math.max(0, clipBounds.maxX - clipBounds.minX),
        h: Math.max(0, clipBounds.maxY - clipBounds.minY),
      };
      if (rectContainsRect(selRect, clipRect)) hit.push(i);
    }
  }

  const expanded = expandGroupSelection(hit, list);
  return Array.from(expanded).sort((a, b) => a - b);
}

export function imageRectFromPaintPx(paint, w, h) {
  if (!paint) return null;
  const xN = Number.isFinite(paint.xN) ? paint.xN : 0;
  const yN = Number.isFinite(paint.yN) ? paint.yN : 0;
  const wN = Number.isFinite(paint.wN) ? paint.wN : 0.25;
  const hN = Number.isFinite(paint.hN) ? paint.hN : 0.25;
  return {
    x: xN * w,
    y: yN * h,
    w: wN * w,
    h: hN * h,
    xN,
    yN,
    wN,
    hN,
  };
}

export function freehandBoundsFromPathPx(pathN, thickness, w, h) {
  if (!Array.isArray(pathN) || pathN.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pathN) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]) * w;
    const y = Number(p[1]) * h;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

  const thicknessRaw = Number(thickness);
  const safeThickness = Number.isFinite(thicknessRaw) ? Math.max(1, Math.min(100, Math.round(thicknessRaw))) : 1;
  const pad = Math.max(2, safeThickness / 2);

  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(1, (maxX - minX) + pad * 2),
    h: Math.max(1, (maxY - minY) + pad * 2),
  };
}

export function clipBoundsFromClipNPx(clipN, w, h) {
  if (!Array.isArray(clipN) || clipN.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of clipN) {
    if (!Array.isArray(q) || q.length < 2) continue;
    const x = Number(q[0]) * w;
    const y = Number(q[1]) * h;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function combinedClipBoundsPx(clips, w, h) {
  const list = Array.isArray(clips) ? clips : [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const clipN of list) {
    if (!Array.isArray(clipN) || clipN.length < 3) continue;
    for (const q of clipN) {
      if (!Array.isArray(q) || q.length < 2) continue;
      const x = Number(q[0]) * w;
      const y = Number(q[1]) * h;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}