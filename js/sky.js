// =========================================================
// VERA KART — sky.js
// Skybox procedural: esfera con shader (degradado azul estilo Mario Kart,
// sol y nubes matemáticas generadas con ruido fBm). Sin imágenes externas.
// =========================================================

import * as THREE from 'three';

// Color del horizonte: se usa también como color de la niebla para que
// el suelo lejano se funda con el cielo sin costuras.
export const HORIZON_HEX = '#c7e6ff';

const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uSunDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(17.1, 9.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    vec3 horizon = vec3(0.780, 0.902, 1.000);   // #c7e6ff
    vec3 mid     = vec3(0.360, 0.660, 0.980);
    vec3 top     = vec3(0.100, 0.360, 0.880);

    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h));
    col = mix(col, top, smoothstep(0.22, 0.95, h));
    if (h < 0.0) col = horizon;

    // Sol con halo
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.93, 0.70) * (pow(sd, 900.0) * 2.0 + pow(sd, 14.0) * 0.20);

    // Nubes: se proyecta la dirección sobre un plano alto y se evalúa ruido fBm
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.16) * 0.85 + vec2(uTime * 0.012, uTime * 0.004);
      float n = fbm(uv * 1.15);
      float c = smoothstep(0.50, 0.80, n);
      float fade = smoothstep(0.0, 0.14, h);
      vec3 shade = mix(vec3(0.74, 0.82, 0.96), vec3(1.0), smoothstep(0.45, 0.95, n));
      col = mix(col, shade, c * fade * 0.96);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor(sunDir) {
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone().normalize() },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2600, 40, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** El cielo siempre se centra en la cámara (parece infinitamente lejano). */
  update(camera, time) {
    this.mesh.position.copy(camera.position);
    this.material.uniforms.uTime.value = time;
  }
}
