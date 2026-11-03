// =========================================================
// VERA KART — controls.js  (v2.0)
// Teclado (WASD / flechas / espacio) + controles táctiles para móviles
// (Izq/Der, Acelerar, Frenar y Derrape) con suavizado del volante.
// =========================================================

/** ¿El dispositivo es táctil? (móvil/tablet o pantalla táctil) */
export function detectTouchDevice() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return !!(coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
}

export class Controls {
  constructor() {
    this.keys = new Set();
    this.pressedOnce = new Set(); // teclas pulsadas desde el último consumo
    this.steer = 0;               // volante suavizado [-1 (izq) .. 1 (der)]

    // Estado de los botones táctiles
    this.touch = { left: false, right: false, gas: false, brake: false, drift: false };
    this.isTouch = detectTouchDevice();
    this.onTouchDetected = null;  // callback si aparece un toque en un dispositivo "no táctil"
    this._pointers = new Map();   // pointerId → nombre del botón que tiene debajo

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.releaseTouch(); });

    // Si llega un toque en un equipo que no se detectó como táctil, se activan los controles
    window.addEventListener('touchstart', () => {
      if (!this.isTouch) {
        this.isTouch = true;
        if (this.onTouchDetected) this.onTouchDetected();
      }
    }, { passive: true });

    // Evita zoom (pellizco / doble toque) y el menú contextual por pulsación larga
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.isTouch) e.preventDefault(); });
    document.addEventListener('touchmove', (e) => {
      // se bloquea el scroll solo sobre el juego (los menús siguen pudiendo desplazarse)
      if (this.isTouch && e.target.closest && e.target.closest('#touch-controls, #game-canvas, #hud')) e.preventDefault();
    }, { passive: false });
  }

  // ---------------------------------------------------------
  // Táctil: se escucha el contenedor y se deduce el botón con elementFromPoint,
  // así el pulgar puede deslizarse de "Izq" a "Der" sin levantarlo (y hay multitoque).
  // ---------------------------------------------------------
  bindTouch(container) {
    if (!container) return;
    const buttonAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest ? el.closest('[data-touch]') : null;
      return btn ? btn.dataset.touch : null;
    };
    const refresh = () => {
      const t = this.touch;
      t.left = t.right = t.gas = t.brake = t.drift = false;
      for (const name of this._pointers.values()) if (name) t[name] = true;
      container.querySelectorAll('[data-touch]').forEach((b) => {
        b.classList.toggle('pressed', !!t[b.dataset.touch]);
      });
    };
    this._refreshTouchUI = refresh;

    container.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { container.setPointerCapture(e.pointerId); } catch (_) { /* ignorar */ }
      this._pointers.set(e.pointerId, buttonAt(e.clientX, e.clientY));
      refresh();
    });
    container.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      e.preventDefault();
      this._pointers.set(e.pointerId, buttonAt(e.clientX, e.clientY));
      refresh();
    });
    const end = (e) => { this._pointers.delete(e.pointerId); refresh(); };
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
    container.addEventListener('lostpointercapture', end);
  }

  releaseTouch() {
    this._pointers.clear();
    const t = this.touch;
    t.left = t.right = t.gas = t.brake = t.drift = false;
    if (this._refreshTouchUI) this._refreshTouchUI();
  }

  // ---------------------------------------------------------
  isDown(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Devuelve true una sola vez por cada pulsación. */
  consume(code) {
    if (this.pressedOnce.has(code)) {
      this.pressedOnce.delete(code);
      return true;
    }
    return false;
  }

  get throttle() { return (this.isDown('KeyW', 'ArrowUp') || this.touch.gas) ? 1 : 0; }
  get brake() { return (this.isDown('KeyS', 'ArrowDown') || this.touch.brake) ? 1 : 0; }
  get drift() { return this.isDown('Space', 'ShiftLeft', 'ShiftRight') || this.touch.drift; }

  get rawSteer() {
    let s = 0;
    if (this.isDown('KeyA', 'ArrowLeft') || this.touch.left) s -= 1;
    if (this.isDown('KeyD', 'ArrowRight') || this.touch.right) s += 1;
    return s;
  }

  /** Actualiza el volante suavizado y devuelve el estado de entrada. */
  update(dt) {
    const target = this.rawSteer;
    // Más rápido al volver al centro, algo más lento al girar (sensación de volante)
    const rate = target === 0 ? 9 : 6;
    this.steer += (target - this.steer) * (1 - Math.exp(-rate * dt));
    if (Math.abs(this.steer) < 0.001) this.steer = 0;
    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: this.steer,   // + = derecha
      drift: this.drift,
    };
  }

  clearPressed() { this.pressedOnce.clear(); }
}
