
const APP_ID = 'Ontwerpstudio2026';
const LEGACY_APP_ID = 'Ontwerpstudio2026-v1';
// Controleer of een IndexedDB database bestaat
function dbExists(name) {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    let existed = true;
    req.onupgradeneeded = () => {
      existed = false;
    };
    req.onsuccess = () => {
      req.result.close();
      if (!existed) {
        indexedDB.deleteDatabase(name);
      }
      resolve(existed);
    };
    req.onerror = () => resolve(false);
  });
}

// Normaliseer CSS kleurstring (spaties weg, lowercase)
function normalizeCssColorString(str) {
  const input = typeof str === 'string' ? str.trim() : '';
  if (!input) return '';
  if (typeof document === 'undefined' || !document.body) return input.toLowerCase();

  const tmp = document.createElement('div');
  tmp.style.color = input;
  document.body.appendChild(tmp);
  const out = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  return typeof out === 'string' && out.trim() ? out.trim().toLowerCase() : input.toLowerCase();
}

function parseCssRgbString(str) {
  const s = typeof str === 'string' ? str.trim().toLowerCase() : '';
  if (!s) return null;
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;

  const body = m[1].replace(/\//g, ' ');
  const parts = body.includes(',')
    ? body.split(',').map((p) => p.trim())
    : body.split(/\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  if (![r, g, b].every((v) => Number.isFinite(v))) return null;

  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

function tintRgb(rgb, tone) {
  const base = rgb && Number.isFinite(rgb.r) && Number.isFinite(rgb.g) && Number.isFinite(rgb.b)
    ? rgb
    : { r: 0, g: 0, b: 0 };
  const t = Number.isFinite(tone) ? Math.max(-1, Math.min(1, tone)) : 0;
  const mix = t >= 0 ? 255 : 0;
  const amount = Math.abs(t);
  const blend = (v) => Math.round(v + (mix - v) * amount);
  return {
    r: Math.max(0, Math.min(255, blend(base.r))),
    g: Math.max(0, Math.min(255, blend(base.g))),
    b: Math.max(0, Math.min(255, blend(base.b))),
  };
}

function rgbaCssFromRgb(rgb, alpha) {
  const base = rgb && Number.isFinite(rgb.r) && Number.isFinite(rgb.g) && Number.isFinite(rgb.b)
    ? rgb
    : { r: 0, g: 0, b: 0 };
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${base.r}, ${base.g}, ${base.b}, ${a})`;
}
import { qs } from './menu/ui.js';
import {
  pointInPolygon,
  normalizeRectPx,
  collectContainedLayerIndicesInRect,
  combinedClipBoundsPx,
} from './menu/selection.js';
import {
  getImagePaintForLayerIndex as getImagePaintForLayerIndexFromLayers,
  getFreehandPaintForLayerIndex as getFreehandPaintForLayerIndexFromLayers,
  getImageRectPxForLayerIndex as getImageRectPxForLayerIndexFromLayers,
  getClipPolyPxForLayerIndex as getClipPolyPxForLayerIndexFromLayers,
  getFreehandBoundsPxForLayerIndex as getFreehandBoundsPxForLayerIndexFromLayers,
  getClipBoundsPxForClipN as getClipBoundsPxForClipNFromOverlay,
  getClipHandleAtPoint,
  getImageHandleAtPoint,
  hitTestTopmostImageLayer as hitTestTopmostImageLayerFromLayers,
  hitTestTopmostClipLayer as hitTestTopmostClipLayerFromLayers,
  hitTestTopmostFreehandLayer as hitTestTopmostFreehandLayerFromLayers,
} from './menu/overlay.js';
import {
  handlePointerMoveDraggingShape,
  handlePointerMoveResizingShape,
  handlePointerMoveDraggingImage,
  handlePointerMoveDraggingFreehand,
  tryUpdateCroppingPreview,
  updatePointerHoverCursor,
  tryUpdateBoxSelectionPreview,
  tryAppendDrawPathPoint,
} from './menu/pointerMoveHandlers.js';
import {
  tryStartImageLayerDrag,
  tryStartFreehandLayerDrag,
  tryStartClipLayerInteraction,
  tryStartActiveSelectionInteraction,
  tryStartCropSelection,
  tryStartBoxSelection,
  startDrawStroke,
} from './menu/pointerDownHandlers.js';
import {
  tryFinishCropping,
  tryFinishDraggingShape,
  tryFinishResizingShape,
  tryFinishDraggingImage,
  tryFinishDraggingFreehand,
  tryFinishBoxSelection,
  tryFinishDrawing,
} from './menu/pointerFinishHandlers.js';

// ES6 module entry: alle logica is nu opgesplitst in modules.

  function hashStringToSeed(str) {
    const s = typeof str === 'string' ? str : '';
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

// --- UI Controllers ---

  function makeRng(seed) {
    let x = Number.isFinite(seed) ? (seed >>> 0) : 1;
    return () => {
      // LCG (Numerical Recipes)
      x = (Math.imul(1664525, x) + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  function generateTextureDataUrl(textureId, colorOrPalette, size) {
    const id = typeof textureId === 'string' ? textureId.trim() : '';
    const w = Math.max(32, Math.min(512, Math.round(Number.isFinite(size) ? size : 256)));
    const h = w;

    const baseCss = typeof colorOrPalette === 'string' && colorOrPalette.trim() ? colorOrPalette.trim() : '#000000';
    const rawPalette = Array.isArray(colorOrPalette)
      ? colorOrPalette.filter((c) => typeof c === 'string' && c.trim()).slice(0, 4)
      : [baseCss];

    const paletteCss = rawPalette.length ? rawPalette.slice() : [baseCss];
    while (paletteCss.length < 4) paletteCss.push(paletteCss[paletteCss.length - 1] || baseCss);

    const paletteNorm = paletteCss.map((c) => normalizeCssColorString(c));
    const paletteRgb = paletteNorm.map((c) => parseCssRgbString(c) || { r: 0, g: 0, b: 0 });

    const pickBaseRgb = (rnd) => {
      const t = rnd();
      if (t < 0.8) return paletteRgb[0];
      if (t < 0.9) return paletteRgb[1];
      if (t < 0.95) return paletteRgb[2];
      return paletteRgb[3];
    };

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const seed = hashStringToSeed(`${id}|${paletteNorm.join('|')}|${w}`);
    const rnd = makeRng(seed);

    // Base wash.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = rgbaCssFromRgb(paletteRgb[0], 0.14);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = rgbaCssFromRgb(paletteRgb[1], 0.04);
    ctx.fillRect(0, 0, w, h);

    const strokeFrom = (baseRgb, a, tone) => rgbaCssFromRgb(tintRgb(baseRgb, tone), a);

    const drawDots = (count, rMin, rMax, aMin, aMax) => {
      for (let i = 0; i < count; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const r = rMin + (rMax - rMin) * rnd();
        const a = aMin + (aMax - aMin) * rnd();
        const tone = (rnd() - 0.5) * 1.0;
        const base = pickBaseRgb(rnd);
        ctx.fillStyle = strokeFrom(base, a, tone);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawLines = (step, angleRad, lineWidth, alpha) => {
      const base = pickBaseRgb(rnd);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angleRad);
      ctx.translate(-w / 2, -h / 2);
      ctx.strokeStyle = strokeFrom(base, alpha, -0.55);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let x = -h; x <= w + h; x += step) {
        ctx.moveTo(x, -h);
        ctx.lineTo(x, h + h);
      }
      ctx.stroke();
      ctx.restore();
    };

    const drawWaves = (rows, amp, alpha, lineWidth) => {
      ctx.lineWidth = lineWidth;
      for (let r = 0; r < rows; r++) {
        const base = pickBaseRgb(rnd);
        ctx.strokeStyle = strokeFrom(base, alpha, -0.50);
        const y0 = (r + 0.5) * (h / rows);
        const phase = rnd() * Math.PI * 2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const t = (x / w) * Math.PI * 2;
          const y = y0 + Math.sin(t + phase) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    const drawFibers = (count, alpha) => {
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const base = pickBaseRgb(rnd);
        ctx.strokeStyle = strokeFrom(base, alpha, -0.55);
        const x0 = rnd() * w;
        const y0 = rnd() * h;
        const x1 = x0 + (rnd() - 0.5) * w * 0.4;
        const y1 = y0 + (rnd() - 0.5) * h * 0.4;
        const cx = (x0 + x1) / 2 + (rnd() - 0.5) * w * 0.2;
        const cy = (y0 + y1) / 2 + (rnd() - 0.5) * h * 0.2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(cx, cy, x1, y1);
        ctx.stroke();
      }
    };

    switch (id) {
      case 'grain': {
        drawDots(Math.round(w * h * 0.015), 0.3, 1.2, 0.10, 0.22);
        break;
      }
      case 'speckle': {
        drawDots(Math.round(w * h * 0.0035), 0.8, 2.8, 0.14, 0.30);
        drawDots(Math.round(w * h * 0.0010), 2.5, 5.5, 0.10, 0.22);
        break;
      }
      case 'dots': {
        const step = Math.max(10, Math.round(w / 14));
        for (let y = 0; y <= h; y += step) {
          for (let x = 0; x <= w; x += step) {
            const jx = (rnd() - 0.5) * step * 0.25;
            const jy = (rnd() - 0.5) * step * 0.25;
            const tone = (rnd() - 0.5) * 1.0;
            const base = pickBaseRgb(rnd);
            ctx.fillStyle = strokeFrom(base, 0.34, tone);
            ctx.beginPath();
            ctx.arc(x + jx, y + jy, Math.max(1, step * 0.10), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'lines': {
        drawLines(Math.max(12, Math.round(w / 12)), 0, 2, 0.18);
        drawLines(Math.max(12, Math.round(w / 12)), Math.PI / 2, 1, 0.14);
        break;
      }
      case 'crosshatch': {
        drawLines(Math.max(12, Math.round(w / 12)), Math.PI / 4, 1, 0.16);
        drawLines(Math.max(12, Math.round(w / 12)), -Math.PI / 4, 1, 0.16);
        break;
      }
      case 'waves': {
        drawWaves(10, Math.max(4, Math.round(w * 0.02)), 0.18, 2);
        break;
      }
      case 'checker': {
        const cell = Math.max(10, Math.round(w / 8));
        for (let y = 0; y < h; y += cell) {
          for (let x = 0; x < w; x += cell) {
            const on = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2;
            const base = on ? paletteRgb[1] : paletteRgb[0];
            const tone = on ? -0.60 : 0.35;
            const a = on ? 0.30 : 0.22;
            ctx.fillStyle = strokeFrom(base, a, tone);
            ctx.fillRect(x, y, cell, cell);
          }
        }
        break;
      }
      case 'fibers': {
        drawFibers(Math.round(w * 0.45), 0.18);
        drawDots(Math.round(w * h * 0.0012), 0.5, 1.6, 0.10, 0.18);
        break;
      }
      case 'cloud': {
        // Soft blotches.
        for (let i = 0; i < 120; i++) {
          const x = rnd() * w;
          const y = rnd() * h;
          const r = (0.04 + 0.10 * rnd()) * w;
          const a = 0.03 + 0.08 * rnd();
          const tone = (rnd() - 0.5) * 1.0;
          const base = pickBaseRgb(rnd);
          ctx.fillStyle = strokeFrom(base, a + 0.04, tone);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'scratches': {
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        for (let i = 0; i < 180; i++) {
          const base = pickBaseRgb(rnd);
          ctx.strokeStyle = strokeFrom(base, 0.28, -0.70);
          const x0 = rnd() * w;
          const y0 = rnd() * h;
          const len = (0.05 + 0.20 * rnd()) * w;
          const ang = rnd() * Math.PI * 2;
          const x1 = x0 + Math.cos(ang) * len;
          const y1 = y0 + Math.sin(ang) * len;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        break;
      }
      default: {
        // Fallback: light grain.
        drawDots(Math.round(w * h * 0.010), 0.4, 1.5, 0.10, 0.22);
        break;
      }
    }

    try {
      return canvas.toDataURL('image/png');
    } catch (_) {
      return '';
    }
  }

// --- UI Controllers ---

class MenuController {
    constructor(options) {
      this.toggle = qs('menuToggle');
      this.nav = qs('topnav');
      this.onRightViewSelect = options && typeof options.onRightViewSelect === 'function' ? options.onRightViewSelect : null;
      this.qs = qs;
      this.bindEvents();
    }
  
    bindEvents() {
      this.toggle.addEventListener('click', () => {
        const isOpen = document.body.classList.toggle('menu-open');
        this.toggle.setAttribute('aria-expanded', String(isOpen));
      });
  
      this.nav.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.tagName !== 'A') return;
  
        const action = target.dataset ? target.dataset.appAction : '';
        if (action && this.onAction) {
          event.preventDefault();
          this.onAction(action);
        }
  
        const view = target.dataset ? target.dataset.rightView : '';
        if (view && this.onRightViewSelect) {
          event.preventDefault();
          this.onRightViewSelect(view);
        }
  
        if (window.matchMedia('(max-width: 700px)').matches) {
          document.body.classList.remove('menu-open');
          this.toggle.setAttribute('aria-expanded', 'false');
        }
      });
  }
}
// --- IndexedDB Storage ---
    
class SavedImagesDB {
    // ...existing code...
    
    constructor() {
      this.dbName = APP_ID;
      this.storeName = 'savedImages';
      this.version = 2;
      this.dbPromise = null;
    }

    open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
          reject(new Error('IndexedDB not available'));
          return;
        }

        const req = indexedDB.open(this.dbName, this.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'id' });
          }

          // Ensure future stores exist as the app evolves.
          if (!db.objectStoreNames.contains('savedShapes')) {
            db.createObjectStore('savedShapes', { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
      });
      return this.dbPromise;
    }

    put(record) {
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.put(record);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
          })
      );
    }

    getAll() {
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
          })
      );
    }

    get(id) {
      const key = typeof id === 'string' ? id : '';
      if (!key) return Promise.resolve(null);
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
          })
      );
    }

    delete(id) {
      const key = typeof id === 'string' ? id : '';
      if (!key) return Promise.resolve(false);
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
          })
      );
    }
  }

  class SavedShapesDB {
    constructor() {
      this.dbName = APP_ID;
      this.storeName = 'savedShapes';
      this.version = 2;
      this.dbPromise = null;
    }

    open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
          reject(new Error('IndexedDB not available'));
          return;
        }

        const req = indexedDB.open(this.dbName, this.version);
        req.onupgradeneeded = () => {
          const db = req.result;

          if (!db.objectStoreNames.contains('savedImages')) {
            db.createObjectStore('savedImages', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
      });
      return this.dbPromise;
    }

    put(record) {
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.put(record);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
          })
      );
    }

    getAll() {
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
          })
      );
    }

    get(id) {
      const key = typeof id === 'string' ? id : '';
      if (!key) return Promise.resolve(null);
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
          })
      );
    }

    delete(id) {
      const key = typeof id === 'string' ? id : '';
      if (!key) return Promise.resolve(false);
      return this.open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
          })
      );
    }
  }

  class PanelsController {
    constructor() {
      this.leftEdge = qs('leftEdge');
      this.rightEdge = qs('rightEdge');
      this.leftClose = qs('leftClose');
      this.rightClose = qs('rightClose');
    }

    init() {
      if (this.leftClose && this.leftClose.dataset.bound !== '1') {
        this.leftClose.dataset.bound = '1';
        this.leftClose.addEventListener('click', () => {
          document.body.classList.add('left-collapsed');
        });
      }

      if (this.rightClose && this.rightClose.dataset.bound !== '1') {
        this.rightClose.dataset.bound = '1';
        this.rightClose.addEventListener('click', () => {
          document.body.classList.add('right-collapsed');
        });
      }

      const openLeft = () => document.body.classList.remove('left-collapsed');
      const openRight = () => document.body.classList.remove('right-collapsed');

      if (this.leftEdge && this.leftEdge.dataset.bound !== '1') {
        this.leftEdge.dataset.bound = '1';
        this.leftEdge.addEventListener('mouseenter', openLeft);
        this.leftEdge.addEventListener('click', openLeft);
      }

      if (this.rightEdge && this.rightEdge.dataset.bound !== '1') {
        this.rightEdge.dataset.bound = '1';
        this.rightEdge.addEventListener('mouseenter', openRight);
        this.rightEdge.addEventListener('click', openRight);
      }
    }
  }

  class PatternCanvasLayers {
    constructor(canvas) {
      this.canvas = canvas instanceof HTMLCanvasElement ? canvas : null;
      this.layers = [];
      this.pendingDraw = 0;
      this.imageCache = new Map();
	  this.svgTextCache = new Map();
	  this.variantCache = new Map();
	  this.textureCache = new Map();
	  this.savedImageCache = new Map();
      this.drawQueue = Promise.resolve();

      this.computeQueue = Promise.resolve();
      this.visibleColorsTimers = new Map();
      this.visibleColorsTokens = new Map();
      this.visibleColorsPromises = new Map();

      this.cssRgbCache = new Map();

      this.offscreenCanvas = null;
      this.offscreenCtx = null;
    }

    cancelAllVisibleColorsSchedules() {
      for (const t of this.visibleColorsTimers.values()) {
        if (t) window.clearTimeout(t);
      }
      this.visibleColorsTimers.clear();
      this.visibleColorsTokens.clear();
      this.visibleColorsPromises.clear();
    }

    clearAllLayers() {
      // Cancel scheduled work first.
      this.cancelAllVisibleColorsSchedules();

      if (this.pendingDraw) {
        window.clearTimeout(this.pendingDraw);
        this.pendingDraw = 0;
      }

      this.layers = [];
      this.drawQueue = Promise.resolve();

      const c = this.getContext();
      if (!c) return;
      this.resizeToCSSPixels();
      const rect = c.canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      c.ctx.clearRect(0, 0, w, h);
    }

    removeLayerAt(layerIndex) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      if (idx < 0 || idx >= this.layers.length) return false;
      this.layers.splice(idx, 1);
      // Layer indices shift; cancel scheduled index-based work.
      this.cancelAllVisibleColorsSchedules();
      this.redrawAllLayers();
      return true;
    }

  isBackgroundLayer(layer) {
    if (!layer || typeof layer !== 'object') return false;
    if (layer.isBackground === true) return true;
    return false;
  }

  looksLikeBackgroundLayer(layer) {
    if (!layer || typeof layer !== 'object') return false;
    const hasClip = Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
    if (hasClip) return false;
    const paints = Array.isArray(layer.paints) ? layer.paints : [];
    if (!paints.length) return false;
    const hasImage = paints.some((p) => p && p.kind === 'image');
    return !hasImage;
  }

  ensureBackgroundIsBottom() {
    if (!Array.isArray(this.layers) || this.layers.length === 0) return -1;

    // Preferred: keep explicit background flag.
    const flaggedIdx = this.layers.findIndex((l) => l && l.isBackground === true);
    if (flaggedIdx > 0) {
      const [bg] = this.layers.splice(flaggedIdx, 1);
      this.layers.unshift(bg);
      return 0;
    }
    if (flaggedIdx === 0) return 0;

    // Legacy: if bottom-most layer looks like a background, flag it.
    const bottom = this.layers[0];
    if (this.looksLikeBackgroundLayer(bottom)) {
      bottom.isBackground = true;
      return 0;
    }
    return -1;
  }

    reorderLayersByView(fromViewIndex, toViewIndex) {
      const fromV = Number.isFinite(fromViewIndex) ? Math.trunc(fromViewIndex) : -1;
      const toVRaw = Number.isFinite(toViewIndex) ? Math.trunc(toViewIndex) : -1;
      if (fromV < 0) return false;

	  // Keep background pinned at model index 0.
	  // (If it was flagged but got out of place somehow, normalize first.)
	  this.ensureBackgroundIsBottom();

      const view = this.layers.slice().reverse();
      if (fromV >= view.length) return false;

    // Disallow dragging the background layer.
    const bgV = view.findIndex((l) => this.isBackgroundLayer(l));
    if (bgV >= 0 && fromV === bgV) return false;

      let toV = toVRaw;
      if (toV < 0) toV = 0;
      if (toV > view.length) toV = view.length;
      if (toV === fromV || toV === fromV + 1) return false;

      const [moved] = view.splice(fromV, 1);
      const insertAt = toV > fromV ? Math.max(0, toV - 1) : toV;
      view.splice(insertAt, 0, moved);

    // Ensure background stays the bottom-most in the view.
    const bgV2 = view.findIndex((l) => this.isBackgroundLayer(l));
    if (bgV2 >= 0 && bgV2 !== view.length - 1) {
      const [bg] = view.splice(bgV2, 1);
      view.push(bg);
    }

      this.layers = view.reverse();
      // Layer indices shift; cancel scheduled index-based work.
      this.cancelAllVisibleColorsSchedules();
      this.redrawAllLayers();
      return true;
    }

    getOffscreenCtx(w, h) {
      const cw = Math.max(1, Math.round(w));
      const ch = Math.max(1, Math.round(h));
      if (!(this.offscreenCanvas instanceof HTMLCanvasElement)) {
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }

      const c = this.offscreenCanvas;
      if (!c) return null;
      if (c.width !== cw) c.width = cw;
      if (c.height !== ch) c.height = ch;
      if (!this.offscreenCtx) this.offscreenCtx = c.getContext('2d', { willReadFrequently: true });
      return this.offscreenCtx;
    }

    findLayerIndexByClipKey(clipKey) {
      if (typeof clipKey !== 'string' || !clipKey) return -1;
      for (let i = this.layers.length - 1; i >= 0; i--) {
        const layer = this.layers[i];
        if (layer && layer.clipKey === clipKey) return i;
      }
      return -1;
    }

    getCssSize() {
      if (!this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      return { w, h };
    }

    hexToRgb(hex) {
      const s = typeof hex === 'string' ? hex.trim() : '';
      if (!s.startsWith('#')) return null;
      const h = s.slice(1);
      if (h.length === 3) {
        const r = parseInt(h[0] + h[0], 16);
        const g = parseInt(h[1] + h[1], 16);
        const b = parseInt(h[2] + h[2], 16);
        if (![r, g, b].every(Number.isFinite)) return null;
        return [r, g, b];
      }
      if (h.length === 6) {
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        if (![r, g, b].every(Number.isFinite)) return null;
        return [r, g, b];
      }
      return null;
    }

    cssToRgb(color) {
      const s = typeof color === 'string' ? color.trim() : '';
      if (!s) return null;

      const cached = this.cssRgbCache.get(s);
      if (Array.isArray(cached) && cached.length === 3) return cached;

      const hex = this.hexToRgb(s);
      if (hex) {
        this.cssRgbCache.set(s, hex);
        return hex;
      }

      // Normalize via browser and parse rgb().
      const tmp = document.createElement('div');
      tmp.style.color = s;
      document.body.appendChild(tmp);
      const out = getComputedStyle(tmp).color;
      document.body.removeChild(tmp);
      const m = out.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!m) return null;
      const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (rgb.every(Number.isFinite)) this.cssRgbCache.set(s, rgb);
      return rgb;
    }

    scheduleVisibleColorsCompute(layerIndex) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      if (idx < 0) return Promise.resolve();

      const expectedLayer = this.layers[idx];

      const prevTimer = this.visibleColorsTimers.get(idx);
      if (prevTimer) window.clearTimeout(prevTimer);

      const nextToken = (this.visibleColorsTokens.get(idx) || 0) + 1;
      this.visibleColorsTokens.set(idx, nextToken);

      let resolveDone = null;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });
      this.visibleColorsPromises.set(idx, done);

      const run = () => {
        const token = this.visibleColorsTokens.get(idx);
        if (token !== nextToken) {
          if (resolveDone) resolveDone();
          return;
        }

        this.computeQueue = this.computeQueue
          .then(() => {
            const t = this.visibleColorsTokens.get(idx);
            if (t !== nextToken) return;
            if (this.layers[idx] !== expectedLayer) return;
            return this.computeVisibleColorsForLayerIndex(idx, expectedLayer);
          })
          .catch(() => {})
          .then(() => {
            if (resolveDone) resolveDone();
          });
      };

      const timer = window.setTimeout(() => {
        this.visibleColorsTimers.delete(idx);
        // Give drawing/UI a chance; compute in idle time when possible.
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => run(), { timeout: 300 });
        } else {
          run();
        }
      }, 120);

      this.visibleColorsTimers.set(idx, timer);
      return done;
    }

    getLatestVisibleColorsPromise(layerIndex) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      if (idx < 0) return Promise.resolve();
      return this.visibleColorsPromises.get(idx) || Promise.resolve();
    }

    getClipBounds(clipPathN, w, h) {
      if (!Array.isArray(clipPathN) || clipPathN.length < 2) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of clipPathN) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = p[0] * w;
        const y = p[1] * h;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
      const x = Math.max(0, Math.floor(minX));
      const y = Math.max(0, Math.floor(minY));
      const r = Math.min(w, Math.ceil(maxX));
      const b = Math.min(h, Math.ceil(maxY));
      const bw = Math.max(0, r - x);
      const bh = Math.max(0, b - y);
      return { x, y, w: bw, h: bh };
    }

    addOptimisticVisibleColor(layer, color) {
      if (!layer) return;
      const c = typeof color === 'string' && color.trim() ? color.trim() : '';
      if (!c) return;
      if (!Array.isArray(layer.visibleColors)) layer.visibleColors = [];
      if (layer.visibleColors.includes(c)) return;
      layer.visibleColors.push(c);
    }

    drawPaintToCtx(ctx, w, h, img, repeatCount, clipPathN, tileScaleMode) {
      if (!ctx) return;
      const pattern = ctx.createPattern(img, 'repeat');
      if (!pattern) return;

      const iw = Math.max(1, img.naturalWidth || img.width || 1);
      const ih = Math.max(1, img.naturalHeight || img.height || 1);

      const count = Number.isFinite(repeatCount) ? repeatCount : 10;
      const clamped = Math.max(1, Math.min(100, Math.round(count)));

      let refW = w;
      let refH = h;
      if (clipPathN && tileScaleMode === 'shape') {
        const bw = this.getClipBoundsWidth(clipPathN, w);
        const bh = this.getClipBoundsHeight(clipPathN, h);
        if (Number.isFinite(bw) && bw > 0.5) refW = bw;
        if (Number.isFinite(bh) && bh > 0.5) refH = bh;
      }

      // Beperk tile rendering tot max 4096x4096 px (iOS limiet)
      refW = Math.min(refW, 4096);
      refH = Math.min(refH, 4096);

      const ref = Math.max(0.5, Math.min(refW, refH));
      const tileSize = ref / clamped;
      const sx = Math.max(0.0001, tileSize / iw);
      const sy = Math.max(0.0001, tileSize / ih);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';

      if (clipPathN) {
        const ok = this.buildClipPath(ctx, clipPathN, w, h);
        if (ok) ctx.clip();
      }

      const prevSmoothing = ctx.imageSmoothingEnabled;
      const prevQuality = ctx.imageSmoothingQuality;
      ctx.imageSmoothingEnabled = true;
      if (typeof prevQuality === 'string') ctx.imageSmoothingQuality = 'high';

      ctx.scale(sx, sy);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w / sx, h / sy);

      ctx.imageSmoothingEnabled = prevSmoothing;
      if (typeof prevQuality === 'string') ctx.imageSmoothingQuality = prevQuality;

      ctx.restore();
    }

    drawSolidToCtx(ctx, w, h, color, clipPathN) {
      if (!ctx) return;
      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';

      if (clipPathN) {
        const ok = this.buildClipPath(ctx, clipPathN, w, h);
        if (ok) ctx.clip();
      }

      ctx.fillStyle = c;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    computeVisibleColorsForLayerIndex(layerIndex, expectedLayer) {
      const size = this.getCssSize();
      if (!size) return Promise.resolve([]);

      const layer = this.layers && this.layers[layerIndex];
      if (!layer) return Promise.resolve([]);
      if (expectedLayer && layer !== expectedLayer) return Promise.resolve(Array.isArray(layer.visibleColors) ? layer.visibleColors : []);
      const clipPathN = layer.clipPathN;
      if (!Array.isArray(clipPathN) || clipPathN.length < 3) {
        // Non-clipped layer: just report its last paint color.
        const paints = Array.isArray(layer.paints) ? layer.paints : [];
        const last = paints[paints.length - 1];
        const c = last && typeof last.color === 'string' && last.color.trim() ? last.color.trim() : '';
        layer.visibleColors = c ? [c] : [];
        return Promise.resolve(layer.visibleColors);
      }

      const paints = Array.isArray(layer.paints) ? layer.paints.slice() : [];
      const candidates = [];
      const candidateRgb = [];
      const seen = new Set();
      for (const p of paints) {
        const c = p && typeof p.color === 'string' && p.color.trim() ? p.color.trim() : '';
        if (!c || seen.has(c)) continue;
        const rgb = this.cssToRgb(c);
        if (!rgb) continue;
        seen.add(c);
        candidates.push(c);
        candidateRgb.push(rgb);
      }
      if (candidates.length === 0) {
        layer.visibleColors = [];
        return Promise.resolve([]);
      }

      const ctx = this.getOffscreenCtx(size.w, size.h);
      if (!ctx) {
        layer.visibleColors = candidates.slice();
        return Promise.resolve(layer.visibleColors);
      }
      ctx.clearRect(0, 0, size.w, size.h);

      // Render this shape-layer only.
      let chain = Promise.resolve();
      for (const p of paints) {
        const kind = p ? p.kind : undefined;
        const color = p ? p.color : undefined;
        if (kind === 'solid' || !(p && p.file)) {
          this.drawSolidToCtx(ctx, size.w, size.h, color, clipPathN);
          continue;
        }
        const file = p.file;
        const repeatCount = p.repeatCount;
        const thickness = p.thickness;
        const tileScaleMode = p.tileScaleMode;
        chain = chain
		  .then(() => this.loadPatternVariantImage(file, color, thickness))
          .then((img) => {
            this.drawPaintToCtx(ctx, size.w, size.h, img, repeatCount, clipPathN, tileScaleMode);
          })
          .catch(() => {});
      }

      return chain.then(() => {
        const bounds = this.getClipBounds(clipPathN, size.w, size.h);
        const bx = bounds ? bounds.x : 0;
        const by = bounds ? bounds.y : 0;
        const bw = bounds ? bounds.w : size.w;
        const bh = bounds ? bounds.h : size.h;
        if (bw <= 0 || bh <= 0) {
          layer.visibleColors = [];
          return [];
        }

        const imgData = ctx.getImageData(bx, by, bw, bh);
        const data = imgData.data;
        const area = bw * bh;
        const maxSamples = 80000;
        const baseStep = Math.max(1, Math.ceil(Math.sqrt(area / maxSamples)));

        const present = new Array(candidates.length).fill(false);
        let presentCount = 0;
        const threshold = 65; // tolerate anti-aliasing/edges
        const thr2 = threshold * threshold;

        const scan = (step) => {
          for (let y = 0; y < bh; y += step) {
            for (let x = 0; x < bw; x += step) {
              const idx = (y * bw + x) * 4;
              const a = data[idx + 3];
              if (a < 4) continue;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];

              for (let i = 0; i < candidateRgb.length; i++) {
                if (present[i]) continue;
                const cr = candidateRgb[i][0];
                const cg = candidateRgb[i][1];
                const cb = candidateRgb[i][2];
                const dr = r - cr;
                const dg = g - cg;
                const db = b - cb;
                const d2 = dr * dr + dg * dg + db * db;
                if (d2 <= thr2) {
                  present[i] = true;
                  presentCount++;
                  if (presentCount >= candidates.length) return;
                }
              }
            }
            if (presentCount >= candidates.length) return;
          }
        };

        scan(baseStep);
        if (presentCount < candidates.length && baseStep > 1) {
          const step2 = Math.max(1, Math.floor(baseStep / 2));
          if (step2 !== baseStep) scan(step2);
        }

        const out = [];
        for (let i = 0; i < candidates.length; i++) if (present[i]) out.push(candidates[i]);
        layer.visibleColors = out;
        return out;
      });
    }

    buildClipPath(ctx, clipPathN, w, h) {
      if (!ctx) return false;
      if (!Array.isArray(clipPathN) || clipPathN.length < 3) return false;

      const first = clipPathN[0];
      if (!Array.isArray(first) || first.length < 2) return false;

      const x0 = first[0] * w;
      const y0 = first[1] * h;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 1; i < clipPathN.length; i++) {
        const p = clipPathN[i];
        if (!Array.isArray(p) || p.length < 2) continue;
        ctx.lineTo(p[0] * w, p[1] * h);
      }
      ctx.closePath();
      return true;
    }

    getClipBoundsWidth(clipPathN, w) {
      if (!Array.isArray(clipPathN) || clipPathN.length < 2) return null;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const p of clipPathN) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = p[0] * w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
      return Math.max(0, maxX - minX);
    }

    getClipBoundsHeight(clipPathN, h) {
      if (!Array.isArray(clipPathN) || clipPathN.length < 2) return null;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of clipPathN) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const y = p[1] * h;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
      return Math.max(0, maxY - minY);
    }

    getContext() {
      if (!this.canvas) return null;
      const ctx = this.canvas.getContext('2d');
      if (!ctx) return null;
      return { canvas: this.canvas, ctx };
    }

    resizeToCSSPixels() {
      const c = this.getContext();
      if (!c) return;

      const rect = c.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const nextW = Math.max(1, Math.round(rect.width * dpr));
      const nextH = Math.max(1, Math.round(rect.height * dpr));
      if (c.canvas.width !== nextW) c.canvas.width = nextW;
      if (c.canvas.height !== nextH) c.canvas.height = nextH;

      // Draw in CSS pixel space.
      c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    loadPatternImage(file) {
      const cached = this.imageCache.get(file);
      if (cached && cached.img && cached.img.complete) return Promise.resolve(cached.img);
      if (cached && cached.promise) return cached.promise;

      const img = new Image();
      const promise = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load pattern image: ${file}`));
      });

      this.imageCache.set(file, { img, promise });
      img.src = `./patronen/${file}`;
      return promise;
    }

  loadSvgText(file) {
    const cached = this.svgTextCache.get(file);
    if (typeof cached === 'string') return Promise.resolve(cached);
    if (cached && cached.promise) return cached.promise;

    const url = `./patronen/${file}`;
    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch SVG: ${file}`);
        return res.text();
      })
      .then((text) => {
        this.svgTextCache.set(file, text);
        return text;
      });

    this.svgTextCache.set(file, { promise });
    return promise;
  }

  buildSvgVariant(svgText, color, thickness) {
    const safeColor = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
    const t = Number.isFinite(thickness) ? Math.round(thickness) : 1;
    const clamped = Math.max(1, Math.min(100, t));

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg) svg.setAttribute('overflow', 'visible');

    if (svg) {
      if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      // iOS can be picky with SVG sizing; ensure we have explicit dimensions.
      const hasW = !!svg.getAttribute('width');
      const hasH = !!svg.getAttribute('height');
      if (!hasW || !hasH) {
        let vbW = 100;
        let vbH = 100;
        const vb = (svg.getAttribute('viewBox') || '').trim();
        const parts = vb.split(/\s+/).map((n) => Number(n)).filter((n) => Number.isFinite(n));
        if (parts.length === 4) {
          vbW = Math.max(1, parts[2]);
          vbH = Math.max(1, parts[3]);
        }
        if (!hasW) svg.setAttribute('width', String(vbW));
        if (!hasH) svg.setAttribute('height', String(vbH));
      }
    }

    const stroked = Array.from(doc.querySelectorAll('[stroke]'));
    if (stroked.length === 0 && svg) {
      svg.setAttribute('stroke', safeColor);
    } else {
      for (const el of stroked) {
        el.setAttribute('stroke', safeColor);
      }
    }

    const widths = Array.from(doc.querySelectorAll('[stroke-width]'));
    if (widths.length === 0 && svg) {
      svg.setAttribute('stroke-width', String(clamped));
    } else {
      for (const el of widths) {
        el.setAttribute('stroke-width', String(clamped));
      }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  }

  loadPatternVariantImage(file, color, thickness) {
    const safeColor = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
    const t = Number.isFinite(thickness) ? Math.round(thickness) : 1;
    const clamped = Math.max(1, Math.min(100, t));
    const key = `${file}|${safeColor}|${clamped}`;

    const cached = this.variantCache.get(key);
    if (cached && cached.source) return Promise.resolve(cached.source);
    if (cached && cached.promise) return cached.promise;

    const img = new Image();
    const promise = this.loadSvgText(file)
      .then((svgText) => this.buildSvgVariant(svgText, safeColor, clamped))
      .then((variantText) =>
        new Promise((resolve, reject) => {
          img.onerror = () => reject(new Error(`Failed to load variant SVG image: ${file}`));
          const blob = new Blob([variantText], { type: 'image/svg+xml' });
          const blobUrl = URL.createObjectURL(blob);
          img.onload = () => {
            try {
              // Rasterize SVG into a bitmap canvas. This improves export reliability on iOS
              // where canvases that involve SVG patterns can fail to export.
              const iw = Math.max(1, img.naturalWidth || img.width || 1);
              const ih = Math.max(1, img.naturalHeight || img.height || 1);
              const targetMax = 512;
              const scale = Math.max(1, Math.floor(targetMax / Math.max(iw, ih)));
              const cw = Math.max(1, Math.min(targetMax, iw * scale));
              const ch = Math.max(1, Math.min(targetMax, ih * scale));

              const c = document.createElement('canvas');
              c.width = cw;
              c.height = ch;
              const cctx = c.getContext('2d');
              if (!cctx) throw new Error('No 2D context for pattern rasterization');
              cctx.clearRect(0, 0, cw, ch);
              cctx.drawImage(img, 0, 0, cw, ch);

              URL.revokeObjectURL(blobUrl);
              resolve(c);
            } catch (e) {
              // Als rasteren faalt, géén SVG-image gebruiken (iOS taint!).
              try { URL.revokeObjectURL(blobUrl); } catch (_) {}
              // Log welke pattern faalt
              if (window && window.console && typeof window.console.error === 'function') {
                console.error('Pattern rasterization failed:', file, e);
              }
              // Maak een fallback-canvas met effen kleur en tekst.
              const fallback = document.createElement('canvas');
              fallback.width = 64;
              fallback.height = 64;
              const ctx = fallback.getContext('2d');
              ctx.fillStyle = safeColor || '#ccc';
              ctx.fillRect(0, 0, 64, 64);
              ctx.fillStyle = '#900';
              ctx.font = 'bold 10px sans-serif';
              ctx.fillText('PATTERN', 2, 32);
              resolve(fallback);
            }
          };
          img.src = blobUrl;
        })
      );

    this.variantCache.set(key, { source: null, promise });
    promise
      .then((source) => {
        const entry = this.variantCache.get(key) || {};
        this.variantCache.set(key, { ...entry, source });
      })
      .catch(() => {});
    return promise;
  }

  loadGeneratedTextureImage(textureId, color, paletteCss) {
    const id = typeof textureId === 'string' ? textureId.trim() : '';
    const safeColor = typeof color === 'string' && color.trim() ? color.trim() : '#000000';

    const palette = Array.isArray(paletteCss) && paletteCss.length
      ? paletteCss.filter((c) => typeof c === 'string' && c.trim()).slice(0, 4)
      : [safeColor, safeColor, safeColor, safeColor];
    while (palette.length < 4) palette.push(palette[palette.length - 1] || safeColor);
    const paletteKey = palette.map((c) => normalizeCssColorString(c)).join('|');
    const key = `${id}|${paletteKey}`;

    const cached = this.textureCache.get(key);
    if (cached && cached.img && cached.img.complete) return Promise.resolve(cached.img);
    if (cached && cached.promise) return cached.promise;

    const img = new Image();
    const promise = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load generated texture: ${id}`));
    });

    this.textureCache.set(key, { img, promise });
    const dataUrl = generateTextureDataUrl(id, palette, 256);
    img.src = dataUrl || '';
    return promise;
  }

  drawLayer(img, repeatCount, clipPathN, tileScaleMode) {
      const c = this.getContext();
      if (!c) return;

      const rect = c.canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);

      const pattern = c.ctx.createPattern(img, 'repeat');
      if (!pattern) return;

      const iw = Math.max(1, img.naturalWidth || img.width || 1);
      const ih = Math.max(1, img.naturalHeight || img.height || 1);

      const count = Number.isFinite(repeatCount) ? repeatCount : 10;
      const clamped = Math.max(1, Math.min(100, Math.round(count)));

      let refW = w;
      let refH = h;
      if (clipPathN && tileScaleMode === 'shape') {
        const bw = this.getClipBoundsWidth(clipPathN, w);
        const bh = this.getClipBoundsHeight(clipPathN, h);
        if (Number.isFinite(bw) && bw > 0.5) refW = bw;
        if (Number.isFinite(bh) && bh > 0.5) refH = bh;
      }

      const ref = Math.max(0.5, Math.min(refW, refH));
      const tileSize = ref / clamped;
  		const sx = Math.max(0.0001, tileSize / iw);
  		const sy = Math.max(0.0001, tileSize / ih);

      c.ctx.save();
      c.ctx.globalCompositeOperation = 'source-over';

      if (clipPathN) {
        const ok = this.buildClipPath(c.ctx, clipPathN, w, h);
        if (ok) c.ctx.clip();
      }

      // Anti-aliasing for smoother diagonal lines when the pattern is scaled.
      const prevSmoothing = c.ctx.imageSmoothingEnabled;
      const prevQuality = c.ctx.imageSmoothingQuality;
      c.ctx.imageSmoothingEnabled = true;
      if (typeof prevQuality === 'string') c.ctx.imageSmoothingQuality = 'high';

      // Scale the pattern so it repeats N times across the canvas.
      // We scale the drawing context (not the bitmap) to avoid clearing.
      c.ctx.scale(sx, sy);
      c.ctx.fillStyle = pattern;
      c.ctx.fillRect(0, 0, w / sx, h / sy);

      c.ctx.imageSmoothingEnabled = prevSmoothing;
      if (typeof prevQuality === 'string') c.ctx.imageSmoothingQuality = prevQuality;

      c.ctx.restore();
    }

    loadSavedImageFromBlob(id, blob) {
      const key = typeof id === 'string' && id ? id : `blob:${Math.random().toString(16).slice(2)}`;
      if (!(blob instanceof Blob)) return Promise.reject(new Error('Invalid image blob'));

      const cached = this.savedImageCache.get(key);
      if (cached && cached.img && cached.img.complete && cached.img.naturalWidth > 0 && cached.img.naturalHeight > 0) {
		return Promise.resolve(cached.img);
	  }
      if (cached && cached.promise) return cached.promise;

      const img = new Image();
      const promise = new Promise((resolve, reject) => {
        const blobUrl = URL.createObjectURL(blob);
        img.onload = () => {
          // iOS Safari can show blank results if revoked too early; revoke async.
          window.setTimeout(() => {
			try {
				URL.revokeObjectURL(blobUrl);
			} catch (_) {}
		  }, 0);
          resolve(img);
        };
        img.onerror = () => {
          window.setTimeout(() => {
			try {
				URL.revokeObjectURL(blobUrl);
			} catch (_) {}
		  }, 0);
		  try {
			this.savedImageCache.delete(key);
		  } catch (_) {}
          reject(new Error('Failed to load saved image'));
        };
        img.src = blobUrl;
      });

      this.savedImageCache.set(key, { img, promise });
      return promise;
    }

    drawPlacedImageToCtx(ctx, w, h, img, placement) {
      if (!ctx || !img || !placement) return;
      const xN = Number.isFinite(placement.xN) ? placement.xN : 0;
      const yN = Number.isFinite(placement.yN) ? placement.yN : 0;
      const wN = Number.isFinite(placement.wN) ? placement.wN : 0.25;
      const hN = Number.isFinite(placement.hN) ? placement.hN : 0.25;

      const x = xN * w;
      const y = yN * h;
      const dw = Math.max(1, wN * w);
      const dh = Math.max(1, hN * h);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      const prevSmoothing = ctx.imageSmoothingEnabled;
      const prevQuality = ctx.imageSmoothingQuality;
      ctx.imageSmoothingEnabled = true;
      if (typeof prevQuality === 'string') ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, dw, dh);
      ctx.imageSmoothingEnabled = prevSmoothing;
      if (typeof prevQuality === 'string') ctx.imageSmoothingQuality = prevQuality;
      ctx.restore();
    }

    drawSolidLayer(color, clipPathN) {
      const c = this.getContext();
      if (!c) return;
      const rect = c.canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      this.drawSolidToCtx(c.ctx, w, h, color, clipPathN);
    }

    drawFreehandLineToCtx(ctx, w, h, pathN, color, thickness) {
      if (!ctx) return;
      if (!Array.isArray(pathN) || pathN.length < 2) return;

      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
      const t = Number.isFinite(thickness) ? Math.round(thickness) : 1;
      const lineWidth = Math.max(1, Math.min(100, t));

      const first = pathN[0];
      if (!Array.isArray(first) || first.length < 2) return;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = c;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(first[0] * w, first[1] * h);
      for (let i = 1; i < pathN.length; i++) {
        const p = pathN[i];
        if (!Array.isArray(p) || p.length < 2) continue;
        ctx.lineTo(p[0] * w, p[1] * h);
      }
      ctx.stroke();
      ctx.restore();
    }

    redrawAllLayers() {
      const c = this.getContext();
      if (!c) return;
      if (this.layers.length === 0) return;

      if (this.pendingDraw) {
        window.clearTimeout(this.pendingDraw);
        this.pendingDraw = 0;
      }

      this.resizeToCSSPixels();
      const rect = c.canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      c.ctx.clearRect(0, 0, w, h);

      this.drawQueue = Promise.resolve();
      for (const layer of this.layers) {
        const clipPathN = layer && layer.clipPathN ? layer.clipPathN : null;
        const paints = layer && Array.isArray(layer.paints) && layer.paints.length
          ? layer.paints
          : [
              {
                file: layer ? layer.file : undefined,
                repeatCount: layer ? layer.repeatCount : undefined,
                color: layer ? layer.color : undefined,
                thickness: layer ? layer.thickness : undefined,
                tileScaleMode: layer ? layer.tileScaleMode : undefined,
              },
            ];

        for (const paint of paints) {
          const kind = paint ? paint.kind : undefined;
          if (kind === 'image' && paint && paint.blob instanceof Blob) {
            const imageId = paint && typeof paint.imageId === 'string' ? paint.imageId : '';
            const blob = paint.blob;
            const placement = {
              xN: paint.xN,
              yN: paint.yN,
              wN: paint.wN,
              hN: paint.hN,
            };

            this.drawQueue = this.drawQueue
              .then(() => this.loadSavedImageFromBlob(imageId, blob))
              .then((img) => {
                this.resizeToCSSPixels();
                const c2 = this.getContext();
                if (!c2) return;
                const rect2 = c2.canvas.getBoundingClientRect();
                const w2 = Math.max(1, rect2.width);
                const h2 = Math.max(1, rect2.height);
                this.drawPlacedImageToCtx(c2.ctx, w2, h2, img, placement);
              })
              .catch(() => {});
            continue;
          }

          if (kind === 'freehand') {
            const pathN = paint && Array.isArray(paint.pathN) ? paint.pathN : null;
            const color = paint ? paint.color : undefined;
            const thickness = paint ? paint.thickness : undefined;
            this.drawQueue = this.drawQueue
              .then(() => {
                this.resizeToCSSPixels();
                const c2 = this.getContext();
                if (!c2) return;
                const rect2 = c2.canvas.getBoundingClientRect();
                const w2 = Math.max(1, rect2.width);
                const h2 = Math.max(1, rect2.height);
                this.drawFreehandLineToCtx(c2.ctx, w2, h2, pathN, color, thickness);
              })
              .catch(() => {});
            continue;
          }

          if (kind === 'texture') {
            const textureId = paint && typeof paint.textureId === 'string' ? paint.textureId : '';
			const repeatCountRaw = paint ? paint.repeatCount : undefined;
			const repeatCount = Number.isFinite(repeatCountRaw) ? Math.max(1, Math.min(10, Math.round(repeatCountRaw))) : 10;
            const color = paint ? paint.color : undefined;
            const palette = paint && Array.isArray(paint.palette) ? paint.palette : null;
            const tileScaleMode = paint ? paint.tileScaleMode : undefined;
            this.drawQueue = this.drawQueue
              .then(() => this.loadGeneratedTextureImage(textureId, color, palette))
              .then((img) => {
                this.resizeToCSSPixels();
                this.drawLayer(img, repeatCount, clipPathN, tileScaleMode);
              })
              .catch(() => {});
            continue;
          }

          if (kind === 'solid' || !(paint && paint.file)) {
            const color = paint ? paint.color : undefined;
            this.drawQueue = this.drawQueue
              .then(() => {
                this.resizeToCSSPixels();
                this.drawSolidLayer(color, clipPathN);
              })
              .catch(() => {});
            continue;
          }

          const file = paint ? paint.file : undefined;
          if (!file) continue;
          const repeatCount = paint ? paint.repeatCount : undefined;
          const color = paint ? paint.color : undefined;
          const thickness = paint ? paint.thickness : undefined;
          const tileScaleMode = paint ? paint.tileScaleMode : undefined;

          this.drawQueue = this.drawQueue
			.then(() => this.loadPatternVariantImage(file, color, thickness))
            .then((img) => {
              this.resizeToCSSPixels();
				this.drawLayer(img, repeatCount, clipPathN, tileScaleMode);
            })
            .catch(() => {});
        }
      }
    }

    addFreehandLineLayer(pathN, color, thickness) {
      const safePathN = Array.isArray(pathN)
        ? pathN
            .map((p) => {
              if (!Array.isArray(p) || p.length < 2) return null;
              const x = Number(p[0]);
              const y = Number(p[1]);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
              return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
            })
            .filter((p) => Array.isArray(p) && p.length === 2)
        : [];

      if (safePathN.length < 2) return -1;

      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
      const t = Number.isFinite(thickness) ? Math.round(thickness) : 1;
      const lineWidth = Math.max(1, Math.min(100, t));

      this.layers.push({
        clipPathN: null,
        clipKey: null,
        paints: [{ kind: 'freehand', pathN: safePathN, color: c, thickness: lineWidth }],
        visibleColors: [c],
      });

      const layerIndex = this.layers.length - 1;
      if (this.layers.length === 1) this.resizeToCSSPixels();

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;
        this.drawQueue = this.drawQueue
          .then(() => {
            this.resizeToCSSPixels();
            const c2 = this.getContext();
            if (!c2) return;
            const rect2 = c2.canvas.getBoundingClientRect();
            const w2 = Math.max(1, rect2.width);
            const h2 = Math.max(1, rect2.height);
            this.drawFreehandLineToCtx(c2.ctx, w2, h2, safePathN, c, lineWidth);
          })
          .catch(() => {});
      }, 0);

      return layerIndex;
    }

    addLayer(file, repeatCount, color, thickness) {
      this.layers.push({
        clipPathN: null,
        clipKey: null,
        paints: [{ file, repeatCount, color, thickness, tileScaleMode: 'canvas' }],
      });
      if (this.layers.length === 1) this.resizeToCSSPixels();

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;
        this.drawQueue = this.drawQueue
			.then(() => this.loadPatternVariantImage(file, color, thickness))
          .then((img) => {
            // Draw the new transparent layer over the existing canvas content.
				this.drawLayer(img, repeatCount, null, 'canvas');
          })
          .catch(() => {});
      }, 0);
    }

    addImageLayer(imageId, blob, xN, yN, wN, hN) {
      const id = typeof imageId === 'string' ? imageId : '';
      const placement = {
        xN: Number.isFinite(xN) ? xN : 0,
        yN: Number.isFinite(yN) ? yN : 0,
        wN: Number.isFinite(wN) ? wN : 0.25,
        hN: Number.isFinite(hN) ? hN : 0.25,
      };

      this.layers.push({
        clipPathN: null,
        clipKey: null,
        paints: [
          {
            kind: 'image',
            imageId: id,
            blob,
            xN: placement.xN,
            yN: placement.yN,
            wN: placement.wN,
            hN: placement.hN,
          },
        ],
      });

      const layerIndex = this.layers.length - 1;
      if (this.layers.length === 1) this.resizeToCSSPixels();

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;
        this.drawQueue = this.drawQueue
          .then(() => this.loadSavedImageFromBlob(id, blob))
          .then((img) => {
            this.resizeToCSSPixels();
            const c = this.getContext();
            if (!c) return;
            const rect = c.canvas.getBoundingClientRect();
            const w = Math.max(1, rect.width);
            const h = Math.max(1, rect.height);
            this.drawPlacedImageToCtx(c.ctx, w, h, img, placement);
          })
          .catch(() => {});
      }, 0);

      return layerIndex;
    }

    addClippedLayer(file, repeatCount, color, thickness, clipPathN, tileScaleMode, clipKey) {
      const safeClipN = Array.isArray(clipPathN) ? clipPathN.slice() : null;
      const mode = tileScaleMode === 'shape' ? 'shape' : 'canvas';
      const safeKey = typeof clipKey === 'string' && clipKey ? clipKey : null;

      let layerIndex = -1;
      if (safeKey) layerIndex = this.findLayerIndexByClipKey(safeKey);

      if (layerIndex >= 0) {
        const layer = this.layers[layerIndex];
        if (layer) {
          layer.clipPathN = safeClipN;
          layer.clipKey = safeKey;
          if (!Array.isArray(layer.paints)) layer.paints = [];
          layer.paints.push({ file, repeatCount, color, thickness, tileScaleMode: mode });

          // Make the UI reflect the latest chosen color immediately.
          this.addOptimisticVisibleColor(layer, color);
        }
      } else {
        this.layers.push({
          clipPathN: safeClipN,
          clipKey: safeKey,
          paints: [{ file, repeatCount, color, thickness, tileScaleMode: mode }],
        });
        layerIndex = this.layers.length - 1;

        const layer = this.layers[layerIndex];
        this.addOptimisticVisibleColor(layer, color);
      }

      if (this.layers.length === 1) this.resizeToCSSPixels();

      const needsFullRedraw = layerIndex >= 0 && layerIndex < this.layers.length - 1;

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;

        if (needsFullRedraw) {
          this.redrawAllLayers();
          return;
        }

        this.drawQueue = this.drawQueue
			.then(() => this.loadPatternVariantImage(file, color, thickness))
          .then((img) => {
            this.drawLayer(img, repeatCount, safeClipN, mode);
          })
          .catch(() => {});
      }, 0);

      // Recompute which colors are actually still visible for this shape-layer.
      this.scheduleVisibleColorsCompute(layerIndex);

      return layerIndex;
    }

    addClippedTextureLayer(textureId, repeatCount, color, clipPathN, tileScaleMode, clipKey, paletteCss) {
      const id = typeof textureId === 'string' ? textureId.trim() : '';
      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
	  const rc = Number.isFinite(repeatCount) ? Math.max(1, Math.min(10, Math.round(repeatCount))) : 10;
      const safeClipN = Array.isArray(clipPathN) ? clipPathN.slice() : null;
      const mode = tileScaleMode === 'shape' ? 'shape' : 'canvas';
      const safeKey = typeof clipKey === 'string' && clipKey ? clipKey : null;

      const palette = Array.isArray(paletteCss) && paletteCss.length
        ? paletteCss.filter((p) => typeof p === 'string' && p.trim()).slice(0, 4)
        : [c, c, c, c];
      while (palette.length < 4) palette.push(palette[palette.length - 1] || c);

      let layerIndex = -1;
      if (safeKey) layerIndex = this.findLayerIndexByClipKey(safeKey);

      if (layerIndex >= 0) {
        const layer = this.layers[layerIndex];
        if (layer) {
          layer.clipPathN = safeClipN;
          layer.clipKey = safeKey;
          if (!Array.isArray(layer.paints)) layer.paints = [];
		  layer.paints.push({ kind: 'texture', textureId: id, repeatCount: rc, color: c, tileScaleMode: mode, palette });
          this.addOptimisticVisibleColor(layer, c);
        }
      } else {
        this.layers.push({
          clipPathN: safeClipN,
          clipKey: safeKey,
		  paints: [{ kind: 'texture', textureId: id, repeatCount: rc, color: c, tileScaleMode: mode, palette }],
        });
        layerIndex = this.layers.length - 1;
        const layer = this.layers[layerIndex];
        this.addOptimisticVisibleColor(layer, c);
      }

      if (this.layers.length === 1) this.resizeToCSSPixels();
      const needsFullRedraw = layerIndex >= 0 && layerIndex < this.layers.length - 1;

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;

        if (needsFullRedraw) {
          this.redrawAllLayers();
          return;
        }

        this.drawQueue = this.drawQueue
          .then(() => this.loadGeneratedTextureImage(id, c, palette))
          .then((img) => {
			this.drawLayer(img, rc, safeClipN, mode);
          })
          .catch(() => {});
      }, 0);

      this.scheduleVisibleColorsCompute(layerIndex);
      return layerIndex;
    }

    addClippedSolidLayer(color, clipPathN, clipKey) {
      const safeClipN = Array.isArray(clipPathN) ? clipPathN.slice() : null;
      const safeKey = typeof clipKey === 'string' && clipKey ? clipKey : null;

      let layerIndex = -1;
      if (safeKey) layerIndex = this.findLayerIndexByClipKey(safeKey);

      if (layerIndex >= 0) {
        const layer = this.layers[layerIndex];
        if (layer) {
          layer.clipPathN = safeClipN;
          layer.clipKey = safeKey;
          if (!Array.isArray(layer.paints)) layer.paints = [];
          layer.paints.push({ kind: 'solid', file: null, color });
          this.addOptimisticVisibleColor(layer, color);
        }
      } else {
        this.layers.push({
          clipPathN: safeClipN,
          clipKey: safeKey,
          paints: [{ kind: 'solid', file: null, color }],
        });
        layerIndex = this.layers.length - 1;
        const layer = this.layers[layerIndex];
        this.addOptimisticVisibleColor(layer, color);
      }

      if (this.layers.length === 1) this.resizeToCSSPixels();

      const needsFullRedraw = layerIndex >= 0 && layerIndex < this.layers.length - 1;

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;

        if (needsFullRedraw) {
          this.redrawAllLayers();
          return;
        }

        this.drawQueue = this.drawQueue
          .then(() => {
            this.drawSolidLayer(color, safeClipN);
          })
          .catch(() => {});
      }, 0);

      this.scheduleVisibleColorsCompute(layerIndex);
      return layerIndex;
    }

    addSolidLayer(color) {
      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
      this.layers.push({
        clipPathN: null,
        clipKey: null,
        paints: [{ kind: 'solid', file: null, color: c }],
        visibleColors: [c],
      });

      const layerIndex = this.layers.length - 1;
      if (this.layers.length === 1) this.resizeToCSSPixels();

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;
        this.drawQueue = this.drawQueue
          .then(() => {
            this.drawSolidLayer(c, null);
          })
          .catch(() => {});
      }, 0);

      return layerIndex;
    }

    addSolidPaintToLayerIndex(layerIndex, color) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      const layer = this.layers && this.layers[idx];
      if (!layer) return false;

      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
      if (!Array.isArray(layer.paints)) layer.paints = [];
      layer.paints.push({ kind: 'solid', file: null, color: c });

      const clipPathN = Array.isArray(layer.clipPathN) ? layer.clipPathN : null;
      if (!clipPathN) layer.visibleColors = [c];
      else this.addOptimisticVisibleColor(layer, c);

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;

        const needsFullRedraw = idx >= 0 && idx < this.layers.length - 1;
        if (needsFullRedraw) {
          this.redrawAllLayers();
          return;
        }

        this.drawQueue = this.drawQueue
          .then(() => {
            this.drawSolidLayer(c, clipPathN);
          })
          .catch(() => {});
      }, 0);

      if (clipPathN) this.scheduleVisibleColorsCompute(idx);
      return true;
    }

    addPatternPaintToLayerIndex(layerIndex, file, repeatCount, color, thickness, tileScaleMode) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      const layer = this.layers && this.layers[idx];
      if (!layer) return false;

      const f = typeof file === 'string' ? file.trim() : '';
      if (!f) return false;

      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
      const mode = tileScaleMode === 'shape' ? 'shape' : 'canvas';

      if (!Array.isArray(layer.paints)) layer.paints = [];
      layer.paints.push({ file: f, repeatCount, color: c, thickness, tileScaleMode: mode });

      const clipPathN = Array.isArray(layer.clipPathN) ? layer.clipPathN : null;
      if (clipPathN) this.addOptimisticVisibleColor(layer, c);

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;

        const needsFullRedraw = idx >= 0 && idx < this.layers.length - 1;
        if (needsFullRedraw) {
          this.redrawAllLayers();
          return;
        }

        this.drawQueue = this.drawQueue
          .then(() => this.loadPatternVariantImage(f, c, thickness))
          .then((img) => {
            this.drawLayer(img, repeatCount, clipPathN, mode);
          })
          .catch(() => {});
      }, 0);

      if (clipPathN) this.scheduleVisibleColorsCompute(idx);
      return true;
    }

    addTexturePaintToLayerIndex(layerIndex, textureId, repeatCount, color, tileScaleMode, paletteCss) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      const layer = this.layers && this.layers[idx];
      if (!layer) return false;

      const id = typeof textureId === 'string' ? textureId.trim() : '';
      if (!id) return false;
      const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
	  const rc = Number.isFinite(repeatCount) ? Math.max(1, Math.min(10, Math.round(repeatCount))) : 10;
      const mode = tileScaleMode === 'shape' ? 'shape' : 'canvas';

      const palette = Array.isArray(paletteCss) && paletteCss.length
        ? paletteCss.filter((p) => typeof p === 'string' && p.trim()).slice(0, 4)
        : [c, c, c, c];
      while (palette.length < 4) palette.push(palette[palette.length - 1] || c);

      if (!Array.isArray(layer.paints)) layer.paints = [];
    layer.paints.push({ kind: 'texture', textureId: id, repeatCount: rc, color: c, tileScaleMode: mode, palette });

      const clipPathN = Array.isArray(layer.clipPathN) ? layer.clipPathN : null;
      if (clipPathN) this.addOptimisticVisibleColor(layer, c);
      else layer.visibleColors = [c];

      if (this.pendingDraw) window.clearTimeout(this.pendingDraw);
      this.pendingDraw = window.setTimeout(() => {
        this.pendingDraw = 0;

        const needsFullRedraw = idx >= 0 && idx < this.layers.length - 1;
        if (needsFullRedraw) {
          this.redrawAllLayers();
          return;
        }

        this.drawQueue = this.drawQueue
          .then(() => this.loadGeneratedTextureImage(id, c, palette))
          .then((img) => {
			this.drawLayer(img, rc, clipPathN, mode);
          })
          .catch(() => {});
      }, 0);

      if (clipPathN) this.scheduleVisibleColorsCompute(idx);
      return true;
    }

    hasLayers() {
      return this.layers.length > 0;
    }
  }

  class PatternPickerController {
        setDrawModeActive() {
          this.toolMode = 'free-draw';
          this.interactionMode = 'draw';
          // Deactivate all three buttons and aria-pressed
          if (this.drawToolBtn) {
            this.drawToolBtn.classList.remove('is-active');
            this.drawToolBtn.setAttribute('aria-pressed', 'false');
          }
          if (this.modeDrawBtn) {
            this.modeDrawBtn.classList.remove('is-active');
            this.modeDrawBtn.setAttribute('aria-pressed', 'false');
          }
          if (this.modeSelectBtn) {
            this.modeSelectBtn.classList.remove('is-active');
            this.modeSelectBtn.setAttribute('aria-pressed', 'false');
          }
          // Activate only the Tekenen button
          if (this.drawToolBtn) {
            this.drawToolBtn.classList.add('is-active');
            this.drawToolBtn.setAttribute('aria-pressed', 'true');
          }
          // Do NOT call setInteractionMode here, to avoid toggling Vormen/Selecteren UI
          if (typeof this.attachDrawEvents === 'function') this.attachDrawEvents();
        }
    constructor() {
      this.select = qs('patternSelect');
      this.preview = qs('patternPreview');
      this.rightViewStart = qs('rightViewStart');
	    this.rightViewAbout = qs('rightViewAbout');
	    this.aboutPublishTime = qs('aboutPublishTime');
      this.rightViewComposition = qs('rightViewComposition');
      this.compositionGrid = qs('compositionGrid');
      this.rightViewPatterns = qs('rightViewPatterns');
      this.rightViewTextures = qs('rightViewTextures');
      this.rightViewColors = qs('rightViewColors');
      this.rightViewImages = qs('rightViewImages');
      this.rightViewShapes = qs('rightViewShapes');
	    this.rightPanelTitle = qs('rightPanelTitle');
      this.savedImagesRoot = qs('savedImages');
      this.savedShapesRoot = qs('savedShapes');
      this.saveShapeBtn = qs('saveShapeBtn');
	    this.deleteShapeBtn = qs('deleteShapeBtn');
      this.canvas = qs('mainCanvas');
      this.compositionOverlay = qs('compositionOverlay');
      this.layersRoot = qs('layersRoot');
      this.cropToolBtn = qs('cropToolBtn');
      this.saveImageBtn = qs('saveImageBtn');
      this.cropToolBtnRight = qs('cropToolBtnRight');
      this.saveImageBtnRight = qs('saveImageBtnRight');
      this.exportPdfBtn = qs('exportPdfBtn');
      this.clearConceptBtn = qs('clearConceptBtn');
      this.deleteSavedImageBtn = qs('deleteSavedImageBtn');
      this.downloadSavedImageBtn = qs('downloadSavedImageBtn');
      this.favoriteSavedImageBtn = qs('favoriteSavedImageBtn');
      this.repeat = qs('patternRepeat');
      this.repeatValue = qs('patternRepeatValue');

      this.textureSelect = qs('textureSelect');
      this.texturePreview = qs('texturePreview');
      this.textureRepeat = qs('textureRepeat');
      this.textureRepeatValue = qs('textureRepeatValue');
      this.tileScaleToShapeTextures = qs('tileScaleToShapeTextures');

      this.palette = qs('palette');
      this.colorBarPrimary = qs('colorBarPrimary');
      this.colorBarComplement = qs('colorBarComplement');
      this.colorBarSupportA = qs('colorBarSupportA');
      this.colorBarSupportB = qs('colorBarSupportB');
      this.colorMixCanvas = qs('colorMixCanvas');
      this.colorMixCanvasPatterns = qs('colorMixCanvasPatterns');
      this.colorMixCanvasTextures = qs('colorMixCanvasTextures');
      this.colorMixCanvasShapes = qs('colorMixCanvasShapes');
      this.thickness = qs('patternThickness');
      this.thicknessValue = qs('patternThicknessValue');
      this.tileScaleToShape = qs('tileScaleToShape');

      this.conceptInput = qs('conceptInput');
      this.descriptionInput = qs('descriptionInput');

      this.drawToolBtn = qs('drawToolBtn');
    this.modeDrawBtn = qs('modeDrawBtn');
    this.modeSelectBtn = qs('modeSelectBtn');
    this.interactionMode = 'draw'; // 'draw' | 'select'

    this.rightView = 'start';
    this.savedImagesDB = new SavedImagesDB();
  this.savedShapesDB = new SavedShapesDB();
	this.savedImagesObjectUrls = new Map();
	  this.layerThumbObjectUrls = [];
    this.selectedSavedImageId = '';
    this.savedImagesCache = [];
	  this.selectedSavedShapeId = '';
	  this.savedShapesCache = [];
      this.selectedCompositionId = '';

      this.patterns = [
        { label: 'Geen', file: '' },
        { label: '00 Vierkant', file: '00-vierkant.svg' },
        { label: '01 Vertical (tile)', file: '01-vertical.svg' },
        { label: '02 Horizontal (tile)', file: '02-horizontal.svg' },
        { label: '03 Diagonaal 45° (tile)', file: '03-diagonal-45.svg' },
        { label: '04 Diagonaal 135° (tile)', file: '04-diagonal-135.svg' },
        { label: '05 Zig (tile)', file: '05-zig.svg' },
        { label: '05 Zag (tile)', file: '05-zag.svg' },
        { label: '06 Grid (tile)', file: '06-grid.svg' },
        { label: '07 Dashed diagonaal (tile)', file: '07-dashed-diagonal.svg' },
        { label: '08 Chevron (tile)', file: '08-chevron.svg' },
        { label: '09 Radial rays (tile)', file: '09-radial-rays.svg' },
        { label: '10 Vertical midden (1 lijn)', file: '10-vertical-midden.svg' },
        { label: '11 Horizontaal midden (1 lijn)', file: '11-horizontal-midden.svg' },
        { label: '12 Diagonaal 45° (1 lijn)', file: '12-diagonaal-45.svg' },
        { label: '13 Diagonaal 135° (1 lijn)', file: '13-diagonaal-135.svg' },
        { label: '14 Diagonaal vlak (1 lijn)', file: '14-diagonaal-vlak.svg' },
        { label: '15 Diagonaal steil (1 lijn)', file: '15-diagonaal-steil.svg' },
        { label: '16 Boog (1 lijn)', file: '16-boog.svg' },
        { label: '20 Boog op kop (1 lijn)', file: '20-boog-op-kop.svg' },
        { label: '17 Cirkel (1 lijn)', file: '17-cirkel.svg' },
        { label: '21 Stip (1 punt)', file: '21-stip.svg' },
        { label: '22 Vierkantje (1 vlak)', file: '22-vierkantje.svg' },
        { label: '18 Sinus (1 lijn)', file: '18-sinus.svg' },
        { label: '19 Spiraal (1 lijn)', file: '19-spiraal.svg' },
      ];

      this.currentFile = '';
      this.textures = [
        { label: 'Geen', id: '' },
        { label: '01 Korrel', id: 'grain' },
        { label: '02 Spikkels', id: 'speckle' },
        { label: '03 Stippen', id: 'dots' },
        { label: '04 Lijnen', id: 'lines' },
        { label: '05 Kruisarcering', id: 'crosshatch' },
        { label: '06 Golven', id: 'waves' },
        { label: '07 Blokjes', id: 'checker' },
        { label: '08 Vezels', id: 'fibers' },
        { label: '09 Wolkjes', id: 'cloud' },
        { label: '10 Krasjes', id: 'scratches' },
      ];
      this.currentTextureId = '';
    this.currentColor = '#000000';
    this.baseColor = '#000000';
    this.currentThickness = 1;
      this.currentTileScaleMode = 'canvas';
      this.currentTextureTileScaleMode = 'shape';
      this.canvasLayers = new PatternCanvasLayers(this.canvas);

      this.drawOverlay = null;
      this.drawOverlayCtx = null;
      this.renderDrawOverlay = null;
      this.isDrawing = false;
      this.drawPointerId = null;
      this.drawPath = [];
      this.activeClipPathN = null;
      this.activeClipKey = null;

      this.isDraggingShape = false;
      this.dragPointerId = null;
      this.dragLayerIndex = -1;
      this.dragStartPos = null;
      this.dragStartClipPathN = null;
      this.dragRaf = 0;
      this.dragPendingPos = null;

	  this.isDraggingImage = false;
	  this.imagePointerId = null;
	  this.imageLayerIndex = -1;
	  this.imageDragMode = ''; // 'move' | 'resize'
	  this.imageStartPos = null;
	  this.imageStartPlacement = null; // {xN,yN,wN,hN}

    this.isDraggingFreehand = false;
    this.freehandPointerId = null;
    this.freehandStartPos = null;
    this.freehandTargetIndices = null;
    this.freehandStartPathByIndex = null;
    this.freehandShapeTargetIndices = null;
    this.freehandShapeStartClipByIndex = null;

    this.isBoxSelecting = false;
    this.boxSelectPointerId = null;
    this.boxSelectStartPos = null;
    this.boxSelectRectPx = null;
    this.boxSelectMoved = false;

      this.toolMode = 'draw';
      this.isCropping = false;
      this.cropPointerId = null;
      this.cropStartPos = null;
      this.cropPendingPos = null;
      this.cropRectPx = null;
      this.cropRectN = null;

      this.activeLayerIndex = -1;

      // Multi-select (Shift+click) support for layers.
      this.selectedLayerIndices = new Set();

      this.visibleColorsRenderToken = 0;

      this.draggingLayerViewIndex = -1;
      this.dragOverItem = null;

      this.previewToken = 0;
      this.texturePreviewToken = 0;

      this.pendingGroupParamRaf = 0;
      this.pendingGroupPatternParams = null;

	  this.colorBarSteps = 16;
	  this.colorBarColors = { primary: [], complement: [], supportA: [], supportB: [] };
	  this.colorBarSelectedIndex = { primary: -1, complement: -1, supportA: -1, supportB: -1 };
    this.lastLayersPointerType = '';
    }

    init() {
      if (!(this.select instanceof HTMLSelectElement)) return;
      if (!(this.preview instanceof HTMLElement)) return;

      if (this.select.dataset.bound === '1') return;
      this.select.dataset.bound = '1';

      this.populateOptions();

      // Migrate legacy IndexedDB/localStorage from previous app name.
      this.migrateLegacyAppData().catch(() => {});

	  // Fill About panel with a dynamic "publication" timestamp.
	  this.updateAboutPublishTimestamp();

	  this.initCompositionView();

      this.initRepeatControl();
    this.initTexturesView();
    this.initTextureRepeatControl();
    this.initTextureTileScaleToggle();
	  this.initPaletteControl();
	  this.initColorMixCanvasControl();
	  this.initThicknessControl();
      this.initTileScaleToggle();
      this.initImageActions();
      this.initShapeActions();

      // Persist Concept/Omschrijving across sessions.
      this.restoreConceptDescriptionFromStorage();
      if (this.conceptInput instanceof HTMLInputElement && this.conceptInput.dataset.boundStorage !== '1') {
        this.conceptInput.dataset.boundStorage = '1';
        this.conceptInput.addEventListener('input', () => this.persistConceptDescriptionToStorage());
        this.conceptInput.addEventListener('change', () => this.persistConceptDescriptionToStorage());
      }
      if (this.descriptionInput instanceof HTMLTextAreaElement && this.descriptionInput.dataset.boundStorage !== '1') {
        this.descriptionInput.dataset.boundStorage = '1';
        this.descriptionInput.addEventListener('input', () => this.persistConceptDescriptionToStorage());
        this.descriptionInput.addEventListener('change', () => this.persistConceptDescriptionToStorage());
      }

      if (this.clearConceptBtn && this.clearConceptBtn.dataset.bound !== '1') {
        this.clearConceptBtn.dataset.bound = '1';
        this.clearConceptBtn.addEventListener('click', () => {
          this.clearConceptDescriptionStorageAndFields();

          // Clearing concept also resets the working canvas.
          this.resetToStart();
        });
      }

      if (this.exportPdfBtn && this.exportPdfBtn.dataset.bound !== '1') {
        this.exportPdfBtn.dataset.bound = '1';
        this.exportPdfBtn.addEventListener('click', () => {
          const concept = this.getConceptValue();
          const description = this.getDescriptionValue();
          this.exportSavedImagesPdf({ concept, description, createdAt: Date.now() }).catch(() => false);
        });
      }

      if (this.deleteSavedImageBtn && this.deleteSavedImageBtn.dataset.bound !== '1') {
        this.deleteSavedImageBtn.dataset.bound = '1';
        this.deleteSavedImageBtn.addEventListener('click', () => {
          this.deleteSelectedSavedImage();
        });
      }

      if (this.downloadSavedImageBtn && this.downloadSavedImageBtn.dataset.bound !== '1') {
        this.downloadSavedImageBtn.dataset.bound = '1';
        this.downloadSavedImageBtn.addEventListener('click', () => {
          this.downloadSelectedSavedImage();
        });
      }

      if (this.favoriteSavedImageBtn && this.favoriteSavedImageBtn.dataset.bound !== '1') {
        this.favoriteSavedImageBtn.dataset.bound = '1';
        this.favoriteSavedImageBtn.addEventListener('click', () => {
          this.toggleFavoriteSelectedSavedImage();
        });
      }

      // Left-panel mode toggle: Tekenen (nieuw), Vormen (was Tekenen), Selecteren.
      if (this.drawToolBtn instanceof HTMLButtonElement) {
        this.drawToolBtn.addEventListener('click', () => {
          this.setDrawModeActive();
        });
      }

      if (this.modeDrawBtn instanceof HTMLButtonElement && this.modeSelectBtn instanceof HTMLButtonElement) {
        this.modeDrawBtn.addEventListener('click', () => {
          this.setInteractionMode('draw');
        });
        this.modeSelectBtn.addEventListener('click', () => {
          this.setInteractionMode('select');
        });

        // Ensure UI reflects the default mode.
        this.setInteractionMode(this.interactionMode);
      }

      // Clicking the empty area of the layers list deselects all layers.
      // (This enables the "no layer chosen" state so actions can target the background.)
      if (this.layersRoot instanceof HTMLElement && this.layersRoot.dataset.boundDeselect !== '1') {
        this.layersRoot.dataset.boundDeselect = '1';
        this.layersRoot.addEventListener('click', (evt) => {
          const target = evt.target instanceof HTMLElement ? evt.target : null;
          if (!target) return;
          if (target.closest('.layers__item')) return;
          if (target.closest('button') || target.closest('input') || target.closest('select')) return;

          this.selectedLayerIndices = new Set();
          this.setActiveLayerIndex(-1);
          this.syncActiveShapeToLayerIndex(-1);
          this.renderLayersList();
          if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
        });
      }

    // iPad/Pencil: allow multi-select in layers list without Shift.
    if (this.layersRoot instanceof HTMLElement && this.layersRoot.dataset.boundPointerType !== '1') {
      this.layersRoot.dataset.boundPointerType = '1';
      this.layersRoot.addEventListener(
        'pointerdown',
        (evt) => {
          const pt = evt && typeof evt.pointerType === 'string' ? evt.pointerType : '';
          this.lastLayersPointerType = pt;
        },
        { passive: true }
      );
    }

      const initial = this.patterns && this.patterns[0] ? this.patterns[0].file : null;
      this.select.value = initial || '';
      this.applySelection(initial || '');

      this.select.addEventListener('change', () => {
        this.applySelection(this.select.value);
      });

      this.preview.addEventListener('click', () => {
        const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
        const selected = this.getSelectedLayerIndices();

    // Pending composite shape placement (from saved group)
    const hasActiveGroup = Array.isArray(this.activeClipPathsN) && this.activeClipPathsN.length > 0;
    if (hasActiveGroup) {
      this.applyToActiveShapeGroup();
      return;
    }

        // If the user selected multiple layers (Shift+click), actions apply to the group.
        // This takes precedence over "active shape" behavior.
        if (selected.length > 1) {
          if (!this.currentFile) {
            this.applySolidToSelectedLayerOrCanvas();
            return;
          }

          for (const idx of selected) {
            this.canvasLayers.addPatternPaintToLayerIndex(
              idx,
              this.currentFile,
              this.getRepeatCount(),
              this.currentColor,
              this.getThickness(),
              this.currentTileScaleMode
            );
          }

          this.renderLayersList();

          const token = ++this.visibleColorsRenderToken;
          Promise.all(selected.map((i) => this.canvasLayers.getLatestVisibleColorsPromise(i).catch(() => {})))
            .then(() => {
              if (token !== this.visibleColorsRenderToken) return;
              this.renderLayersList();
            })
            .catch(() => {});

          return;
        }

        const hasActive = Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 3;
        if (hasActive) {
          this.applyToActiveShape();
          return;
        }

        if (!this.currentFile) {
          this.applySolidToSelectedLayerOrCanvas();
          return;
        }

        if (selected.length > 0) {
          for (const idx of selected) {
            this.canvasLayers.addPatternPaintToLayerIndex(
              idx,
              this.currentFile,
              this.getRepeatCount(),
              this.currentColor,
              this.getThickness(),
              this.currentTileScaleMode
            );
          }

          this.renderLayersList();

          // Re-render once async visible-colors computations finish.
          const token = ++this.visibleColorsRenderToken;
          Promise.all(selected.map((i) => this.canvasLayers.getLatestVisibleColorsPromise(i).catch(() => {})))
            .then(() => {
              if (token !== this.visibleColorsRenderToken) return;
              this.renderLayersList();
            })
            .catch(() => {});

          return;
        }

        if (this.activeLayerIndex >= 0 && this.activeLayerIndex < layers.length) {
          const layer = layers[this.activeLayerIndex];
          const paints = layer && Array.isArray(layer.paints) ? layer.paints : [];
          const isImageLayer = paints.some((p) => p && p.kind === 'image' && p.blob instanceof Blob);
          if (isImageLayer) {
            this.applyPatternToBackground();
            this.renderLayersList();
            return;
          }
          this.canvasLayers.addPatternPaintToLayerIndex(
            this.activeLayerIndex,
            this.currentFile,
            this.getRepeatCount(),
            this.currentColor,
            this.getThickness(),
            this.currentTileScaleMode
          );
          this.renderLayersList();
          return;
        }

			this.applyPatternToBackground();
			this.renderLayersList();
      });

      this.initDrawShapeToMask();
	  this.initLayerReorderDragDrop();

      this.renderLayersList();

      this.setRightView(this.rightView);

      window.addEventListener('resize', () => {
        this.resizeDrawOverlay();
		this.resizeCompositionOverlay();
		this.renderCompositionOverlay();
        if (!this.canvasLayers.hasLayers()) return;
        this.canvasLayers.redrawAllLayers();
      });
    }

    setInteractionMode(nextMode) {
      const mode = nextMode === 'select' ? 'select' : 'draw';
      this.interactionMode = mode;

      // Entering Vormen mode must leave free-draw mode.
      if (mode === 'draw' && this.toolMode !== 'crop') {
        this.toolMode = 'draw';
      }

      // Deactivate all three buttons first
      if (this.drawToolBtn) {
        this.drawToolBtn.classList.remove('is-active');
        this.drawToolBtn.setAttribute('aria-pressed', 'false');
      }
      if (this.modeDrawBtn) {
        this.modeDrawBtn.classList.remove('is-active');
        this.modeDrawBtn.setAttribute('aria-pressed', 'false');
      }
      if (this.modeSelectBtn) {
        this.modeSelectBtn.classList.remove('is-active');
        this.modeSelectBtn.setAttribute('aria-pressed', 'false');
      }

      // Activate only the correct button
      if (mode === 'draw' && this.modeDrawBtn) {
        this.modeDrawBtn.classList.add('is-active');
        this.modeDrawBtn.setAttribute('aria-pressed', 'true');
      } else if (mode === 'select' && this.modeSelectBtn) {
        this.modeSelectBtn.classList.add('is-active');
        this.modeSelectBtn.setAttribute('aria-pressed', 'true');
      }
    }

    resetToStart() {
      // Clear canvas + layers.
      if (this.canvasLayers && typeof this.canvasLayers.clearAllLayers === 'function') {
        this.canvasLayers.clearAllLayers();
      }

	  // Clear composition overlay/selection.
	  this.selectedCompositionId = '';
    this.clearCompositionStorage();
	  this.updateCompositionThumbSelection();
	  this.renderCompositionOverlay();

      // Reset interaction state.
      this.setInteractionMode('draw');
      this.isDrawing = false;
      this.drawPointerId = null;
      this.drawPath = [];
      this.activeClipPathN = null;
      this.activeClipKey = null;

      this.isDraggingShape = false;
      this.dragPointerId = null;
      this.dragLayerIndex = -1;
      this.dragStartPos = null;
      this.dragStartClipPathN = null;
      this.dragPendingPos = null;
      if (this.dragRaf) {
        window.cancelAnimationFrame(this.dragRaf);
        this.dragRaf = 0;
      }

      this.isDraggingImage = false;
      this.imagePointerId = null;
      this.imageLayerIndex = -1;
      this.imageDragMode = '';
      this.imageStartPos = null;
      this.imageStartPlacement = null;

      this.isDraggingFreehand = false;
      this.freehandPointerId = null;
      this.freehandStartPos = null;
      this.freehandTargetIndices = null;
      this.freehandStartPathByIndex = null;
      this.freehandShapeTargetIndices = null;
      this.freehandShapeStartClipByIndex = null;

      this.isBoxSelecting = false;
      this.boxSelectPointerId = null;
      this.boxSelectStartPos = null;
      this.boxSelectRectPx = null;
      this.boxSelectMoved = false;

      this.toolMode = 'draw';
      this.isCropping = false;
      this.cropPointerId = null;
      this.cropStartPos = null;
      this.cropPendingPos = null;
      this.cropRectPx = null;
      this.cropRectN = null;

      this.activeLayerIndex = -1;
      this.selectedLayerIndices = new Set();

      // Reset controls to defaults.
      this.setBaseColor('#000000');

      if (this.repeat instanceof HTMLInputElement) {
        this.repeat.value = '10';
      }
      if (this.repeatValue instanceof HTMLElement) {
        this.repeatValue.textContent = '10';
      }

      if (this.thickness instanceof HTMLInputElement) {
        this.thickness.value = '1';
      }
      if (this.thicknessValue instanceof HTMLElement) {
        this.thicknessValue.textContent = '1';
      }
      this.currentThickness = 1;

      if (this.tileScaleToShape instanceof HTMLInputElement) {
        this.tileScaleToShape.checked = true;
      }
      this.currentTileScaleMode = 'shape';

      const initial = this.patterns && this.patterns[0] ? this.patterns[0].file : '';
      if (this.select instanceof HTMLSelectElement) {
        this.select.value = initial || '';
      }
      this.applySelection(initial || '');

      // Reset view.
	  this.setRightView('start');

      // Clear layers list UI.
      this.renderLayersList();

      if (this.drawOverlay instanceof HTMLCanvasElement) {
        this.drawOverlay.style.cursor = 'crosshair';
      }
      if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
    }

    setRightView(view) {
      const next = view === 'start'
        ? 'start'
        : view === 'about'
          ? 'about'
        : view === 'composition'
          ? 'composition'
          : view === 'images'
            ? 'images'
            : view === 'shapes'
              ? 'shapes'
              : view === 'colors'
                ? 'colors'
                : view === 'textures'
                  ? 'textures'
                  : 'patterns';
      this.rightView = next;

      if (this.rightViewStart instanceof HTMLElement) {
        this.rightViewStart.hidden = next !== 'start';
      }
	  if (this.rightViewAbout instanceof HTMLElement) {
		this.rightViewAbout.hidden = next !== 'about';
	  }
      if (this.rightViewComposition instanceof HTMLElement) {
        this.rightViewComposition.hidden = next !== 'composition';
      }
      if (this.rightViewPatterns instanceof HTMLElement) {
        this.rightViewPatterns.hidden = next !== 'patterns';
      }
	  if (this.rightViewTextures instanceof HTMLElement) {
		this.rightViewTextures.hidden = next !== 'textures';
	  }
      if (this.rightViewColors instanceof HTMLElement) {
        this.rightViewColors.hidden = next !== 'colors';
      }
      if (this.rightViewImages instanceof HTMLElement) {
        this.rightViewImages.hidden = next !== 'images';
      }

      if (this.rightViewShapes instanceof HTMLElement) {
        this.rightViewShapes.hidden = next !== 'shapes';
      }

    if (this.rightPanelTitle instanceof HTMLElement) {
      const title = next === 'start'
        ? 'Concept'
        : next === 'composition'
          ? 'Compositie'
          : next === 'colors'
            ? 'Kleuren'
            : next === 'patterns'
              ? 'Patronen'
              : next === 'textures'
                ? 'Texturen'
              : next === 'shapes'
                ? 'Vormen'
                : next === 'images'
                  ? 'Afbeeldingen'
                  : 'Over';
      this.rightPanelTitle.textContent = title;
    }

      // Ensure the right panel is visible.
      document.body.classList.remove('right-collapsed');

      if (next === 'images') this.renderSavedImages();
      if (next === 'shapes') this.renderSavedShapes();
	  if (next === 'textures') this.applyTextureSelection(this.currentTextureId);
	  this.renderColorMixCanvas();
      if (next === 'composition') {
        this.renderCompositionThumbs();
        this.resizeCompositionOverlay();
        this.renderCompositionOverlay();
      }
    }

    getCompositionStrokeStyle() {
      try {
        const cs = getComputedStyle(document.documentElement);
        const border = (cs.getPropertyValue('--border') || '').trim();
        return border || 'rgba(0,0,0,0.12)';
      } catch (_) {
        return 'rgba(0,0,0,0.12)';
      }
    }

    getCompositions() {
      // 18 simple composition guides.
      const thirds = (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(w / 3, 0);
        ctx.lineTo(w / 3, h);
        ctx.moveTo((2 * w) / 3, 0);
        ctx.lineTo((2 * w) / 3, h);
        ctx.moveTo(0, h / 3);
        ctx.lineTo(w, h / 3);
        ctx.moveTo(0, (2 * h) / 3);
        ctx.lineTo(w, (2 * h) / 3);
        ctx.stroke();
      };
      const centerCross = (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
      };
      const diagTLBR = (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w, h);
        ctx.stroke();
      };
      const diagTRBL = (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(w, 0);
        ctx.lineTo(0, h);
        ctx.stroke();
      };
      const frameInset = (ctx, w, h) => {
        const m = Math.min(w, h) * 0.12;
        ctx.beginPath();
        ctx.rect(m, m, w - 2 * m, h - 2 * m);
        ctx.stroke();
      };
      const circleCenter = (ctx, w, h) => {
        const r = Math.min(w, h) * 0.32;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      };
      const triangle = (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(0, h);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.stroke();
      };
      const horizon = (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(0, h / 3);
        ctx.lineTo(w, h / 3);
        ctx.moveTo(0, (2 * h) / 3);
        ctx.lineTo(w, (2 * h) / 3);
        ctx.stroke();
      };
      const verticals = (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(w / 3, 0);
        ctx.lineTo(w / 3, h);
        ctx.moveTo((2 * w) / 3, 0);
        ctx.lineTo((2 * w) / 3, h);
        ctx.stroke();
      };
    const diagX = (ctx, w, h) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.moveTo(w, 0);
    ctx.lineTo(0, h);
    ctx.stroke();
    };
    const goldenRatioGrid = (ctx, w, h) => {
    const phi = 0.61803398875;
    const x1 = w * phi;
    const x2 = w * (1 - phi);
    const y1 = h * phi;
    const y2 = h * (1 - phi);
    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, h);
    ctx.moveTo(x2, 0);
    ctx.lineTo(x2, h);
    ctx.moveTo(0, y1);
    ctx.lineTo(w, y1);
    ctx.moveTo(0, y2);
    ctx.lineTo(w, y2);
    ctx.stroke();
    };
    const diamond = (ctx, w, h) => {
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w, h / 2);
    ctx.lineTo(w / 2, h);
    ctx.lineTo(0, h / 2);
    ctx.closePath();
    ctx.stroke();
    };
    const doubleFrame = (ctx, w, h) => {
    const m1 = Math.min(w, h) * 0.10;
    const m2 = Math.min(w, h) * 0.22;
    ctx.beginPath();
    ctx.rect(m1, m1, w - 2 * m1, h - 2 * m1);
    ctx.rect(m2, m2, w - 2 * m2, h - 2 * m2);
    ctx.stroke();
    };
    const offsetFrame = (ctx, w, h) => {
    const m = Math.min(w, h) * 0.14;
    const dx = Math.min(w, h) * 0.06;
    const dy = Math.min(w, h) * 0.04;
    ctx.beginPath();
    ctx.rect(m, m, w - 2 * m, h - 2 * m);
    ctx.rect(m + dx, m + dy, w - 2 * (m + dx), h - 2 * (m + dy));
    ctx.stroke();
    };
    const goldenSpiral = (ctx, w, h) => {
    const m = Math.min(w, h) * 0.05;
    const ww = Math.max(1, w - 2 * m);
    const hh = Math.max(1, h - 2 * m);
    const cx = m + ww * 0.61803398875;
    const cy = m + hh * 0.38196601125;
    const phi = (1 + Math.sqrt(5)) / 2;
    const maxR = Math.min(ww, hh) * 0.52;
    const thetaMax = Math.PI * 2.75;
    const a = maxR / Math.pow(phi, (2 * thetaMax) / Math.PI);
    ctx.beginPath();
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * thetaMax;
      const r = a * Math.pow(phi, (2 * t) / Math.PI);
      const x = cx + r * Math.cos(t);
      const y = cy + r * Math.sin(t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    };
    const emptyComposition = (_ctx, _w, _h) => {
    // Intentionally empty (no guide).
    };
    const grid4 = (ctx, w, h) => {
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo((w * i) / 4, 0);
      ctx.lineTo((w * i) / 4, h);
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
    }
    ctx.stroke();
    };
    const grid5 = (ctx, w, h) => {
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      ctx.moveTo((w * i) / 5, 0);
      ctx.lineTo((w * i) / 5, h);
      ctx.moveTo(0, (h * i) / 5);
      ctx.lineTo(w, (h * i) / 5);
    }
    ctx.stroke();
    };

      return [
        { id: 'c1', label: '1', draw: thirds },
        { id: 'c2', label: '2', draw: centerCross },
        { id: 'c3', label: '3', draw: diagTLBR },
        { id: 'c4', label: '4', draw: diagTRBL },
        { id: 'c5', label: '5', draw: frameInset },
        { id: 'c6', label: '6', draw: circleCenter },
        { id: 'c7', label: '7', draw: triangle },
        { id: 'c8', label: '8', draw: horizon },
        { id: 'c9', label: '9', draw: verticals },
		{ id: 'c10', label: '10', draw: diagX },
		{ id: 'c11', label: '11', draw: goldenRatioGrid },
		{ id: 'c12', label: '12', draw: diamond },
    { id: 'c13', label: '13', draw: doubleFrame },
    { id: 'c14', label: '14', draw: offsetFrame },
    { id: 'c15', label: '15', draw: goldenSpiral },
    { id: 'c16', label: '16', draw: emptyComposition },
    { id: 'c17', label: '17', draw: grid4 },
    { id: 'c18', label: '18', draw: grid5 },
      ];
    }

    initCompositionView() {
      // Restore previous selection (if any) and build thumbs lazily.
      this.restoreCompositionFromStorage();
      this.renderCompositionThumbs();
      this.resizeCompositionOverlay();
      this.renderCompositionOverlay();
    }

    renderCompositionThumbs() {
      console.log('[renderCompositionThumbs] wordt aangeroepen');
      if (!(this.compositionGrid instanceof HTMLElement)) return;
      const grid = this.compositionGrid;
      if (grid.dataset.built === '1') {
        this.updateCompositionThumbSelection();
        return;
      }
      grid.dataset.built = '1';
      grid.innerHTML = '';

      for (const comp of this.getCompositions()) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'composition-item';
        btn.dataset.compositionId = comp.id;
        btn.setAttribute('aria-label', `Compositie ${comp.label}`);

        const canvas = document.createElement('canvas');
        canvas.width = 140;
        canvas.height = 140;
        btn.appendChild(canvas);

        btn.addEventListener('click', () => {
          const next = String(comp.id);
          this.selectedCompositionId = this.selectedCompositionId === next ? '' : next;
          this.persistCompositionToStorage();
          this.updateCompositionThumbSelection();
          this.renderCompositionOverlay();
        });

        grid.appendChild(btn);

        // Draw thumbnail.
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = this.getCompositionStrokeStyle();
        ctx.lineWidth = 2;
        comp.draw(ctx, canvas.width, canvas.height);
      }

      this.updateCompositionThumbSelection();
    }

    updateCompositionThumbSelection() {
      if (!(this.compositionGrid instanceof HTMLElement)) return;
      const selected = String(this.selectedCompositionId || '');
      const buttons = this.compositionGrid.querySelectorAll('.composition-item');
      for (const el of buttons) {
        if (!(el instanceof HTMLElement)) continue;
        const id = el.dataset ? String(el.dataset.compositionId || '') : '';
        el.classList.toggle('is-selected', !!selected && id === selected);
      }
    }

    resizeCompositionOverlay() {
      if (!(this.canvas instanceof HTMLCanvasElement)) return;
      if (!(this.compositionOverlay instanceof HTMLCanvasElement)) return;
      const overlay = this.compositionOverlay;

      const canvasRect = this.canvas.getBoundingClientRect();
      const parent = this.canvas.parentElement;
      const parentRect = parent ? parent.getBoundingClientRect() : null;
      if (!parentRect) return;

      const left = canvasRect.left - parentRect.left;
      const top = canvasRect.top - parentRect.top;
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${canvasRect.width}px`;
      overlay.style.height = `${canvasRect.height}px`;

      const dpr = window.devicePixelRatio || 1;
      overlay.width = Math.max(1, Math.round(canvasRect.width * dpr));
      overlay.height = Math.max(1, Math.round(canvasRect.height * dpr));
      const ctx = overlay.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    renderCompositionOverlay() {
      if (!(this.compositionOverlay instanceof HTMLCanvasElement)) return;
      const overlay = this.compositionOverlay;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      const rect = overlay.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      ctx.clearRect(0, 0, w, h);

      const id = String(this.selectedCompositionId || '');
      if (!id) return;
      const comp = this.getCompositions().find((c) => c && c.id === id);
      if (!comp) return;

      ctx.strokeStyle = this.getCompositionStrokeStyle();
      ctx.lineWidth = 2;
      comp.draw(ctx, w, h);
    }

    getConceptValue() {
      if (!(this.conceptInput instanceof HTMLInputElement)) return '';
      return typeof this.conceptInput.value === 'string' ? this.conceptInput.value.trim() : '';
    }

    getDescriptionValue() {
      if (!(this.descriptionInput instanceof HTMLTextAreaElement)) return '';
      return typeof this.descriptionInput.value === 'string' ? this.descriptionInput.value.trim() : '';
    }

    getConceptStorage() {
      try {
        if (!('localStorage' in window)) return null;
        return window.localStorage;
      } catch (_) {
        return null;
      }
    }

    getConceptStorageKeys() {
      return {
        concept: `${APP_ID}.concept`,
        description: `${APP_ID}.description`,
      };
    }

    getLegacyConceptStorageKeys() {
      return {
        concept: `${LEGACY_APP_ID}.concept`,
        description: `${LEGACY_APP_ID}.description`,
      };
    }

    migrateLegacyConceptDescriptionIfNeeded() {
      const store = this.getConceptStorage();
      if (!store) return;

      const keys = this.getConceptStorageKeys();
      const legacy = this.getLegacyConceptStorageKeys();

      const newConcept = store.getItem(keys.concept);
      const newDescription = store.getItem(keys.description);
      // If the new keys exist (even if empty strings), do not migrate.
      if (newConcept !== null || newDescription !== null) return;

      const legacyConcept = store.getItem(legacy.concept);
      const legacyDescription = store.getItem(legacy.description);
      if (!legacyConcept && !legacyDescription) return;

      try {
        store.setItem(keys.concept, legacyConcept || '');
        store.setItem(keys.description, legacyDescription || '');
        store.removeItem(legacy.concept);
        store.removeItem(legacy.description);
      } catch (_) {}
    }

    restoreConceptDescriptionFromStorage() {
      const store = this.getConceptStorage();
      if (!store) return;

      this.migrateLegacyConceptDescriptionIfNeeded();

      const keys = this.getConceptStorageKeys();
      const concept = store.getItem(keys.concept) || '';
      const description = store.getItem(keys.description) || '';

      if (this.conceptInput instanceof HTMLInputElement && !this.conceptInput.value) {
        this.conceptInput.value = concept;
      }
      if (this.descriptionInput instanceof HTMLTextAreaElement && !this.descriptionInput.value) {
        this.descriptionInput.value = description;
      }
    }

    persistConceptDescriptionToStorage() {
      const store = this.getConceptStorage();
      if (!store) return;

      const keys = this.getConceptStorageKeys();
      const concept = this.conceptInput instanceof HTMLInputElement ? this.conceptInput.value : '';
      const description = this.descriptionInput instanceof HTMLTextAreaElement ? this.descriptionInput.value : '';

      try {
        store.setItem(keys.concept, concept || '');
        store.setItem(keys.description, description || '');
      } catch (_) {}
    }

    clearConceptDescriptionStorageAndFields() {
      const store = this.getConceptStorage();

      if (this.conceptInput instanceof HTMLInputElement) this.conceptInput.value = '';
      if (this.descriptionInput instanceof HTMLTextAreaElement) this.descriptionInput.value = '';

      if (!store) return;
      const keys = this.getConceptStorageKeys();
      try {
        store.removeItem(keys.concept);
        store.removeItem(keys.description);
      } catch (_) {}
    }

    migrateLegacyAppData() {
      // localStorage migration is handled lazily in restoreConceptDescriptionFromStorage.
      if (!('indexedDB' in window)) return Promise.resolve(false);
      if (APP_ID === LEGACY_APP_ID) return Promise.resolve(false);

      const version = 2;
      const newName = APP_ID;
      const oldName = LEGACY_APP_ID;

      return Promise.all([dbExists(oldName), this.savedImagesDB.getAll().catch(() => []), this.savedShapesDB.getAll().catch(() => [])]).then(
        ([legacyExists, newImages, newShapes]) => {
          const hasNewData = (Array.isArray(newImages) && newImages.length > 0) || (Array.isArray(newShapes) && newShapes.length > 0);
          if (hasNewData) return false;
          if (!legacyExists) return false;

          return openDb(oldName, version, null)
            .then((legacyDb) =>
              Promise.all([getAllFromDb(legacyDb, 'savedImages').catch(() => []), getAllFromDb(legacyDb, 'savedShapes').catch(() => [])])
                .then(([legacyImages, legacyShapes]) => ({ legacyDb, legacyImages, legacyShapes }))
                .catch(() => ({ legacyDb, legacyImages: [], legacyShapes: [] }))
            )
            .then(({ legacyDb, legacyImages, legacyShapes }) => {
              // Ensure new DB exists (open via our wrappers).
                return Promise.all([this.savedImagesDB.open(), this.savedShapesDB.open()]).then(([newDb]) => ({ legacyDb, newDb, legacyImages, legacyShapes }));
            })
            .then(({ legacyDb, newDb, legacyImages, legacyShapes }) => {
              const imgs = Array.isArray(legacyImages) ? legacyImages : [];
              const shapes = Array.isArray(legacyShapes) ? legacyShapes : [];

              return Promise.all([
                putManyToDb(newDb, 'savedImages', imgs),
                putManyToDb(newDb, 'savedShapes', shapes),
              ])
                .then(() => {
                  try {
                    legacyDb.close();
                  } catch (_) {}
                  return true;
                })
                .catch(() => {
                  try {
                    legacyDb.close();
                  } catch (_) {}
                  return false;
                });
            })
            .then((did) => {
              if (!did) return false;
              // Best-effort cleanup of the legacy DB.
              return deleteDb(oldName).then(() => true);
            })
            .then(() => {
              if (this.rightView === 'images') this.renderSavedImages();
              if (this.rightView === 'shapes') this.renderSavedShapes();
              return true;
            })
            .catch(() => false);
        }
      );
    }

    sanitizeFileStem(name) {
      const raw = typeof name === 'string' ? name : '';
      const cleaned = raw
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/[\\/?:%*|"<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned.slice(0, 80);
    }

    getJsPDF() {
      // Loaded via UMD bundle: window.jspdf.jsPDF
      const jspdf = window.jspdf;
      const jsPDF = jspdf && jspdf.jsPDF;
      return typeof jsPDF === 'function' ? jsPDF : null;
    }

    formatDateTimeNl(ts) {
      const t = Number(ts);
      const d = new Date(Number.isFinite(t) ? t : Date.now());
      try {
        return d.toLocaleString('nl-NL', {
          year: 'numeric',
          month: 'long',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch (_) {
        return d.toISOString();
      }
    }

    formatDateStamp(ts) {
      const t = Number(ts);
      const d = new Date(Number.isFinite(t) ? t : Date.now());
      const pad = (n) => String(n).padStart(2, '0');
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const mi = pad(d.getMinutes());
      const ss = pad(d.getSeconds());
      return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
    }

  isIosLike() {
    const ua = typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
    const isIOS = /iPad|iPhone|iPod/i.test(ua);
    const isIPadOS =
      typeof navigator !== 'undefined' &&
      navigator.platform === 'MacIntel' &&
      Number.isFinite(navigator.maxTouchPoints) &&
      navigator.maxTouchPoints > 1;
    return isIOS || isIPadOS;
  }

  openBlankExportWindow(titleText) {
    try {
      const win = window.open('', '_blank');
      if (!win) return null;
      try {
        const title = typeof titleText === 'string' && titleText.trim() ? titleText.trim() : 'Export';
        win.document.open();
        win.document.write(
          `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${title}</title></head><body style="font-family:system-ui,-apple-system; padding:16px;">Bezig met exporteren…</body></html>`
        );
        win.document.close();
      } catch (_) {
        // ignore
      }
      return win;
    } catch (_) {
      return null;
    }
  }

  async offerBlobToUser(blob, fileName, opts) {
    if (!(blob instanceof Blob)) return false;
    const safeName = typeof fileName === 'string' && fileName.trim() ? fileName.trim() : 'ontwerpstudio-2026.png';
    const mime = typeof blob.type === 'string' && blob.type ? blob.type : 'image/png';
    const exportWindow = opts && typeof opts === 'object' ? opts.exportWindow : null;
    const preferShare = !(opts && typeof opts === 'object' && opts.preferShare === false);

    // Best on iPad/iOS: Share sheet (Save Image / Save to Files).
    // NOTE: this only works reliably when called directly from a user gesture.
    if (preferShare) {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          let file = null;
          try {
            file = new File([blob], safeName, { type: mime });
          } catch (_) {
            file = null;
          }

          const canShareFiles =
            file && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
          if (canShareFiles) {
            await navigator.share({ files: [file], title: safeName });
            return true;
          }
        }
      } catch (_) {
        // ignore and fall back
      }
    }

    const isIOS = this.isIosLike();

    // iOS ignores a.download; open the image so the user can save/share.
    if (isIOS) {
      let url = '';
      try {
        url = URL.createObjectURL(blob);
      } catch (_) {
        url = '';
      }
      if (url) {
			// If we already opened a tab synchronously (user gesture), reuse it.
			try {
				if (exportWindow && typeof exportWindow === 'object' && exportWindow.location && !exportWindow.closed) {
					exportWindow.location.href = url;
					window.setTimeout(() => {
						try {
							URL.revokeObjectURL(url);
						} catch (_) {}
					}, 60_000);
					return true;
				}
			} catch (_) {
				// ignore
			}

        try {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
          return true;
        } catch (_) {
          // popups might be blocked
        }
        try {
          window.location.href = url;
          return true;
        } catch (_) {
          // ignore
        }
      }
    }

    // Default: regular download.
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }, 0);
      return true;
    } catch (_) {
      return false;
    }
  }

    blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        if (!(blob instanceof Blob)) {
          reject(new Error('Not a blob'));
          return;
        }
        const r = new FileReader();
        r.onerror = () => reject(r.error || new Error('FileReader failed'));
        r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
        r.readAsDataURL(blob);
      });
    }

    exportSavedImagesPdf(opts) {
      const jsPDF = this.getJsPDF();
      if (!jsPDF) return Promise.resolve(false);

      const concept = opts && typeof opts.concept === 'string' ? opts.concept : '';
      const description = opts && typeof opts.description === 'string' ? opts.description : '';
      const createdAt = opts && Number.isFinite(opts.createdAt) ? Number(opts.createdAt) : Date.now();
    	  const title = concept.trim() || 'Ontwerpstudio 2026';
      const dateLine = this.formatDateTimeNl(createdAt);

      return this.savedImagesDB
        .getAll()
        .catch(() => [])
        .then(async (items) => {
          const sorted = (Array.isArray(items) ? items : [])
            .filter((it) => it && typeof it.id === 'string' && it.blob instanceof Blob)
            .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));

          const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
          const pageW = doc.internal.pageSize.getWidth();
          const pageH = doc.internal.pageSize.getHeight();
          const margin = 40;
          const maxW = pageW - margin * 2;

          let y = margin;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.text(title, margin, y);
          y += 22;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.text(dateLine, margin, y);
          y += 18;

          const desc = description.trim();
          if (desc) {
            const lines = doc.splitTextToSize(desc, maxW);
            const blockH = Math.max(14, lines.length * 14);
            if (y + blockH > pageH - margin) {
              doc.addPage();
              y = margin;
            }
            doc.text(lines, margin, y);
            y += blockH + 14;
          }

          if (sorted.length === 0) {
            doc.setFontSize(12);
            doc.text('Nog geen opgeslagen afbeeldingen.', margin, y + 10);
          } else {
            // Prepare data URLs once (used for thumbnails + full pages).
            const prepared = [];
            for (const it of sorted) {
              const dataUrl = await this.blobToDataUrl(it.blob).catch(() => '');
              if (!dataUrl) continue;
              const iw = Math.max(1, Number(it.w) || 1);
              const ih = Math.max(1, Number(it.h) || 1);
              prepared.push({ it, dataUrl, iw, ih });
            }

            // 1) First page: thumbnail overview.
            const cols = 3;
            const gutter = 10;
            const cellW = (maxW - gutter * (cols - 1)) / cols;
            const cellH = cellW; // square cells for consistent thumbnails

            let tx = margin;
            let ty = y;
            let col = 0;

            const ensureThumbSpace = () => {
              if (ty + cellH > pageH - margin) {
                doc.addPage();
                tx = margin;
                ty = margin;
                col = 0;
              }
            };

            for (const p of prepared) {
              ensureThumbSpace();

              const fitW = cellW;
              const fitH = cellH;
              let drawW = fitW;
              let drawH = (drawW * p.ih) / p.iw;
              if (drawH > fitH) {
                drawH = fitH;
                drawW = (drawH * p.iw) / p.ih;
              }

              const ox = tx + (fitW - drawW) / 2;
              const oy = ty + (fitH - drawH) / 2;
              doc.addImage(p.dataUrl, 'PNG', ox, oy, drawW, drawH);

              col += 1;
              if (col >= cols) {
                col = 0;
                tx = margin;
                ty += cellH + gutter;
              } else {
                tx += cellW + gutter;
              }
            }

            // 2) Following pages: full-size images (favorites only).
            const favorites = prepared.filter((p) => p && p.it && !!p.it.favorite);
            if (favorites.length > 0) {
              doc.addPage();
              y = margin;
            }

            for (const p of favorites) {
              let drawW = maxW;
              let drawH = (drawW * p.ih) / p.iw;

              const availableH = pageH - margin - y;
              if (drawH > availableH) {
                if (y > margin + 20) {
                  doc.addPage();
                  y = margin;
                }
              }

              const availableH2 = pageH - margin - y;
              if (drawH > availableH2) {
                drawH = Math.max(1, availableH2);
                drawW = (drawH * p.iw) / p.ih;
              }

              doc.addImage(p.dataUrl, 'PNG', margin, y, drawW, drawH);
              y += drawH + 16;
            }
          }

            const stem = this.sanitizeFileStem(title) || 'ontwerpstudio-2026';
          const stamp = this.formatDateStamp(createdAt);
          // Note: browsers do not guarantee saving into folders; this name is still helpful.
          const fileName = `pdf/${stem}-${stamp}.pdf`;
          doc.save(fileName);
          return true;
        });
    }

    clearSavedImagesObjectUrls() {
    const m = this.savedImagesObjectUrls instanceof Map ? this.savedImagesObjectUrls : new Map();
    for (const u of m.values()) {
      try {
        URL.revokeObjectURL(u);
      } catch (_) {}
    }
    this.savedImagesObjectUrls = new Map();
    }

  reconcileSavedImagesObjectUrls(sortedItems) {
    const m = this.savedImagesObjectUrls instanceof Map ? this.savedImagesObjectUrls : new Map();
    const nextIds = new Set(
      (Array.isArray(sortedItems) ? sortedItems : [])
        .map((it) => (it && typeof it.id === 'string' ? String(it.id) : ''))
        .filter(Boolean),
    );

    for (const [id, url] of m.entries()) {
      if (!nextIds.has(String(id))) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
        m.delete(id);
      }
    }
    this.savedImagesObjectUrls = m;
  }

    clearLayerThumbObjectUrls() {
      for (const u of this.layerThumbObjectUrls) {
        try {
          URL.revokeObjectURL(u);
        } catch (_) {}
      }
      this.layerThumbObjectUrls = [];
    }

    updateSavedImagesSelectionUI() {
      if (!(this.savedImagesRoot instanceof HTMLElement)) return;
      const selectedId = typeof this.selectedSavedImageId === 'string' ? this.selectedSavedImageId : '';
      const items = this.savedImagesRoot.querySelectorAll('.saved-images__item');
      for (const el of items) {
        if (!(el instanceof HTMLElement)) continue;
        const id = el.dataset && typeof el.dataset.imageId === 'string' ? el.dataset.imageId : '';
        if (selectedId && id && String(id) === String(selectedId)) el.classList.add('is-selected');
        else el.classList.remove('is-selected');
      }
    }

    startSavedItemPointerDrag(evt, btn, kind, id) {
      if (!evt || !(btn instanceof HTMLElement)) return false;
      if (evt.pointerType === 'mouse') return false;
    const isPen = evt.pointerType === 'pen';
    const w = Number(evt.width);
    const h = Number(evt.height);
    const isPenLikeTouch = evt.pointerType === 'touch' && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= 6 && h <= 6;
    if (!isPen && !isPenLikeTouch) return false;

	  // On iPad/Safari a pointer sequence also fires a click; we handle tap/drag ourselves.
	  if (btn && btn.dataset) btn.dataset.skipClick = '1';

      const pointerId = evt.pointerId;
      const startX = evt.clientX;
      const startY = evt.clientY;
      const threshold = 6;
      let moved = false;
      let ghost = null;

      const cleanup = () => {
        try {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
        } catch (_) {}
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        ghost = null;
      };

      const ensureGhost = () => {
        if (ghost) return ghost;
        ghost = document.createElement('div');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.position = 'fixed';
        ghost.style.left = '0px';
        ghost.style.top = '0px';
        ghost.style.width = '72px';
        ghost.style.height = '72px';
        ghost.style.transform = 'translate(-50%, -50%)';
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '0.85';
        ghost.style.border = '1px solid var(--border)';
        ghost.style.borderRadius = '10px';
        ghost.style.backgroundColor = 'white';
        ghost.style.backgroundRepeat = 'no-repeat';
        ghost.style.backgroundPosition = 'center';
        ghost.style.backgroundSize = 'cover';
        ghost.style.zIndex = '999999';
        const bg = btn.style && btn.style.backgroundImage ? btn.style.backgroundImage : '';
        if (bg) {
			ghost.style.backgroundImage = bg;
		} else {
			const childImg = btn.querySelector('img');
			const src = childImg instanceof HTMLImageElement ? (childImg.currentSrc || childImg.src) : '';
			if (src) ghost.style.backgroundImage = `url("${src}")`;
		}
        document.body.appendChild(ghost);
        return ghost;
      };

      const moveGhost = (x, y) => {
        if (!ghost) return;
        ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      };

      const onMove = (e) => {
        if (!e || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved) {
          if (Math.hypot(dx, dy) < threshold) return;
          moved = true;
          ensureGhost();
        }
        moveGhost(e.clientX, e.clientY);
        if (e.pointerType === 'pen' || e.pointerType === 'touch') e.preventDefault();
      };

      const onUp = (e) => {
        if (!e || e.pointerId !== pointerId) return;
        const endX = e.clientX;
        const endY = e.clientY;
        cleanup();

        if (moved) {
          const overlay = this.drawOverlay;
          if (overlay instanceof HTMLCanvasElement) {
            const r = overlay.getBoundingClientRect();
            const inside = endX >= r.left && endX <= r.right && endY >= r.top && endY <= r.bottom;
            if (inside) {
              if (kind === 'image') this.placeSavedImageAtClientPoint(String(id), endX, endY);
              else if (kind === 'shape') this.placeSavedShapeAtClientPoint(String(id), endX, endY);
            }
          }
          if (e.pointerType === 'pen' || e.pointerType === 'touch') e.preventDefault();
          return;
        }

        // Tap behavior (no drag)
        if (kind === 'image') {
          this.selectedSavedImageId = String(id);
          this.updateSavedImagesToolbarState();
          this.updateSavedImagesSelectionUI();
        } else if (kind === 'shape') {
          const shapeId = String(id);
          const wasSelected = shapeId === String(this.selectedSavedShapeId);
          this.selectedSavedShapeId = shapeId;
          if (!wasSelected) {
            this.renderSavedShapes();
            return;
          }
          this.placeSavedShapeAtCanvasN(shapeId, 0.5, 0.5);
        }
        if (e.pointerType === 'pen' || e.pointerType === 'touch') e.preventDefault();
      };

      try {
        if (typeof btn.setPointerCapture === 'function') btn.setPointerCapture(pointerId);
      } catch (_) {}

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp, { passive: false });
      window.addEventListener('pointercancel', onUp, { passive: false });
      if (evt.pointerType === 'pen' || evt.pointerType === 'touch') evt.preventDefault();
      return true;
    }

    placeSavedImageAtClientPoint(id, clientX, clientY) {
      const overlay = this.drawOverlay;
      if (!(overlay instanceof HTMLCanvasElement)) return;
      const rect = overlay.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const clamp01 = (n) => Math.max(0, Math.min(1, n));

      this.savedImagesDB
        .get(String(id))
        .then((rec) => {
          if (!rec || !(rec.blob instanceof Blob)) return;

          const base = 0.28;
          const iw = Number(rec.w) || 0;
          const ih = Number(rec.h) || 0;
          const ratio = iw > 0 && ih > 0 ? ih / iw : 1;

          let wN = base;
          let hN = base;
          if (ratio > 0.0001) {
            if (ratio >= 1) {
              hN = base;
              wN = Math.max(0.03, base / ratio);
            } else {
              wN = base;
              hN = Math.max(0.03, base * ratio);
            }
          }

          let xN = clamp01(x / w - wN / 2);
          let yN = clamp01(y / h - hN / 2);
          xN = Math.max(0, Math.min(1 - wN, xN));
          yN = Math.max(0, Math.min(1 - hN, yN));

          const idx = this.canvasLayers.addImageLayer(String(id), rec.blob, xN, yN, wN, hN);
          this.setInteractionMode('select');
          this.setLayerSelectionSingle(idx);
          this.renderLayersList();
          if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
        })
        .catch(() => {});
    }

    placeSavedShapeAtClientPoint(id, clientX, clientY) {
      const overlay = this.drawOverlay;
      if (!(overlay instanceof HTMLCanvasElement)) return;
      const rect = overlay.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const cxN = Math.max(0, Math.min(1, x / w));
      const cyN = Math.max(0, Math.min(1, y / h));
      this.placeSavedShapeAtCanvasN(String(id), cxN, cyN);
    }

    placeSavedShapeAtCanvasN(id, cxN, cyN) {
      this.savedShapesDB
        .get(String(id))
        .then((rec) => {
          if (!rec) return;
          if (Array.isArray(rec.clipPathsN) && rec.clipPathsN.length) {
            const nextGroup = this.placeClipPathsNAt(rec.clipPathsN, cxN, cyN) || rec.clipPathsN;
            this.activeClipPathsN = nextGroup;
            this.activeClipPathN = null;
            this.activeClipKey = typeof rec.clipKey === 'string' && rec.clipKey ? rec.clipKey : '';
            this.setInteractionMode('select');
            this.applyToActiveShapeGroup();
          } else {
            if (!Array.isArray(rec.clipPathN) || rec.clipPathN.length < 3) return;
            const next = this.placeClipPathNAt(rec.clipPathN, cxN, cyN) || rec.clipPathN;
            this.activeClipPathN = next;
            this.activeClipPathsN = null;
            this.activeClipKey = typeof rec.clipKey === 'string' && rec.clipKey ? rec.clipKey : this.makeClipKey(next);
            this.setInteractionMode('select');
            this.applyToActiveShape();
          }

          if (this.rightView === 'shapes') this.renderSavedShapes();
          if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
          this.renderLayersList();
        })
        .catch(() => {});
    }

    renderSavedImages() {
      if (!(this.savedImagesRoot instanceof HTMLElement)) return;

      this.savedImagesRoot.innerHTML = '';

      this.savedImagesDB
        .getAll()
        .then((items) => {
          const sorted = items
            .filter((it) => it && typeof it.id === 'string' && it.blob instanceof Blob)
            .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

          this.savedImagesCache = sorted;
          if (this.selectedSavedImageId && !sorted.some((it) => String(it.id) === String(this.selectedSavedImageId))) {
            this.selectedSavedImageId = '';
          }
          this.updateSavedImagesToolbarState();

          if (sorted.length === 0) {
            this.savedImagesRoot.textContent = 'Nog geen opgeslagen afbeeldingen.';
      this.reconcileSavedImagesObjectUrls(sorted);
            return;
          }

      const urlMap = this.savedImagesObjectUrls instanceof Map ? this.savedImagesObjectUrls : new Map();

          for (const it of sorted) {
      const id = String(it.id);
      let url = urlMap.get(id);
      if (!url) {
        url = URL.createObjectURL(it.blob);
        urlMap.set(id, url);
      }

            const cell = document.createElement('div');
            cell.className = 'saved-images__cell';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'saved-images__item';

      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = url;
      btn.appendChild(img);

            const isSelected = String(it.id) === String(this.selectedSavedImageId);
            if (isSelected) btn.classList.add('is-selected');
            btn.setAttribute('aria-label', 'Opgeslagen afbeelding');
			btn.draggable = true;
			btn.dataset.imageId = it.id;
			btn.addEventListener('dragstart', (evt) => {
				if (!evt.dataTransfer) return;
				evt.dataTransfer.effectAllowed = 'copy';
        evt.dataTransfer.setData('application/x-ontwerpstudio2026-image', String(it.id));
				evt.dataTransfer.setData('text/plain', String(it.id));
			});
			btn.addEventListener('pointerdown', (evt) => {
				this.startSavedItemPointerDrag(evt, btn, 'image', String(it.id));
			});
            btn.addEventListener('click', () => {
				if (btn.dataset && btn.dataset.skipClick === '1') {
					btn.dataset.skipClick = '0';
					return;
				}
              this.selectedSavedImageId = String(it.id);
              this.updateSavedImagesToolbarState();
              this.updateSavedImagesSelectionUI();
            });

            if (it && it.favorite) {
              const fav = document.createElement('div');
              fav.className = 'saved-images__favorite';
              fav.textContent = '★';
              fav.setAttribute('aria-hidden', 'true');
              cell.appendChild(fav);
            }

            cell.appendChild(btn);
            this.savedImagesRoot.appendChild(cell);
          }

			this.updateSavedImagesSelectionUI();
			this.savedImagesObjectUrls = urlMap;
			this.reconcileSavedImagesObjectUrls(sorted);
        })
        .catch(() => {
          this.savedImagesRoot.textContent = 'Kan opgeslagen afbeeldingen niet laden.';
        });
    }

    getSelectedSavedImageFromCache() {
      const id = typeof this.selectedSavedImageId === 'string' ? this.selectedSavedImageId : '';
      if (!id) return null;
      const items = Array.isArray(this.savedImagesCache) ? this.savedImagesCache : [];
      return items.find((it) => it && String(it.id) === String(id)) || null;
    }

    updateSavedImagesToolbarState() {
      const it = this.getSelectedSavedImageFromCache();
      const has = !!it;

      if (this.deleteSavedImageBtn instanceof HTMLButtonElement) {
        this.deleteSavedImageBtn.disabled = !has;
      }
      if (this.downloadSavedImageBtn instanceof HTMLButtonElement) {
        this.downloadSavedImageBtn.disabled = !has;
      }
      if (this.favoriteSavedImageBtn instanceof HTMLButtonElement) {
        this.favoriteSavedImageBtn.disabled = !has;
        if (has && it && it.favorite) this.favoriteSavedImageBtn.textContent = 'Favoriet uit';
        else this.favoriteSavedImageBtn.textContent = 'Favoriet maken';
      }
    }

    deleteSelectedSavedImage() {
      const it = this.getSelectedSavedImageFromCache();
      if (!it) return;
      this.savedImagesDB
        .delete(String(it.id))
        .then(() => {
			const m = this.savedImagesObjectUrls instanceof Map ? this.savedImagesObjectUrls : new Map();
			const id = String(it.id);
			const url = m.get(id);
			if (url) {
				try {
					URL.revokeObjectURL(url);
				} catch (_) {}
				m.delete(id);
			}
			this.savedImagesObjectUrls = m;
          this.selectedSavedImageId = '';
          this.renderSavedImages();
        })
        .catch(() => {});
    }

    downloadSelectedSavedImage() {
      const it = this.getSelectedSavedImageFromCache();
      if (!it) return;
      if (it && it.blob instanceof Blob) {
        this.offerBlobToUser(it.blob, it.fileName || 'ontwerpstudio-2026.png', { preferShare: true }).catch(() => {});
        return;
      }

      this.savedImagesDB
        .get(String(it.id))
        .then((record) => {
          if (!record || !(record.blob instanceof Blob)) return;
      // After async IndexedDB read, iOS user-gesture is gone; navigate in the same tab if needed.
      this.offerBlobToUser(record.blob, record.fileName || 'ontwerpstudio-2026.png', { preferShare: false }).catch(() => {});
        })
        .catch(() => {});
    }

    toggleFavoriteSelectedSavedImage() {
      const it = this.getSelectedSavedImageFromCache();
      if (!it) return;

      this.savedImagesDB
        .get(String(it.id))
        .then((record) => {
          if (!record || typeof record.id !== 'string') return;
          record.favorite = !record.favorite;
          return this.savedImagesDB.put(record);
        })
        .then(() => {
          this.renderSavedImages();
        })
        .catch(() => {});
    }

    initShapeActions() {
      if (this.saveShapeBtn && this.saveShapeBtn.dataset.bound !== '1') {
        this.saveShapeBtn.dataset.bound = '1';
        this.saveShapeBtn.addEventListener('click', () => {
          const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
          const selectedSet = new Set(this.getSelectedLayerIndices());
          if (Number.isFinite(this.activeLayerIndex) && this.activeLayerIndex >= 0) selectedSet.add(this.activeLayerIndex);

          // If the active layer belongs to a group, include the full group.
          if (Number.isFinite(this.activeLayerIndex) && this.activeLayerIndex >= 0) {
            const activeLayer = layers[this.activeLayerIndex];
            const activeGroupId = activeLayer && typeof activeLayer.groupId === 'string' && activeLayer.groupId.trim()
              ? activeLayer.groupId.trim()
              : '';
            if (activeGroupId) {
              for (let i = 0; i < layers.length; i++) {
                const layer = layers[i];
                if (layer && typeof layer.groupId === 'string' && layer.groupId === activeGroupId) {
                  selectedSet.add(i);
                }
              }
            }
          }

          const selected = Array.from(selectedSet);
          const selectedClipIndices = selected.filter((i) => {
            const layer = layers[i];
            return layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
          });

          const clipPathsN = [];
          const clipKeys = new Set();
          const addPoly = (poly, preferredKey) => {
            if (!Array.isArray(poly) || poly.length < 3) return;
            const nextPoly = poly
              .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
              .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
            if (nextPoly.length < 3) return;
            const key = typeof preferredKey === 'string' && preferredKey ? preferredKey : this.makeClipKey(nextPoly);
            if (key && clipKeys.has(String(key))) return;
            clipPathsN.push(nextPoly);
            if (key) clipKeys.add(String(key));
          };

          for (const idx of selectedClipIndices) {
            const layer = layers[idx];
            if (!layer) continue;
            addPoly(layer.clipPathN, layer.clipKey);
          }

          // Also include a pending active composite selection (saved group placement flow).
          if (Array.isArray(this.activeClipPathsN) && this.activeClipPathsN.length) {
            for (const poly of this.activeClipPathsN) addPoly(poly, null);
          }

          // Include a pending free single selection if it is not already present.
          const hasActiveFree = !(Number.isFinite(this.activeLayerIndex) && this.activeLayerIndex >= 0)
            && Array.isArray(this.activeClipPathN)
            && this.activeClipPathN.length >= 3;
          if (hasActiveFree) addPoly(this.activeClipPathN, this.activeClipKey);

          if (clipPathsN.length === 0) return;

          const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          if (clipPathsN.length >= 2) {
            const groupKey = JSON.stringify(clipPathsN);
            const record = {
              id,
              createdAt: Date.now(),
              kind: 'group',
              clipPathsN,
              clipKey: groupKey,
            };
            this.savedShapesDB.put(record).catch(() => {});
            if (this.rightView === 'shapes') this.renderSavedShapes();
            return;
          }

          const single = clipPathsN[0];
          const singleKey = this.makeClipKey(single);
          if (!singleKey) return;
          const record = {
            id,
            createdAt: Date.now(),
            kind: 'single',
            clipPathN: single,
            clipKey: singleKey,
          };
          this.savedShapesDB.put(record).catch(() => {});
          if (this.rightView === 'shapes') this.renderSavedShapes();
        });
      }

    if (this.deleteShapeBtn && this.deleteShapeBtn.dataset.bound !== '1') {
      this.deleteShapeBtn.dataset.bound = '1';
      this.deleteShapeBtn.addEventListener('click', () => {
        this.deleteSelectedSavedShape();
      });
    }
    }

    placeClipPathNAt(clipPathN, targetCxN, targetCyN) {
      if (!Array.isArray(clipPathN) || clipPathN.length < 3) return null;
      const clamp01 = (n) => Math.max(0, Math.min(1, n));

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of clipPathN) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = clamp01(Number(p[0]));
        const y = clamp01(Number(p[1]));
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      let dx = clamp01(Number(targetCxN)) - cx;
      let dy = clamp01(Number(targetCyN)) - cy;

      // Clamp translation to keep shape fully inside 0..1.
      const minDx = -minX;
      const maxDx = 1 - maxX;
      const minDy = -minY;
      const maxDy = 1 - maxY;
      dx = Math.max(minDx, Math.min(maxDx, dx));
      dy = Math.max(minDy, Math.min(maxDy, dy));

      const next = clipPathN
        .map((p) => [clamp01(Number(p[0]) + dx), clamp01(Number(p[1]) + dy)])
        .filter((p) => Array.isArray(p) && p.length === 2);
      return next.length >= 3 ? next : null;
    }

  placeClipPathsNAt(clipPathsN, targetCxN, targetCyN) {
    if (!Array.isArray(clipPathsN) || clipPathsN.length === 0) return null;
    const clamp01 = (n) => Math.max(0, Math.min(1, n));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const poly of clipPathsN) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      for (const p of poly) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = clamp01(Number(p[0]));
        const y = clamp01(Number(p[1]));
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let dx = clamp01(Number(targetCxN)) - cx;
    let dy = clamp01(Number(targetCyN)) - cy;

    // Clamp translation to keep all polygons fully inside 0..1.
    const minDx = -minX;
    const maxDx = 1 - maxX;
    const minDy = -minY;
    const maxDy = 1 - maxY;
    dx = Math.max(minDx, Math.min(maxDx, dx));
    dy = Math.max(minDy, Math.min(maxDy, dy));

    const out = [];
    for (const poly of clipPathsN) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      const nextPoly = poly
        .map((p) => [clamp01(Number(p[0]) + dx), clamp01(Number(p[1]) + dy)])
        .filter((p) => Array.isArray(p) && p.length === 2);
      if (nextPoly.length >= 3) out.push(nextPoly);
    }
    return out.length ? out : null;
  }

    clipPathNToPreviewDataUrl(clipPathN) {
      if (!Array.isArray(clipPathN) || clipPathN.length < 3) return '';
      const clamp01 = (n) => Math.max(0, Math.min(1, n));
      const pts = clipPathN
        .map((p) => {
          const x = Math.round(clamp01(Number(p[0])) * 1000) / 10;
          const y = Math.round(clamp01(Number(p[1])) * 1000) / 10;
          return `${x},${y}`;
        })
        .join(' ');

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="none"/><polygon points="${pts}" fill="none" stroke="#000" stroke-width="2"/></svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

  clipPathsNToPreviewDataUrl(clipPathsN) {
    if (!Array.isArray(clipPathsN) || clipPathsN.length === 0) return '';
    const clamp01 = (n) => Math.max(0, Math.min(1, n));
    const polys = [];
    for (const poly of clipPathsN) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      const pts = poly
        .map((p) => {
          const x = Math.round(clamp01(Number(p[0])) * 1000) / 10;
          const y = Math.round(clamp01(Number(p[1])) * 1000) / 10;
          return `${x},${y}`;
        })
        .join(' ');
      polys.push(`<polygon points="${pts}" fill="none" stroke="#000" stroke-width="2"/>`);
    }
    if (polys.length === 0) return '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="none"/>${polys.join('')}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

    renderSavedShapes() {
      if (!(this.savedShapesRoot instanceof HTMLElement)) return;
      this.savedShapesRoot.innerHTML = '';

      this.savedShapesDB
        .getAll()
        .then((items) => {
          const sorted = items
            .filter((it) => {
				if (!it || typeof it.id !== 'string') return false;
				if (Array.isArray(it.clipPathN) && it.clipPathN.length >= 3) return true;
				if (Array.isArray(it.clipPathsN) && it.clipPathsN.some((p) => Array.isArray(p) && p.length >= 3)) return true;
				return false;
			})
            .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

          this.savedShapesCache = sorted;
          if (this.selectedSavedShapeId && !sorted.some((it) => String(it.id) === String(this.selectedSavedShapeId))) {
            this.selectedSavedShapeId = '';
          }
          this.updateSavedShapesToolbarState();

          if (sorted.length === 0) {
            this.savedShapesRoot.textContent = 'Nog geen opgeslagen vormen.';
            return;
          }

          for (const it of sorted) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'saved-shapes__item';
            btn.setAttribute('aria-label', 'Opgeslagen vorm');
			const isGroup = Array.isArray(it.clipPathsN) && it.clipPathsN.length;
			btn.style.backgroundImage = isGroup
				? `url("${this.clipPathsNToPreviewDataUrl(it.clipPathsN)}")`
				: `url("${this.clipPathNToPreviewDataUrl(it.clipPathN)}")`;
      const isSelected = String(it.id) === String(this.selectedSavedShapeId);
      if (isSelected) btn.classList.add('is-selected');
            btn.draggable = true;
            btn.dataset.shapeId = it.id;
            btn.addEventListener('dragstart', (evt) => {
              if (!evt.dataTransfer) return;
              evt.dataTransfer.effectAllowed = 'copy';
              evt.dataTransfer.setData('application/x-ontwerpstudio2026-shape', String(it.id));
              evt.dataTransfer.setData('text/plain', String(it.id));
            });
			btn.addEventListener('pointerdown', (evt) => {
				this.startSavedItemPointerDrag(evt, btn, 'shape', String(it.id));
			});
            btn.addEventListener('click', () => {
				if (btn.dataset && btn.dataset.skipClick === '1') {
					btn.dataset.skipClick = '0';
					return;
				}
              const id = String(it.id);
              const wasSelected = id === String(this.selectedSavedShapeId);
              this.selectedSavedShapeId = id;

              // First tap selects (so you can delete). Second tap places on canvas.
              if (!wasSelected) {
                this.renderSavedShapes();
                return;
              }

              if (Array.isArray(it.clipPathsN) && it.clipPathsN.length) {
				const nextGroup = this.placeClipPathsNAt(it.clipPathsN, 0.5, 0.5) || it.clipPathsN;
				this.activeClipPathsN = nextGroup;
				this.activeClipPathN = null;
				this.activeClipKey = typeof it.clipKey === 'string' && it.clipKey ? it.clipKey : '';

                this.setInteractionMode('select');
                this.applyToActiveShapeGroup();
			  } else {
				const next = this.placeClipPathNAt(it.clipPathN, 0.5, 0.5) || it.clipPathN;
				this.activeClipPathN = next;
				this.activeClipPathsN = null;
				this.activeClipKey = typeof it.clipKey === 'string' && it.clipKey ? it.clipKey : this.makeClipKey(next);

                this.setInteractionMode('select');
                this.applyToActiveShape();
			  }

              this.renderSavedShapes();
              if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
              this.renderLayersList();
            });
            this.savedShapesRoot.appendChild(btn);
          }
        })
        .catch(() => {
          this.savedShapesRoot.textContent = 'Kan opgeslagen vormen niet laden.';
        });
    }

    getSelectedSavedShapeFromCache() {
      const id = typeof this.selectedSavedShapeId === 'string' ? this.selectedSavedShapeId : '';
      if (!id) return null;
      const items = Array.isArray(this.savedShapesCache) ? this.savedShapesCache : [];
      return items.find((it) => it && String(it.id) === String(id)) || null;
    }

    updateSavedShapesToolbarState() {
      const it = this.getSelectedSavedShapeFromCache();
      const has = !!it;
      if (this.deleteShapeBtn instanceof HTMLButtonElement) {
        this.deleteShapeBtn.disabled = !has;
      }
    }

    deleteSelectedSavedShape() {
      const it = this.getSelectedSavedShapeFromCache();
      if (!it) return;
      this.savedShapesDB
        .delete(String(it.id))
        .then(() => {
          this.selectedSavedShapeId = '';
          if (this.rightView === 'shapes') this.renderSavedShapes();
        })
        .catch(() => {});
    }

    initImageActions() {
      const bindCrop = (btn) => {
        if (!(btn instanceof HTMLButtonElement)) return;
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => {
          // Crop implies interaction/selection mode.
          this.setInteractionMode('select');
          this.toolMode = 'crop';

          // Crop selection should override any active shape/image selection.
          this.isDrawing = false;
          this.drawPointerId = null;
          this.drawPath = [];
          this.activeClipPathN = null;
          this.activeClipKey = null;
          this.setActiveLayerIndex(-1);

          this.isDraggingShape = false;
          this.dragPointerId = null;
          this.dragLayerIndex = -1;
          this.dragStartPos = null;
          this.dragStartClipPathN = null;
          this.dragPendingPos = null;
          if (this.dragRaf) {
            window.cancelAnimationFrame(this.dragRaf);
            this.dragRaf = 0;
          }

          this.isDraggingImage = false;
          this.imagePointerId = null;
          this.imageLayerIndex = -1;
          this.imageDragMode = '';
          this.imageStartPos = null;
          this.imageStartPlacement = null;

          // Start a new crop selection; the last crop is still shown until replaced.
          this.isCropping = false;
          this.cropPointerId = null;
          this.cropStartPos = null;
          this.cropPendingPos = null;
          this.cropRectPx = null;
          if (this.drawOverlay) this.drawOverlay.style.cursor = 'crosshair';

          this.renderLayersList();
          if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
        });
      };

      bindCrop(this.cropToolBtn);
      bindCrop(this.cropToolBtnRight);

	  const bindSave = (btn) => {
		if (!(btn instanceof HTMLButtonElement)) return;
		if (btn.dataset.bound === '1') return;
		btn.dataset.bound = '1';
		btn.addEventListener('click', () => {
			this.saveCurrentImage();
		});
	  };

	  bindSave(this.saveImageBtn);
	  bindSave(this.saveImageBtnRight);
    }

  updateAboutPublishTimestamp() {
    const el = this.aboutPublishTime;
    if (!(el instanceof HTMLElement)) return;

    // Show cached value immediately (useful offline).
    try {
      const cached = localStorage.getItem('ontwerpstudio2026:publishText');
      if (typeof cached === 'string' && cached.trim()) el.textContent = cached.trim();
    } catch (_) {
      // ignore
    }

    const formatNl = (iso) => {
      if (typeof iso !== 'string' || !iso.trim()) return '';
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return '';
      const tz = 'Europe/Amsterdam';
      const dateText = new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: tz,
      }).format(d);
      const timeText = new Intl.DateTimeFormat('nl-NL', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: tz,
      }).format(d);
      return `${dateText} ${timeText}`;
    };

    // Dynamic: use GitHub API so it updates automatically on each push.
    const url = 'https://api.github.com/repos/riastroes/Ontwerpstudio2026/commits/main';
    fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const iso =
          data && data.commit && data.commit.committer && typeof data.commit.committer.date === 'string'
            ? data.commit.committer.date
            : data && data.commit && data.commit.author && typeof data.commit.author.date === 'string'
              ? data.commit.author.date
              : '';
        const text = formatNl(iso);
        if (!text) return;
        el.textContent = text;
        try {
          localStorage.setItem('ontwerpstudio2026:publishText', text);
        } catch (_) {
          // ignore
        }
      })
      .catch(() => {
        // Keep cached/placeholder value.
      });
  }

    initLayerReorderDragDrop() {
      if (!(this.layersRoot instanceof HTMLElement)) return;
      if (this.layersRoot.dataset.dndBound === '1') return;
      this.layersRoot.dataset.dndBound = '1';

      const cleanupOver = () => {
        if (this.dragOverItem) {
          this.dragOverItem.classList.remove('is-drop-target');
          this.dragOverItem = null;
        }
      };

      this.layersRoot.addEventListener('dragstart', (evt) => {
        const target = evt.target instanceof HTMLElement ? evt.target : null;
        const item = target && typeof target.closest === 'function' ? target.closest('.layers__item') : null;
        if (!(item instanceof HTMLElement)) return;

        // Avoid starting a drag when interacting with buttons/inputs.
        if (target && (target.closest('button') || target.closest('input') || target.closest('select'))) {
          evt.preventDefault();
          return;
        }

        const v = Number(item.dataset.viewIndex);
        if (!Number.isFinite(v) || v < 0) {
          evt.preventDefault();
          return;
        }

        this.draggingLayerViewIndex = Math.trunc(v);
        item.classList.add('is-dragging');
        cleanupOver();

        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', String(this.draggingLayerViewIndex));
        }
      });

      this.layersRoot.addEventListener('dragover', (evt) => {
        if (this.draggingLayerViewIndex < 0) return;
        const target = evt.target instanceof HTMLElement ? evt.target : null;
        const item = target && typeof target.closest === 'function' ? target.closest('.layers__item') : null;
        if (!(item instanceof HTMLElement)) return;

        evt.preventDefault();
        if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';

        if (this.dragOverItem && this.dragOverItem !== item) {
          this.dragOverItem.classList.remove('is-drop-target');
        }
        this.dragOverItem = item;
        item.classList.add('is-drop-target');
      });

      this.layersRoot.addEventListener('drop', (evt) => {
        if (this.draggingLayerViewIndex < 0) return;
        const target = evt.target instanceof HTMLElement ? evt.target : null;
        const item = target && typeof target.closest === 'function' ? target.closest('.layers__item') : null;
        if (!(item instanceof HTMLElement)) return;

        evt.preventDefault();

        const fromV = this.draggingLayerViewIndex;
        const toVBase = Number(item.dataset.viewIndex);
        if (!Number.isFinite(toVBase) || toVBase < 0) return;

        const rect = item.getBoundingClientRect();
        const after = evt.clientY > rect.top + rect.height / 2;
        const toV = Math.trunc(toVBase) + (after ? 1 : 0);

        const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
        const activeRef = this.activeLayerIndex >= 0 ? layers[this.activeLayerIndex] : null;

        const changed = this.canvasLayers.reorderLayersByView(fromV, toV);
        if (changed) {
          const nextLayers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
          if (activeRef) {
            const nextIdx = nextLayers.indexOf(activeRef);
            this.activeLayerIndex = Number.isFinite(nextIdx) && nextIdx >= 0 ? nextIdx : -1;
          }
          this.syncActiveShapeToLayerIndex(this.activeLayerIndex);
          this.renderLayersList();
        }

        cleanupOver();
        this.draggingLayerViewIndex = -1;
      });

      this.layersRoot.addEventListener('dragend', (evt) => {
        const target = evt.target instanceof HTMLElement ? evt.target : null;
        const item = target && typeof target.closest === 'function' ? target.closest('.layers__item') : null;
        if (item instanceof HTMLElement) item.classList.remove('is-dragging');
        cleanupOver();
        this.draggingLayerViewIndex = -1;
      });
    }

    saveCurrentImage() {
      if (!(this.canvas instanceof HTMLCanvasElement)) return;
      const src = this.canvas;
      const sw = Math.max(1, src.width);
      const sh = Math.max(1, src.height);

      const hasActiveClip = Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 3;

      const clearCropSelection = () => {
        this.cropRectN = null;
        this.cropRectPx = null;
        if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
      };

      const out = document.createElement('canvas');
      const ctx = out.getContext('2d');
      if (!ctx) return;

      let usedCropRect = false;

      if (hasActiveClip) {
        // Export only the selected (clipped) part.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of this.activeClipPathN) {
          if (!Array.isArray(p) || p.length < 2) continue;
          const xN = Math.max(0, Math.min(1, Number(p[0])));
          const yN = Math.max(0, Math.min(1, Number(p[1])));
          const x = xN * sw;
          const y = yN * sh;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }

        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;

        const bx = Math.max(0, Math.min(sw - 1, Math.floor(minX)));
        const by = Math.max(0, Math.min(sh - 1, Math.floor(minY)));
        const ex = Math.max(bx + 1, Math.min(sw, Math.ceil(maxX)));
        const ey = Math.max(by + 1, Math.min(sh, Math.ceil(maxY)));
        const bw = Math.max(1, ex - bx);
        const bh = Math.max(1, ey - by);

        out.width = bw;
        out.height = bh;

        ctx.save();
        ctx.translate(-bx, -by);
        ctx.beginPath();
        const pts = this.activeClipPathN;
        ctx.moveTo(Math.max(0, Math.min(1, pts[0][0])) * sw, Math.max(0, Math.min(1, pts[0][1])) * sh);
        for (let i = 1; i < pts.length; i++) {
          const q = pts[i];
          if (!Array.isArray(q) || q.length < 2) continue;
          const x = Math.max(0, Math.min(1, Number(q[0]))) * sw;
          const y = Math.max(0, Math.min(1, Number(q[1]))) * sh;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(src, 0, 0);
        ctx.restore();
      } else {
        // Default export: crop-rect if present, otherwise full canvas.
        let sx = 0;
        let sy = 0;
        let sWidth = sw;
        let sHeight = sh;

        const cr = this.cropRectN;
        if (cr && Number.isFinite(cr.x) && Number.isFinite(cr.y) && Number.isFinite(cr.w) && Number.isFinite(cr.h)) {
          usedCropRect = true;
          sx = Math.max(0, Math.min(sw - 1, Math.round(cr.x * sw)));
          sy = Math.max(0, Math.min(sh - 1, Math.round(cr.y * sh)));
          sWidth = Math.max(1, Math.min(sw - sx, Math.round(cr.w * sw)));
          sHeight = Math.max(1, Math.min(sh - sy, Math.round(cr.h * sh)));
        }

        out.width = sWidth;
        out.height = sHeight;
        ctx.drawImage(src, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
      }

        // --- Toevoeging: na croppen, maak PNG, wis lagen, zet PNG als enige laag ---
        if (usedCropRect || hasActiveClip) {
          try {
            const dataUrl = out.toDataURL('image/png');
            // Wis alle lagen
            if (this.canvasLayers && typeof this.canvasLayers.clearAllLayers === 'function') {
              this.canvasLayers.clearAllLayers();
            }
            // Maak nieuwe Image-laag
            const img = new window.Image();
            img.onload = () => {
              // Voeg als nieuwe laag toe
              if (this.canvasLayers && typeof this.canvasLayers.layers === 'object') {
                const layer = {
                  kind: 'image',
                  image: img,
                  w: out.width,
                  h: out.height,
                  x: 0,
                  y: 0,
                  isBackground: true
                };
                this.canvasLayers.layers = [layer];
                if (typeof this.canvasLayers.redrawAllLayers === 'function') {
                  this.canvasLayers.redrawAllLayers();
                }
              }
            };
            img.src = dataUrl;
          } catch (e) {
            // fallback: doe niets
          }
        }
      const concept = this.getConceptValue();
      const description = this.getDescriptionValue();
      const stem = this.sanitizeFileStem(concept) || 'ontwerpstudio-2026';
      const fileName = `${stem}.png`;

    const downloadBlob = (blob, name) => {
      if (!(blob instanceof Blob)) return;
      const safeName = typeof name === 'string' && name.trim() ? name.trim() : 'ontwerpstudio-2026.png';
      try {
		this.offerBlobToUser(blob, safeName, { preferShare: false }).catch(() => false);
      } catch (_) {}
    };

      const saveBlob = (blob) => {
        if (!(blob instanceof Blob)) return;
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const record = {
          id,
          createdAt: Date.now(),
          w: out.width,
          h: out.height,
          fileName,
          concept,
          description,
          favorite: false,
          blob,
        };

      // Persist and refresh the Images view (no auto-PDF generation).
      this.savedImagesDB
        .put(record)
        .then(() => {
          if (this.rightView === 'images') this.renderSavedImages();
          // After saving a cropped export, remove the crop grid.
          if (usedCropRect) clearCropSelection();
        })
        .catch(() => {
          // Common on iPad: quota exceeded / IndexedDB blocked.
          // Fall back to downloading the PNG so the user can still save.
          try {
            this.savedImagesDB.dbPromise = null;
          } catch (_) {}
          downloadBlob(blob, fileName);
          if (usedCropRect) clearCropSelection();
        });
      };

      const showExportError = (msg) => {
        alert(msg || 'Exporteren mislukt. Probeer het opnieuw of reset de app.');
      };

      const resetAfterExportError = () => {
        try {
          if (window && typeof window.location === 'object') {
            // Hard reload to clear tainted canvas/caches
            window.location.reload();
          }
        } catch (_) {}
      };

      if (typeof out.toBlob === 'function') {
        out.toBlob((blob) => {
          if (blob instanceof Blob) {
            saveBlob(blob);
            return;
          }
          // iOS/Safari can occasionally return null; fall back to a dataURL conversion.
          try {
            const dataUrl = out.toDataURL('image/png');
            fetch(dataUrl)
              .then((res) => res.blob())
              .then((b) => {
                if (b instanceof Blob) saveBlob(b);
                else {
                  showExportError('Exporteren mislukt (canvas is "besmet"). De app wordt opnieuw geladen.');
                  resetAfterExportError();
                }
              })
              .catch(() => {
                showExportError('Exporteren mislukt (canvas is "besmet"). De app wordt opnieuw geladen.');
                resetAfterExportError();
              });
          } catch (_) {
            showExportError('Exporteren mislukt (canvas is "besmet"). De app wordt opnieuw geladen.');
            resetAfterExportError();
          }
        }, 'image/png');
        return;
      }

      // Fallback for older browsers.
      try {
        const dataUrl = out.toDataURL('image/png');
        fetch(dataUrl)
          .then((res) => res.blob())
          .then((blob) => {
            saveBlob(blob);
          })
          .catch(() => {
            showExportError('Exporteren mislukt (canvas is "besmet"). De app wordt opnieuw geladen.');
            resetAfterExportError();
          });
      } catch (_) {
        showExportError('Exporteren mislukt (canvas is "besmet"). De app wordt opnieuw geladen.');
        resetAfterExportError();
      }
    }

    makeClipKey(pathN) {
      if (!Array.isArray(pathN) || pathN.length < 3) return null;
      const round = (n) => Math.round(n * 1000) / 1000;
      const cleaned = pathN
        .map((p) => (Array.isArray(p) && p.length >= 2 ? [round(Number(p[0])), round(Number(p[1]))] : null))
        .filter(Boolean);
      if (cleaned.length < 3) return null;
      return JSON.stringify(cleaned);
    }

    applyToActiveShape() {
      const hasActive = Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 3;
      if (!hasActive) return;

      const clipKey = this.activeClipKey || this.makeClipKey(this.activeClipPathN);
      if (!clipKey) return;

      let idx = -1;
      if (this.currentFile) {
        idx = this.canvasLayers.addClippedLayer(
          this.currentFile,
          this.getRepeatCount(),
          this.currentColor,
          this.getThickness(),
          this.activeClipPathN,
          this.currentTileScaleMode,
          clipKey
        );
      } else {
        idx = this.canvasLayers.addClippedSolidLayer(
          this.currentColor,
          this.activeClipPathN,
          clipKey
        );
      }

      this.setLayerSelectionSingle(idx);
      this.renderLayersList();

      // Re-render once the async pixel-based visible-colors computation finishes.
      const token = ++this.visibleColorsRenderToken;
      this.canvasLayers.getLatestVisibleColorsPromise(idx)
        .then(() => {
          if (token !== this.visibleColorsRenderToken) return;
          this.renderLayersList();
        })
        .catch(() => {});
    }

  applyToActiveShapeGroup() {
    const clipPathsN = Array.isArray(this.activeClipPathsN) ? this.activeClipPathsN : null;
    if (!clipPathsN || clipPathsN.length === 0) return;

    const cleaned = clipPathsN
      .map((poly) => {
        if (!Array.isArray(poly) || poly.length < 3) return null;
        const out = poly
          .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
          .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        return out.length >= 3 ? out : null;
      })
      .filter(Boolean);
    if (cleaned.length === 0) return;

    const groupId = `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const indices = [];

    for (const poly of cleaned) {
      const clipKey = this.makeClipKey(poly);
      if (!clipKey) continue;
      let idx = -1;
      if (this.currentFile) {
        idx = this.canvasLayers.addClippedLayer(
          this.currentFile,
          this.getRepeatCount(),
          this.currentColor,
          this.getThickness(),
          poly,
          this.currentTileScaleMode,
          clipKey
        );
      } else {
        idx = this.canvasLayers.addClippedSolidLayer(this.currentColor, poly, clipKey);
      }

      if (Number.isFinite(idx) && idx >= 0) {
        const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
        const layer = layers[idx];
        if (layer) layer.groupId = groupId;
        indices.push(idx);
      }
    }

    if (indices.length === 0) return;

    // Group placement adds multiple layers in one burst; each add schedules drawing.
    // Force one full redraw so early layers are not skipped by timer replacement.
    if (this.canvasLayers && typeof this.canvasLayers.redrawAllLayers === 'function') {
      this.canvasLayers.redrawAllLayers();
    }

    this.selectedLayerIndices = new Set(indices);
    const activeIdx = indices[0];
    this.setActiveLayerIndex(activeIdx);
    this.syncActiveShapeToLayerIndex(activeIdx);
    this.renderLayersList();
  }

  applyTextureToActiveShape() {
    const hasActive = Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 3;
    if (!hasActive) return;

    const clipKey = this.activeClipKey || this.makeClipKey(this.activeClipPathN);
    if (!clipKey) return;

    if (!this.currentTextureId) {
      this.applyToActiveShape();
      return;
    }

    const idx = this.canvasLayers.addClippedTextureLayer(
      this.currentTextureId,
      this.getTextureRepeatCount(),
      this.currentColor,
      this.activeClipPathN,
      this.currentTextureTileScaleMode,
      clipKey,
      this.getCurrentTexturePaletteCss()
    );

    this.setLayerSelectionSingle(idx);
    this.renderLayersList();

    const token = ++this.visibleColorsRenderToken;
    this.canvasLayers.getLatestVisibleColorsPromise(idx)
      .then(() => {
        if (token !== this.visibleColorsRenderToken) return;
        this.renderLayersList();
      })
      .catch(() => {});
  }

  applyTextureToActiveShapeGroup() {
    const clipPathsN = Array.isArray(this.activeClipPathsN) ? this.activeClipPathsN : null;
    if (!clipPathsN || clipPathsN.length === 0) return;
    if (!this.currentTextureId) {
      this.applyToActiveShapeGroup();
      return;
    }

    const cleaned = clipPathsN
      .map((poly) => {
        if (!Array.isArray(poly) || poly.length < 3) return null;
        const out = poly
          .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
          .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        return out.length >= 3 ? out : null;
      })
      .filter(Boolean);
    if (cleaned.length === 0) return;

    const groupId = `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const indices = [];

    for (const poly of cleaned) {
      const clipKey = this.makeClipKey(poly);
      if (!clipKey) continue;
      const idx = this.canvasLayers.addClippedTextureLayer(
        this.currentTextureId,
        this.getTextureRepeatCount(),
        this.currentColor,
        poly,
        this.currentTextureTileScaleMode,
        clipKey,
        this.getCurrentTexturePaletteCss()
      );
      if (Number.isFinite(idx) && idx >= 0) {
        const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
        const layer = layers[idx];
        if (layer) layer.groupId = groupId;
        indices.push(idx);
      }
    }

    if (indices.length === 0) return;

    // Group placement adds multiple layers in one burst; each add schedules drawing.
    // Force one full redraw so early layers are not skipped by timer replacement.
    if (this.canvasLayers && typeof this.canvasLayers.redrawAllLayers === 'function') {
      this.canvasLayers.redrawAllLayers();
    }

    this.selectedLayerIndices = new Set(indices);
    const activeIdx = indices[0];
    this.setActiveLayerIndex(activeIdx);
    this.syncActiveShapeToLayerIndex(activeIdx);
    this.renderLayersList();
  }

    syncActiveShapeToLayerIndex(layerIndex) {
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
      const layer = layers[layerIndex];

	  // A layer-driven selection overrides any pending multi-clip (saved group) placement.
	  this.activeClipPathsN = null;

      if (layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3) {
        this.activeClipPathN = layer.clipPathN.slice();
        this.activeClipKey = typeof layer.clipKey === 'string' && layer.clipKey ? layer.clipKey : this.makeClipKey(this.activeClipPathN);
      } else {
        this.activeClipPathN = null;
        this.activeClipKey = null;
      }

      if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
    }

    setLayerSelectionSingle(layerIndex) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      if (idx < 0) {
        this.selectedLayerIndices = new Set();
        this.setActiveLayerIndex(-1);
        this.syncActiveShapeToLayerIndex(-1);
        return;
      }

    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const layer = layers[idx];
    const groupId = layer && typeof layer.groupId === 'string' && layer.groupId.trim() ? layer.groupId.trim() : '';

    if (groupId) {
      const groupIndices = [];
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (l && typeof l.groupId === 'string' && l.groupId === groupId) groupIndices.push(i);
      }
      this.selectedLayerIndices = new Set(groupIndices.length ? groupIndices : [idx]);
    } else {
      this.selectedLayerIndices = new Set([idx]);
    }

    this.setActiveLayerIndex(idx);
    this.syncActiveShapeToLayerIndex(idx);
    }

    toggleLayerSelection(layerIndex) {
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
      const n = layers.length;
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      if (idx < 0 || idx >= n) return;

    const layer = layers[idx];
    const groupId = layer && typeof layer.groupId === 'string' && layer.groupId.trim() ? layer.groupId.trim() : '';
    const groupIndices = [];
    if (groupId) {
      for (let i = 0; i < n; i++) {
        const l = layers[i];
        if (l && typeof l.groupId === 'string' && l.groupId === groupId) groupIndices.push(i);
    		}
    }

      const next = new Set(this.selectedLayerIndices);
    if (groupId && groupIndices.length) {
      const anySelected = groupIndices.some((i) => next.has(i));
      if (anySelected) {
        for (const i of groupIndices) next.delete(i);
      } else {
        for (const i of groupIndices) next.add(i);
      }
    } else {
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
    }

      // Never allow ending up with no selected layers via toggling.
      // (Prevents deselect by clicking the checkbox off.)
      if (next.size === 0) {
        next.add(idx);
      }

      this.selectedLayerIndices = next;

      // Make the toggled layer the primary active layer.
      this.setActiveLayerIndex(idx);
      this.syncActiveShapeToLayerIndex(idx);
    }

    getSelectedLayerIndices() {
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
      const n = layers.length;
      const set = this.selectedLayerIndices instanceof Set ? this.selectedLayerIndices : new Set();
      return Array.from(set)
        .map((i) => (Number.isFinite(i) ? Math.trunc(i) : -1))
        .filter((i) => i >= 0 && i < n);
    }

    scheduleUpdateSelectedLayersPatternParams(nextParams) {
      const params = nextParams && typeof nextParams === 'object' ? nextParams : null;
      if (!params) return;

      if (!this.pendingGroupPatternParams) this.pendingGroupPatternParams = {};
      if (Number.isFinite(params.repeatCount)) this.pendingGroupPatternParams.repeatCount = Math.trunc(params.repeatCount);
      if (Number.isFinite(params.thickness)) this.pendingGroupPatternParams.thickness = Math.trunc(params.thickness);
	  this.pendingGroupPatternParams.kindFilter = params.kindFilter === 'texture' ? 'texture' : 'pattern';

      if (this.pendingGroupParamRaf) return;
      this.pendingGroupParamRaf = window.requestAnimationFrame(() => {
        this.pendingGroupParamRaf = 0;
        const p = this.pendingGroupPatternParams;
        this.pendingGroupPatternParams = null;
        if (!p) return;
        this.updateSelectedLayersPatternParams(p);
      });
    }

    updateSelectedLayersPatternParams(params) {
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
      const indices = this.getSelectedLayerIndices();
      if (indices.length === 0) return;

      const hasRepeat = Number.isFinite(params.repeatCount);
      const hasThickness = Number.isFinite(params.thickness);
	  const kindFilter = params.kindFilter === 'texture' ? 'texture' : 'pattern';
    const textureRepeat = kindFilter === 'texture' && hasRepeat
    ? Math.max(1, Math.min(10, Math.round(params.repeatCount)))
    : null;

      let touchedAny = false;
      for (const idx of indices) {
        const layer = layers[idx];
        if (!layer) continue;
        const paints = Array.isArray(layer.paints) ? layer.paints : [];
        let touched = false;
        for (const paint of paints) {
          if (!paint) continue;
          if (paint.kind === 'image') continue;
          if (paint.kind === 'solid') continue;

      if (kindFilter === 'texture') {
      if (paint.kind !== 'texture') continue;
      if (!(typeof paint.textureId === 'string' && paint.textureId.trim())) continue;
	  if (hasRepeat) paint.repeatCount = textureRepeat;
      touched = true;
      continue;
      }

      // Patterns
      if (!(typeof paint.file === 'string' && paint.file.trim())) continue;
      if (hasRepeat) paint.repeatCount = params.repeatCount;
      if (hasThickness) paint.thickness = params.thickness;
      touched = true;
        }

        if (touched && typeof this.canvasLayers.scheduleVisibleColorsCompute === 'function') {
          const clipPathN = Array.isArray(layer.clipPathN) ? layer.clipPathN : null;
          if (clipPathN && clipPathN.length >= 3) this.canvasLayers.scheduleVisibleColorsCompute(idx);
        }

        touchedAny = touchedAny || touched;
      }

      if (!touchedAny) return;

      this.canvasLayers.redrawAllLayers();
      this.renderLayersList();

      // Refresh once async visible-colors computations finish.
      const token = ++this.visibleColorsRenderToken;
      Promise.all(indices.map((i) => this.canvasLayers.getLatestVisibleColorsPromise(i).catch(() => {})))
        .then(() => {
          if (token !== this.visibleColorsRenderToken) return;
          this.renderLayersList();
        })
        .catch(() => {});
    }

    setActiveLayerIndex(nextIndex) {
      const n = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers.length : 0;
      if (!Number.isFinite(nextIndex)) return;
      const raw = Math.trunc(nextIndex);
      if (raw < 0 || n <= 0) {
        this.activeLayerIndex = -1;

        // Keep multi-select state consistent.
        this.selectedLayerIndices = new Set();
        return;
      }
      const idx = Math.max(0, Math.min(n - 1, raw));
      this.activeLayerIndex = idx;

      // Keep selection consistent with the UI highlight.
      if (!(this.selectedLayerIndices instanceof Set)) this.selectedLayerIndices = new Set();
      this.selectedLayerIndices.add(idx);
    }

    removeLayerIndex(layerIndex) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      const n = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers.length : 0;
      if (idx < 0 || idx >= n) return;

      const removed = this.canvasLayers.removeLayerAt(idx);
      if (!removed) return;

      const nextN = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers.length : 0;
      if (nextN <= 0) {
        this.activeLayerIndex = -1;
        this.activeClipPathN = null;
        this.activeClipKey = null;
        if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
        this.renderLayersList();
        return;
      }

      let nextActive = this.activeLayerIndex;
      if (idx < nextActive) nextActive -= 1;
      else if (idx === nextActive) nextActive = Math.min(idx, nextN - 1);
      this.activeLayerIndex = Math.max(0, Math.min(nextN - 1, nextActive));
      this.syncActiveShapeToLayerIndex(this.activeLayerIndex);

      // Keep selection consistent.
      this.selectedLayerIndices = new Set([this.activeLayerIndex]);
      this.renderLayersList();
    }

    removeColorFromLayerIndex(layerIndex, color) {
      const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
      const c = typeof color === 'string' && color.trim() ? color.trim() : '';
      if (idx < 0 || !c) return;

      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
      const layer = layers[idx];
      if (!layer) return;

      const paints = Array.isArray(layer.paints) ? layer.paints : [];
      const nextPaints = paints.filter((p) => {
        const pc = p && typeof p.color === 'string' && p.color.trim() ? p.color.trim() : '';
        return pc !== c;
      });

      if (nextPaints.length === 0) {
        this.removeLayerIndex(idx);
        return;
      }

      layer.paints = nextPaints;

      if (Array.isArray(layer.visibleColors)) {
        layer.visibleColors = layer.visibleColors.filter((x) => (typeof x === 'string' ? x.trim() : '') !== c);
      }

      this.canvasLayers.redrawAllLayers();

      const hasClip = Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
      if (hasClip) {
        this.canvasLayers.scheduleVisibleColorsCompute(idx)
          .then(() => this.renderLayersList())
          .catch(() => {});
      }

      this.renderLayersList();
    }

    applySolidToSelectedLayerOrCanvas() {
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];

      const selected = this.getSelectedLayerIndices();
      if (selected.length > 0) {
        const c = typeof this.currentColor === 'string' && this.currentColor.trim() ? this.currentColor.trim() : '#000000';
        const clippedTouched = [];

        for (const idx of selected) {
          const layer = layers[idx];
          if (!layer) continue;
          if (!Array.isArray(layer.paints)) layer.paints = [];

          const hasClip = Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
          layer.paints.push({ kind: 'solid', file: null, color: c });

          if (hasClip) {
            if (typeof this.canvasLayers.addOptimisticVisibleColor === 'function') {
              this.canvasLayers.addOptimisticVisibleColor(layer, c);
            }
            clippedTouched.push(idx);
          } else {
            layer.visibleColors = [c];
          }
        }

        // Group-apply touches multiple layers; force a full redraw.
        this.canvasLayers.redrawAllLayers();
        this.renderLayersList();

        const token = ++this.visibleColorsRenderToken;
        for (const idx of clippedTouched) {
          if (typeof this.canvasLayers.scheduleVisibleColorsCompute === 'function') {
            this.canvasLayers.scheduleVisibleColorsCompute(idx).catch(() => {});
          }
        }
        Promise.all(selected.map((i) => this.canvasLayers.getLatestVisibleColorsPromise(i).catch(() => {})))
          .then(() => {
            if (token !== this.visibleColorsRenderToken) return;
            this.renderLayersList();
          })
          .catch(() => {});
        return;
      }

      if (this.activeLayerIndex >= 0 && this.activeLayerIndex < layers.length) {
        const layer = layers[this.activeLayerIndex];
        const paints = layer && Array.isArray(layer.paints) ? layer.paints : [];
        const isImageLayer = paints.some((p) => p && p.kind === 'image' && p.blob instanceof Blob);
        if (isImageLayer) {
          this.applySolidToBackground();
          this.renderLayersList();
          return;
        }
        const hasClip = layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;

        if (hasClip) {
          const clipPathN = layer.clipPathN;
          const clipKey = typeof layer.clipKey === 'string' && layer.clipKey
            ? layer.clipKey
            : this.makeClipKey(clipPathN);

          const idx = this.canvasLayers.addClippedSolidLayer(this.currentColor, clipPathN, clipKey);
          this.setActiveLayerIndex(idx);
          this.syncActiveShapeToLayerIndex(idx);
          this.renderLayersList();

          const token = ++this.visibleColorsRenderToken;
          this.canvasLayers.getLatestVisibleColorsPromise(idx)
            .then(() => {
              if (token !== this.visibleColorsRenderToken) return;
              this.renderLayersList();
            })
            .catch(() => {});
          return;
        }

        this.canvasLayers.addSolidPaintToLayerIndex(this.activeLayerIndex, this.currentColor);
        this.renderLayersList();
        return;
      }

      // No selection: apply to background.
      this.applySolidToBackground();
      this.renderLayersList();
    }

  getBackgroundLayerIndex() {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    if (layers.length === 0) return -1;

    const flagged = layers.findIndex((l) => l && l.isBackground === true);
    if (flagged >= 0) return flagged;

    const layer = layers[0];
    if (this.canvasLayers && typeof this.canvasLayers.looksLikeBackgroundLayer === 'function') {
      return this.canvasLayers.looksLikeBackgroundLayer(layer) ? 0 : -1;
    }

    const hasClip = layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
    if (hasClip) return -1;
    const paints = layer && Array.isArray(layer.paints) ? layer.paints : [];
    const hasImage = paints.some((p) => p && p.kind === 'image' && p.blob instanceof Blob);
    return hasImage ? -1 : 0;
  }

  ensureBackgroundLayerExistsAsSolid(color) {
    const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
    if (!this.canvasLayers || !Array.isArray(this.canvasLayers.layers)) return;

    // We insert a new layer at model index 0; shift indices so selection stays on the same logical layer.
    const prevActive = Number.isFinite(this.activeLayerIndex) ? Math.trunc(this.activeLayerIndex) : -1;
    const prevSelected = this.selectedLayerIndices instanceof Set ? new Set(this.selectedLayerIndices) : new Set();

    this.canvasLayers.layers.unshift({
	  isBackground: true,
      clipPathN: null,
      clipKey: null,
      paints: [{ kind: 'solid', file: null, color: c }],
      visibleColors: [c],
    });

    if (prevSelected.size) {
      this.selectedLayerIndices = new Set(Array.from(prevSelected).map((i) => (Number.isFinite(i) ? Math.trunc(i) + 1 : -1)).filter((i) => i >= 0));
    }
    if (prevActive >= 0) {
      this.setActiveLayerIndex(prevActive + 1);
      this.syncActiveShapeToLayerIndex(prevActive + 1);
    }

    if (typeof this.canvasLayers.cancelAllVisibleColorsSchedules === 'function') {
      this.canvasLayers.cancelAllVisibleColorsSchedules();
    }
    this.canvasLayers.redrawAllLayers();
  }

  ensureBackgroundLayerExistsAsPattern(file, repeatCount, color, thickness) {
    const f = typeof file === 'string' ? file.trim() : '';
    if (!f) return;
    const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
    if (!this.canvasLayers || !Array.isArray(this.canvasLayers.layers)) return;

    // We insert a new layer at model index 0; shift indices so selection stays on the same logical layer.
    const prevActive = Number.isFinite(this.activeLayerIndex) ? Math.trunc(this.activeLayerIndex) : -1;
    const prevSelected = this.selectedLayerIndices instanceof Set ? new Set(this.selectedLayerIndices) : new Set();

    this.canvasLayers.layers.unshift({
	  isBackground: true,
      clipPathN: null,
      clipKey: null,
      paints: [{ file: f, repeatCount, color: c, thickness, tileScaleMode: 'canvas' }],
    });

    if (prevSelected.size) {
      this.selectedLayerIndices = new Set(Array.from(prevSelected).map((i) => (Number.isFinite(i) ? Math.trunc(i) + 1 : -1)).filter((i) => i >= 0));
    }
    if (prevActive >= 0) {
      this.setActiveLayerIndex(prevActive + 1);
      this.syncActiveShapeToLayerIndex(prevActive + 1);
    }

    if (typeof this.canvasLayers.cancelAllVisibleColorsSchedules === 'function') {
      this.canvasLayers.cancelAllVisibleColorsSchedules();
    }
    this.canvasLayers.redrawAllLayers();
  }

  ensureBackgroundLayerExistsAsTexture(textureId, repeatCount, color, paletteCss) {
    const id = typeof textureId === 'string' ? textureId.trim() : '';
    if (!id) return;
    const c = typeof color === 'string' && color.trim() ? color.trim() : '#000000';
	const rc = Number.isFinite(repeatCount) ? Math.max(1, Math.min(10, Math.round(repeatCount))) : 10;
    if (!this.canvasLayers || !Array.isArray(this.canvasLayers.layers)) return;

    const palette = Array.isArray(paletteCss) && paletteCss.length
      ? paletteCss.filter((p) => typeof p === 'string' && p.trim()).slice(0, 4)
      : [c, c, c, c];
    while (palette.length < 4) palette.push(palette[palette.length - 1] || c);

    const prevActive = Number.isFinite(this.activeLayerIndex) ? Math.trunc(this.activeLayerIndex) : -1;
    const prevSelected = this.selectedLayerIndices instanceof Set ? new Set(this.selectedLayerIndices) : new Set();

    this.canvasLayers.layers.unshift({
      isBackground: true,
      clipPathN: null,
      clipKey: null,
	  paints: [{ kind: 'texture', textureId: id, repeatCount: rc, color: c, tileScaleMode: 'canvas', palette }],
    });

    if (prevSelected.size) {
      this.selectedLayerIndices = new Set(
        Array.from(prevSelected)
          .map((i) => (Number.isFinite(i) ? Math.trunc(i) + 1 : -1))
          .filter((i) => i >= 0)
      );
    }
    if (prevActive >= 0) {
      this.setActiveLayerIndex(prevActive + 1);
      this.syncActiveShapeToLayerIndex(prevActive + 1);
    }

    if (typeof this.canvasLayers.cancelAllVisibleColorsSchedules === 'function') {
      this.canvasLayers.cancelAllVisibleColorsSchedules();
    }
    this.canvasLayers.redrawAllLayers();
  }

  applySolidToBackground() {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const bgIdx = this.getBackgroundLayerIndex();
    if (bgIdx >= 0) {
	  const layer = layers[bgIdx];
	  if (layer && typeof layer === 'object') layer.isBackground = true;
      this.canvasLayers.addSolidPaintToLayerIndex(bgIdx, this.currentColor);
      return;
    }
    this.ensureBackgroundLayerExistsAsSolid(this.currentColor);
  }

  applyPatternToBackground() {
    const f = typeof this.currentFile === 'string' ? this.currentFile.trim() : '';
    if (!f) {
      this.applySolidToBackground();
      return;
    }

    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const bgIdx = this.getBackgroundLayerIndex();
    if (bgIdx >= 0) {
	  const layer = layers[bgIdx];
	  if (layer && typeof layer === 'object') layer.isBackground = true;
      this.canvasLayers.addPatternPaintToLayerIndex(
        bgIdx,
        f,
        this.getRepeatCount(),
        this.currentColor,
        this.getThickness(),
        'canvas'
      );
      return;
    }

    this.ensureBackgroundLayerExistsAsPattern(
      f,
      this.getRepeatCount(),
      this.currentColor,
      this.getThickness()
    );
  }

  applyTextureToBackground() {
    const id = typeof this.currentTextureId === 'string' ? this.currentTextureId.trim() : '';
    if (!id) {
      this.applySolidToBackground();
      return;
    }

    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const bgIdx = this.getBackgroundLayerIndex();
    if (bgIdx >= 0) {
      const layer = layers[bgIdx];
      if (layer && typeof layer === 'object') layer.isBackground = true;
      this.canvasLayers.addTexturePaintToLayerIndex(
        bgIdx,
        id,
        this.getTextureRepeatCount(),
        this.currentColor,
        'canvas',
        this.getCurrentTexturePaletteCss()
      );
      return;
    }

    this.ensureBackgroundLayerExistsAsTexture(id, this.getTextureRepeatCount(), this.currentColor, this.getCurrentTexturePaletteCss());
  }

    renderLayersList() {
      if (!(this.layersRoot instanceof HTMLElement)) return;
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
	  this.clearLayerThumbObjectUrls();

    const renderTextureThumbToCanvas = (canvas, img, repeatCount) => {
      if (!(canvas instanceof HTMLCanvasElement)) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cssW = Math.max(1, canvas.getBoundingClientRect().width || 22);
      const cssH = Math.max(1, canvas.getBoundingClientRect().height || 22);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(0, 0, cssW, cssH);

      if (!img) return;
      const pattern = ctx.createPattern(img, 'repeat');
      if (!pattern) return;

      const iw = Math.max(1, img.naturalWidth || img.width || 1);
      const ih = Math.max(1, img.naturalHeight || img.height || 1);

      const rc = Number.isFinite(repeatCount) ? Math.max(1, Math.min(100, Math.round(repeatCount))) : 10;
      const repeats = Math.max(2, Math.min(10, Math.round(Math.sqrt(rc))));
      const tileSize = Math.max(2, cssW / repeats);
      const sx = Math.max(0.0001, tileSize / iw);
      const sy = Math.max(0.0001, tileSize / ih);

      ctx.save();
      ctx.scale(sx, sy);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, cssW / sx, cssH / sy);
      ctx.restore();
    };

      this.layersRoot.innerHTML = '';
      const selectedSet = this.selectedLayerIndices instanceof Set ? this.selectedLayerIndices : new Set();

      const addLayerToSelection = (layerIndex) => {
        const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
        if (idx < 0 || idx >= layers.length) return;
        const layer = layers[idx];
        const groupId = layer && typeof layer.groupId === 'string' && layer.groupId.trim() ? layer.groupId.trim() : '';
        const next = new Set(this.selectedLayerIndices instanceof Set ? this.selectedLayerIndices : []);
        if (groupId) {
          for (let i = 0; i < layers.length; i++) {
            const l = layers[i];
            if (l && typeof l.groupId === 'string' && l.groupId === groupId) next.add(i);
          }
        } else {
          next.add(idx);
        }
        this.selectedLayerIndices = next;
        this.setActiveLayerIndex(idx);
        this.syncActiveShapeToLayerIndex(idx);
      };

      const handleLayerListClick = (layerIndex) => {
        this.setInteractionMode('select');
        const idx = Number.isFinite(layerIndex) ? Math.trunc(layerIndex) : -1;
        if (idx < 0) return;
        const cur = this.selectedLayerIndices instanceof Set ? this.selectedLayerIndices : new Set();
        if (cur.has(idx)) {
          // If multiple are selected, clicking one focuses it (single selection).
          if (cur.size > 1) this.setLayerSelectionSingle(idx);
          else {
            this.setActiveLayerIndex(idx);
            this.syncActiveShapeToLayerIndex(idx);
          }
        } else {
          // Add without requiring Shift.
          addLayerToSelection(idx);
        }
        this.renderLayersList();
      };

      // Newest layer first (top of list).
      for (let viewIndex = 0; viewIndex < layers.length; viewIndex++) {

        const i = layers.length - 1 - viewIndex; // model index
        const layer = layers[i] || {};
        const isBg = layer && layer.isBackground === true;
        const paintsForType = Array.isArray(layer.paints) && layer.paints.length ? layer.paints : [];
        const hasFreehandPaint = paintsForType.some((p) => p && p.kind === 'freehand' && Array.isArray(p.pathN));
        const hasImagePaint = paintsForType.some((p) => p && p.kind === 'image' && p.blob instanceof Blob);
        const hasTexturePaint = paintsForType.some((p) => p && p.kind === 'texture' && typeof p.textureId === 'string' && p.textureId.trim());
        const hasClipShape = Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;

        let layerLabel = 'Patroon';
        if (isBg) layerLabel = 'Achtergrond';
        else if (hasFreehandPaint) layerLabel = 'Tekening';
        else if (hasImagePaint) layerLabel = 'Afbeelding';
        else if (hasTexturePaint) layerLabel = 'Textuur';
        else if (hasClipShape) layerLabel = 'Vorm';

        const item = document.createElement('div');
        const isPrimary = i === this.activeLayerIndex;
        const isSelected = selectedSet.has(i) || isPrimary;
        item.className = 'layers__item' + (isSelected ? ' is-selected' : '') + (isPrimary ? ' is-primary' : '');
        item.draggable = !isBg;
        item.dataset.viewIndex = String(viewIndex);

        const left = document.createElement('span');
        left.className = 'layers__left';

        // --- Nieuw: toon thumbnail voor image-layer ---
        if (layer.kind === 'image' && layer.image instanceof window.Image && layer.image.src) {
          const thumb = document.createElement('span');
          thumb.className = 'layers__thumb';
          thumb.style.backgroundImage = `url('${layer.image.src}')`;
          thumb.title = 'Afbeelding';
          left.appendChild(thumb);
        }

        const radio = document.createElement('input');
        radio.type = 'checkbox';
        radio.value = String(i);
        radio.checked = isSelected;
        radio.draggable = false;
        radio.addEventListener('click', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          handleLayerListClick(i);
        });

        const num = document.createElement('span');
        num.className = 'layers__num';
        num.textContent = String(viewIndex + 1);

        const name = document.createElement('span');
        name.className = 'layers__name';
        name.textContent = layerLabel;

        left.appendChild(radio);
        left.appendChild(num);
        left.appendChild(name);

        // Click on the row selects; Shift+click multi-selects.
        item.addEventListener('click', (evt) => {
          const target = evt.target instanceof HTMLElement ? evt.target : null;
          if (target && (target.closest('button') || target.closest('input') || target.closest('select'))) return;
      handleLayerListClick(i);
        });

        const swatches = document.createElement('span');
        swatches.className = 'layers__swatches';

        const imagePaint = paintsForType.find((p) => p && p.kind === 'image' && p.blob instanceof Blob);
        if (imagePaint) {
          const blob = imagePaint.blob;
          const url = URL.createObjectURL(blob);
          this.layerThumbObjectUrls.push(url);
          const thumb = document.createElement('span');
          thumb.className = 'layers__thumb';
          thumb.style.backgroundImage = `url(\"${url}\")`;
          swatches.appendChild(thumb);
        } else {
      // If the layer contains a texture paint, show a mini-canvas thumb of the texture.
      const texturePaints = paintsForType.filter((p) => p && p.kind === 'texture' && typeof p.textureId === 'string' && p.textureId.trim());
      const texturePaint = texturePaints.length ? texturePaints[texturePaints.length - 1] : null;
      if (texturePaint) {
      const canvas = document.createElement('canvas');
      canvas.className = 'layers__thumb';
      canvas.width = 22;
      canvas.height = 22;
      canvas.draggable = false;
      canvas.setAttribute('aria-label', 'Textuur thumbnail');
      swatches.appendChild(canvas);

      const textureId = texturePaint.textureId;
      const color = texturePaint.color;
      const palette = Array.isArray(texturePaint.palette) ? texturePaint.palette : null;
      const repeatCount = texturePaint.repeatCount;
      const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      canvas.dataset.thumbToken = token;
      if (this.canvasLayers && typeof this.canvasLayers.loadGeneratedTextureImage === 'function') {
        this.canvasLayers.loadGeneratedTextureImage(textureId, color, palette)
          .then((img) => {
            if (!canvas.isConnected) return;
            if (canvas.dataset.thumbToken !== token) return;
            renderTextureThumbToCanvas(canvas, img, repeatCount);
          })
          .catch(() => {
            renderTextureThumbToCanvas(canvas, null, repeatCount);
          });
      }
      } else {

        const colors = [];
        const seen = new Set();

        if (Array.isArray(layer.visibleColors) && layer.visibleColors.length) {
          for (const c of layer.visibleColors) {
            const s = typeof c === 'string' && c.trim() ? c.trim() : '';
            if (!s) continue;
            if (seen.has(s)) continue;
            seen.add(s);
            colors.push(s);
          }
        } else {
          const paints = Array.isArray(layer.paints) && layer.paints.length ? layer.paints : [{ color: layer.color }];
          for (const p of paints) {
            const c = p && typeof p.color === 'string' && p.color.trim() ? p.color.trim() : '';
            if (!c) continue;
            if (seen.has(c)) continue;
            seen.add(c);
            colors.push(c);
          }
        }

          for (const c of colors) {
            const s = document.createElement('button');
            s.type = 'button';
            s.className = 'layers__swatch';
            s.style.backgroundColor = c;
            s.title = 'Verwijder kleur uit layer';
            s.setAttribute('aria-label', `Verwijder kleur ${c} uit layer`);
            s.draggable = false;
            s.addEventListener('click', (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();

              const layers2 = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
			  const sel = this.getSelectedLayerIndices();
			  const applyGroup = sel.length > 1 && sel.includes(i);
              if (applyGroup) {
                for (const li of sel) this.removeColorFromLayerIndex(li, c);
                return;
              }

              this.removeColorFromLayerIndex(i, c);
            });
            swatches.appendChild(s);
          }
		  }
        }

        const right = document.createElement('span');
        right.className = 'layers__right';

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'layers__delete';
        del.textContent = '×';
        del.title = 'Verwijder layer';
        del.setAttribute('aria-label', 'Verwijder layer');
        del.draggable = false;
        del.addEventListener('click', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();

          const layers2 = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
		  const sel = this.getSelectedLayerIndices();
		  const applyGroup = sel.length > 1 && sel.includes(i);
          if (applyGroup) {
            // Remove from highest index to lowest to avoid index shifts.
            sel.sort((a, b) => b - a);
            for (const li of sel) {
              this.canvasLayers.removeLayerAt(li);
            }

            const nextN = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers.length : 0;
            if (nextN <= 0) {
              this.activeLayerIndex = -1;
              this.activeClipPathN = null;
              this.activeClipKey = null;
              this.selectedLayerIndices = new Set();
              if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
              this.renderLayersList();
              return;
            }

            this.setLayerSelectionSingle(Math.min(this.activeLayerIndex, nextN - 1));
            this.renderLayersList();
            return;
          }

          this.removeLayerIndex(i);
        });

        right.appendChild(swatches);
        right.appendChild(del);

        item.appendChild(left);
        item.appendChild(right);
        this.layersRoot.appendChild(item);
      }
    }

  initTileScaleToggle() {
    if (!(this.tileScaleToShape instanceof HTMLInputElement)) return;
    if (this.tileScaleToShape.dataset.bound === '1') return;
    this.tileScaleToShape.dataset.bound = '1';

    const update = () => {
      this.currentTileScaleMode = this.tileScaleToShape.checked ? 'shape' : 'canvas';
    };

    update();
    this.tileScaleToShape.addEventListener('change', update);
  }

  initDrawShapeToMask() {
    if (!(this.canvas instanceof HTMLCanvasElement)) return;
    if (!this.canvas.parentElement) return;

    if (this.drawOverlay instanceof HTMLCanvasElement) return;

    const parent = this.canvas.parentElement;
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.position === 'static') parent.style.position = 'relative';

    const overlay = document.createElement('canvas');
    overlay.id = 'drawOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'auto';
    overlay.style.touchAction = 'none';
    overlay.style.cursor = 'crosshair';
    overlay.style.background = 'transparent';

    parent.appendChild(overlay);
    this.drawOverlay = overlay;
    this.drawOverlayCtx = overlay.getContext('2d');

    // Allow dropping saved images onto the canvas.
    overlay.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
    });

    overlay.addEventListener('drop', (evt) => {
      evt.preventDefault();
      const dt = evt.dataTransfer;
      if (!dt) return;

      // Shapes
    	const shapeId = dt.getData('application/x-ontwerpstudio2026-shape');
      const shapeKey = typeof shapeId === 'string' ? shapeId.trim() : '';
      if (shapeKey) {
        const rect = overlay.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const cxN = Math.max(0, Math.min(1, x / w));
        const cyN = Math.max(0, Math.min(1, y / h));

        this.savedShapesDB
          .get(shapeKey)
          .then((rec) => {
            if (!rec) return;
			// Composite group shape
			if (Array.isArray(rec.clipPathsN) && rec.clipPathsN.length) {
				const nextGroup = this.placeClipPathsNAt(rec.clipPathsN, cxN, cyN) || rec.clipPathsN;
				this.activeClipPathsN = nextGroup;
				this.activeClipPathN = null;
				this.activeClipKey = typeof rec.clipKey === 'string' && rec.clipKey ? rec.clipKey : '';

        // Commit immediately as real layers so it persists and can be colored.
        this.setInteractionMode('select');
        this.applyToActiveShapeGroup();
			} else {
				if (!Array.isArray(rec.clipPathN) || rec.clipPathN.length < 3) return;
				const next = this.placeClipPathNAt(rec.clipPathN, cxN, cyN) || rec.clipPathN;
				this.activeClipPathN = next;
				this.activeClipPathsN = null;
				this.activeClipKey = typeof rec.clipKey === 'string' && rec.clipKey ? rec.clipKey : this.makeClipKey(next);

        // Commit immediately as a real layer so it persists and can be colored.
        this.setInteractionMode('select');
        this.applyToActiveShape();
			}

      // Ensure overlay + list are in sync after placement.
      if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
      this.renderLayersList();
          })
          .catch(() => {});
        return;
      }

    	const imageId = dt.getData('application/x-ontwerpstudio2026-image') || dt.getData('text/plain');
      const id = typeof imageId === 'string' ? imageId.trim() : '';
      if (!id) return;

      const rect = overlay.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const clamp01 = (n) => Math.max(0, Math.min(1, n));

      this.savedImagesDB
        .get(id)
        .then((rec) => {
          if (!rec || !(rec.blob instanceof Blob)) return;

          // Place centered around the drop point, but keep the image aspect ratio.
          const base = 0.28;
          const iw = Number(rec.w) || 0;
          const ih = Number(rec.h) || 0;
          const ratio = iw > 0 && ih > 0 ? ih / iw : 1;

          let wN = base;
          let hN = base;
          if (ratio > 0.0001) {
            if (ratio >= 1) {
              // Tall image: cap height.
              hN = base;
              wN = Math.max(0.03, base / ratio);
            } else {
              // Wide image: cap width.
              wN = base;
              hN = Math.max(0.03, base * ratio);
            }
          }

          let xN = clamp01(x / w - wN / 2);
          let yN = clamp01(y / h - hN / 2);

          // Keep fully on-canvas.
          xN = Math.max(0, Math.min(1 - wN, xN));
          yN = Math.max(0, Math.min(1 - hN, yN));

          const idx = this.canvasLayers.addImageLayer(id, rec.blob, xN, yN, wN, hN);
          this.setInteractionMode('select');
          this.setLayerSelectionSingle(idx);
          this.renderLayersList();
        })
        .catch(() => {});
    });

    // Wheel scaling for selected image layers and selected shapes.
    overlay.addEventListener('wheel', (evt) => {
      const idx = this.activeLayerIndex;

      // 1) Image scaling (existing behavior)
      if (Number.isFinite(idx) && idx >= 0) {
        const paint = getImagePaintForLayerIndex(idx);
        if (paint) {
          evt.preventDefault();

          const xN = Number.isFinite(paint.xN) ? paint.xN : 0;
          const yN = Number.isFinite(paint.yN) ? paint.yN : 0;
          const wN = Number.isFinite(paint.wN) ? paint.wN : 0.25;
          const hN = Number.isFinite(paint.hN) ? paint.hN : 0.25;
          const minN = 0.03;

          const cx = xN + wN / 2;
          const cy = yN + hN / 2;
          const aspect = hN > 0.0001 ? wN / hN : 1;

          const dir = evt.deltaY > 0 ? -1 : 1;
          const factor = dir > 0 ? 1.08 : 1 / 1.08;
          let nextW = wN * factor;
          nextW = Math.max(minN, Math.min(1, nextW));
          let nextH = aspect > 0.0001 ? nextW / aspect : nextW;
          nextH = Math.max(minN, Math.min(1, nextH));

          let nextX = cx - nextW / 2;
          let nextY = cy - nextH / 2;
          nextX = Math.max(0, Math.min(1 - nextW, nextX));
          nextY = Math.max(0, Math.min(1 - nextH, nextY));

          paint.xN = clamp01(nextX);
          paint.yN = clamp01(nextY);
          paint.wN = clamp01(nextW);
          paint.hN = clamp01(nextH);

          this.canvasLayers.redrawAllLayers();
          drawOverlayPath();
          return;
        }
      }

      // 2) Shape scaling (active clip path)
      if (!Array.isArray(this.activeClipPathN) || this.activeClipPathN.length < 3) return;

      evt.preventDefault();

      const base = this.activeClipPathN
        .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
        .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (base.length < 3) return;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of base) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const curW = Math.max(0.000001, maxX - minX);
      const curH = Math.max(0.000001, maxY - minY);

      const dir = evt.deltaY > 0 ? -1 : 1;
      let factor = dir > 0 ? 1.08 : 1 / 1.08;

      // Clamp minimum size.
      const minDim = 0.03;
      const minFactor = Math.max(minDim / curW, minDim / curH);
      factor = Math.max(factor, Math.min(1, minFactor));

      // Clamp maximum scale so the shape stays inside 0..1.
      if (factor > 1) {
        let maxFactor = Infinity;
        for (const p of base) {
          const dx = p[0] - cx;
          const dy = p[1] - cy;
          if (dx > 0) maxFactor = Math.min(maxFactor, (1 - cx) / dx);
          else if (dx < 0) maxFactor = Math.min(maxFactor, (0 - cx) / dx);
          if (dy > 0) maxFactor = Math.min(maxFactor, (1 - cy) / dy);
          else if (dy < 0) maxFactor = Math.min(maxFactor, (0 - cy) / dy);
        }
        if (Number.isFinite(maxFactor) && maxFactor > 0) factor = Math.min(factor, maxFactor);
      }

      if (!(Number.isFinite(factor) && factor > 0)) return;

      const next = base
        .map((p) => [clamp01(cx + (p[0] - cx) * factor), clamp01(cy + (p[1] - cy) * factor)])
        .filter((p) => Array.isArray(p) && p.length === 2);
      if (next.length < 3) return;

      this.activeClipPathN = next;
      this.activeClipKey = this.makeClipKey(next);

      // If the active clip is tied to an actual layer, keep it in sync and redraw.
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
      if (Number.isFinite(idx) && idx >= 0 && idx < layers.length) {
        const layer = layers[idx];
        if (layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3) {
          layer.clipPathN = next.slice();
          layer.clipKey = this.activeClipKey;
          this.canvasLayers.redrawAllLayers();
          if (typeof this.canvasLayers.scheduleVisibleColorsCompute === 'function') {
            this.canvasLayers.scheduleVisibleColorsCompute(idx).catch(() => {});
          }
          this.renderLayersList();
        }
      }

      drawOverlayPath();
    }, { passive: false });

    const getPos = (evt) => {
      const rect = overlay.getBoundingClientRect();
      return [evt.clientX - rect.left, evt.clientY - rect.top];
    };

    const getOverlaySize = () => {
      const rect = overlay.getBoundingClientRect();
      return {
        w: Math.max(1, rect.width),
        h: Math.max(1, rect.height),
      };
    };

    const clamp01 = (n) => Math.max(0, Math.min(1, n));

  const getImagePaintForLayerIndex = (layerIndex) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    return getImagePaintForLayerIndexFromLayers(layers, layerIndex);
  };

  const getFreehandPaintForLayerIndex = (layerIndex) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    return getFreehandPaintForLayerIndexFromLayers(layers, layerIndex);
  };

  const getImageRectPxForLayerIndex = (layerIndex) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const { w, h } = getOverlaySize();
    return getImageRectPxForLayerIndexFromLayers(layers, layerIndex, { w, h });
  };

  const hitTestTopmostImageLayer = (px, py) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const { w, h } = getOverlaySize();
    return hitTestTopmostImageLayerFromLayers(layers, px, py, { w, h });
  };

  const getClipPolyPxForLayerIndex = (layerIndex) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const { w, h } = getOverlaySize();
    return getClipPolyPxForLayerIndexFromLayers(layers, layerIndex, { w, h });
  };

  const getFreehandBoundsPxForLayerIndex = (layerIndex) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const { w, h } = getOverlaySize();
    return getFreehandBoundsPxForLayerIndexFromLayers(layers, layerIndex, { w, h });
  };

  const getClipBoundsPxForClipN = (clipN) => {
    const { w, h } = getOverlaySize();
    return getClipBoundsPxForClipNFromOverlay(clipN, { w, h });
  };

  const getSelectedClipBoundsPx = () => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const selected = typeof this.getSelectedLayerIndices === 'function' ? this.getSelectedLayerIndices() : [];
    const clips = [];
    for (const idx of selected) {
      const layer = layers[idx];
      if (!layer || !Array.isArray(layer.clipPathN) || layer.clipPathN.length < 3) continue;
      clips.push(layer.clipPathN);
    }
    if (clips.length === 0) return null;

    const { w, h } = getOverlaySize();
    return combinedClipBoundsPx(clips, w, h);
  };

  const hitTestTopmostClipLayer = (px, py) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const { w, h } = getOverlaySize();
    return hitTestTopmostClipLayerFromLayers(layers, px, py, { w, h });
  };

  const hitTestTopmostFreehandLayer = (px, py) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const { w, h } = getOverlaySize();
    return hitTestTopmostFreehandLayerFromLayers(layers, px, py, { w, h });
  };

  const collectLayerIndicesInRect = (selRect) => {
    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    return collectContainedLayerIndicesInRect(
      selRect,
      layers,
      (i) => getImageRectPxForLayerIndex(i),
      (i) => getFreehandBoundsPxForLayerIndex(i),
      (i) => {
        const layer = layers[i];
        return Array.isArray(layer && layer.clipPathN) && layer.clipPathN.length >= 3
          ? getClipBoundsPxForClipN(layer.clipPathN)
          : null;
      }
    );
  };

    const clearOverlay = () => {
      const ctx = this.drawOverlayCtx;
      if (!ctx) return;
      const rect = overlay.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      ctx.clearRect(0, 0, w, h);
    };

    const drawOverlayPath = () => {
      const ctx = this.drawOverlayCtx;
      if (!ctx) return;
      clearOverlay();

    const rect = overlay.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    const layersForOverlay = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const selectedForOverlay = typeof this.getSelectedLayerIndices === 'function' ? this.getSelectedLayerIndices() : [];
    const hasSelectedClipLayers = selectedForOverlay.some((idx) => {
      const layer = layersForOverlay[idx];
      return layer && Array.isArray(layer.clipPathN) && layer.clipPathN.length >= 3;
    });

    const polys = [];
    if (this.isDrawing && Array.isArray(this.drawPath) && this.drawPath.length >= 2) {
    const isFreeDraw = this.toolMode === 'free-draw';
    polys.push({ points: this.drawPath, close: !isFreeDraw });
    } else if (!hasSelectedClipLayers && Array.isArray(this.activeClipPathsN) && this.activeClipPathsN.length) {
    for (const polyN of this.activeClipPathsN) {
      if (!Array.isArray(polyN) || polyN.length < 2) continue;
      polys.push({ points: polyN.map((p) => [p[0] * w, p[1] * h]), close: true });
    }
    } else if (!hasSelectedClipLayers && Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 2) {
    polys.push({ points: this.activeClipPathN.map((p) => [p[0] * w, p[1] * h]), close: true });
    }

    if (polys.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const poly of polys) {
      const points = poly.points;
      if (!points || points.length < 2) continue;

      const isDrawPreview = this.isDrawing && poly.close === false;
      const previewColor = typeof this.currentColor === 'string' && this.currentColor.trim() ? this.currentColor.trim() : '#000000';
      const previewThicknessRaw = Number(this.currentThickness);
      const previewThickness = Number.isFinite(previewThicknessRaw) ? Math.max(1, Math.min(100, Math.round(previewThicknessRaw))) : 1;

      if (isDrawPreview) {
        ctx.strokeStyle = previewColor;
        ctx.globalAlpha = 1;
        ctx.lineWidth = previewThickness;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = '#000000';
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
      }

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      if (poly.close) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    }

    // Shape resize handle (bottom-right of selection bounds)
    if (this.interactionMode === 'select') {
      const bounds = getSelectedClipBoundsPx() || (Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 3 ? getClipBoundsPxForClipN(this.activeClipPathN) : null);
      if (bounds) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#000000';
        ctx.fillRect(bounds.maxX - 6, bounds.maxY - 6, 12, 12);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(bounds.maxX - 6, bounds.maxY - 6, 12, 12);
        ctx.restore();
      }
    }

    // Area selection box preview in Selecteren mode.
    if (this.interactionMode === 'select' && this.isBoxSelecting && this.boxSelectRectPx) {
      const r = this.boxSelectRectPx;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }

    // Image selection outline (if active layer is an image-layer)
    if (this.activeLayerIndex >= 0) {
      const rect = getImageRectPxForLayerIndex(this.activeLayerIndex);
      if (rect && rect.w > 2 && rect.h > 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#000000';
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        // bottom-right handle
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#000000';
        ctx.fillRect(rect.x + rect.w - 6, rect.y + rect.h - 6, 12, 12);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + rect.w - 6, rect.y + rect.h - 6, 12, 12);
        ctx.restore();
      }
    }

      // Crop rectangle preview (if any)
      const rectPx = this.cropRectPx;
      const rectN = this.cropRectN;
      let rx = null;
      let ry = null;
      let rw = null;
      let rh = null;
      if (rectPx && Number.isFinite(rectPx.x) && Number.isFinite(rectPx.y) && Number.isFinite(rectPx.w) && Number.isFinite(rectPx.h)) {
        rx = rectPx.x;
        ry = rectPx.y;
        rw = rectPx.w;
        rh = rectPx.h;
      } else if (rectN && Number.isFinite(rectN.x) && Number.isFinite(rectN.y) && Number.isFinite(rectN.w) && Number.isFinite(rectN.h)) {
        const { w, h } = getOverlaySize();
        rx = rectN.x * w;
        ry = rectN.y * h;
        rw = rectN.w * w;
        rh = rectN.h * h;
      }

      if (rw && rh && rw > 1 && rh > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#000000';
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.restore();
      }
    };

    this.renderDrawOverlay = drawOverlayPath;

    const minDist = 2;

    overlay.addEventListener('pointerdown', (evt) => {
      // On touch/pen, `button` can differ across browsers; only gate on mouse.
      if (evt.pointerType === 'mouse' && evt.button !== 0) return;

    // iPad/Safari: prevent default element-selection / tap highlight behavior.
    if (evt.pointerType === 'pen' || evt.pointerType === 'touch') {
      evt.preventDefault();
    }

      const p = getPos(evt);

      const interactionMode = this.interactionMode === 'select' ? 'select' : 'draw';

    if (tryStartImageLayerDrag({
      self: this,
      evt,
      p,
      interactionMode,
      overlay,
      hitTestTopmostImageLayer,
      getImageRectPxForLayerIndex,
      getImageHandleAtPoint,
      drawOverlayPath,
    })) return;

    if (tryStartFreehandLayerDrag({
      self: this,
      evt,
      p,
      interactionMode,
      overlay,
      hitTestTopmostFreehandLayer,
      getFreehandPaintForLayerIndex,
      drawOverlayPath,
    })) return;

      if (tryStartClipLayerInteraction({
        self: this,
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
      })) return;

      if (tryStartCropSelection({ self: this, evt, p, overlay, drawOverlayPath })) return;

      if (tryStartActiveSelectionInteraction({
        self: this,
        evt,
        p,
        interactionMode,
        overlay,
        getOverlaySize,
        getSelectedClipBoundsPx,
        getClipBoundsPxForClipN,
        getClipHandleAtPoint,
        pointInPolygon,
      })) return;

      // Background click always clears selection.
      if (tryStartBoxSelection({
        self: this,
        evt,
        p,
        interactionMode,
        overlay,
        drawOverlayPath,
      })) return;

	  startDrawStroke({
		self: this,
		evt,
		p,
		overlay,
		drawOverlayPath,
	  });
    });

    overlay.addEventListener('pointermove', (evt) => {
      const p = getPos(evt);

      if (this.toolMode === 'crop' && !this.isCropping) {
        overlay.style.cursor = 'crosshair';
        return;
      }

      if (tryUpdateCroppingPreview({ self: this, evt, p, drawOverlayPath })) return;

      if (handlePointerMoveDraggingShape({
        self: this,
        evt,
        p,
        getOverlaySize,
        drawOverlayPath,
      })) return;

    if (handlePointerMoveResizingShape({
      self: this,
      evt,
      p,
      drawOverlayPath,
      getClipBoundsPxForClipN,
    })) return;

    if (handlePointerMoveDraggingImage({
      self: this,
      evt,
      p,
      getOverlaySize,
      drawOverlayPath,
      getImagePaintForLayerIndex,
    })) return;

      if (handlePointerMoveDraggingFreehand({
        self: this,
        evt,
        p,
        getOverlaySize,
        drawOverlayPath,
        getFreehandPaintForLayerIndex,
      })) return;

      if (tryUpdateBoxSelectionPreview({ self: this, evt, p, normalizeRectPx, drawOverlayPath })) return;
      if (tryAppendDrawPathPoint({ self: this, evt, p, minDist, drawOverlayPath })) return;

      updatePointerHoverCursor({
        self: this,
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
      });
    });

    const finish = (evt) => {
      if (tryFinishCropping({
        self: this,
        evt,
        overlay,
        getOverlaySize,
        clamp01,
        drawOverlayPath,
      })) return;

      if (tryFinishDraggingShape({ self: this, evt, overlay })) return;
      if (tryFinishResizingShape({ self: this, evt, overlay })) return;
      if (tryFinishDraggingImage({ self: this, evt, overlay })) return;
      if (tryFinishDraggingFreehand({ self: this, evt, overlay })) return;
      if (tryFinishBoxSelection({
        self: this,
        evt,
        overlay,
        collectLayerIndicesInRect,
        drawOverlayPath,
      })) return;
      if (tryFinishDrawing({ self: this, evt, overlay, drawOverlayPath })) return;
    };

    overlay.addEventListener('pointerup', finish);
    overlay.addEventListener('pointercancel', finish);

    this.resizeDrawOverlay();
  }

  resizeDrawOverlay() {
    if (!(this.canvas instanceof HTMLCanvasElement)) return;
    if (!(this.drawOverlay instanceof HTMLCanvasElement)) return;
    const overlay = this.drawOverlay;

    const canvasRect = this.canvas.getBoundingClientRect();
    const parent = this.canvas.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    if (!parentRect) return;

    const left = canvasRect.left - parentRect.left;
    const top = canvasRect.top - parentRect.top;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${canvasRect.width}px`;
    overlay.style.height = `${canvasRect.height}px`;

    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.max(1, Math.round(canvasRect.width * dpr));
    overlay.height = Math.max(1, Math.round(canvasRect.height * dpr));
    const ctx = overlay.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (typeof this.renderDrawOverlay === 'function') this.renderDrawOverlay();
  }

  initThicknessControl() {
    if (!(this.thickness instanceof HTMLInputElement)) return;
    if (!(this.thicknessValue instanceof HTMLElement)) return;
    if (this.thickness.dataset.bound === '1') return;
    this.thickness.dataset.bound = '1';

    const update = () => {
      this.thicknessValue.textContent = String(this.thickness.value);
      const raw = Number(this.thickness.value);
      this.currentThickness = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.round(raw))) : 1;

      // Keep preview in sync with thickness.
      if (this.preview instanceof HTMLElement) this.applySelection(this.currentFile);

      // Apply to group selection.
      this.scheduleUpdateSelectedLayersPatternParams({ thickness: this.currentThickness });
    };

    update();
    this.thickness.addEventListener('input', update);
  }

  initPaletteControl() {
    if (!(this.palette instanceof HTMLElement)) return;
    if (this.palette.dataset.bound === '1') return;
    this.palette.dataset.bound = '1';

    const colors = [
      '#ff0000',
      '#ff7f00',
      '#ffff00',
      '#00ff00',
      '#00ffff',
      '#0000ff',
      '#7f00ff',
      '#ff00ff',
      '#7f8c8d',
      '#8e5a2a',
      '#000000',
      '#ffffff',
    ];

    this.palette.innerHTML = '';
    for (const c of colors) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'palette__swatch';
      btn.style.backgroundColor = c;
      btn.setAttribute('aria-label', `Kleur ${c}`);
      btn.addEventListener('click', () => {
        this.setBaseColor(c);
      });
      this.palette.appendChild(btn);
    }

    this.setBaseColor(this.baseColor);
  }

  setBaseColor(color) {
    this.baseColor = typeof color === 'string' && color.trim() ? color.trim() : '#000000';

    // Picking a base color also resets the working color.
    this.currentColor = this.baseColor;

    if (this.palette instanceof HTMLElement) {
      for (const el of Array.from(this.palette.children)) {
        if (!(el instanceof HTMLElement)) continue;
        const bg = el.style.backgroundColor;
        el.classList.toggle(
          'is-active',
          bg === this.baseColor || this.normalizeCssColor(bg) === this.normalizeCssColor(this.baseColor)
        );
      }
    }

    if (this.preview instanceof HTMLElement) this.applySelection(this.currentFile);
	if (this.texturePreview instanceof HTMLElement) this.applyTextureSelection(this.currentTextureId);
    this.updateColorBars();
  }

  setCurrentColor(color) {
    this.currentColor = typeof color === 'string' && color.trim() ? color.trim() : '#000000';

    // Working color should update preview, but should not move the palette or rebuild bars.
    if (this.preview instanceof HTMLElement) this.applySelection(this.currentFile);
	if (this.texturePreview instanceof HTMLElement) this.applyTextureSelection(this.currentTextureId);
  }

  applyPickedColorToActiveShapes(picked) {
    const color = typeof picked === 'string' ? picked.trim() : '';
    if (!color) return;

    const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
    const selectedSet = new Set(this.getSelectedLayerIndices());
    if (Number.isFinite(this.activeLayerIndex) && this.activeLayerIndex >= 0) selectedSet.add(this.activeLayerIndex);
    const selected = Array.from(selectedSet);

    let changedAny = false;
    for (const idx of selected) {
      const layer = layers[idx];
      if (!layer || !Array.isArray(layer.clipPathN) || layer.clipPathN.length < 3) continue;
      const paints = Array.isArray(layer.paints) ? layer.paints : [];
      let changed = false;
      for (const paint of paints) {
        if (!paint) continue;
        if (paint.kind === 'image') continue;
		// Any non-image paint should accept a new working color.
		// (Renderer treats paints without `file` as solid; patterns also use `color`.)
		paint.color = color;
		changed = true;
      }

	  // Legacy layers: older records store pattern/solid props directly on the layer.
	  // The renderer treats missing/empty paints as a single paint derived from layer.* fields.
	  if (!changed && (!Array.isArray(layer.paints) || layer.paints.length === 0)) {
		  // Only recolor if the layer is actually a drawable (not image-only) layer.
		  const isImageOnly = Array.isArray(layer.paints) && layer.paints.some((p) => p && p.kind === 'image');
		  if (!isImageOnly) {
			  layer.color = color;
			  changed = true;
		  }
	  }

      if (changed) {
        changedAny = true;
        if (typeof this.canvasLayers.addOptimisticVisibleColor === 'function') {
          this.canvasLayers.addOptimisticVisibleColor(layer, color);
        }
        if (typeof this.canvasLayers.scheduleVisibleColorsCompute === 'function') {
          this.canvasLayers.scheduleVisibleColorsCompute(idx);
        }
      }
    }

    if (changedAny) {
      this.canvasLayers.redrawAllLayers();
      this.renderLayersList();
      return;
    }

    // Fallback: if a free (not-yet-layer) active shape exists, apply the color to it.
    const hasActive = Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 3;
    if (hasActive) this.applyToActiveShape();
  }

  initColorMixCanvasControl() {
    const canvases = [this.colorMixCanvas, this.colorMixCanvasPatterns, this.colorMixCanvasTextures, this.colorMixCanvasShapes].filter(
      (c) => c instanceof HTMLCanvasElement
    );
    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      if (canvas.dataset.boundMix === '1') continue;
      canvas.dataset.boundMix = '1';
      canvas.style.cursor = 'pointer';
      canvas.addEventListener('click', (evt) => {
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const w = rect.width;
        if (!w) return;

        // Top strip (30px): quick-pick white/black.
        if (y >= 0 && y < 30) {
          const picked = x < w / 2 ? '#ffffff' : '#000000';
          this.setCurrentColor(picked);
		  if (canvas === this.colorMixCanvasShapes) this.applyPickedColorToActiveShapes(picked);
          return;
        }

        const t = Math.max(0, Math.min(0.999999, x / w));
        let key = 'primary';
        if (t >= 0.8 && t < 0.9) key = 'complement';
        else if (t >= 0.9 && t < 0.95) key = 'supportA';
        else if (t >= 0.95) key = 'supportB';

        const colors = this.colorBarColors && Array.isArray(this.colorBarColors[key]) ? this.colorBarColors[key] : [];
        const idx = this.colorBarSelectedIndex && Number.isFinite(this.colorBarSelectedIndex[key]) ? this.colorBarSelectedIndex[key] : -1;
        const picked = idx >= 0 && idx < colors.length ? colors[idx] : '';
		if (picked) {
			this.setCurrentColor(picked);
			if (canvas === this.colorMixCanvasShapes) this.applyPickedColorToActiveShapes(picked);
		}
      });
    }
  }

  parseCssRgb(color) {
    const s = typeof color === 'string' ? color.trim() : '';
    if (!s) return null;
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map((p) => p.trim());
    if (parts.length < 3) return null;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (![r, g, b].every((v) => Number.isFinite(v))) return null;
    return {
      r: Math.max(0, Math.min(255, Math.round(r))),
      g: Math.max(0, Math.min(255, Math.round(g))),
      b: Math.max(0, Math.min(255, Math.round(b))),
    };
  }

  rgbToHsl(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      s = Number.isFinite(s) ? s : 0;
      s = Math.max(0, Math.min(1, s));
      s *= 100;
      s = Math.max(0, Math.min(100, s));
      s = Number.isFinite(s) ? s : 0;
      s = Math.round(s);

      switch (max) {
        case r:
          h = ((g - b) / d) % 6;
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
          break;
      }
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }
    let ll = Math.round(l * 100);
    ll = Math.max(0, Math.min(100, ll));
    return { h, s, l: ll };
  }

  hslToRgb(hsl) {
    const h = ((hsl.h % 360) + 360) % 360;
    const s = Math.max(0, Math.min(100, hsl.s)) / 100;
    const l = Math.max(0, Math.min(100, hsl.l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h < 60) {
      rp = c;
      gp = x;
      bp = 0;
    } else if (h < 120) {
      rp = x;
      gp = c;
      bp = 0;
    } else if (h < 180) {
      rp = 0;
      gp = c;
      bp = x;
    } else if (h < 240) {
      rp = 0;
      gp = x;
      bp = c;
    } else if (h < 300) {
      rp = x;
      gp = 0;
      bp = c;
    } else {
      rp = c;
      gp = 0;
      bp = x;
    }
    return {
      r: Math.max(0, Math.min(255, Math.round((rp + m) * 255))),
      g: Math.max(0, Math.min(255, Math.round((gp + m) * 255))),
      b: Math.max(0, Math.min(255, Math.round((bp + m) * 255))),
    };
  }

  rgbaCss(rgb, alpha) {
    const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  }

  renderColorBar(el, baseHsl, alpha) {
    if (!(el instanceof HTMLElement)) return;
    el.innerHTML = '';
    const steps = Number.isFinite(this.colorBarSteps) ? Math.max(2, Math.min(64, Math.round(this.colorBarSteps))) : 16;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const l = Math.round(92 + (18 - 92) * t);
      const rgb = this.hslToRgb({ h: baseHsl.h, s: baseHsl.s, l });
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'colorbar__swatch';
      sw.style.backgroundColor = this.rgbaCss(rgb, alpha);
      el.appendChild(sw);
    }
  }

  setColorBarSelection(key, index) {
    const k = key === 'primary' || key === 'complement' || key === 'supportA' || key === 'supportB' ? key : 'primary';
    const colors = this.colorBarColors && Array.isArray(this.colorBarColors[k]) ? this.colorBarColors[k] : [];
    if (!colors.length) return;
    const idx = Number.isFinite(index) ? Math.max(0, Math.min(colors.length - 1, Math.round(index))) : 0;
    this.colorBarSelectedIndex[k] = idx;
    this.applyColorBarActiveStates();
    this.renderColorMixCanvas();
	if (this.texturePreview instanceof HTMLElement) this.applyTextureSelection(this.currentTextureId);
  }

  applyColorBarActiveStates() {
    const mapping = [
      { key: 'primary', el: this.colorBarPrimary },
      { key: 'complement', el: this.colorBarComplement },
      { key: 'supportA', el: this.colorBarSupportA },
      { key: 'supportB', el: this.colorBarSupportB },
    ];
    for (const m of mapping) {
      if (!(m.el instanceof HTMLElement)) continue;
      const idx = this.colorBarSelectedIndex[m.key];
      const children = Array.from(m.el.children);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!(child instanceof HTMLElement)) continue;
        child.classList.toggle('is-active', i === idx);
      }
    }
  }

  ensureDefaultSelections() {
    const keys = ['primary', 'complement', 'supportA', 'supportB'];
    for (const k of keys) {
      const colors = this.colorBarColors && Array.isArray(this.colorBarColors[k]) ? this.colorBarColors[k] : [];
      if (!colors.length) continue;
      const cur = this.colorBarSelectedIndex[k];
      if (Number.isFinite(cur) && cur >= 0 && cur < colors.length) continue;
      this.colorBarSelectedIndex[k] = Math.floor((colors.length - 1) / 2);
    }
  }

  resizeColorMixCanvas() {
    // Backwards-compatible wrapper (kept for call sites).
    if (this.colorMixCanvas instanceof HTMLCanvasElement) this.resizeColorMixCanvasEl(this.colorMixCanvas);
    if (this.colorMixCanvasPatterns instanceof HTMLCanvasElement) this.resizeColorMixCanvasEl(this.colorMixCanvasPatterns);
	if (this.colorMixCanvasTextures instanceof HTMLCanvasElement) this.resizeColorMixCanvasEl(this.colorMixCanvasTextures);
    if (this.colorMixCanvasShapes instanceof HTMLCanvasElement) this.resizeColorMixCanvasEl(this.colorMixCanvasShapes);
  }

  resizeColorMixCanvasEl(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  renderColorMixCanvas() {
    const canvases = [this.colorMixCanvas, this.colorMixCanvasPatterns, this.colorMixCanvasTextures, this.colorMixCanvasShapes].filter(
      (c) => c instanceof HTMLCanvasElement
    );
    if (!canvases.length) return;

    const topStripH = 30;

    const getColor = (k) => {
      const colors = this.colorBarColors && Array.isArray(this.colorBarColors[k]) ? this.colorBarColors[k] : [];
      const idx = this.colorBarSelectedIndex && Number.isFinite(this.colorBarSelectedIndex[k]) ? this.colorBarSelectedIndex[k] : -1;
      return idx >= 0 && idx < colors.length ? colors[idx] : null;
    };

    const c1 = getColor('primary') || this.currentColor || '#000000';
    const c2 = getColor('complement') || c1;
    const c3 = getColor('supportA') || c2;
    const c4 = getColor('supportB') || c2;

    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      // When hidden, dimensions might be 0; skip until visible.
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      if (!w || !h) continue;
      this.resizeColorMixCanvasEl(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.clearRect(0, 0, w, h);

      // Top strip: white + black blocks.
      const stripH = Math.max(0, Math.min(topStripH, h));
      if (stripH > 0) {
        const halfW = w / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, halfW, stripH);
        ctx.fillStyle = '#000000';
        ctx.fillRect(halfW, 0, w - halfW, stripH);
      }

      const mixY = stripH;
      const mixH = Math.max(0, h - stripH);
      if (mixH <= 0) continue;

      let x = 0;
      const widths = [0.8, 0.1, 0.05, 0.05].map((p) => Math.round(w * p));
      widths[3] = Math.max(0, w - (widths[0] + widths[1] + widths[2]));
      const colors = [c1, c2, c3, c4];
      for (let i = 0; i < widths.length; i++) {
        const ww = widths[i];
        ctx.fillStyle = colors[i];
        ctx.fillRect(x, mixY, ww, mixH);
        x += ww;
      }
    }
  }

  updateColorBars() {
    const els = [this.colorBarPrimary, this.colorBarComplement, this.colorBarSupportA, this.colorBarSupportB];
    if (!els.some((el) => el instanceof HTMLElement)) return;

    const normalized = this.normalizeCssColor(this.baseColor);
    const rgb = this.parseCssRgb(normalized);
    if (!rgb) return;

    const hsl = this.rgbToHsl(rgb);
    const complement = { h: (hsl.h + 180) % 360, s: hsl.s, l: hsl.l };
    const supportA = { h: (complement.h + 30) % 360, s: complement.s, l: complement.l };
    const supportB = { h: (complement.h + 360 - 30) % 360, s: complement.s, l: complement.l };

    const alpha = 1;

    // Render bars as clickable tint swatches.
    this.colorBarColors.primary = [];
    this.colorBarColors.complement = [];
    this.colorBarColors.supportA = [];
    this.colorBarColors.supportB = [];

    const render = (el, key, base) => {
      if (!(el instanceof HTMLElement)) return;
      el.innerHTML = '';
      const steps = Number.isFinite(this.colorBarSteps) ? Math.max(2, Math.min(64, Math.round(this.colorBarSteps))) : 16;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const l = Math.round(92 + (18 - 92) * t);
        const rgbStep = this.hslToRgb({ h: base.h, s: base.s, l });
        const css = this.rgbaCss(rgbStep, alpha);
        this.colorBarColors[key].push(css);
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'colorbar__swatch';
        sw.style.backgroundColor = css;
        sw.setAttribute('aria-label', `Tint ${i + 1}`);
        sw.addEventListener('click', () => this.setColorBarSelection(key, i));
        el.appendChild(sw);
      }
    };

    render(this.colorBarPrimary, 'primary', hsl);
    render(this.colorBarComplement, 'complement', complement);
    render(this.colorBarSupportA, 'supportA', supportA);
    render(this.colorBarSupportB, 'supportB', supportB);

    this.ensureDefaultSelections();
    this.applyColorBarActiveStates();
    this.renderColorMixCanvas();
  }

  normalizeCssColor(color) {
    const tmp = document.createElement('div');
    tmp.style.color = color;
    document.body.appendChild(tmp);
    const out = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    return out;
  }

    initRepeatControl() {
      if (!(this.repeat instanceof HTMLInputElement)) return;
      if (!(this.repeatValue instanceof HTMLElement)) return;

      const update = () => {
        this.repeatValue.textContent = String(this.repeat.value);

        const nextRepeat = this.getRepeatCount();
        this.scheduleUpdateSelectedLayersPatternParams({ repeatCount: nextRepeat });
      };
      update();
      this.repeat.addEventListener('input', update);
    }

    getRepeatCount() {
      if (!(this.repeat instanceof HTMLInputElement)) return 10;
      const raw = Number(this.repeat.value);
      if (!Number.isFinite(raw)) return 10;
      return Math.max(1, Math.min(100, Math.round(raw)));
    }

	getThickness() {
		if (!(this.thickness instanceof HTMLInputElement)) return 1;
		const raw = Number(this.thickness.value);
		if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(100, Math.round(raw)));
	}

  getCompositionStorageKeys() {
    return {
      composition: `${APP_ID}.composition`,
    };
  }

  restoreCompositionFromStorage() {
    const store = this.getConceptStorage();
    if (!store) return;
    const keys = this.getCompositionStorageKeys();
    const id = store.getItem(keys.composition);
    if (!id) return;
    const exists = this.getCompositions().some((c) => c && c.id === String(id));
    this.selectedCompositionId = exists ? String(id) : '';
  }

  persistCompositionToStorage() {
    const store = this.getConceptStorage();
    if (!store) return;
    const keys = this.getCompositionStorageKeys();
    try {
      if (this.selectedCompositionId) store.setItem(keys.composition, String(this.selectedCompositionId));
      else store.removeItem(keys.composition);
    } catch (_) {}
  }

  clearCompositionStorage() {
    const store = this.getConceptStorage();
    if (!store) return;
    const keys = this.getCompositionStorageKeys();
    try {
      store.removeItem(keys.composition);
    } catch (_) {}
  }

    populateOptions() {
      this.select.innerHTML = '';
      for (const p of this.patterns) {
        const opt = document.createElement('option');
        opt.value = p.file;
        opt.textContent = p.label;
        this.select.appendChild(opt);
      }
    }

  populateTextureOptions() {
    if (!(this.textureSelect instanceof HTMLSelectElement)) return;
    this.textureSelect.innerHTML = '';
    for (const t of this.textures) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      this.textureSelect.appendChild(opt);
    }
  }

  applyTextureSelection(textureId) {
    if (!(this.texturePreview instanceof HTMLElement)) return;
    const id = typeof textureId === 'string' ? textureId : '';
    this.currentTextureId = id;

    // Textures are meant to tile; make the preview reflect that.
    this.texturePreview.style.backgroundRepeat = 'repeat';
    this.texturePreview.style.backgroundPosition = 'top left';
    this.texturePreview.style.backgroundSize = 'auto';

    const token = ++this.texturePreviewToken;
    if (!id) {
      this.texturePreview.style.backgroundImage = 'none';
      this.texturePreview.style.backgroundColor = this.currentColor;
      this.texturePreview.setAttribute('aria-label', 'Textuur preview: geen');
      return;
    }

    this.texturePreview.style.backgroundColor = '';
    this.texturePreview.setAttribute('aria-label', `Textuur preview: ${id}`);
    const dataUrl = generateTextureDataUrl(id, this.getCurrentTexturePaletteCss(), 256);
    if (token !== this.texturePreviewToken) return;
    this.texturePreview.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : 'none';
  }

  initTexturesView() {
    if (!(this.textureSelect instanceof HTMLSelectElement)) return;
    if (!(this.texturePreview instanceof HTMLElement)) return;

    if (this.textureSelect.dataset.bound === '1') return;
    this.textureSelect.dataset.bound = '1';

    this.populateTextureOptions();

    const initial = this.textures && this.textures[0] ? this.textures[0].id : '';
    this.textureSelect.value = initial || '';
    this.applyTextureSelection(initial || '');

    this.textureSelect.addEventListener('change', () => {
      this.applyTextureSelection(this.textureSelect.value);
    });

    this.texturePreview.addEventListener('click', () => {
      const layers = this.canvasLayers && Array.isArray(this.canvasLayers.layers) ? this.canvasLayers.layers : [];
      const selected = this.getSelectedLayerIndices();

      // Pending composite shape placement (from saved group)
      const hasActiveGroup = Array.isArray(this.activeClipPathsN) && this.activeClipPathsN.length > 0;
      if (hasActiveGroup) {
        this.applyTextureToActiveShapeGroup();
        return;
      }

      const hasActive = Array.isArray(this.activeClipPathN) && this.activeClipPathN.length >= 3;
      if (hasActive) {
        this.applyTextureToActiveShape();
        return;
      }

      // If nothing selected: apply to background.
      if (!this.currentTextureId) {
        this.applySolidToSelectedLayerOrCanvas();
        return;
      }

      // Group-apply to selected layers.
      if (selected.length > 0) {
        for (const idx of selected) {
          this.canvasLayers.addTexturePaintToLayerIndex(
            idx,
            this.currentTextureId,
            this.getTextureRepeatCount(),
            this.currentColor,
            this.currentTextureTileScaleMode,
            this.getCurrentTexturePaletteCss()
          );
        }
        this.renderLayersList();
        return;
      }

      if (this.activeLayerIndex >= 0 && this.activeLayerIndex < layers.length) {
        const layer = layers[this.activeLayerIndex];
        const paints = layer && Array.isArray(layer.paints) ? layer.paints : [];
        const isImageLayer = paints.some((p) => p && p.kind === 'image' && p.blob instanceof Blob);
        if (isImageLayer) {
          this.applyTextureToBackground();
          this.renderLayersList();
          return;
        }
        this.canvasLayers.addTexturePaintToLayerIndex(
          this.activeLayerIndex,
          this.currentTextureId,
          this.getTextureRepeatCount(),
          this.currentColor,
          this.currentTextureTileScaleMode,
          this.getCurrentTexturePaletteCss()
        );
        this.renderLayersList();
        return;
      }

      this.applyTextureToBackground();
      this.renderLayersList();
    });
  }

  initTextureRepeatControl() {
    if (!(this.textureRepeat instanceof HTMLInputElement)) return;
    if (!(this.textureRepeatValue instanceof HTMLElement)) return;
    if (this.textureRepeat.dataset.bound === '1') return;
    this.textureRepeat.dataset.bound = '1';

    const update = () => {
      this.textureRepeatValue.textContent = String(this.textureRepeat.value);
      const nextRepeat = this.getTextureRepeatCount();
      this.scheduleUpdateSelectedLayersPatternParams({ repeatCount: nextRepeat, kindFilter: 'texture' });
    };
    update();
    this.textureRepeat.addEventListener('input', update);
  }

  getTextureRepeatCount() {
    if (!(this.textureRepeat instanceof HTMLInputElement)) return 10;
    const raw = Number(this.textureRepeat.value);
    if (!Number.isFinite(raw)) return 10;
	// Textures: keep tile count intentionally low.
    return Math.max(1, Math.min(10, Math.round(raw)));
  }

  initTextureTileScaleToggle() {
    if (!(this.tileScaleToShapeTextures instanceof HTMLInputElement)) return;
    if (this.tileScaleToShapeTextures.dataset.bound === '1') return;
    this.tileScaleToShapeTextures.dataset.bound = '1';

    const update = () => {
      this.currentTextureTileScaleMode = this.tileScaleToShapeTextures.checked ? 'shape' : 'canvas';
    };
    update();
    this.tileScaleToShapeTextures.addEventListener('change', update);
  }

  getCurrentTexturePaletteCss() {
    const getColor = (k) => {
      const colors = this.colorBarColors && Array.isArray(this.colorBarColors[k]) ? this.colorBarColors[k] : [];
      const idx = this.colorBarSelectedIndex && Number.isFinite(this.colorBarSelectedIndex[k]) ? this.colorBarSelectedIndex[k] : -1;
      return idx >= 0 && idx < colors.length ? colors[idx] : null;
    };

    const c1 = getColor('primary') || this.currentColor || '#000000';
    const c2 = getColor('complement') || c1;
    const c3 = getColor('supportA') || c2;
    const c4 = getColor('supportB') || c2;
    return [c1, c2, c3, c4];
  }

    applySelection(file) {
      const f = typeof file === 'string' ? file : '';
      this.currentFile = f;

      const token = ++this.previewToken;

      if (!f) {
        this.preview.style.backgroundImage = 'none';
        this.preview.style.backgroundColor = this.currentColor;
        this.preview.setAttribute('aria-label', 'Patroon preview: geen');
        return;
      }

      this.preview.style.backgroundColor = '';
      this.preview.setAttribute('aria-label', `Patroon preview: ${f}`);

      const thickness = this.getThickness();
      const effectiveThickness = thickness;

      this.canvasLayers.loadSvgText(f)
        .then((svgText) => this.canvasLayers.buildSvgVariant(svgText, this.currentColor, effectiveThickness))
        .then((variantText) => {
          if (token !== this.previewToken) return;
          const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(variantText)}`;
          this.preview.style.backgroundImage = `url(\"${dataUrl}\")`;
        })
        .catch(() => {
          // Fallback to raw asset if something goes wrong.
          if (token !== this.previewToken) return;
          const url = `./patronen/${f}`;
          this.preview.style.backgroundImage = `url(\"${url}\")`;
        });
    }
  }

  const NS = {};
  NS.initLayout = function initLayout() {
    const picker = new PatternPickerController();
    picker.init();
    new MenuController({
      onRightViewSelect: (view) => picker.setRightView(view),
      onAction: (action) => {
        if (action === 'reset') picker.resetToStart();
      },
    }).init();
    new PanelsController().init();
  };
export { generateTextureDataUrl, MenuController, SavedImagesDB, PatternPickerController };

