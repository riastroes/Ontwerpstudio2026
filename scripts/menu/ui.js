// Layout-initialisatie voor legacy support
export function initLayout() {

  initUI();
  // Hier kun je eventueel meer initialisatie toevoegen
}

// Maak global voor legacy main.js
if (typeof window !== 'undefined') {
  window.Ontwerpstudio2026 = window.Ontwerpstudio2026 || {};
  window.Ontwerpstudio2026.initLayout = initLayout;
}
// UI/DOM interactie voor het menu
// MenuController class en initialisatie

export function qs(id) {
  return document.getElementById(id);
}



class MenuController {
  constructor(options) {
    this.toggle = qs('menuToggle');
    this.nav = qs('topnav');
    this.onRightViewSelect = options && typeof options.onRightViewSelect === 'function' ? options.onRightViewSelect : null;
    this.onAction = options && typeof options.onAction === 'function' ? options.onAction : null;
  }

  showRightPanelView(view) {
    // Alleen views in het rechterpaneel verbergen, niet de menu-links!
    const panel = document.getElementById('rightPanel');
    if (!panel) return;
    const views = panel.querySelectorAll('[data-right-view]');
    views.forEach(v => v.hidden = true);
    const active = panel.querySelector(`[data-right-view="${view}"]`);
    if (active) {
      active.hidden = false;

    } else {

    }
    const title = document.getElementById('rightPanelTitle');
    if (title) {
      const titles = {
        start: 'Concept',
        about: 'Over',
        composition: 'Compositie',
        patterns: 'Patronen',
        textures: 'Texturen',
        colors: 'Kleuren',
        images: 'Afbeeldingen',
        shapes: 'Vormen'
      };
      title.textContent = titles[view] || '';
    }
  }

  init() {
    if (!(this.toggle instanceof HTMLElement)) {

      return;
    }
    if (!(this.nav instanceof HTMLElement)) {

      return;
    }
    if (this.toggle.dataset.bound === '1') return;
    this.toggle.dataset.bound = '1';

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
      if (view) {
        event.preventDefault();
        this.showRightPanelView(view);
        if (this.onRightViewSelect) this.onRightViewSelect(view);
      }

      if (window.matchMedia('(max-width: 700px)').matches) {
        document.body.classList.remove('menu-open');
        this.toggle.setAttribute('aria-expanded', 'false');
      }
    });
    // Init: toon alleen start
    this.showRightPanelView('start');
    // Debug: log alle views en menu-items


  }
}

export function initUI() {

  // Initialiseer het menu
  new MenuController().init();
}
