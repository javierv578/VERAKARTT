// =========================================================
// VERA KART — kart.js
// Físicas arcade del kart (aceleración, frenado, fricción, gravedad,
// derrape con mini-turbo, colisiones con las barreras) + IA de los rivales.
// El mismo modelo físico sirve para el jugador y para los rivales.
// =========================================================

import * as THREE from 'three';

// ---------- Constantes de física (metros, segundos) ----------
export const PHYS = {
  MAX_SPEED: 42,          // velocidad máxima normal (≈185 km/h en el HUD)
  BOOST_MULT: 1.32,       // multiplicador de velocidad máxima con turbo
  ACCEL: 27,              // aceleración a baja velocidad
  BRAKE: 58,              // frenada
  REVERSE_MAX: 13,
  REVERSE_ACCEL: 16,
  COAST_BASE: 5,          // fricción de rodadura (sin acelerar)
  COAST_SPEED: 0.07,      // fricción dependiente de la velocidad
  GRIP: 11,               // agarre lateral normal (1/s)
  DRIFT_GRIP: 5.2,        // v2.0: agarre en derrape más alto → desliza menos y es más controlable
  GRIP_BLEND: 8,          // v2.0: rapidez con que el agarre cambia entre normal ↔ derrape (suavidad)
  DRIFT_YAW_BASE: 1.3,    // v2.0: giro base en derrape (× giro del volante)
  DRIFT_YAW_RANGE: 0.55,  // v2.0: cuánto cambia el giro al apuntar hacia dentro/fuera de la curva
  TURN_LOW: 2.0,          // giro del volante a baja velocidad (rad/s)
  TURN_HIGH: 1.02,        // giro del volante a máxima velocidad
  GRAVITY: 32,
  RADIUS: 1.15,           // radio de colisión del kart (v2.0: -15%, como el modelo)
  RESTITUTION: 0.3,
  KMH: 4.4,               // factor m/s → km/h mostrado
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Kart {
  /**
   * @param {THREE.Object3D} model  modelo ya normalizado (base en y=0, centrado, frente +Z)
   */
  constructor({ model, name = 'Kart', isPlayer = false, color = '#ffffff', ai = null }) {
    this.name = name;
    this.isPlayer = isPlayer;
    this.color = color;
    this.ai = ai;                      // { skill, lane, phase } si es rival

    this.root = new THREE.Group();     // posición + rumbo
    this.tilt = new THREE.Group();     // cabeceo / alabeo / efecto de derrape
    this.tilt.add(model);
    this.root.add(this.tilt);

    this.proj = {};                    // proyección sobre la pista
    this.events = { hit: 0, padBoost: false, boxBoost: false, driftBoost: 0, driftLevelUp: 0 };
    this.speedScale = ai ? ai.skill : 1;
    this.hitCooldown = 0;
    this.reset(0, 0, 0, 0);
  }

  reset(x, y, z, heading) {
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.heading = heading;
    this.speed = 0;                    // módulo de la velocidad
    this.forwardSpeed = 0;             // componente hacia delante (con signo)
    this.slip = 0;                     // velocidad lateral
    this.grounded = true;
    this.drifting = false; this.driftDir = 0; this.driftTime = 0; this.driftLevel = 0;
    this.boostTime = 0;
    this.hop = 0; this.hopV = 0;
    this.steerVis = 0; this.pitch = 0; this.roll = 0; this.bodyYaw = 0;
    this.contact = false;
    this.turnIn = 0; this.boosting = false;
    this.lap = -1; this.prevS = 0; this.progress = 0;
    this.finished = false; this.finishTime = 0;
    this.lapStart = 0; this.bestLap = Infinity;
    this.stuckTime = 0;
    this.padCooldown = 0;
    this.gripNow = PHYS.GRIP;
    this.proj = {};
  }

  /** Lo coloca sobre la pista (reaparición con R, parrilla, etc.) */
  placeOnTrack(track, s, lat = 0) {
    const o = track.pointAt(s, lat);
    this.x = o.x; this.z = o.z; this.y = o.y; this.heading = o.heading;
    this.vx = this.vz = this.vy = 0;
    this.drifting = false; this.driftTime = 0; this.driftLevel = 0; this.boostTime = 0;
    this.proj = {};
    track.project(this.x, this.z, -1, this.proj);
  }

  startBoost(duration, impulse = 6) {
    const maxV = PHYS.MAX_SPEED * this.speedScale * PHYS.BOOST_MULT;
    this.boostTime = Math.max(this.boostTime, duration);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const vf = this.vx * fx + this.vz * fz;
    const add = Math.min(impulse, Math.max(0, maxV - vf));
    this.vx += fx * add; this.vz += fz * add;
  }

  /**
   * Paso de simulación.
   * input = { throttle 0..1, brake 0..1, steer -1..1 (+ derecha), drift bool }
   */
  update(dt, input, track) {
    const ev = this.events;
    ev.hit = 0; ev.padBoost = false; ev.boxBoost = false; ev.driftBoost = 0; ev.driftLevelUp = 0;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.padCooldown = Math.max(0, this.padCooldown - dt);

    const P = PHYS;
    const boosting = this.boostTime > 0;
    if (boosting) this.boostTime -= dt;
    const maxV = P.MAX_SPEED * this.speedScale * (boosting ? P.BOOST_MULT : 1);

    // --- Base actual (antes de girar) ---
    let h = this.heading;
    let fx = Math.sin(h), fz = Math.cos(h);
    let vf = this.vx * fx + this.vz * fz;
    const vNorm = clamp(Math.abs(vf) / P.MAX_SPEED, 0, 1.3);
    const turnIn = -input.steer;                 // + = girar a la izquierda (rumbo aumenta)

    // --- Derrape (máquina de estados) ---
    if (!this.drifting) {
      if (input.drift && vf > 12 && Math.abs(input.steer) > 0.25 && this.grounded) {
        this.drifting = true;
        this.driftDir = turnIn > 0 ? 1 : -1;
        this.driftTime = 0; this.driftLevel = 0;
        this.hopV = 6.5;                         // saltito visual al iniciar
      }
    } else {
      if (!input.drift || vf < 8) {
        // al soltar: mini-turbo según el nivel cargado
        if (this.driftLevel >= 2) { this.startBoost(1.6, 7); ev.driftBoost = 2; }
        else if (this.driftLevel === 1) { this.startBoost(0.9, 5); ev.driftBoost = 1; }
        this.drifting = false; this.driftTime = 0; this.driftLevel = 0;
      } else {
        this.driftTime += dt;
        const lvl = this.driftTime > 2.0 ? 2 : this.driftTime > 0.9 ? 1 : 0;
        if (lvl > this.driftLevel) { this.driftLevel = lvl; ev.driftLevelUp = lvl; }
      }
    }

    // --- Giro ---
    const dirSign = vf >= 0 ? 1 : -1;
    const speedFactor = clamp(Math.abs(vf) / 7, 0, 1) * dirSign;
    const turnRate = lerp(P.TURN_LOW, P.TURN_HIGH, clamp(vNorm, 0, 1));
    let yawRate;
    if (this.drifting) {
      const along = turnIn * this.driftDir;      // -1 (contra) .. 1 (a favor del derrape)
      yawRate = this.driftDir * turnRate * (P.DRIFT_YAW_BASE + P.DRIFT_YAW_RANGE * along) * speedFactor;
    } else {
      yawRate = turnIn * turnRate * speedFactor;
    }
    h += yawRate * dt;
    this.heading = h = wrapAngle(h);

    // --- Nueva base tras girar: se descompone la velocidad (agarre lateral) ---
    fx = Math.sin(h); fz = Math.cos(h);
    const lx = fz, lz = -fx;
    vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;

    // --- Aceleración / freno / fricción ---
    if (input.throttle > 0) {
      if (vf < -0.5) vf += P.BRAKE * dt;
      else {
        const ratio = clamp(vf / maxV, 0, 1);
        vf += P.ACCEL * (boosting ? 2.4 : 1) * (1 - Math.pow(ratio, 1.6)) * dt;
      }
    } else if (input.brake > 0) {
      if (vf > 0.5) vf -= P.BRAKE * dt;
      else vf -= P.REVERSE_ACCEL * (1 - clamp(-vf / P.REVERSE_MAX, 0, 1)) * dt;
    } else {
      const decel = (P.COAST_BASE + P.COAST_SPEED * Math.abs(vf)) * dt;
      vf = Math.abs(vf) <= decel ? 0 : vf - Math.sign(vf) * decel;
    }
    // exceso de velocidad (al acabar un turbo) → decae suavemente
    if (vf > maxV) vf = Math.max(maxV, vf - 12 * dt);
    if (this.drifting) vf -= 2.0 * dt * vNorm;       // pequeño roce del derrape

    // v2.0: el agarre cambia de forma progresiva (derrape más suave) y la velocidad
    // lateral que se "pierde" al deslizar se devuelve en parte hacia delante.
    const gripTarget = this.drifting ? P.DRIFT_GRIP : P.GRIP;
    this.gripNow += (gripTarget - this.gripNow) * (1 - Math.exp(-P.GRIP_BLEND * dt));
    const vlBefore = vl;
    vl *= Math.exp(-this.gripNow * dt);
    if (this.drifting) vf += Math.abs(vlBefore - vl) * 0.3;

    this.vx = fx * vf + lx * vl;
    this.vz = fz * vf + lz * vl;

    // --- Integración de posición ---
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // --- Colisión estricta con las barreras ---
    const p = track.project(this.x, this.z, this.proj.i === undefined ? -1 : this.proj.i, this.proj);
    const maxLat = track.width / 2 + 0.1 - P.RADIUS;
    this.contact = false;
    if (Math.abs(p.lat) > maxLat) {
      const sgn = Math.sign(p.lat);
      const excess = Math.abs(p.lat) - maxLat;
      const nx = sgn * p.lx, nz = sgn * p.lz;          // normal hacia fuera
      this.x -= nx * (excess + 0.01);
      this.z -= nz * (excess + 0.01);
      p.lat = sgn * maxLat;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        this.vx -= nx * vn * (1 + P.RESTITUTION);
        this.vz -= nz * vn * (1 + P.RESTITUTION);
        const k = 1 - Math.min(0.45, vn * 0.022);       // se pierde velocidad al rozar
        this.vx *= k; this.vz *= k;
        if (vn > 3 && this.hitCooldown <= 0) { ev.hit = vn; this.hitCooldown = 0.25; }
      }
      const scrape = Math.max(0, 1 - 0.8 * dt);          // fricción continua contra el muro
      this.vx *= scrape; this.vz *= scrape;
      // el morro se alinea con la pista para no quedarse "pegado"
      if (vf > 0) {
        const diff = wrapAngle(Math.atan2(p.tx, p.tz) - this.heading);
        if (Math.abs(diff) < 1.7) this.heading = wrapAngle(this.heading + diff * Math.min(1, 3.5 * dt));
      }
      this.contact = true;
    }

    // --- Seguridad: si algo fallara y el kart se alejara, vuelve a la pista ---
    if (Math.abs(p.lat) > track.width) this.placeOnTrack(track, p.s, 0);

    // --- Verticalidad: gravedad + seguir el terreno ---
    const ground = p.y;
    const wasGrounded = this.grounded;
    this.vy -= P.GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.y <= ground) {
      this.y = ground; this.vy = 0; this.grounded = true;
    } else if (wasGrounded && this.y - ground < 0.45 && this.vy <= 0) {
      this.y = ground; this.vy = 0; this.grounded = true;   // pegado a la bajada
    } else {
      this.grounded = this.y - ground < 0.05;
    }

    // --- Turbos del asfalto ---
    if (this.padCooldown <= 0 && this.grounded && track.onBoostPad(p.s, p.lat)) {
      this.startBoost(1.3, 9);
      this.padCooldown = 0.6;
      ev.padBoost = true;
    }

    // --- Cajas de objetos: mini-turbo instantáneo de nivel 2 ---
    if (track.collectBox && track.collectBox(this.x, this.y, this.z)) {
      this.startBoost(1.6, 7);
      ev.boxBoost = true;
    }

    // --- Progreso de vuelta ---
    const d = p.s - this.prevS;
    if (d < -0.5) this.lap++;
    else if (d > 0.5) this.lap--;
    this.prevS = p.s;
    this.progress = this.lap + p.s;

    // --- Datos derivados ---
    this.forwardSpeed = this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
    this.speed = Math.hypot(this.vx, this.vz);
    this.slip = vl;
    this.steerVis += (input.steer - this.steerVis) * (1 - Math.exp(-10 * dt));
    this.turnIn = turnIn;
    this.boosting = this.boostTime > 0;
  }

  /** Aplica posición/rotaciones al objeto 3D (inclinación por pendiente, derrape, saltito). */
  syncVisual(dt) {
    // salto de inicio de derrape
    this.hop += this.hopV * dt; this.hopV -= 38 * dt;
    if (this.hop < 0) { this.hop = 0; this.hopV = 0; }

    const slope = this.proj.slope || 0;
    const fdotT = Math.sin(this.heading) * (this.proj.tx || 0) + Math.cos(this.heading) * (this.proj.tz || 0);
    const targetPitch = -Math.atan(slope * fdotT);
    const targetRoll = (this.drifting ? this.driftDir * 0.13 : 0) + this.turnIn * 0.07 * clamp(this.speed / 30, 0, 1);
    const targetYaw = this.drifting ? this.driftDir * 0.32 + this.turnIn * 0.1 : -this.steerVis * 0.1;
    const k = 1 - Math.exp(-9 * dt);
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    this.bodyYaw += (targetYaw - this.bodyYaw) * k;

    this.root.position.set(this.x, this.y + this.hop, this.z);
    this.root.rotation.set(0, this.heading, 0);
    this.tilt.rotation.set(this.pitch, this.bodyYaw, this.roll, 'YXZ');
  }
}

// ---------- Colisiones kart contra kart ----------
export function resolveKartCollisions(karts) {
  const R = PHYS.RADIUS * 1.15, D = R * 2;
  for (let a = 0; a < karts.length; a++) {
    for (let b = a + 1; b < karts.length; b++) {
      const A = karts[a], B = karts[b];
      if (Math.abs(A.y - B.y) > 2.5) continue;
      const dx = B.x - A.x, dz = B.z - A.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= D * D || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
      const push = (D - d) * 0.5;
      A.x -= nx * push; A.z -= nz * push;
      B.x += nx * push; B.z += nz * push;
      const rel = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;   // < 0 → se acercan
      if (rel < 0) {
        const j = -rel * 0.65;
        A.vx -= nx * j; A.vz -= nz * j;
        B.vx += nx * j; B.vz += nz * j;
        if (-rel > 4) { A.events.hit = Math.max(A.events.hit, -rel); B.events.hit = Math.max(B.events.hit, -rel); }
      }
    }
  }
}

// ---------- Choques con rivales online (fantasmas con posición y velocidad estimadas) ----------
// Solo se mueve el kart local: cada jugador calcula su propia mitad del choque, así queda igual en ambos lados.
export function collideWithGhosts(kart, ghosts) {
  const R = PHYS.RADIUS * 1.15, D = R * 2;
  for (const g of ghosts) {
    if (Math.abs(kart.y - g.y) > 2.5) continue;
    const dx = g.x - kart.x, dz = g.z - kart.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= D * D || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
    const push = (D - d) * 0.5;
    kart.x -= nx * push; kart.z -= nz * push;
    const rel = (g.vx - kart.vx) * nx + (g.vz - kart.vz) * nz;   // < 0 → se acercan
    if (rel < 0) {
      const j = -rel * 0.65;
      kart.vx -= nx * j; kart.vz -= nz * j;
      if (-rel > 4) kart.events.hit = Math.max(kart.events.hit, -rel);
    }
  }
}

// ---------- IA de los rivales ----------
/**
 * Devuelve el input { throttle, brake, steer, drift } de un rival.
 * rubber ∈ ~[0.9, 1.08]: ayuda dinámica para que la carrera sea reñida.
 */
export function aiControl(kart, track, time, rubber = 1) {
  const p = kart.proj;
  if (p.s === undefined) return { throttle: 0, brake: 0, steer: 0, drift: false };

  kart.speedScale = kart.ai.skill * rubber;
  const look = 20 + kart.speed * 0.6;
  const lane = clamp(kart.ai.lane + Math.sin(time * 0.45 + kart.ai.phase) * 3.2, -8.5, 8.5);
  const tgt = track.pointAt(p.s + look / track.length, lane);
  const desired = Math.atan2(tgt.x - kart.x, tgt.z - kart.z);
  const err = wrapAngle(desired - kart.heading);        // + = el objetivo está a la izquierda
  const steer = clamp(-err * 2.6, -1, 1);

  // v2.0: las curvas son muy cerradas → la IA frena según la curvatura que viene
  let kappa = 0;
  for (let off = 0; off <= 40; off += 20) {
    const t = Math.abs(track.turnAhead((p.i + off) % track.N, 20)) / (20 * track.segLen);
    if (t > kappa) kappa = t;
  }
  const cornerSpeed = kappa > 1e-4 ? 0.95 / kappa : Infinity;       // v ≈ giro disponible / curvatura
  const target = Math.min(PHYS.MAX_SPEED * kart.speedScale, Math.max(16, cornerSpeed));
  return {
    throttle: kart.forwardSpeed < target ? 1 : 0,
    brake: 0,
    steer,
    drift: false,
  };
}

// =========================================================
// Rivales ONLINE: un kart 3D por cada jugador conectado a la misma pista.
// Reciben datos de red ~20 veces por segundo y se mueven con interpolación lineal
// (Lerp en posición, Slerp en rotación) para que el movimiento se vea fluido y sin saltos.
// También exponen x/y/z, vx/vz, progreso y meta, como un Kart normal (choques, minimapa, posiciones).
// =========================================================
const REMOTE_SMOOTHING = 14;      // más alto = sigue más pegado a los datos recibidos (menos suave)
const REMOTE_STALE_MS = 3000;     // sin datos durante 3 s → el rival se oculta
const REMOTE_SNAP_DIST = 40;      // saltos mayores (reposicionar, reinicio) no se interpolan

export class RemoteKart {
  /**
   * @param {object} o  { id, name, char, color, makeModel(charId)→Object3D|null, makeTag(texto, color)→Sprite }
   */
  constructor(o) {
    this.id = o.id;
    this.name = o.name || 'Piloto';
    this.char = o.char;
    this.color = o.color || '#38d9ff';
    this.isPlayer = false;
    this._makeModel = o.makeModel;
    this._makeTag = o.makeTag;

    this.root = new THREE.Group();            // posición + rotación (lo que se interpola)
    this.root.visible = false;
    this.model = null; this.tag = null; this.tagText = null;
    this.targetPos = new THREE.Vector3();     // último dato recibido
    this.targetQuat = new THREE.Quaternion();
    this.hasState = false;
    this.lastT = 0;                           // hora (ms) del último dato

    // Campos compatibles con Kart (minimapa, choques y posiciones)
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0;
    this.progress = -1;
    this.finished = false; this.finishTime = 0;
    this.events = { hit: 0 };

    this.rebuild(this.char);
  }

  /** Crea (o rehace) el modelo 3D del rival: el kart de su personaje + etiqueta con su nombre. */
  rebuild(char) {
    if (this.model) this.root.remove(this.model);
    if (this.tag) { this.root.remove(this.tag); if (this.tag.material.map) this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.char = char;
    let model = null;
    try { model = this._makeModel ? this._makeModel(char) : null; } catch (e) { model = null; }
    if (!model) model = basicKart(this.color);          // modelo 3D básico de reserva
    model.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = false; } });
    this.model = model;
    this.root.add(model);
    this.tag = this._makeTag(this.name, this.color);
    this.tagText = this.name;
    this.root.add(this.tag);
  }

  /** Datos recibidos por red: { x, y, z, q:[x,y,z,w], pr, fin }. */
  setTarget(d) {
    // Velocidad estimada (para los choques): diferencia entre dos datos seguidos, suavizada
    const now = performance.now();
    const dtS = (now - this.lastT) / 1000;
    if (this.hasState && dtS > 0.01 && dtS < 0.5) {
      const vx = (d.x - this.targetPos.x) / dtS, vz = (d.z - this.targetPos.z) / dtS;
      if (Math.hypot(vx, vz) < 120) { this.vx += (vx - this.vx) * 0.5; this.vz += (vz - this.vz) * 0.5; }
    } else { this.vx = 0; this.vz = 0; }
    if (typeof d.pr === 'number') this.progress = d.pr;
    this.finished = !!d.fin;
    this.finishTime = d.fin || 0;

    this.targetPos.set(d.x, d.y, d.z);
    this.targetQuat.set(d.q[0], d.q[1], d.q[2], d.q[3]).normalize();
    // Primer dato o teletransporte: colocar directamente, sin deslizar
    if (!this.hasState || this.root.position.distanceTo(this.targetPos) > REMOTE_SNAP_DIST) {
      this.root.position.copy(this.targetPos);
      this.root.quaternion.copy(this.targetQuat);
    }
    this.hasState = true;
    this.lastT = now;
  }

  /** Una vez por fotograma. Devuelve true si el rival está activo (con datos recientes). */
  update(dt, now = performance.now()) {
    const fresh = this.hasState && now - this.lastT < REMOTE_STALE_MS;
    this.root.visible = fresh;
    if (!fresh) return false;
    const k = 1 - Math.exp(-REMOTE_SMOOTHING * dt);
    this.root.position.lerp(this.targetPos, k);          // Lerp de posición
    this.root.quaternion.slerp(this.targetQuat, k);      // Slerp de rotación
    this.x = this.root.position.x; this.y = this.root.position.y; this.z = this.root.position.z;
    return true;
  }

  dispose() {
    this.root.traverse((c) => {
      if (c.isSprite) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
      // los modelos clonados comparten geometría con el original: no se liberan aquí
    });
  }
}

/** Kart básico (cajas y ruedas) por si el modelo del personaje no está disponible. */
function basicKart(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.6), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  body.position.y = 0.55;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), new THREE.MeshStandardMaterial({ color: 0x222233 }));
  seat.position.set(0, 1.0, -0.4);
  g.add(body, seat);
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.9, 0.9]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.38, sz);
    g.add(w);
  }
  return g;
}
