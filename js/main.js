// =========================================================
// VERA KART — main.js
// Punto de entrada: escena, luces, sombras, cámara de seguimiento,
// carga de personajes (kart.glb / cangri.glb), menú 3D con selector,
// bucle de juego, carrera, récords (localStorage) y controles táctiles.
// =========================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

import { Controls } from './controls.js';
import { Track, mulberry32 } from './track.js';
import { Sky, HORIZON_HEX } from './sky.js';
import { createGround, createMountains, createTrees } from './scenery.js';
import { Kart, PHYS, resolveKartCollisions, collideWithGhosts, aiControl, wrapAngle } from './kart.js';
import { Particles } from './effects.js';
import { AudioFX } from './audio.js';
import { Net } from './net.js';
import { HUD, formatTime } from './hud.js';

// ---------------------------------------------------------
// Configuración
// ---------------------------------------------------------
const CONFIG = {
  LAPS: 3,
  KART_LENGTH: 3.06,            // v2.0: karts un 15% más pequeños (antes 3.6 m)
  KART_MAX_WIDTH: 2.2,          // límite de ancho para que ningún modelo roce las barreras
  MODEL_YAW: 0,                 // si un modelo mirase hacia otro lado, cambia este ángulo (radianes)
  PLAYER_SLOT: 3,               // posición de salida del jugador (3 = última fila)
};

// Personajes seleccionables. Cada uno carga su propio archivo .glb (en la raíz del proyecto).
const CHARACTERS = [
  { id: 'javier', name: 'Javier Vera', url: 'kart.glb',   tagline: 'El piloto de la casa · barril y estilo' },
  { id: 'cangri', name: 'Cangri',      url: 'cangri.glb', tagline: 'Camioneta roja 4x4 · potencia bruta' },
];

const RIVALS = [
  { name: 'Rayo',  color: '#ff4d4d', tint: 0xff9a9a, skill: 0.955, lane: -6, slot: 0 },
  { name: 'Turbo', color: '#3dff8a', tint: 0x9affc0, skill: 0.935, lane: 5,  slot: 1 },
  { name: 'Nitro', color: '#c36bff', tint: 0xd8a8ff, skill: 0.915, lane: -2, slot: 2 },
];

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------
// Avisos de error
// ---------------------------------------------------------
function showError(html) {
  $('loading').classList.add('hidden');
  $('menu').classList.add('hidden');
  $('error-text').innerHTML = html;
  $('error').classList.remove('hidden');
}
if (location.protocol === 'file:') {
  showError('Este juego debe abrirse desde un servidor web (GitHub Pages) y no con doble clic en <b>index.html</b>.<br><br>' +
    'Prueba local: ejecuta <code>python3 -m http.server 8000</code> en la carpeta del proyecto y abre <code>http://localhost:8000</code>.');
  throw new Error('file:// no soportado');
}

// ---------------------------------------------------------
// Almacenamiento local (récords, personaje y pista guardados)
// ---------------------------------------------------------
const LS_KEY = 'vera-kart-v2';
let store = { seed: null, char: 'javier', records: {} };
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && typeof s === 'object') store = Object.assign(store, s);
    if (!store.records || typeof store.records !== 'object') store.records = {};
  } catch (e) { /* sin localStorage: el juego sigue funcionando sin guardar */ }
}
function saveStore() {
  try {
    const keys = Object.keys(store.records);
    if (keys.length > 40) for (const k of keys.slice(0, keys.length - 40)) delete store.records[k];
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) { /* ignorar */ }
}
loadStore();

/** Récord guardado de la pista actual: { race, lap } (segundos) */
function getRecord() {
  return track ? (store.records[track.seed] || null) : null;
}

// ---------------------------------------------------------
// Renderer, escena y cámara
// ---------------------------------------------------------
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(HORIZON_HEX);
scene.fog = new THREE.Fog(HORIZON_HEX, 260, 2300);

const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 5000);

// ---------------------------------------------------------
// Luces y sombras
// ---------------------------------------------------------
const SUN_OFFSET = new THREE.Vector3(60, 95, 45);
const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4f7f38, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 62;
sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);

// ---------------------------------------------------------
// Cielo procedural
// ---------------------------------------------------------
const sky = new Sky(SUN_OFFSET);
scene.add(sky.mesh);

// ---------------------------------------------------------
// Sistemas
// ---------------------------------------------------------
const controls = new Controls();
const hud = new HUD();
const audio = new AudioFX();
const particles = new Particles(scene);

// ---------------------------------------------------------
// Estado global
// ---------------------------------------------------------
let mode = 'loading';        // loading | menu | countdown | racing | paused | finished | results
let modeBeforePause = 'racing';
let time = 0;                // tiempo global (cielo, IA, animaciones)
let raceTime = 0;
let countdownT = 0, countdownStep = -1;
let finishTimer = 0;
let shake = 0;
let models = {};             // id de personaje → modelo normalizado (cargado desde su .glb)
let available = [];          // personajes que se cargaron correctamente
let selected = 0;            // índice del personaje elegido en el menú
let track = null;
let world = { group: null, ground: null, trees: null, mountains: null, platform: null };
let karts = [];
let player = null;
let playerFinishPlace = 1;
let finishRecord = { newRecord: false, first: false };
let menuSpot = null;         // punto de la pista donde gira el kart en el menú
let menuAngle = 0;
let menuPop = 1;             // animación de "pop" al cambiar de personaje
const dustAcc = new Map();

const cam = { heading: 0, look: new THREE.Vector3(), fov: 60, init: false };

// ---------------------------------------------------------
// Carga de los modelos .glb (kart.glb es obligatorio)
// ---------------------------------------------------------
function loadGLB(url, onProgress) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    }, reject);
  });
}

async function loadAllModels() {
  const progress = CHARACTERS.map(() => 0);
  const update = () => {
    const pct = Math.round((progress.reduce((a, b) => a + b, 0) / CHARACTERS.length) * 100);
    $('loader-fill').style.width = pct + '%';
    $('loading-text').textContent = `Cargando personajes… ${pct}%`;
  };
  const results = await Promise.allSettled(CHARACTERS.map((c, i) =>
    loadGLB(c.url, (p) => { progress[i] = p; update(); }).then((s) => { progress[i] = 1; update(); return s; })));

  available = [];
  models = {};
  results.forEach((r, i) => {
    const c = CHARACTERS[i];
    if (r.status === 'fulfilled') {
      models[c.id] = prepareKartModel(r.value);
      available.push(c);
    } else {
      console.error(`No se pudo cargar ${c.url}`, r.reason);
    }
  });
  if (!models.javier) throw new Error('kart.glb no se pudo cargar');
}

/** Normaliza el modelo: corrige normales/materiales, lo escala, centra y apoya sobre y=0. */
function prepareKartModel(scene3d) {
  scene3d.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Si el glb no trae normales (kart.glb) se calculan, suavizadas por ángulo
    if (!o.geometry.attributes.normal) {
      try { o.geometry = toCreasedNormals(o.geometry, Math.PI / 3); }
      catch (e) { o.geometry.computeVertexNormals(); }
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      // glTF sin metallicFactor = 1.0 → saldría negro sin mapa de entorno.
      // Si el modelo trae mapa metal/rugosidad (cangri.glb) se respeta, atenuado.
      const hasMR = !!(m.metalnessMap || m.roughnessMap);
      m.metalness = hasMR ? 0.22 : 0.05;
      m.roughness = hasMR ? 1.0 : 0.65;
      if (m.map) m.map.anisotropy = 8;
      m.needsUpdate = true;
    });
  });

  const box = new THREE.Box3().setFromObject(scene3d);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = Math.min(CONFIG.KART_LENGTH / Math.max(size.z, 1e-6), CONFIG.KART_MAX_WIDTH / Math.max(size.x, 1e-6));

  const inner = new THREE.Group();
  scene3d.position.set(-center.x, -box.min.y, -center.z);
  inner.add(scene3d);
  inner.scale.setScalar(scale);
  inner.rotation.y = CONFIG.MODEL_YAW;
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  return wrapper;
}

function cloneKartModel(charId, tint) {
  const m = models[charId].clone(true);
  if (tint !== undefined) {
    m.traverse((o) => {
      if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(tint); }
    });
  }
  return m;
}

function makeNameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '900 40px "Trebuchet MS", Verdana, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = '#111'; ctx.strokeText(text, 128, 34);
  ctx.fillStyle = color; ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  spr.scale.set(3.4, 0.85, 1);
  spr.position.set(0, 3.7, 0);
  return spr;
}

// ---------------------------------------------------------
// Multijugador online (Socket.io) — ver js/net.js
// ---------------------------------------------------------
const CFG = window.VERAKART_CONFIG || {};
// Servidor multijugador (el mismo para VERA KART y SENSAKART). Se puede cambiar con ?server=... o en index.html.
const SERVER_URL = new URLSearchParams(location.search).get('server') || CFG.serverUrl || 'https://sensakary-server.onrender.com';
// Conexión Socket.io (la librería `io` llega por el CDN de index.html). Si no carga, el juego sigue sin online.
const socket = (typeof io === 'function' && SERVER_URL)
  ? io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,                 // Render (plan gratis) puede tardar en "despertar"
    })
  : null;
const _qTmp = new THREE.Quaternion();

const net = new Net({
  socket,
  game: CFG.gameId || 'verakart',
  scene,
  // Posición y rotación del jugador local (null = no enviar: estamos en el menú)
  getLocal() {
    if (!player || mode === 'menu' || mode === 'loading') return null;
    _qTmp.copy(player.root.quaternion).multiply(player.tilt.quaternion);
    return {
      x: player.root.position.x, y: player.root.position.y, z: player.root.position.z,
      q: [_qTmp.x, _qTmp.y, _qTmp.z, _qTmp.w],
      pr: player.progress, fin: player.finished ? player.finishTime : 0,
    };
  },
  getProfile() {
    const me = available[selected] || { id: 'javier', name: 'Javier Vera' };
    return { name: me.name, char: me.id };
  },
  makeModel: (charId) => (models[charId] ? cloneKartModel(charId) : null),
  makeTag: (text, color) => makeNameTag(text, color),
  onToast: (t) => hud.toast(t),
  // Salida sincronizada: todos los de la sala arrancan a la vez (o en solitario si el servidor no responde)
  onGo: (delay, who) => {
    if (mode !== 'menu' && mode !== 'results') { if (who) hud.toast(`🏁 ${who} lanzó otra salida`); return; }
    const st = $('net-status');
    if (st && who) { st.textContent = `🏁 ¡${who} lanza la salida!`; st.classList.remove('hidden'); }
    setTimeout(() => { if (mode === 'menu' || mode === 'results') startRace(); }, delay);
  },
  onStatus: ({ state, players, room }) => {
    const el = $('net-status');
    if (!el) return;
    const txt = {
      off: '', connecting: '🌐 Conectando al servidor online…', error: '🌐 Sin conexión con el servidor (modo solo)',
      full: '🌐 Pista llena (máx. 8). Prueba «Nueva pista»',
      online: players > 1 ? `🌐 Online · ${players} pilotos en esta pista` : '🌐 Online · esperando rivales (pulsa «Invitar»)',
    }[state] || '';
    el.textContent = txt;
    el.dataset.state = state;
    el.classList.toggle('hidden', !txt);
    // Indicador de conexión visible durante la carrera
    const chip = $('net-chip');
    if (chip) {
      chip.dataset.state = state;
      chip.textContent = state === 'online' ? `🌐 ${players}` : (state === 'off' ? '' : (state === 'connecting' ? '🌐 …' : '🌐 ✕'));
      chip.title = txt;
      chip.classList.toggle('hidden', state === 'off');
    }
    $('btn-invite').classList.toggle('hidden', state === 'off');
  },
});

// ---------------------------------------------------------
// Mundo: pista + entorno
// ---------------------------------------------------------
function disposeObject(o) {
  o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      });
    }
  });
}

/** Plataforma giratoria bajo el kart del menú. */
function makePlatform() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 3.1, 0.22, 40),
    new THREE.MeshStandardMaterial({ color: 0x1b1f45, roughness: 0.5, metalness: 0.2 }));
  base.receiveShadow = true;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.75, 0.07, 10, 48),
    new THREE.MeshStandardMaterial({ color: 0xffd93b, emissive: 0xffb21a, emissiveIntensity: 0.9 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.13;
  g.add(base, ring);
  return g;
}

function buildWorld(seed) {
  for (const k of Object.keys(world)) {
    if (world[k]) { scene.remove(world[k]); disposeObject(world[k]); world[k] = null; }
  }
  track = new Track(seed);
  store.seed = track.seed;
  saveStore();
  world.group = track.build();
  world.ground = createGround(track, track.grassTex);
  const rng = mulberry32(track.seed ^ 0xabcdef);
  world.trees = createTrees(track, rng);
  world.mountains = createMountains(track, rng);
  world.platform = makePlatform();
  scene.add(world.group, world.ground, world.trees, world.mountains, world.platform);
  hud.initMinimap(track);

  // Punto de la pista donde gira el kart en el menú (justo antes del arco de salida)
  const o = track.pointAt(-16 / track.length, 0);
  menuSpot = { x: o.x, y: o.y, z: o.z, tx: o.tx, tz: o.tz, lx: o.lx, lz: o.lz };
  world.platform.position.set(o.x, o.y + 0.11, o.z);
  net.setRoom(track.seed);          // online: cada pista es una sala
}

function initialSeed() {
  const q = new URLSearchParams(location.search).get('seed');
  if (q !== null) return parseInt(q, 10) || 1;
  if (store.seed) return store.seed;
  return (Math.random() * 0xffffffff) >>> 0;
}

// ---------------------------------------------------------
// Karts
// ---------------------------------------------------------
function createKarts() {
  for (const k of karts) scene.remove(k.root);
  karts = [];
  const me = available[selected];

  player = new Kart({ model: cloneKartModel(me.id), name: me.name, isPlayer: true, color: '#ffd93b' });
  karts.push(player);

  RIVALS.forEach((r, i) => {
    // los rivales también usan los modelos de los personajes (con un tinte de color)
    const rivalChar = available[(selected + 1 + i) % available.length];
    const k = new Kart({
      model: cloneKartModel(rivalChar.id, r.tint), name: r.name, color: r.color,
      ai: { skill: r.skill, lane: r.lane, phase: Math.random() * 6.28 },
    });
    k.slot = r.slot;
    k.root.add(makeNameTag(r.name, r.color));
    karts.push(k);
  });
  player.slot = CONFIG.PLAYER_SLOT;
  karts.forEach((k) => scene.add(k.root));
  hud.setPilot(me.name);
}

function resetKarts() {
  for (const k of karts) {
    const g = track.gridSlot(k.slot);
    k.reset(g.x, g.y, g.z, g.heading);
    k.prevS = g.s;
    k.lap = -1;
    k._lapSeen = -1;
    k.speedScale = k.ai ? k.ai.skill : 1;
    track.project(k.x, k.z, -1, k.proj);
    k.progress = -1 + g.s;
    k.syncVisual(0.016);
  }
  track.resetBoxes();
  raceTime = 0;
  player.lapStart = 0;
  player.bestLap = Infinity;
  const rec = getRecord();
  hud.setBest(rec && rec.lap ? rec.lap : Infinity);
  hud.setRecord(rec ? rec.race : Infinity);
  hud.setTime(0);
  hud.setLap(1, CONFIG.LAPS);
  hud.setPos(karts.length);
  hud.wrongWay(false);
  hud.setTrackInfo(track.seed, rec ? rec.race : Infinity);
}

/** Muestra solo el kart del jugador (menú) o toda la parrilla (carrera). */
function setMenuScene(on) {
  for (const k of karts) k.root.visible = on ? k.isPlayer : true;
  if (world.platform) world.platform.visible = on;
  if (!on && player) { player.root.scale.setScalar(1); }
}

// ---------------------------------------------------------
// Selector de personaje
// ---------------------------------------------------------
function refreshCharacterUI() {
  hud.setCharacterInfo(available[selected], selected, available.length);
  const multi = available.length > 1;
  $('btn-prev').classList.toggle('hidden', !multi);
  $('btn-next').classList.toggle('hidden', !multi);
}

function selectCharacter(delta) {
  if (mode !== 'menu' || available.length < 2) return;
  selected = (selected + delta + available.length) % available.length;
  store.char = available[selected].id;
  saveStore();
  net.updateProfile();
  createKarts();
  resetKarts();
  setMenuScene(true);
  menuPop = 0;
  refreshCharacterUI();
  audio.init();
  audio.beep(660, 0.08, 'triangle', 0.25);
}

// ---------------------------------------------------------
// Posiciones
// ---------------------------------------------------------
function rankOf(kart) {
  let r = 1;
  const all = net.minimap.length ? karts.concat(net.minimap) : karts;   // incluye rivales online
  for (const o of all) {
    if (o === kart) continue;
    if (kart.finished && o.finished) { if (o.finishTime < kart.finishTime) r++; }
    else if (o.finished) r++;
    else if (kart.finished) continue;
    else if (o.progress > kart.progress) r++;
  }
  return r;
}

// ---------------------------------------------------------
// Cámara de seguimiento (tercera persona + lerp suave)
// ---------------------------------------------------------
const CHASE_DIST = 5.7, CHASE_HEIGHT = 3.0;

function snapCamera(k) {
  cam.heading = k.heading;
  camera.position.set(k.x - Math.sin(cam.heading) * CHASE_DIST, k.y + CHASE_HEIGHT, k.z - Math.cos(cam.heading) * CHASE_DIST);
  cam.look.set(k.x + Math.sin(cam.heading) * 6, k.y + 1.5, k.z + Math.cos(cam.heading) * 6);
  camera.lookAt(cam.look);
  cam.init = true;
}

function updateChaseCamera(dt, k) {
  if (!cam.init) snapCamera(k);
  const speedNorm = clamp(Math.abs(k.forwardSpeed) / PHYS.MAX_SPEED, 0, 1.4);

  // El rumbo de la cámara sigue al kart con retardo; en derrape mira algo hacia la trayectoria real
  let targetH = k.heading;
  if (k.forwardSpeed > 4) {
    const velH = Math.atan2(k.vx, k.vz);
    targetH = k.heading + wrapAngle(velH - k.heading) * 0.4;
  }
  cam.heading += wrapAngle(targetH - cam.heading) * (1 - Math.exp(-5 * dt));

  const dist = CHASE_DIST + speedNorm * 0.8;
  const height = CHASE_HEIGHT + speedNorm * 0.3;
  const dx = k.x - Math.sin(cam.heading) * dist;
  const dz = k.z - Math.cos(cam.heading) * dist;
  const dy = k.y + height;

  // Lerp con retardo: a más velocidad, más se "estira" la cámara hacia atrás → sensación de velocidad
  const kxz = 1 - Math.exp(-9 * dt), ky = 1 - Math.exp(-6 * dt);
  camera.position.x += (dx - camera.position.x) * kxz;
  camera.position.z += (dz - camera.position.z) * kxz;
  camera.position.y += (dy - camera.position.y) * ky;

  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * shake * 0.35;
    camera.position.z += (Math.random() - 0.5) * shake * 0.5;
    shake *= Math.exp(-7 * dt);
  }

  const lt = new THREE.Vector3(k.x + Math.sin(cam.heading) * 6, k.y + 1.6, k.z + Math.cos(cam.heading) * 6);
  cam.look.lerp(lt, 1 - Math.exp(-12 * dt));
  camera.lookAt(cam.look);

  const targetFov = 58 + speedNorm * 15 + (k.boosting ? 9 : 0);
  cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-4 * dt));
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
}

/** Menú 3D: cámara fija mirando al kart elegido, que gira sobre su plataforma; el circuito queda de fondo. */
function updateMenuScene(dt) {
  if (!player || !menuSpot) return;
  menuAngle += dt * 0.9;
  menuPop = Math.min(1, menuPop + dt * 3.2);
  const pop = 1 + Math.sin(menuPop * Math.PI) * 0.12;      // pequeño rebote al cambiar de personaje
  const k = player;
  k.root.position.set(menuSpot.x, menuSpot.y + 0.22 + Math.sin(time * 1.6) * 0.04, menuSpot.z);
  k.root.rotation.set(0, menuAngle, 0);
  k.tilt.rotation.set(0, 0, 0);
  k.root.scale.setScalar(Math.max(0.05, menuPop) * pop);
  if (world.platform) world.platform.rotation.y = -menuAngle * 0.4;

  // Cámara por detrás del kart, con una ligera oscilación lateral
  const sway = Math.sin(time * 0.35) * 1.4;
  camera.position.set(
    menuSpot.x - menuSpot.tx * 8.6 + menuSpot.lx * (2.4 + sway),
    menuSpot.y + 3.0,
    menuSpot.z - menuSpot.tz * 8.6 + menuSpot.lz * (2.4 + sway));
  // se apunta algo por debajo del kart para que quede en la zona libre, sobre los botones
  camera.lookAt(menuSpot.x, menuSpot.y + 0.35, menuSpot.z);
  if (camera.fov !== 50) camera.fov = 50;
  camera.updateProjectionMatrix();
  cam.init = false;
}

// ---------------------------------------------------------
// Efectos (partículas)
// ---------------------------------------------------------
function rearWorld(k, lx, lz) {
  const s = Math.sin(k.heading), c = Math.cos(k.heading);
  return [k.x + lx * c + lz * s, k.z - lx * s + lz * c];
}

function emitKartEffects(dt, k) {
  const slipping = Math.abs(k.slip) > 3 || k.drifting;
  // Polvo
  if (k.grounded && k.speed > 5 && (slipping || k.contact || k.speed > 30)) {
    let acc = (dustAcc.get(k) || 0) + dt * (slipping ? 60 : 18);
    while (acc >= 1) {
      acc -= 1;
      const side = Math.random() > 0.5 ? 1 : -1;
      const [wx, wz] = rearWorld(k, side * 0.82, -1.2);
      particles.dust(wx, k.y, wz, k.vx, k.vz);
    }
    dustAcc.set(k, acc);
  }
  // Chispas de derrape (azul → naranja según el nivel)
  if (k.drifting && k.driftLevel > 0) {
    for (let i = 0; i < 2; i++) {
      const [wx, wz] = rearWorld(k, (i ? 1 : -1) * 0.82, -1.3);
      particles.spark(wx, k.y, wz, k.driftLevel);
    }
  }
  // Llamas del turbo
  if (k.boosting) {
    const [wx, wz] = rearWorld(k, 0, -1.7);
    const bx = -Math.sin(k.heading) * 9, bz = -Math.cos(k.heading) * 9;
    for (let i = 0; i < 3; i++) particles.flame(wx, k.y + 0.6, wz, k.vx * 0.5 + bx, 0.3, k.vz * 0.5 + bz);
  }
}

// ---------------------------------------------------------
// Carrera: vueltas, récords y meta
// ---------------------------------------------------------
function onLapCross(k) {
  let beatLap = false;
  if (k.lap >= 1 && !k.finished) {
    const lapTime = raceTime - k.lapStart;
    if (lapTime < k.bestLap) k.bestLap = lapTime;
    if (k.isPlayer) {
      // mejor vuelta guardada de esta pista
      const rec = store.records[track.seed] || (store.records[track.seed] = {});
      if (!rec.lap || lapTime < rec.lap) {
        beatLap = rec.lap !== undefined;
        rec.lap = lapTime;
        saveStore();
        hud.setBest(rec.lap);
      }
    }
  }
  k.lapStart = raceTime;
  if (!k.isPlayer) return;
  if (k.lap >= CONFIG.LAPS) return;
  if (k.lap >= 1) {
    audio.lap();
    hud.toast(beatLap ? '¡MEJOR VUELTA!' : (k.lap === CONFIG.LAPS - 1 ? '¡ÚLTIMA VUELTA!' : `VUELTA ${k.lap + 1}`));
  }
}

function onPlayerFinish() {
  mode = 'finished';
  playerFinishPlace = rankOf(player);

  // ----- Récord de tiempo de carrera (localStorage) -----
  const rec = store.records[track.seed] || (store.records[track.seed] = {});
  finishRecord = { newRecord: false, first: false };
  if (rec.race === undefined) {
    rec.race = player.finishTime;
    finishRecord.first = true;
  } else if (player.finishTime < rec.race) {
    rec.race = player.finishTime;
    finishRecord.newRecord = true;
  }
  saveStore();
  hud.setRecord(rec.race);
  hud.setTrackInfo(track.seed, rec.race);

  if (finishRecord.newRecord) {
    hud.recordEffect('¡NUEVO RÉCORD!');                 // destello dorado + banner + confeti
    shake = Math.max(shake, 0.5);
  } else {
    hud.toast(playerFinishPlace === 1 ? '¡VICTORIA!' : '¡META!');
  }
  audio.lap();
  player.ai = { skill: 0.97, lane: 0, phase: 0 };   // piloto automático mientras se muestran los resultados
  finishTimer = finishRecord.newRecord ? 4.2 : 3.2;
}

function showResults() {
  const order = [...karts, ...net.minimap].sort((a, b) => rankOf(a) - rankOf(b));
  const rows = order.map((k) => ({
    name: k.name + (k.isPlayer ? ' (tú)' : ''),
    isPlayer: k.isPlayer,
    time: k.finished ? formatTime(k.finishTime) : 'en carrera',
  }));
  hud.showResults(rows, playerFinishPlace, finishRecord.newRecord, finishRecord.first);
  hud.hide();
  audio.silenceEngine();
}

// ---------------------------------------------------------
// Flujo de juego
// ---------------------------------------------------------
function hideAllScreens() {
  for (const id of ['menu', 'pause', 'results']) $(id).classList.add('hidden');
}

function tryFullscreenLandscape() {
  // En móviles intenta pantalla completa y horizontal (si el navegador lo permite)
  if (!controls.isTouch) return;
  try {
    const el = document.documentElement;
    const p = !document.fullscreenElement && el.requestFullscreen ? el.requestFullscreen() : null;
    if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  } catch (e) { /* ignorar */ }
}

function startRace() {
  controls.clearPressed();
  controls.releaseTouch();
  camera.clearViewOffset();
  audio.init();
  audio.resume();
  tryFullscreenLandscape();
  hideAllScreens();
  setMenuScene(false);
  player.slot = CONFIG.PLAYER_SLOT + net.mySlot;   // online: cada jugador sale en un puesto distinto
  resetKarts();
  player.ai = null;
  snapCamera(player);
  hud.show();
  mode = 'countdown';
  countdownT = 0; countdownStep = -1;
  hud.countdown('');
  audio.beep(300, 0.05, 'sine', 0.01);
}

function goToMenu() {
  hideAllScreens();
  hud.hide();
  hud.countdown('');
  player.ai = null;
  resetKarts();
  setMenuScene(true);
  audio.silenceEngine();
  refreshCharacterUI();
  net.refreshStatus();
  $('menu').classList.remove('hidden');
  mode = 'menu';
}

async function newTrack(thenStart = false) {
  const btns = ['btn-start', 'btn-newtrack'].map($);
  btns.forEach((b) => (b.disabled = true));
  await new Promise((r) => setTimeout(r, 30));     // deja que el navegador pinte el estado
  let seed;
  do { seed = (Math.random() * 0xffffffff) >>> 0; } while (track && seed === track.seed);
  buildWorld(seed);
  resetKarts();
  btns.forEach((b) => (b.disabled = false));
  if (thenStart) startRace(); else goToMenu();
}

function pauseGame() {
  if (mode !== 'racing' && mode !== 'countdown') return;
  modeBeforePause = mode;
  mode = 'paused';
  controls.releaseTouch();
  audio.suspend();
  $('pause').classList.remove('hidden');
}
function resumeGame() {
  if (mode !== 'paused') return;
  $('pause').classList.add('hidden');
  mode = modeBeforePause;
  audio.resume();
}

function respawnPlayer() {
  if (mode !== 'racing') return;
  player.placeOnTrack(track, player.proj.s, 0);
  snapCamera(player);
  hud.toast('REPOSICIONADO');
}

// ---------------------------------------------------------
// Actualización principal
// ---------------------------------------------------------
const ZERO_INPUT = { throttle: 0, brake: 0, steer: 0, drift: false };

function kartEvents(k) {
  const ev = k.events;
  if (ev.boxBoost) {
    // chispas de colores al romper una caja de objetos
    for (let i = 0; i < 16; i++) particles.spark(k.x, k.y + 1.3, k.z, 2);
    if (k.isPlayer) {
      audio.boost();
      shake = Math.max(shake, 0.3);
      if (mode === 'racing') hud.toast('¡CAJA! MINI-TURBO');
    }
  }
  if (!k.isPlayer) return;
  if (ev.hit > 0) {
    audio.hit(ev.hit);
    shake = Math.max(shake, clamp(ev.hit / 16, 0.15, 1.1));
    particles.wallSparks(k.x, k.y, k.z, ev.hit);
  }
  if (ev.padBoost) { audio.boost(); shake = Math.max(shake, 0.35); if (mode === 'racing') hud.toast('¡TURBO!'); }
  if (ev.driftLevelUp) audio.driftLevel(ev.driftLevelUp);
  if (ev.driftBoost) { audio.boost(); shake = Math.max(shake, 0.3); }
}

function stepGame(dt) {
  const input = controls.update(dt);

  // ----- Cuenta atrás -----
  if (mode === 'countdown') {
    countdownT += dt;
    const marks = [[0.4, '3', 440], [1.4, '2', 440], [2.4, '1', 440], [3.4, '¡YA!', 880]];
    for (let i = 0; i < marks.length; i++) {
      if (countdownT >= marks[i][0] && countdownStep < i) {
        countdownStep = i;
        hud.countdown(marks[i][1]);
        audio.beep(marks[i][2], i === 3 ? 0.5 : 0.2, 'square', 0.3);
        if (i === 3) { mode = 'racing'; raceTime = 0; }
      }
    }
  }

  const running = mode === 'racing' || mode === 'finished';
  if (running) raceTime += dt;

  // ----- Física con subpasos fijos para mayor estabilidad -----
  const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
  const sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (const k of karts) {
      let inp = ZERO_INPUT;
      if (k.isPlayer) {
        if (mode === 'racing') inp = input;
        else if (mode === 'finished') inp = aiControl(k, track, time, 1);
      } else if (running) {
        const rb = clamp(1 + (player.progress - k.progress) * 0.5, 0.92, 1.07);
        inp = aiControl(k, track, time, rb);
      }
      k.update(sdt, inp, track);
      kartEvents(k);
    }
    resolveKartCollisions(karts);
    if (running && net.minimap.length) collideWithGhosts(player, net.minimap);   // choques con rivales online
  }
  track.updateBoxes(dt, time);

  // ----- Vueltas, meta, IA atascada -----
  for (const k of karts) {
    if (k.lap > (k._lapSeen ?? -1)) { k._lapSeen = k.lap; onLapCross(k); }
    if (!k.finished && k.lap >= CONFIG.LAPS) {
      k.finished = true;
      k.finishTime = raceTime;
      if (k.isPlayer) onPlayerFinish();
    }
    if (!k.isPlayer && running) {
      k.stuckTime = k.speed < 2.5 ? k.stuckTime + dt : 0;
      if (k.stuckTime > 2.2) { k.placeOnTrack(track, k.proj.s, 0); k.stuckTime = 0; }
    }
  }

  // ----- Visuales y efectos -----
  for (const k of karts) {
    k.syncVisual(dt);
    if (running) emitKartEffects(dt, k);
  }

  // ----- Controles de partida -----
  if (controls.consume('KeyR')) respawnPlayer();
  if (controls.consume('KeyP') || controls.consume('Escape')) pauseGame();

  // ----- Fin de carrera → resultados -----
  if (mode === 'finished') {
    finishTimer -= dt;
    if (finishTimer <= 0) { mode = 'results'; showResults(); }
  }

  // ----- HUD -----
  const kmh = Math.abs(player.forwardSpeed) * PHYS.KMH;
  hud.setSpeed(kmh, player.boosting, player.boostTime / 1.6);
  hud.setTime(player.finished ? player.finishTime : Math.max(0, raceTime));
  hud.setLap(clamp(player.lap + 1, 1, CONFIG.LAPS), CONFIG.LAPS);
  hud.setPos(player.finished ? playerFinishPlace : rankOf(player));
  hud.wrongWay(mode === 'racing' && player.forwardSpeed > 6 &&
    (Math.sin(player.heading) * (player.proj.tx || 0) + Math.cos(player.heading) * (player.proj.tz || 0)) < -0.35);
  hud.drawMinimap(net.minimap.length ? karts.concat(net.minimap) : karts, track.boxes);

  audio.setEngine(
    clamp(Math.abs(player.forwardSpeed) / PHYS.MAX_SPEED, 0, 1.4),
    mode === 'racing' ? input.throttle : (mode === 'countdown' ? (controls.throttle ? 1 : 0.2) : 0),
    player.boosting, player.drifting, Math.abs(player.slip) > 4,
  );

  updateChaseCamera(dt, player);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (mode === 'paused') {
    if (controls.consume('KeyP') || controls.consume('Escape')) resumeGame();
  } else if (mode === 'countdown' || mode === 'racing' || mode === 'finished') {
    time += dt;
    stepGame(dt);
    particles.update(dt);
  } else if (mode === 'menu') {
    time += dt;
    updateMenuScene(dt);
    track.updateBoxes(dt, time);
    particles.update(dt);
    if (controls.consume('ArrowLeft') || controls.consume('KeyA')) selectCharacter(-1);
    if (controls.consume('ArrowRight') || controls.consume('KeyD')) selectCharacter(1);
    if (controls.consume('Enter') && !$('btn-start').disabled) beginRace();
  } else if (mode === 'results') {
    time += dt;
    controls.update(dt);
    // detrás de los resultados la carrera sigue en piloto automático
    for (const k of karts) {
      if (!k.ai) k.ai = { skill: 0.97, lane: 0, phase: 0 };
      k.update(dt, aiControl(k, track, time, 1), track);
      k.syncVisual(dt);
    }
    track.updateBoxes(dt, time);
    updateChaseCamera(dt, player);
    particles.update(dt);
  }

  if (controls.consume('KeyM')) toggleMute();

  // la luz y las sombras siguen al jugador
  if (player) {
    sun.position.set(player.root.position.x + SUN_OFFSET.x, player.root.position.y + SUN_OFFSET.y, player.root.position.z + SUN_OFFSET.z);
    sun.target.position.copy(player.root.position);
    sun.target.updateMatrixWorld();
  }
  // rivales online: visibles solo fuera del menú, con interpolación suave
  net.setVisible(mode !== 'menu' && mode !== 'loading');
  net.update(dt);

  sky.update(camera, time);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------
// UI: botones y eventos
// ---------------------------------------------------------
function toggleMute() {
  audio.setMuted(!audio.muted);
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
}

function applyTouchMode(on) {
  document.body.classList.toggle('is-touch', !!on);
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  particles.setViewportHeight(h * renderer.getPixelRatio());
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
onResize();

// Táctil: se muestran los controles solo si el dispositivo es táctil
applyTouchMode(controls.isTouch);
controls.onTouchDetected = () => applyTouchMode(true);
controls.bindTouch($('touch-controls'));

// Con rivales online la salida es para toda la sala; en solitario arranca directo
function beginRace() { if (!net.requestStart()) startRace(); }

$('btn-start').addEventListener('click', beginRace);
$('btn-newtrack').addEventListener('click', () => newTrack(false));
$('btn-prev').addEventListener('click', () => selectCharacter(-1));
$('btn-next').addEventListener('click', () => selectCharacter(1));
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart').addEventListener('click', () => { $('pause').classList.add('hidden'); audio.resume(); startRace(); });
$('btn-tomenu').addEventListener('click', goToMenu);
$('btn-again').addEventListener('click', beginRace);
$('btn-newtrack2').addEventListener('click', () => newTrack(true));
$('btn-tomenu2').addEventListener('click', goToMenu);
$('btn-mute').addEventListener('click', toggleMute);
$('btn-invite').addEventListener('click', async () => {
  // Enlace de la pista actual: quien lo abra juega en la misma sala online
  const base = CFG.publicUrl || (location.protocol.startsWith('http') ? location.origin + location.pathname : '');
  const link = (base || '') + '?seed=' + track.seed;
  const btn = $('btn-invite');
  const old = btn.textContent;
  try {
    if (navigator.share && controls.isTouch) await navigator.share({ title: 'VERA KART', text: '¡Corre conmigo en VERA KART!', url: link });
    else await navigator.clipboard.writeText(link);
    btn.textContent = '✅ Enlace copiado';
  } catch (e) {
    window.prompt('Copia este enlace y envíaselo a tus amigos:', link);
  }
  setTimeout(() => { btn.textContent = old; }, 1800);
});
$('btn-pause').addEventListener('click', pauseGame);
$('btn-reset').addEventListener('click', respawnPlayer);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// Deslizar horizontalmente sobre la escena del menú también cambia de personaje
let swipeX = null;
canvas.addEventListener('pointerdown', (e) => { if (mode === 'menu') swipeX = e.clientX; });
canvas.addEventListener('pointerup', (e) => {
  if (mode === 'menu' && swipeX !== null) {
    const dx = e.clientX - swipeX;
    if (Math.abs(dx) > 60) selectCharacter(dx < 0 ? 1 : -1);
  }
  swipeX = null;
});

// ---------------------------------------------------------
// Arranque
// ---------------------------------------------------------
const clock = new THREE.Clock();

async function init() {
  try {
    await loadAllModels();
  } catch (err) {
    console.error(err);
    showError('No se pudo cargar el archivo <b>kart.glb</b>.<br><br>' +
      'Comprueba que <code>kart.glb</code> (y <code>cangri.glb</code>) están en la <b>raíz</b> del proyecto, junto a <code>index.html</code>, ' +
      'y que se llaman exactamente así, en minúsculas.');
    return;
  }
  $('loading-text').textContent = 'Generando circuito…';
  await new Promise((r) => setTimeout(r, 30));

  selected = Math.max(0, available.findIndex((c) => c.id === store.char));
  buildWorld(initialSeed());
  createKarts();
  resetKarts();
  setMenuScene(true);
  refreshCharacterUI();
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('btn-start').disabled = false;
  $('btn-newtrack').disabled = false;
  mode = 'menu';
}

// Gancho de depuración (útil para pruebas automáticas)
window.__VERA_KART__ = {
  get mode() { return mode; },
  get player() { return player; },
  get track() { return track; },
  get karts() { return karts; },
  get store() { return store; },
  controls,
  net,
  startRace,
  selectCharacter,
  // avanza la simulación sin dibujar (solo para pruebas automáticas)
  advance(seconds) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n && (mode === 'countdown' || mode === 'racing' || mode === 'finished'); i++) {
      time += 1 / 60; stepGame(1 / 60); particles.update(1 / 60);
    }
  },
};

init();
requestAnimationFrame(frame);
