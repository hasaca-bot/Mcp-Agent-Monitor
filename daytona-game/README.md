# Daytona 40

Tek pist (Daytona tri-oval, 2.5 mil, 31° eğim) ve tek araç modeliyle 40 araçlık paket yarışı. Three.js + WebGL; Android'de tam ekran WebView olarak paketlenir.
Bu klasör depodaki diğer kodlardan bağımsızdır.

## Çalıştırma (tarayıcı)
```
cd daytona-game && python3 -m http.server 8080   # http://localhost:8080
```
Klavye: ←/→ direksiyon · ↑ gaz · ↓ fren/geri · C kamera · R piste dön · P duraklat. `?demo=1&auto=1` yapay zekâ ile izleme modu.

## APK derleme
```
ANDROID_HOME=/yol/android-sdk tools/build-apk.sh    # → dist/daytona40.apk
```
Gerekenler: JDK 17+, Node (esbuild için), Android SDK `platforms;android-34` + `build-tools;35.0.0`. Gradle gerekmez.

## Yapı
| Dosya | İçerik |
|---|---|
| `js/track.js` | Pist geometrisi: eğrilik/eğim profili, spiral geçişler, (s, d) → dünya çerçevesi |
| `js/physics.js` | 240 Hz araç dinamiği: 4 teker Pacejka lastik, yük transferi, banking kuvvetleri, aero + slipstream, motor/şanzıman, OBB çarpışma, duvarlar |
| `js/ai.js` | Rakip sürücüler: şerit seçimi, çekiş arama, geçiş, takip yasası, yan yana güvenlik, spin kurtarma |
| `js/game.js` | Grid, tempo turu → yeşil bayrak, tur/sıralama, oyuncu direksiyon yardımı |
| `js/scene.js` | Pist şeritleri, asfalt shader'ı (güneş yansıması), basamaklı tribün + seyirci sıraları, 2D billboard çevre |
| `js/cars.js` | GLB'den 40 instanced araç, clearcoat boya/cam shader'ı, alpha ile yeniden boyama, parçacıklar |
| `js/post.js` | Bloom + hız bulanıklığı + kromatik sapma + güneş sızması + renk derecelendirme + vinyet/gren |
| `js/audio.js` | Sentez V8, stadyum reverb/eko, kalabalık, rüzgâr, lastik |
| `prompts/ASSET_PROMPTS.md` | 2D asset, menü/yükleme ekranı ve ses üretim promptları |
| `tools/simtest.mjs` | Başsız 40 araç simülasyonu (`node tools/simtest.mjs 5 40`) |
