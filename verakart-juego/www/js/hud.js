// =========================================================
// VERA KART — hud.js  (v2.0)
// Interfaz: velocímetro dinámico, vueltas, posición, tiempo, récord,
// minimapa (con cajas de objetos), cuenta atrás, avisos, confeti de
// nuevo récord, selector de personaje y pantalla de resultados.
// =========================================================

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
export const GAUGE_MAX_KMH = 240;

export function formatTime(t) {
  if (!isFinite(t) || t === null || t === undefined) return '--:--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export class HUD {
  constructor() {
    this.root = $('hud');
    this.lap = $('hud-lap'); this.pos = $('hud-pos'); this.time = $('hud-time');
    this.best = $('hud-best'); this.record = $('hud-record');
    this.pilot = $('hud-pilot');
    this.speedValue = $('speed-value');
    this.arc = $('speedo-arc');
    this.needle = $('speedo-needle');
    this.speedo = $('speedometer');
    this.boostFill = $('boost-fill');
    this.countdownEl = $('countdown');
    this.toastEl = $('toast');
    this.wrongEl = $('wrongway');
    this.flashEl = $('record-flash');
    this.bannerEl = $('record-banner');
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.confetti = $('confetti');
    this.cctx = this.confetti.getContext('2d');
    this.pieces = [];
    this._confettiRunning = false;
    this._buildTicks();
    this._lastSpeed = -1;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  _buildTicks() {
    const g = $('speedo-ticks');
    g.innerHTML = '';
    const cx = 110, cy = 120;
    for (let kmh = 0; kmh <= GAUGE_MAX_KMH; kmh += 20) {
      const a = (-90 + (kmh / GAUGE_MAX_KMH) * 180) * Math.PI / 180;
      const major = kmh % 40 === 0;
      const r1 = major ? 70 : 74, r2 = 80;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', cx + Math.sin(a) * r1); line.setAttribute('y1', cy - Math.cos(a) * r1);
      line.setAttribute('x2', cx + Math.sin(a) * r2); line.setAttribute('y2', cy - Math.cos(a) * r2);
      line.setAttribute('stroke', '#fff'); line.setAttribute('stroke-width', major ? 2.5 : 1.5);
      line.setAttribute('opacity', major ? 0.95 : 0.55);
      g.appendChild(line);
      if (major) {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', cx + Math.sin(a) * 56); t.setAttribute('y', cy - Math.cos(a) * 56 + 3.5);
        t.setAttribute('fill', '#fff'); t.setAttribute('font-size', '10'); t.setAttribute('font-weight', '800');
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('opacity', '0.85');
        t.textContent = kmh;
        g.appendChild(t);
      }
    }
  }

  setPilot(name) {
    if (this.pilot) this.pilot.textContent = name;
    const menuName = $('menu-pilot-name');
    if (menuName) menuName.textContent = name;
  }

  setSpeed(kmh, boosting, boostFrac) {
    const k = Math.min(GAUGE_MAX_KMH, Math.max(0, kmh));
    const shake = boosting ? (Math.random() - 0.5) * 3 : 0;
    const angle = -90 + (k / GAUGE_MAX_KMH) * 180 + shake;
    this.needle.setAttribute('transform', `rotate(${angle.toFixed(2)} 110 120)`);
    this.arc.setAttribute('stroke-dasharray', `${((k / GAUGE_MAX_KMH) * 100).toFixed(1)} 100`);
    const rounded = Math.round(kmh);
    if (rounded !== this._lastSpeed) { this.speedValue.textContent = rounded; this._lastSpeed = rounded; }
    this.speedo.classList.toggle('boosting', boosting);
    this.boostFill.style.width = `${Math.round(Math.max(0, Math.min(1, boostFrac)) * 100)}%`;
  }

  setLap(cur, total) { this.lap.textContent = `${cur}/${total}`; }
  setPos(p) { this.pos.textContent = `${p}º`; }
  setTime(t) { this.time.textContent = formatTime(t); }
  setBest(t) { this.best.textContent = formatTime(t); }
  setRecord(t) { this.record.textContent = formatTime(t); }

  countdown(text) {
    const el = this.countdownEl;
    el.textContent = text;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (!text) el.classList.remove('pop');
  }

  toast(text) {
    const el = this.toastEl;
    el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  wrongWay(on) { this.wrongEl.classList.toggle('hidden', !on); }

  // ---------------------------------------------------------
  // Efecto de nuevo récord: destello dorado + banner + confeti
  // ---------------------------------------------------------
  recordEffect(text = '¡NUEVO RÉCORD!') {
    this.flashEl.classList.remove('go'); void this.flashEl.offsetWidth; this.flashEl.classList.add('go');
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('go'); void this.bannerEl.offsetWidth; this.bannerEl.classList.add('go');
    this.record.classList.remove('record-hit'); void this.record.offsetWidth; this.record.classList.add('record-hit');
    this.startConfetti();
  }

  startConfetti() {
    const c = this.confetti;
    c.width = window.innerWidth; c.height = window.innerHeight;
    const colors = ['#ffd93b', '#ff4d4d', '#3dff8a', '#4fd2ff', '#c36bff', '#ffffff', '#ff9a1a'];
    this.pieces = [];
    for (let i = 0; i < 170; i++) {
      this.pieces.push({
        x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.6,
        vx: (Math.random() - 0.5) * 140, vy: 180 + Math.random() * 260,
        w: 6 + Math.random() * 8, h: 10 + Math.random() * 10,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
        color: colors[(Math.random() * colors.length) | 0], sway: Math.random() * 6.28,
      });
    }
    this._confettiT = 0;
    if (!this._confettiRunning) {
      this._confettiRunning = true;
      this._last = performance.now();
      requestAnimationFrame((t) => this._confettiFrame(t));
    }
  }

  _confettiFrame(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this._confettiT += dt;
    const ctx = this.cctx, c = this.confetti;
    ctx.clearRect(0, 0, c.width, c.height);
    let alive = 0;
    for (const p of this.pieces) {
      p.sway += dt * 3;
      p.x += (p.vx + Math.sin(p.sway) * 60) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y < c.height + 30) alive++;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.sway)));
      ctx.restore();
    }
    if (alive > 0 && this._confettiT < 7) requestAnimationFrame((t) => this._confettiFrame(t));
    else { ctx.clearRect(0, 0, c.width, c.height); this._confettiRunning = false; }
  }

  // ---------------------------------------------------------
  // Minimapa
  // ---------------------------------------------------------
  initMinimap(track) {
    const W = this.mini.width, H = this.mini.height, pad = 22;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.N; i++) {
      minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
    }
    const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = W / 2 - ((minX + maxX) / 2) * scale;
    const oz = H / 2 - ((minZ + maxZ) / 2) * scale;
    this.mm = { scale, ox, oz };

    // Pista pre-dibujada en un canvas aparte
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= track.N; i += 4) {
        const k = i % track.N;
        const x = track.px[k] * scale + ox, y = track.pz[k] * scale + oz;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    path(); ctx.strokeStyle = '#0b0d22'; ctx.lineWidth = 12; ctx.stroke();
    path(); ctx.strokeStyle = '#d7dcf5'; ctx.lineWidth = 7; ctx.stroke();
    // turbos
    ctx.strokeStyle = '#ff9a1a'; ctx.lineWidth = 7;
    for (const p of track.pads) {
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        const o = track.pointAt(p.s + (k * p.halfLen) / 2 / track.length, 0);
        const x = o.x * scale + ox, y = o.z * scale + oz;
        if (k === -2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // meta
    const s0 = track.pointAt(0, 0);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s0.x * scale + ox, s0.z * scale + oz, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    this.mmTrack = c;
  }

  drawMinimap(karts, boxes = []) {
    if (!this.mmTrack) return;
    const ctx = this.mctx, { scale, ox, oz } = this.mm;
    ctx.clearRect(0, 0, this.mini.width, this.mini.height);
    ctx.drawImage(this.mmTrack, 0, 0);
    // cajas de objetos activas (puntos magenta)
    ctx.fillStyle = '#ff4fd8';
    for (const b of boxes) {
      if (!b.active) continue;
      ctx.beginPath(); ctx.arc(b.x * scale + ox, b.z * scale + oz, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // primero los rivales, el jugador encima
    const sorted = [...karts].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const k of sorted) {
      const x = k.x * scale + ox, y = k.z * scale + oz;
      ctx.beginPath();
      ctx.arc(x, y, k.isPlayer ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = k.isPlayer ? '#ffd93b' : k.color;
      ctx.fill();
      ctx.lineWidth = k.isPlayer ? 3 : 2; ctx.strokeStyle = k.isPlayer ? '#111' : '#fff';
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------
  // Selector de personaje (menú)
  // ---------------------------------------------------------
  setCharacterInfo(char, index, total) {
    $('char-name').textContent = char.name;
    $('char-tag').textContent = char.tagline;
    $('char-dots').innerHTML = Array.from({ length: total }, (_, i) =>
      `<span class="dot ${i === index ? 'on' : ''}"></span>`).join('');
    const card = $('char-card');
    card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
  }

  setTrackInfo(seed, record) {
    $('track-info').textContent = `Pista #${seed.toString(36).toUpperCase()}  ·  Récord: ${formatTime(record)}`;
  }

  // ---------------------------------------------------------
  // Resultados
  // ---------------------------------------------------------
  showResults(rows, playerPlace, newRecord = false, firstRecord = false) {
    const medals = ['🥇', '🥈', '🥉'];
    $('results-title').textContent = playerPlace === 1 ? '¡VICTORIA!' : '¡META!';
    const note = $('results-record');
    note.textContent = newRecord ? '⭐ ¡NUEVO RÉCORD PERSONAL! ⭐' : firstRecord ? '⭐ Primer récord guardado en esta pista ⭐' : '';
    note.classList.toggle('hidden', !newRecord && !firstRecord);
    $('results-list').innerHTML = rows.map((r, i) => `
      <div class="res-row ${r.isPlayer ? 'me' : ''}">
        <span class="rp">${medals[i] || (i + 1) + 'º'}</span>
        <span class="rn">${r.name}</span>
        <span class="rt">${r.time}</span>
      </div>`).join('');
    $('results').classList.remove('hidden');
  }
}
