// =========================================================
// VERA KART — scenery.js
// Entorno procedural: suelo de césped, montañas lejanas y bosque
// (árboles instanciados). Nada se carga de archivos externos.
// =========================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './track.js';

export function createGround(track, grassTex) {
  const SIZE = 9000;
  const tex = grassTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(SIZE / 24, SIZE / 24);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = track.groundY;
  ground.receiveShadow = true;
  return ground;
}

export function createMountains(track, rng) {
  const group = new THREE.Group();
  const colors = [0x6f93c9, 0x7aa0b8, 0x6a8fa8, 0x8aa6d0];
  for (let layer = 0; layer < 2; layer++) {
    const count = 20;
    for (let i = 0; i < count; i++) {
      const a = ((i + rng() * 0.8) / count) * Math.PI * 2;
      const dist = (layer === 0 ? 1700 : 2050) + rng() * 200;
      const h = 220 + rng() * 360;
      const r = 200 + rng() * 260;
      const geo = new THREE.ConeGeometry(r, h, 5 + Math.floor(rng() * 3));
      const mat = new THREE.MeshStandardMaterial({ color: colors[Math.floor(rng() * colors.length)], flatShading: true, roughness: 1 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * dist, track.groundY + h / 2 - 15, Math.sin(a) * dist);
      m.rotation.y = rng() * Math.PI;
      group.add(m);
      // pico nevado
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(r * 0.3, h * 0.28, 5),
        new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 }));
      cap.position.set(m.position.x, track.groundY + h - 15 - h * 0.14 + 2, m.position.z);
      cap.rotation.y = m.rotation.y;
      group.add(cap);
    }
  }
  return group;
}

function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 2.4, 6); trunk.translate(0, 1.2, 0);
  parts.push(colored(trunk, 0x7a4a24));
  const c1 = new THREE.ConeGeometry(2.7, 3.8, 7); c1.translate(0, 3.8, 0);
  const c2 = new THREE.ConeGeometry(2.1, 3.4, 7); c2.translate(0, 5.9, 0);
  const c3 = new THREE.ConeGeometry(1.4, 3.0, 7); c3.translate(0, 7.8, 0);
  parts.push(colored(c1, 0x2f9a45), colored(c2, 0x38b04f), colored(c3, 0x45c75c));
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

function roundTreeGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.4, 0.6, 3.2, 6); trunk.translate(0, 1.6, 0);
  parts.push(colored(trunk, 0x8a5a2b));
  const b1 = new THREE.IcosahedronGeometry(2.9, 1); b1.translate(0, 5.2, 0);
  const b2 = new THREE.IcosahedronGeometry(1.9, 1); b2.translate(1.6, 4.2, 0.5);
  parts.push(colored(b1, 0x6ccf3a), colored(b2, 0x7fdc4a));
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Bosque: se colocan árboles al azar evitando pista y terraplenes. */
export function createTrees(track, rng) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const pine = new THREE.InstancedMesh(pineGeometry(), mat, 320);
  const round = new THREE.InstancedMesh(roundTreeGeometry(), mat, 200);
  pine.castShadow = round.castShadow = true;
  pine.receiveShadow = round.receiveShadow = true;

  // distancia mínima a la pista (stride para ir rápido)
  const minDist2 = (x, z) => {
    let m = Infinity;
    for (let i = 0; i < track.N; i += 3) {
      const dx = x - track.px[i], dz = z - track.pz[i];
      const d = dx * dx + dz * dz;
      if (d < m) m = d;
    }
    return m;
  };

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const place = (mesh, count) => {
    let placed = 0, tries = 0;
    while (placed < count && tries < 8000) {
      tries++;
      const a = rng() * Math.PI * 2;
      const r = 40 + Math.pow(rng(), 0.8) * 900;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (minDist2(x, z) < 62 * 62) continue;
      const s = 0.8 + rng() * 1.1;
      dummy.position.set(x, track.groundY - 0.1, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.set(s, s * (0.9 + rng() * 0.4), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      const v = 0.82 + rng() * 0.3;
      color.setRGB(v, v, v);
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  place(pine, 320);
  place(round, 200);
  group.add(pine, round);
  return group;
}
