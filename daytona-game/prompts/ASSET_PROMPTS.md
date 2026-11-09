# Daytona 40 — Asset Üretim Promptları

Oyun tüm bu görseller/sesler **olmadan da çalışır** (prosedürel yedekleri var). Ürettiğin dosyayı aşağıdaki
**tam dosya adıyla** ilgili klasöre koyup `tools/build-apk.sh` çalıştırman yeterli; oyun dosyayı otomatik bulur.

- Çevre dokuları → `assets/textures/`
- Menü / yükleme ekranı → `assets/ui/`
- Sesler → `assets/audio/`

**Ortak stil eki (her görsel promptunun sonuna ekle):**
`stylized semi-realistic game art, clean shapes, slightly low-poly feel that matches a low-poly stock car, warm late-afternoon sunlight coming from the upper left, soft shadows, vivid but natural colors, no text unless specified, no watermark, no logo of real brands`

> Şeffaf zemin isteyenlerde üretici şeffaf PNG veremiyorsa düz **#00FF00 yeşil** zemin iste, sonra arka planı sil.
> "Seamless/tileable" isteyenlerde kenarların döşenebilir olduğunu kontrol et.

---

## 1) Zemin ve gökyüzü

Menüdeki **Zaman** ayarı (Gündüz / İkindi / Gün batımı / Gece) ilgili `sky_*.png` dosyasını yükler; dosya yoksa oyun gökyüzünü kendi shader'ıyla çizer.
Güneşi panoramada soldan 1/3 konumuna koymak, oyundaki güneş ışığı yönüyle (gölgelerle) uyumlu olmasını sağlar.

| Dosya | Boyut | Prompt |
|---|---|---|
| `asphalt.png` | 1024×1024 | `Top-down orthographic seamless tileable texture of race track asphalt, dark grey fine aggregate, subtle tiny speckles and hairline cracks, even flat lighting, no lines, no tire marks, no shadows, no perspective` |
| `grass.png` | 1024×1024 | `Top-down orthographic seamless tileable texture of a freshly mown stadium infield lawn, short dense grass, very subtle mowing stripes, even flat lighting, no shadows, no flowers, no perspective` |
| `sky_day.png` (Gündüz) | 4096×2048 (2:1) | `Equirectangular 360 panorama of a bright midday Florida sky, saturated blue, scattered small white cumulus clouds, high sun at about 50 degrees elevation placed one third from the left edge, flat empty horizon line exactly in the vertical middle, bottom half plain hazy ground color, HDR look, no buildings, no trees` |
| `sky_afternoon.png` (İkindi) | 4096×2048 (2:1) | `Equirectangular 360 panorama of a late afternoon Florida sky, deep blue zenith fading to warm pale horizon, soft cumulus clouds lit golden from one side, low sun at about 25 degrees elevation placed one third from the left edge, flat empty horizon line exactly in the vertical middle, bottom half plain hazy ground color, HDR look, no buildings, no trees` |
| `sky_sunset.png` (Gün batımı) | 4096×2048 (2:1) | `Equirectangular 360 panorama of a dramatic Florida sunset sky, orange and magenta clouds near the horizon, purple-blue zenith, sun disc just above the horizon placed one third from the left edge, strong warm glow around it, flat empty horizon line exactly in the vertical middle, bottom half plain dark warm ground color, HDR look, no buildings, no trees` |
| `sky_night.png` (Gece) | 4096×2048 (2:1) | `Equirectangular 360 panorama of a clear night sky over a floodlit stadium, deep navy to black gradient, many small stars, faint milky way band, soft light-pollution glow along the horizon, small bright moon high on the right, flat empty horizon line exactly in the vertical middle, bottom half plain black, no buildings, no trees` |
| `horizon.png` | 4096×512 şeffaf | `Very wide seamless horizontal panorama strip of a distant flat Florida treeline with a few low far-away buildings, light poles and palm trees, atmospheric haze, bottom edge solid dark green, top two thirds fully transparent background, tileable left to right` |
| `cloud1.png`, `cloud2.png` | 1024×512 şeffaf | `Single soft fluffy cumulus cloud, lit warm from the left with cool blue-grey underside, isolated on a fully transparent background, painterly but clean` |
| `infield_logo.png` | 2048×512 şeffaf | `Huge painted grass logo as seen from directly above, bold italic white letters "DAYTONA" with red outline, slightly faded paint on grass, fully transparent background, flat top-down view` |

## 2) Seyirciler (tribüne merdiven gibi sıra sıra dizilir)

Oyun her tribün basamağına bir "seyirci şeridi" yerleştirir; 3 varyasyon sıralar arasında dönüşümlü kullanılır.

| Dosya | Boyut | Prompt |
|---|---|---|
| `crowd_row1.png` | 2048×256 şeffaf | `One single horizontal row of 14 motorsport fans seen from the front, sitting in grandstand seats, visible from the waist up, colorful team shirts and caps, some cheering with one arm raised, some holding flags or drinks, evenly spaced shoulder to shoulder, heads at the same height, fully transparent background, seamless tileable left to right, no seats visible below the waist` |
| `crowd_row2.png` | 2048×256 şeffaf | `(same as above) different people, more of them standing and clapping, a few wearing sunglasses and headsets` |
| `crowd_row3.png` | 2048×256 şeffaf | `(same as above) different people, calmer seated crowd, families with kids, a few holding phones up` |
| `person1.png` … `person4.png` | 512×1024 şeffaf | `Full body single person standing, front view, [1: male race fan in red cap and shorts cheering / 2: woman in sunglasses holding a small checkered flag / 3: pit crew member in a fire suit and headset, arms crossed / 4: track marshal in orange vest holding a yellow flag], feet at the very bottom edge of the image, centered, fully transparent background` |

## 3) Bitki örtüsü ve pist çevresi

| Dosya | Boyut | Prompt |
|---|---|---|
| `tree1.png` | 512×768 şeffaf | `Single tall sabal palm tree, full tree from ground to top, trunk base at the very bottom edge, centered, fully transparent background` |
| `tree2.png` | 512×768 şeffaf | `Single southern live oak tree with a wide dense canopy, full tree, trunk base at the very bottom edge, centered, fully transparent background` |
| `tree3.png` | 512×768 şeffaf | `Single slash pine tree, tall thin trunk with a sparse crown, full tree, trunk base at the very bottom edge, centered, fully transparent background` |
| `wall_banner.png` | 2048×128 | `Long horizontal strip of trackside advertising banners on a white concrete race track wall, four different fictional sponsors side by side with bold readable text "APEX OIL", "NITRO COLA", "VOLT TIRES", "TURBO PARTS", strong flat colors, thin red stripe along the bottom edge, flat front view, seamless tileable left to right` |
| `billboard1.png` … `billboard3.png` | 1024×512 | `Large trackside billboard artwork, flat front view, fictional [1: fuel brand "SPEEDWAY FUEL" / 2: tire brand "GRIP MAX" / 3: energy drink "THUNDER"], bold italic typography, dynamic diagonal shapes, high contrast` |

## 4) Menü, açılış ve yükleme ekranları (`assets/ui/`)

| Dosya | Boyut | Prompt |
|---|---|---|
| `menu_bg.png` | 2400×1080 | `Cinematic wide shot of a pack of colorful low-poly stock cars racing three-wide on the steep 31-degree banking of a huge superspeedway at golden hour, packed grandstands and catch fence in the background, dramatic low sun with lens flare, motion blur on the track surface, strong depth, darker empty area on the left third for menu text` |
| `loading.png` | 2400×1080 | `Low-angle close-up of a red low-poly stock car number 98 sitting on the starting grid of a superspeedway at sunrise, checkered start line in the foreground, heat haze, blurred grandstands behind, cinematic shallow depth of field, darker lower third for a loading bar` |
| `logo.png` | 1600×500 şeffaf | `Racing game logo, bold italic chrome and red lettering "DAYTONA 40" with a small checkered flag and speed lines, yellow accent on the number 40, metallic bevel, fully transparent background, centered` |
| `icon.png` (uygulama simgesi → `android/res/mipmap-xxxhdpi/ic_launcher.png`) | 512×512 | `Mobile game app icon, front three-quarter view of a red low-poly stock car on a banked track with a checkered flag behind it, bold yellow number 40, rounded square composition, thick clean shapes, high contrast, no small text` |
| (isteğe bağlı) `result_bg.png` | 2400×1080 | `Victory lane celebration at a superspeedway at dusk, confetti in the air, a red low-poly stock car parked under floodlights, cheering crowd blurred behind, empty dark space in the center for a results table` |

## 5) Sesler (`assets/audio/`, isteğe bağlı — ElevenLabs "Sound Effects" için)

Oyundaki motor, yankı (stadyum reverb + tribün ekosu), kalabalık uğultusu, rüzgâr ve lastik sesleri kod içinde sentezlenir.
Aşağıdaki dosyalar varsa sentez kalabalık yerine gerçek kayıt çalınır ve aynı yankı zincirinden geçer.

| Dosya | Süre | Prompt |
|---|---|---|
| `crowd_loop.mp3` | 20–30 sn, loop | `Seamless loop of a huge outdoor motorsport stadium crowd of one hundred thousand people, constant dense murmur and distant cheering, wide stereo, natural stadium reverb, no announcer, no music, no engine sounds` |
| `cheer.mp3` | 4–6 sn | `Sudden massive stadium crowd roar and applause swelling up then fading, outdoor race track grandstand, wide stereo, no music` |

**Senin "bin kere üst üste bindirme" fikrin için:** `crowd_loop.mp3` yerine 5–6 farklı kısa kalabalık kaydı üretip
bir ses editöründe farklı hız (%85–%115) ve gecikmelerle 30–40 katman üst üste bindirirsen aynı yoğun uğultuyu elde edersin;
oyun zaten bu dosyayı tribüne yakınlığa göre açıp kısar ve stadyum yankısına gönderir.
