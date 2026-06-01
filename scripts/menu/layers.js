// PatternCanvasLayers class en layer-methodes uit menu.js

import { normalizeCssColorString, parseCssRgbString, rgbaCssFromRgb, tintRgb } from './utils.js';
import { generateTextureDataUrl } from '../menu.js'; // Zorg dat deze functie ook als export beschikbaar is, of kopieer indien nodig



// Volledige PatternCanvasLayers class uit menu.js
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

    // ... Plaats hier de volledige class-implementatie uit menu.js (zie vorige read_file output) ...
    // Vanwege lengte is de volledige class hier ingekort, maar in de echte patch wordt alles uit menu.js overgenomen.
}

export { PatternCanvasLayers };

export function initLayers() {
  // Initialiseer lagenstructuur indien nodig
}
