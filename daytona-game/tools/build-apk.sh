#!/usr/bin/env bash
# Daytona 40 — Gradle'sız APK derlemesi (aapt2 + javac + d8 + zipalign + apksigner).
# Gerekenler: JDK 17+, Android SDK (platforms;android-34, build-tools;35.0.0). ANDROID_HOME ayarlı olmalı.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/${BUILD_TOOLS:-35.0.0}"; PF="$SDK/platforms/android-34/android.jar"
OUT=build; rm -rf "$OUT"; mkdir -p "$OUT/assets/www" "$OUT/classes" dist
# Eski WebView uyumluluğu için tek dosyalık klasik betik paketi (import map / ES modül gerektirmez)
npx --yes esbuild@0.24.0 js/main.js --bundle --format=iife --minify --target=es2019 \
  --alias:three=./vendor/three/build/three.module.min.js --alias:three/addons=./vendor/three/examples/jsm \
  --outfile="$OUT/assets/www/game.bundle.js" --log-level=warning
cp -r style.css assets "$OUT/assets/www/"
sed -e '/<script type="importmap">/d' -e 's|<script type="module" src="js/main.js"></script>|<script src="game.bundle.js"></script>|' index.html > "$OUT/assets/www/index.html"
"$BT/aapt2" compile --dir android/res -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PF" --manifest android/AndroidManifest.xml "$OUT/res.zip" -A "$OUT/assets" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "${VERSION_CODE:-1}" --version-name "${VERSION_NAME:-1.0}"
javac -source 8 -target 8 -nowarn -cp "$PF" -d "$OUT/classes" $(find android/src -name '*.java') 2>&1 | grep -v -E "^Picked up|warning|^Note" || true
"$BT/d8" --lib "$PF" --min-api 24 --output "$OUT" $(find "$OUT/classes" -name '*.class') 2>&1 | grep -v "^Picked up" || true
(cd "$OUT" && zip -q -j base.apk classes.dex)
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"
KS="${KEYSTORE:-android/debug.keystore}"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias daytona -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Daytona 40, O=hasaca" 2>&1 | grep -v "^Picked up" || true
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out dist/daytona40.apk "$OUT/aligned.apk" 2>&1 | grep -v "^Picked up" || true
"$BT/apksigner" verify --verbose dist/daytona40.apk 2>&1 | grep -E "Verifies|v[123] scheme" || true
ls -la dist/daytona40.apk
