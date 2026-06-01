# Menu Modules

Deze map bevat de opgesplitste logica van de canvas-interactie.

## Kernmodules

- `pointerDownHandlers.js`
  - Start van interacties op `pointerdown`.
  - Selectie, drag-start, resize-start, crop-start en draw-start.

- `pointerMoveHandlers.js`
  - Live updates op `pointermove`.
  - Verplaatsen/schalen, crop-preview, marquee-preview en cursor-feedback.

- `pointerFinishHandlers.js`
  - Afronding op `pointerup` en `pointercancel`.
  - State reset en commit van selectie/drawing/crop.

## Ondersteunende modules

- `selection.js`
  - Geometrie en selectiehulpfuncties (point-in-polygon, bounds, contain-checks).

- `overlay.js`
  - Overlay hit-testing helpers voor image/freehand/clip lagen.

- `interactions.js`
  - Pure interactierekenfuncties (translate, clamp, scale, placement).

## Integratie

- `../menu.js`
  - Houdt app-state, roept de helpers aan en koppelt DOM events.
  - Dit bestand bevat nu vooral orkestratie i.p.v. lage-level berekeningen.

## Werkafspraak

- Houd helperfuncties zo veel mogelijk puur en klein.
- Nieuwe pointerlogica eerst als helper toevoegen, daarna alleen aanroepen vanuit `menu.js`.
- Na elke refactor altijd `get_errors` draaien op aangepaste bestanden.
