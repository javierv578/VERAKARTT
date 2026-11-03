# VERA KART (online)

Juego de karts 3D (Three.js) con modo multijugador online. Web (PWA con modo offline) + app iOS (Capacitor).

## Estructura
```
verakart-online/
├── www/                      ← TODO el juego (lo que se publica y lo que va dentro de la app iOS)
│   ├── index.html · manifest.json · service-worker.js
│   ├── css/style.css · js/ (main, kart, track, controls, hud, net, sky, scenery, effects, audio)
│   ├── kart.glb · cangri.glb · icons/ · vendor/three/
├── resources/icon-1024.png
├── capacitor.config.json (App ID com.javiervera.verakart) · package.json · configure-ios.sh
└── .github/workflows/pages.yml   ← publica www/ en GitHub Pages
```

## Online
1. Despliega `kart-server` (el mismo servidor sirve a VERA KART y a SENSAKART) en Render.
2. Pega su dirección en `serverUrl` dentro de `www/index.html`.
3. Quienes juegan la misma pista (seed) se ven, salen a la vez, chocan y compiten por la posición. El botón «Invitar» copia el enlace de la pista.

## Publicar en GitHub Pages
Sube todo el contenido (incluida `.github`) a un repositorio y en Settings → Pages elige Source: **GitHub Actions**.

## App iOS (Mac con Xcode 26+ y Node 22+)
```
npm install
npx cap add ios
./configure-ios.sh
npx cap sync ios
npx cap open ios
```
Cada vez que cambies algo en `www/`: sube `VERSION` en `www/service-worker.js` y ejecuta `npx cap sync ios`.
