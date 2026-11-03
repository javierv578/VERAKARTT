// =====================================================================
// VERA KART — net.js
// Multijugador online con Socket.io (la conexión `socket` se crea en main.js).
//
//  · Cada pista (seed) es una sala: quienes juegan la misma pista se ven entre sí.
//  · El jugador local envía su posición y rotación (x, y, z, quaternion) cada 50 ms = 20 veces por segundo.
//  · Cada rival conectado se dibuja como un RemoteKart (kart.js) con interpolación lineal (Lerp).
//  · Salida sincronizada de toda la sala, choques y posiciones con los rivales online.
//  · Si no hay socket (sin servidor o sin Socket.io), el juego funciona igual, sin online.
// =====================================================================
import * as THREE from 'three';
import { RemoteKart } from './kart.js';

const SEND_INTERVAL_MS = 50;     // 20 envíos por segundo (20 ticks)
const TAG_COLORS = ['#38d9ff', '#ff7ad9', '#9dff5c', '#ffa94d', '#b197fc', '#ff6b6b', '#63e6be', '#ffe066'];

export class Net {
  /**
   * @param {object} o
   * @param {object|null} o.socket    conexión creada con io(...) en main.js (null = sin online)
   * @param {string}   o.game         identificador del juego ('verakart' | 'verakart'): cada uno tiene sus salas
   * @param {THREE.Scene} o.scene     escena donde se dibujan los rivales online
   * @param {Function} o.getLocal     () => { x, y, z, q:[x,y,z,w], pr, fin } | null   (null = no enviar)
   * @param {Function} o.getProfile   () => { name, char }
   * @param {Function} o.makeModel    (charId) => THREE.Object3D
   * @param {Function} o.makeTag      (texto, color) => THREE.Sprite
   * @param {Function} o.onStatus     (info) => void   info = { state, players, room }
   * @param {Function} o.onToast      (texto) => void
   * @param {Function} o.onGo         (retrasoMs, nombre) => void   salida sincronizada de la sala
   */
  constructor(o) {
    this.o = o;
    this.socket = o.socket || null;
    this.connected = false;
    this.id = null;
    this.seed = null;
    this.joined = false;
    this.mySlot = 0;                         // puesto de salida asignado por el servidor (0 si no hay online)
    this.remotes = new Map();                // id → RemoteKart
    this.minimap = [];                       // rivales online ACTIVOS (minimapa, choques y posiciones)
    this.starting = false;                   // esperando la señal de salida del servidor
    this.visible = true;
    this.group = new THREE.Group();
    this.group.name = 'rivales-online';
    o.scene.add(this.group);
    this._colorIdx = 0;

    if (!this.socket) {
      this.enabled = false;
      this._status('off');
      return;
    }
    this.enabled = true;
    this._bind();
    if (this.socket.connected) { this.connected = true; this.id = this.socket.id; }
    this._status(this.connected ? 'online' : 'connecting');
    this._timer = setInterval(() => this._send(), SEND_INTERVAL_MS);
  }

  // -------------------------------------------------------------------
  // Eventos del servidor
  // -------------------------------------------------------------------
  _bind() {
    const s = this.socket;

    s.on('connect', () => {
      this.connected = true;
      this.id = s.id;
      this._joinCurrent();                   // también tras una reconexión
    });

    s.on('disconnect', () => {
      this.connected = false;
      this.joined = false;
      this._clearRemotes();
      this._status('connecting');
    });

    s.on('connect_error', () => {
      this.connected = false;
      this._status('error');
    });

    s.on('joined', (d) => {
      this.joined = true;
      this.mySlot = d.slot || 0;
      this._clearRemotes();
      for (const p of d.players || []) this._addRemote(p.id, p.name, p.char, p.state);
      this._status('online');
    });

    // Salida sincronizada: el servidor avisa a toda la sala
    s.on('race:go', (d) => {
      clearTimeout(this._goTimer);
      this.starting = false;
      this.o.onGo(d.delay || 1500, d.name || 'Un piloto');
    });

    s.on('join:error', (d) => {
      this.joined = false;
      this._status(d && d.reason === 'sala-llena' ? 'full' : 'error');
    });

    // Un rival se conecta a la pista → se crea su kart 3D
    s.on('player:joined', (p) => {
      if (p.id === this.id) return;
      this._addRemote(p.id, p.name, p.char, null);
      this.o.onToast(`🌐 ${p.name} se unió a la pista`);
      this._status('online');
    });

    s.on('player:left', (p) => {
      const r = this.remotes.get(p.id);
      if (!r) return;
      this._removeRemote(p.id);
      this.o.onToast(`🌐 ${r.name} salió`);
      this._status('online');
    });

    s.on('player:update', (p) => {
      const r = this.remotes.get(p.id);
      if (!r) return;
      const charChanged = r.char !== p.char;
      r.name = p.name;
      if (charChanged || r.tagText !== p.name) r.rebuild(p.char);
    });

    // Posición/rotación de un rival (broadcast del servidor)
    s.on('state', (d) => {
      const r = this.remotes.get(d.id);
      if (r) r.setTarget(d);
    });
  }

  // -------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------
  /** Cambia de sala (cada pista = una sala). Se llama al generar/cargar una pista. */
  setRoom(seed) {
    if (!this.enabled) return;
    this.seed = seed;
    this.joined = false;
    this.mySlot = 0;
    this._clearRemotes();
    if (this.connected) this._joinCurrent();
  }

  /**
   * Pide la salida sincronizada para toda la sala. Devuelve true si hay más gente online
   * (la salida llegará por 'race:go'); false si se debe arrancar la carrera normal en solitario.
   * Si el servidor no responde en 2,5 s, arranca en solitario.
   */
  requestStart() {
    if (!this.enabled || !this.connected || !this.joined || this.remotes.size === 0) return false;
    if (this.starting) return true;
    this.starting = true;
    this.socket.emit('race:start');
    clearTimeout(this._goTimer);
    this._goTimer = setTimeout(() => { this.starting = false; this.o.onGo(0, null); }, 2500);
    return true;
  }

  /** Avisa de un cambio de personaje o nombre. */
  updateProfile() {
    if (!this.enabled || !this.connected || !this.joined) return;
    this.socket.emit('profile', this.o.getProfile());
  }

  /** Muestra u oculta a los rivales online (se ocultan en el menú). */
  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  get count() { return this.remotes.size; }

  /** Vuelve a escribir el estado actual (p. ej. al volver al menú). */
  refreshStatus() {
    if (!this.enabled) return;
    this._status(this.joined ? 'online' : (this.connected ? 'error' : 'connecting'));
  }

  /** Una vez por fotograma: interpola (Lerp) a cada rival hacia su último dato recibido. */
  update(dt) {
    if (!this.enabled) return;
    const now = performance.now();
    this.minimap.length = 0;
    for (const r of this.remotes.values()) {
      if (r.update(dt, now)) this.minimap.push(r);
    }
  }

  // -------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------
  _joinCurrent() {
    if (!this.connected || this.seed === null || this.seed === undefined) return;
    const p = this.o.getProfile();
    this.socket.emit('join', { game: this.o.game || 'verakart', seed: this.seed, name: p.name, char: p.char });
  }

  /** Envía la posición local {x, y, z, quaternion} 20 veces por segundo. */
  _send() {
    if (!this.connected || !this.joined) return;
    const st = this.o.getLocal();
    if (!st) return;
    // volatile: si la red va lenta, se descartan paquetes viejos en vez de acumularlos
    this.socket.volatile.emit('state', {
      x: round(st.x, 3), y: round(st.y, 3), z: round(st.z, 3),
      q: [round(st.q[0], 4), round(st.q[1], 4), round(st.q[2], 4), round(st.q[3], 4)],
      pr: round(st.pr || 0, 3),            // progreso en la carrera (para las posiciones)
      fin: round(st.fin || 0, 2),          // tiempo de meta (0 = aún corriendo)
    });
  }

  _addRemote(id, name, char, state) {
    if (id === this.id || this.remotes.has(id)) return;
    const r = new RemoteKart({
      id, name, char,
      color: TAG_COLORS[this._colorIdx++ % TAG_COLORS.length],
      makeModel: this.o.makeModel,
      makeTag: this.o.makeTag,
    });
    this.group.add(r.root);
    this.remotes.set(id, r);
    if (state) r.setTarget(state);
    this._status('online');
  }

  _removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.group.remove(r.root);
    r.dispose();
    this.remotes.delete(id);
  }

  _clearRemotes() {
    for (const id of [...this.remotes.keys()]) this._removeRemote(id);
    this.minimap.length = 0;
  }

  _status(state) {
    this.o.onStatus({ state, players: this.remotes.size + (state === 'online' ? 1 : 0), room: this.seed });
  }
}

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}
