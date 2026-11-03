// =========================================================
// VERA KART — track.js
// Circuito 100% procedural:
//  - Curva cerrada aleatoria con THREE.CatmullRomCurve3
//  - Asfalto, pianos (curbs), barreras y terraplén creados con
//    THREE.ExtrudeGeometry (la sección se extruye a lo largo de la curva)
//  - Tabla de muestras para colisiones, progreso de vuelta, IA y minimapa
//  - v2.0: más puntos de control y curvas muy cerradas (hay que derrapar),
//          cajas de objetos giratorias que dan un mini-turbo nivel 2
// No se carga ningún modelo ni textura externa: todo se dibuja por código.
// =========================================================

import * as THREE from 'three';

export const TRACK_WIDTH = 26;      // ancho del asfalto en metros
const SAMPLES = 960;                // resolución de la tabla de muestras

// ---------- Generador pseudoaleatorio con semilla ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Utilidad: texturas dibujadas con canvas ----------
export function canvasTexture(w, h, draw, { repeat = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  tex.anisotropy = aniso;
  return tex;
}

export function makeGrassTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#58b848';
    ctx.fillRect(0, 0, w, h);
    const rnd = mulberry32(7);
    for (let i = 0; i < 90; i++) {           // manchas grandes
      const x = rnd() * w, y = rnd() * h, r = 14 + rnd() * 30;
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(120,210,80,0.18)' : 'rgba(30,120,50,0.16)';
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let i = 0; i < 1800; i++) {         // briznas
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(150,235,100,0.55)' : 'rgba(25,100,40,0.45)';
      ctx.fillRect(rnd() * w, rnd() * h, 1.5, 3 + rnd() * 3);
    }
  });
}

function makeRoadTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3d4049';
    ctx.fillRect(0, 0, w, h);
    const rnd = mulberry32(11);
    for (let i = 0; i < 5000; i++) {
      const l = rnd();
      ctx.fillStyle = l > 0.5 ? `rgba(255,255,255,${0.02 + rnd() * 0.05})` : `rgba(0,0,0,${0.05 + rnd() * 0.1})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // franjas de desgaste (por donde pasan las ruedas)
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.28, 'rgba(0,0,0,0.12)');
    g.addColorStop(0.36, 'rgba(0,0,0,0)');
    g.addColorStop(0.64, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // líneas de borde
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(w * 0.035, 0, w * 0.018, h);
    ctx.fillRect(w * 0.947, 0, w * 0.018, h);
    // línea central discontinua
    ctx.fillStyle = '#ffd93b';
    ctx.fillRect(w * 0.492, h * 0.12, w * 0.016, h * 0.38);
    ctx.fillRect(w * 0.492, h * 0.62, w * 0.016, h * 0.38);
  });
}

function makeStripeTexture(colorA, colorB) {
  return canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = colorA; ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = colorB; ctx.fillRect(0, h / 2, w, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h / 2 - 2, w, 4); ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, h - 2, w, 2);
  });
}

function makeBoostTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#ff7a00'); g.addColorStop(0.5, '#ffb81c'); g.addColorStop(1, '#ff7a00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a3a'; ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6);
    ctx.fillStyle = '#fff6c8';
    for (let i = 0; i < 3; i++) {            // chevrones apuntando hacia arriba (= hacia delante)
      const y = 40 + i * 70;
      ctx.beginPath();
      ctx.moveTo(w / 2, y - 34);
      ctx.lineTo(w - 14, y + 8);
      ctx.lineTo(w - 14, y + 30);
      ctx.lineTo(w / 2, y - 6);
      ctx.lineTo(14, y + 30);
      ctx.lineTo(14, y + 8);
      ctx.closePath(); ctx.fill();
    }
  }, { repeat: false });
}

function makeCheckerTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    const cols = 16, rows = 4, cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }, { repeat: false });
}

function makeBannerTexture() {
  return canvasTexture(1024, 160, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ff4d4d'); g.addColorStop(1, '#b3122a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const cs = 20;
    for (let x = 0; x < w; x += cs) for (let r = 0; r < 2; r++) {
      ctx.fillStyle = ((x / cs) + r) % 2 ? '#111' : '#fff';
      ctx.fillRect(x, r * cs, cs, cs);
      ctx.fillRect(x, h - (r + 1) * cs, cs, cs);
    }
    ctx.font = 'italic 900 100px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 12; ctx.strokeStyle = '#1a1a3a'; ctx.strokeText('VERA KART', w / 2, h / 2 + 4);
    ctx.fillStyle = '#ffd93b'; ctx.fillText('VERA KART', w / 2, h / 2 + 4);
  }, { repeat: false });
}

const wrap01 = (s) => ((s % 1) + 1) % 1;

// =========================================================
export class Track {
  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
    this.width = TRACK_WIDTH;
    this.N = SAMPLES;
    this.rng = mulberry32(this.seed);
    this._generate();
    this._sampleCurve();
    this._makeBoostPads();
    this._makeItemBoxes();
  }

  // ---------------------------------------------------------
  // 1) Generación de la curva cerrada aleatoria
  // ---------------------------------------------------------
  _generate() {
    let curve = null;
    for (let attempt = 0; attempt < 2500 && !curve; attempt++) {
      const c = this._randomCurve();
      if (this._validate(c)) curve = c;
    }
    this.curve = curve || this._fallbackCurve();
    this.curve.arcLengthDivisions = 4000;
    this.curve.updateArcLengths();
    this.length = this.curve.getLength();
  }

  _randomCurve() {
    const rng = this.rng;
    const n = 16 + Math.floor(rng() * 9);            // 16..24 puntos de control (antes 9..13)
    const baseR = 215 + rng() * 70;
    const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + (rng() - 0.5) * 0.8) / n) * Math.PI * 2;
      // radios muy dispares → horquillas y curvas cerradas
      const r = baseR * (0.4 + rng() * 1.0);
      const y = 5 * Math.sin(2 * a + ph1) + 3 * Math.sin(3 * a + ph2);   // colinas suaves
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const c = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    c.arcLengthDivisions = 1500;
    return c;
  }

  _fallbackCurve() {
    const pts = [];
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 270 * (1 + 0.32 * Math.cos(5 * a));
      pts.push(new THREE.Vector3(Math.cos(a) * r, 4 * Math.sin(2 * a), Math.sin(a) * r * 0.8));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  }

  /**
   * Comprueba longitud, curvatura y separación. v2.0: se exige un radio mínimo bajo
   * (curvas que obligan a derrapar) pero sin que el asfalto se pliegue sobre sí mismo.
   */
  _validate(curve) {
    const len = curve.getLength();
    if (len < 1500 || len > 2700) return false;
    const n = 720;
    const P = curve.getSpacedPoints(n);
    const k = 8;
    const minR = 21;          // radio de curvatura mínimo permitido (m)
    let tight = 0;
    for (let i = 0; i < n; i++) {
      const a = P[(i - k + n) % n], b = P[i], c = P[(i + k) % n];
      const abx = b.x - a.x, abz = b.z - a.z;
      const bcx = c.x - b.x, bcz = c.z - b.z;
      const acx = c.x - a.x, acz = c.z - a.z;
      const cross = Math.abs(abx * bcz - abz * bcx);
      if (cross < 1e-6) continue;
      const R = (Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(acx, acz)) / (2 * cross);
      if (R < minR) return false;
      if (R < 48) tight++;
    }
    if (tight / n < 0.12) return false;       // al menos un 12% del circuito en curvas muy cerradas
    const gap = Math.floor(n * 0.08);
    for (let i = 0; i < n; i += 2) {
      for (let j = i + gap; j < n; j += 2) {
        const idx = Math.min(j - i, n - (j - i));
        if (idx < gap) continue;
        if (Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z) < 80) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------
  // 2) Tabla de muestras (posición, tangente, normal izquierda)
  // ---------------------------------------------------------
  _sampleCurve() {
    const N = this.N;
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    this.lx = new Float32Array(N); this.lz = new Float32Array(N);
    this.minY = Infinity; this.maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u);
      const l = Math.hypot(t.x, t.z) || 1;
      this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
      this.tx[i] = t.x / l; this.tz[i] = t.z / l;
      this.lx[i] = this.tz[i]; this.lz[i] = -this.tx[i];   // "izquierda" = up × tangente
      this.minY = Math.min(this.minY, p.y); this.maxY = Math.max(this.maxY, p.y);
    }
    this.segLen = this.length / N;
    this.groundY = this.minY - 1.6;      // nivel del suelo bajo la pista
  }

  /**
   * Proyecta un punto (x,z) sobre el eje de la pista.
   * Devuelve índice, fracción, desplazamiento lateral (+ izquierda), altura y progreso [0,1).
   */
  project(x, z, hint = -1, out = {}) {
    const N = this.N, px = this.px, pz = this.pz;
    let best = -1, bd = Infinity;
    if (hint >= 0) {
      for (let k = -24; k <= 24; k++) {
        const i = (hint + k + N) % N;
        const dx = x - px[i], dz = z - pz[i];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best < 0 || bd > 2500) {
      bd = Infinity;
      for (let i = 0; i < N; i++) {
        const dx = x - px[i], dz = z - pz[i];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    }
    let i = best, j = (i + 1) % N;
    let sx = px[j] - px[i], sz = pz[j] - pz[i];
    let t = ((x - px[i]) * sx + (z - pz[i]) * sz) / (sx * sx + sz * sz);
    if (t < 0) {
      j = i; i = (i - 1 + N) % N;
      sx = px[j] - px[i]; sz = pz[j] - pz[i];
      t = ((x - px[i]) * sx + (z - pz[i]) * sz) / (sx * sx + sz * sz);
    }
    t = Math.min(1, Math.max(0, t));
    const cx = px[i] + sx * t, cz = pz[i] + sz * t;
    let lxv = this.lx[i] + (this.lx[j] - this.lx[i]) * t;
    let lzv = this.lz[i] + (this.lz[j] - this.lz[i]) * t;
    const ll = Math.hypot(lxv, lzv) || 1; lxv /= ll; lzv /= ll;
    out.i = i; out.t = t;
    out.lat = (x - cx) * lxv + (z - cz) * lzv;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * t;
    out.slope = (this.py[j] - this.py[i]) / Math.hypot(sx, sz);
    out.s = (i + t) / N;
    out.lx = lxv; out.lz = lzv;
    out.tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    out.tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const tl = Math.hypot(out.tx, out.tz) || 1; out.tx /= tl; out.tz /= tl;
    return out;
  }

  /** Punto de la pista en el parámetro s (0..1, admite negativos) con desplazamiento lateral. */
  pointAt(s, lat = 0, out = {}) {
    const N = this.N;
    const f = wrap01(s) * N;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    const lerp = (a, b) => a + (b - a) * t;
    let lx = lerp(this.lx[i], this.lx[j]), lz = lerp(this.lz[i], this.lz[j]);
    const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
    let tx = lerp(this.tx[i], this.tx[j]), tz = lerp(this.tz[i], this.tz[j]);
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    out.x = lerp(this.px[i], this.px[j]) + lx * lat;
    out.z = lerp(this.pz[i], this.pz[j]) + lz * lat;
    out.y = lerp(this.py[i], this.py[j]);
    out.lx = lx; out.lz = lz; out.tx = tx; out.tz = tz;
    out.heading = Math.atan2(tx, tz);
    return out;
  }

  /** Giro acumulado (rad, + = izquierda) entre la muestra i y la muestra i+ahead. */
  turnAhead(i, ahead) {
    const N = this.N, j = (i + ahead) % N;
    const cross = this.tx[i] * this.tz[j] - this.tz[i] * this.tx[j];
    const dot = this.tx[i] * this.tx[j] + this.tz[i] * this.tz[j];
    return Math.atan2(cross, dot);
  }

  /** Posición de salida para la parrilla (slot 0 = primera fila izquierda). */
  gridSlot(slot) {
    const row = Math.floor(slot / 2), side = slot % 2 === 0 ? 1 : -1;
    const behind = 9 + row * 9;
    const o = this.pointAt(-behind / this.length, side * 5.5);
    return { x: o.x, y: o.y, z: o.z, heading: o.heading, s: wrap01(-behind / this.length) };
  }

  // ---------------------------------------------------------
  // 3) Turbos en el asfalto
  // ---------------------------------------------------------
  _makeBoostPads() {
    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    this.pads = [];
    const count = 6;
    for (let k = 0; k < count; k++) {
      const s = 0.1 + ((k + 0.15 + rng() * 0.7) / count) * 0.84;
      this.pads.push({ s, lat: (rng() - 0.5) * 9, halfLen: 7, halfW: 4.2 });
    }
  }

  /** ¿Está el punto proyectado (s, lat) sobre algún turbo? */
  onBoostPad(s, lat) {
    for (const p of this.pads) {
      let ds = s - p.s; ds -= Math.round(ds);
      if (Math.abs(ds) * this.length < p.halfLen && Math.abs(lat - p.lat) < p.halfW) return true;
    }
    return false;
  }

  // ---------------------------------------------------------
  // 3b) Cajas de objetos (power-ups)
  // ---------------------------------------------------------
  /** Filas de 3 cajas repartidas por el circuito (evitando la meta y los turbos). */
  _makeItemBoxes() {
    const rng = mulberry32(this.seed ^ 0x51ed270b);
    const rows = Math.max(8, Math.round(this.length / 170));
    this.boxes = [];
    this.boxRespawn = 10;                         // segundos que tarda en reaparecer una caja
    const o = {};
    for (let r = 0; r < rows; r++) {
      let s = (r + 0.5 + (rng() - 0.5) * 0.4) / rows;
      if (s < 0.04 || s > 0.96) continue;         // no en la parrilla
      for (const p of this.pads) {                // no encima de un turbo
        let ds = s - p.s; ds -= Math.round(ds);
        if (Math.abs(ds) * this.length < 22) s += 40 / this.length;
      }
      const lats = rng() > 0.5 ? [-7, 0, 7] : [-5, 5];
      for (const lat of lats) {
        this.pointAt(s, lat, o);
        this.boxes.push({ s, lat, x: o.x, y: o.y + 1.7, z: o.z, active: true, timer: 0, pop: 1, mesh: null });
      }
    }
  }

  resetBoxes() {
    for (const b of this.boxes) { b.active = true; b.timer = 0; b.pop = 1; }
  }

  /**
   * ¿Toca el kart (x,y,z) alguna caja activa? La caja desaparece 10 s.
   * Devuelve true si recogió al menos una.
   */
  collectBox(x, y, z) {
    let got = false;
    for (const b of this.boxes) {
      if (!b.active) continue;
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz < 2.6 * 2.6 && Math.abs(y + 1.0 - b.y) < 2.6) {
        b.active = false; b.timer = this.boxRespawn;
        got = true;
      }
    }
    return got;
  }

  /** Anima las cajas (giro, flotación, reaparición). */
  updateBoxes(dt, time) {
    if (this.boxMat) this.boxMat.emissive.setHSL((time * 0.25) % 1, 1, 0.5);
    this.boxes.forEach((b, i) => {
      if (!b.active) {
        b.timer -= dt;
        if (b.timer <= 0) { b.active = true; b.pop = 0; }
      } else if (b.pop < 1) {
        b.pop = Math.min(1, b.pop + dt * 2.5);
      }
      const m = b.mesh;
      if (!m) return;
      m.visible = b.active;
      if (!b.active) return;
      m.rotation.y = time * 1.8 + i;
      m.rotation.x = 0.35 * Math.sin(time * 1.3 + i);
      m.position.y = b.y + 0.3 * Math.sin(time * 2.2 + i * 1.7);
      const k = b.pop;
      const sc = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.35 : 1;     // "pop" al reaparecer
      m.scale.setScalar(Math.max(0.01, k) * sc);
    });
  }

  _buildItemBoxes() {
    const group = new THREE.Group();
    group.name = 'item-boxes';
    const tex = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#bfe4ff');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(30,30,80,0.85)'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.font = '900 92px "Trebuchet MS", Verdana, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 10; ctx.strokeStyle = '#1a1a3a'; ctx.strokeText('?', w / 2, h / 2 + 6);
      ctx.fillStyle = '#ffd93b'; ctx.fillText('?', w / 2, h / 2 + 6);
    }, { repeat: false });
    this.boxMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.93,
      emissive: 0xff3366, emissiveIntensity: 0.55,
    });
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const edges = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    for (const b of this.boxes) {
      const m = new THREE.Mesh(geo, this.boxMat);
      m.add(new THREE.LineSegments(edges, edgeMat));
      m.position.set(b.x, b.y, b.z);
      m.castShadow = true;
      b.mesh = m;
      group.add(m);
    }
    return group;
  }

  // ---------------------------------------------------------
  // 4) Geometría 3D
  // ---------------------------------------------------------

  /** Frames para ExtrudeGeometry: la sección queda siempre vertical (sin torsión). */
  _installFlatFrames() {
    this.curve.computeFrenetFrames = function (steps) {
      const tangents = [], normals = [], binormals = [];
      for (let s = 0; s <= steps; s++) {
        const t = this.getTangentAt(s / steps);
        t.y = 0; t.normalize();
        tangents.push(t);
        normals.push(new THREE.Vector3(t.z, 0, -t.x));   // izquierda → eje X de la sección
        binormals.push(new THREE.Vector3(0, 1, 0));      // arriba   → eje Y de la sección
      }
      return { tangents, normals, binormals };
    };
  }

  /** Extruye una sección (x = lateral, y = vertical) a lo largo de toda la curva. */
  _extrude(points, mode, repeat, tileMeters, material) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, {
      steps: this.N,
      bevelEnabled: false,
      extrudePath: this.curve,
    });
    this._applyUVs(geo, mode, repeat, tileMeters);
    const mesh = new THREE.Mesh(geo, material);
    return mesh;
  }

  /** Reasigna las UV: u = posición lateral, v = distancia a lo largo de la pista. */
  _applyUVs(geo, mode, repeat, tileMeters) {
    const pos = geo.attributes.position;
    const n = pos.count;
    const vs = new Float32Array(n);
    const uv = new Float32Array(n * 2);
    const out = {};
    let hint = -1;
    for (let k = 0; k < n; k++) {
      this.project(pos.getX(k), pos.getZ(k), hint, out);
      hint = out.i;
      vs[k] = ((out.i + out.t) / this.N) * repeat;
      uv[2 * k] = mode === 'road' ? out.lat / this.width + 0.5 : mode === 'meters' ? out.lat / tileMeters : 0.5;
    }
    for (let k = 0; k < n; k += 3) {            // arreglo de la costura de cierre del circuito
      const mx = Math.max(vs[k], vs[k + 1], vs[k + 2]);
      const mn = Math.min(vs[k], vs[k + 1], vs[k + 2]);
      if (mx - mn > repeat * 0.5) {
        for (let q = 0; q < 3; q++) if (vs[k + q] < repeat * 0.5) vs[k + q] += repeat;
      }
    }
    for (let k = 0; k < n; k++) uv[2 * k + 1] = vs[k];
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  /** Cinta plana siguiendo la pista (turbos, línea de meta). */
  _ribbon(s0, s1, x0, x1, yOff) {
    const segs = Math.max(2, Math.ceil(Math.abs(s1 - s0) * this.N) + 1);
    const pos = [], uv = [], idx = [];
    const o = {};
    for (let k = 0; k <= segs; k++) {
      const s = s0 + ((s1 - s0) * k) / segs;
      this.pointAt(s, 0, o);
      pos.push(o.x + o.lx * x0, o.y + yOff, o.z + o.lz * x0);
      pos.push(o.x + o.lx * x1, o.y + yOff, o.z + o.lz * x1);
      uv.push(0, k / segs, 1, k / segs);
    }
    for (let k = 0; k < segs; k++) {
      const a = 2 * k, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Construye todo el circuito y devuelve un THREE.Group. */
  build() {
    this._installFlatFrames();
    const group = new THREE.Group();
    group.name = 'track';
    const W = this.width, H = W / 2;
    const L = this.length;

    const roadTex = makeRoadTexture();
    const barrierTex = makeStripeTexture('#2e6bff', '#ffffff');
    const curbTex = makeStripeTexture('#e8262b', '#ffffff');
    this.grassTex = this.grassTex || makeGrassTexture();

    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    const barrierMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    const grassMat = new THREE.MeshStandardMaterial({ map: this.grassTex, roughness: 1, metalness: 0, side: THREE.DoubleSide });

    // Asfalto
    const road = this._extrude(
      [[-H, -0.6], [H, -0.6], [H, 0], [-H, 0]],
      'road', Math.round(L / 24), 24, roadMat);
    road.receiveShadow = true;
    group.add(road);

    // Pianos rojo/blanco en los bordes
    for (const sgn of [1, -1]) {
      const x0 = sgn * (H - 1.5), x1 = sgn * H;
      const pts = sgn > 0
        ? [[x0, 0], [x1, 0], [x1, 0.07], [x0, 0.07]]
        : [[x1, 0], [x0, 0], [x0, 0.07], [x1, 0.07]];
      const curb = this._extrude(pts, 'flat', Math.round(L / 3), 1, curbMat);
      curb.receiveShadow = true;
      group.add(curb);
    }

    // Barreras laterales (azul/blanco)
    for (const sgn of [1, -1]) {
      const x0 = sgn * (H + 0.1), x1 = sgn * (H + 1.1);
      const pts = sgn > 0
        ? [[x0, -0.6], [x1, -0.6], [x1, 1.3], [x0, 1.3]]
        : [[x1, -0.6], [x0, -0.6], [x0, 1.3], [x1, 1.3]];
      const wall = this._extrude(pts, 'flat', Math.round(L / 6), 1, barrierMat);
      wall.castShadow = true; wall.receiveShadow = true;
      group.add(wall);
    }

    // Terraplén de césped que baja hasta el suelo
    const drop = this.maxY - this.groundY + 2.5;
    const E = H + 1.1;
    const emb = this._extrude(
      [[-E, -0.55], [-E - drop * 1.1, -0.55 - drop], [E + drop * 1.1, -0.55 - drop], [E, -0.55]],
      'meters', Math.round(L / 24), 24, grassMat);
    emb.receiveShadow = true;
    group.add(emb);

    // Turbos
    const boostMat = new THREE.MeshStandardMaterial({
      map: makeBoostTexture(), roughness: 0.5, emissive: 0xff8a00, emissiveIntensity: 0.55,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    for (const p of this.pads) {
      const g = this._ribbon(p.s - p.halfLen / L, p.s + p.halfLen / L, p.lat - p.halfW, p.lat + p.halfW, 0.05);
      const m = new THREE.Mesh(g, boostMat);
      m.receiveShadow = true;
      group.add(m);
    }

    // Línea de meta
    const lineMat = new THREE.MeshStandardMaterial({
      map: makeCheckerTexture(), roughness: 0.8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const line = new THREE.Mesh(this._ribbon(-2.2 / L, 2.2 / L, -H + 1.5, H - 1.5, 0.05), lineMat);
    line.receiveShadow = true;
    group.add(line);

    group.add(this._buildItemBoxes());
    group.add(this._buildArch());
    return group;
  }

  /** Arco de salida/meta con el cartel VERA KART. */
  _buildArch() {
    const W = this.width;
    const arch = new THREE.Group();
    const o = this.pointAt(0, 0);
    arch.position.set(o.x, o.y, o.z);
    arch.rotation.y = o.heading;

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2e6bff, roughness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xffd93b, roughness: 0.5 });
    const px = W / 2 + 2.6;
    for (const sgn of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 12, 1.8), pillarMat);
      pillar.position.set(sgn * px, 6, 0);
      pillar.castShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 2.4), trimMat);
      cap.position.set(sgn * px, 0.4, 0);
      arch.add(pillar, cap);
    }
    const tex = makeBannerTexture();
    const bannerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0x331111, emissiveIntensity: 0.35 });
    const solid = new THREE.MeshStandardMaterial({ color: 0xb3122a, roughness: 0.6 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(px * 2 + 1.8, 4.2, 1.2),
      [solid, solid, solid, solid, bannerMat, bannerMat]);
    beam.position.set(0, 11, 0);
    beam.castShadow = true;
    arch.add(beam);
    return arch;
  }
}
