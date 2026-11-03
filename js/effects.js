// =========================================================
// VERA KART — effects.js
// Sistema de partículas (polvo, chispas de derrape, llamas de turbo).
// Un solo THREE.Points con shader propio y un pool fijo de partículas.
// =========================================================

import * as THREE from 'three';

const MAX = 700;

const vs = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const fs = /* glsl */`
  precision mediump float;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.cursor = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;

    this.material = new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs,
      uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  setViewportHeight(h) { this.material.uniforms.uScale.value = h * 0.9; }

  emit(x, y, z, vx, vy, vz, { color = [1, 1, 1], size = 1, life = 0.6, gravity = 0 } = {}) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size; this.grav[i] = gravity;
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = k;
      this.size[i] = this.size0[i] * (0.6 + (1 - k) * 0.8);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }

  // ----- Emisores específicos -----
  dust(x, y, z, vx, vz) {
    this.emit(x + (Math.random() - 0.5) * 0.6, y + 0.15, z + (Math.random() - 0.5) * 0.6,
      vx * 0.1 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.2, vz * 0.1 + (Math.random() - 0.5) * 1.5,
      { color: [0.86, 0.84, 0.78], size: 0.7 + Math.random() * 0.6, life: 0.55 + Math.random() * 0.3 });
  }

  spark(x, y, z, level) {
    const col = level >= 2 ? [1.0, 0.55, 0.1] : level === 1 ? [0.3, 0.7, 1.0] : [1.0, 0.95, 0.6];
    this.emit(x, y + 0.1, z,
      (Math.random() - 0.5) * 7, 2 + Math.random() * 4, (Math.random() - 0.5) * 7,
      { color: col, size: 0.22 + Math.random() * 0.16, life: 0.28 + Math.random() * 0.2, gravity: 14 });
  }

  flame(x, y, z, vx, vy, vz) {
    this.emit(x, y, z, vx + (Math.random() - 0.5) * 2, vy + Math.random(), vz + (Math.random() - 0.5) * 2,
      { color: Math.random() > 0.5 ? [1, 0.6, 0.1] : [1, 0.9, 0.3], size: 0.55 + Math.random() * 0.4, life: 0.25 + Math.random() * 0.15 });
  }

  wallSparks(x, y, z, strength) {
    const n = Math.min(14, 3 + Math.floor(strength));
    for (let i = 0; i < n; i++) this.spark(x, y + 0.6, z, 0);
  }
}
