// IndexedDB-functies uit menu.js
export function dbExists(name) {
  try {
    if (!('indexedDB' in window)) return Promise.resolve(false);
    if (typeof indexedDB.databases !== 'function') return Promise.resolve(true);
    return indexedDB
      .databases()
      .then((dbs) => Array.isArray(dbs) && dbs.some((d) => d && d.name === name))
      .catch(() => true);
  } catch (_) {
    return Promise.resolve(true);
  }
}

export function openDb(name, version, onUpgrade) {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      try {
        if (typeof onUpgrade === 'function') onUpgrade(req.result);
      } catch (_) {}
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export function getAllFromDb(db, storeName) {
  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    } catch (e) {
      reject(e);
    }
  });
}

export function putManyToDb(db, storeName, items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const it of list) store.put(it);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    } catch (e) {
      reject(e);
    }
  });
}

export function deleteDb(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}
// Utility- en kleurfuncties uit menu.js

export function mixRgb(a, b, t) {
  const tt = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const ar = a && Number.isFinite(a.r) ? a.r : 0;
  const ag = a && Number.isFinite(a.g) ? a.g : 0;
  const ab = a && Number.isFinite(a.b) ? a.b : 0;
  const br = b && Number.isFinite(b.r) ? b.r : 0;
  const bg = b && Number.isFinite(b.g) ? b.g : 0;
  const bb = b && Number.isFinite(b.b) ? b.b : 0;
  return {
    r: ar + (br - ar) * tt,
    g: ag + (bg - ag) * tt,
    b: ab + (bb - ab) * tt,
  };
}

export function tintRgb(rgb, tone) {
  const t = Number.isFinite(tone) ? Math.max(-1, Math.min(1, tone)) : 0;
  if (t === 0) return rgb;
  if (t > 0) return mixRgb(rgb, { r: 255, g: 255, b: 255 }, t);
  return mixRgb(rgb, { r: 0, g: 0, b: 0 }, -t);
}

export function qs(id) {
  return document.getElementById(id);
}

export function normalizeCssColorString(color) {
  const tmp = document.createElement('div');
  tmp.style.color = typeof color === 'string' ? color : '';
  document.body.appendChild(tmp);
  const out = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  return out;
}

export function parseCssRgbString(color) {
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

export function rgbaCssFromRgb(rgb, alpha) {
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  const r = rgb && Number.isFinite(rgb.r) ? Math.max(0, Math.min(255, Math.round(rgb.r))) : 0;
  const g = rgb && Number.isFinite(rgb.g) ? Math.max(0, Math.min(255, Math.round(rgb.g))) : 0;
  const b = rgb && Number.isFinite(rgb.b) ? Math.max(0, Math.min(255, Math.round(rgb.b))) : 0;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
// Algemene helpers en utilities

export function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
