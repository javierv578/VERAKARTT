#!/bin/bash
# VERA KART — configura el proyecto iOS: solo horizontal, pantalla completa, sin barra de estado e icono.
# Ejecutar DESPUÉS de:  npx cap add ios
set -e
PLIST="ios/App/App/Info.plist"
PB=/usr/libexec/PlistBuddy
[ -f "$PLIST" ] || { echo "No existe $PLIST. Ejecuta antes: npx cap add ios"; exit 1; }

# Solo horizontal (iPhone e iPad)
for KEY in UISupportedInterfaceOrientations "UISupportedInterfaceOrientations~ipad"; do
  $PB -c "Delete :$KEY" "$PLIST" 2>/dev/null || true
  $PB -c "Add :$KEY array" "$PLIST"
  $PB -c "Add :$KEY:0 string UIInterfaceOrientationLandscapeLeft" "$PLIST"
  $PB -c "Add :$KEY:1 string UIInterfaceOrientationLandscapeRight" "$PLIST"
done

# Pantalla completa, sin barra de estado
$PB -c "Delete :UIStatusBarHidden" "$PLIST" 2>/dev/null || true
$PB -c "Add :UIStatusBarHidden bool true" "$PLIST"
$PB -c "Delete :UIViewControllerBasedStatusBarAppearance" "$PLIST" 2>/dev/null || true
$PB -c "Add :UIViewControllerBasedStatusBarAppearance bool false" "$PLIST"
$PB -c "Delete :UIRequiresFullScreen" "$PLIST" 2>/dev/null || true
$PB -c "Add :UIRequiresFullScreen bool true" "$PLIST"

# Nombre bajo el icono
$PB -c "Set :CFBundleDisplayName VERA KART" "$PLIST" 2>/dev/null || $PB -c "Add :CFBundleDisplayName string VERA KART" "$PLIST"

# Icono de la app (1024x1024)
ICON_DIR="ios/App/App/Assets.xcassets/AppIcon.appiconset"
if [ -d "$ICON_DIR" ]; then
  for f in "$ICON_DIR"/*.png; do
    [ -f "$f" ] && cp resources/icon-1024.png "$f"
  done
  echo "Icono VERA KART instalado."
else
  echo "Aviso: no encontré $ICON_DIR. Arrastra resources/icon-1024.png a AppIcon dentro de Xcode (Assets)."
fi
echo "Info.plist configurado: horizontal + pantalla completa."
