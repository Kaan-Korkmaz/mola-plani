# Mola Planı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Takım liderinin linkten (telefon + PC) açtığı, günlük mola/yemek planını kurallara göre otomatik çıkaran, elle düzeltilebilen ve Excel/PNG çıktısı veren PWA.

**Architecture:** Framework'süz statik site (ES modülleri). Saf mantık `js/scheduler.js` içinde (Node ile test edilir), arayüz `js/ui.js`, kayıt `js/store.js`, çıktılar `js/export.js`. GitHub Pages'te yayın, service worker ile çevrimdışı.

**Tech Stack:** HTML/CSS/JS (ES2020 modülleri), `xlsx-js-style` (SheetJS fork'u, hücre renkleri için; `vendor/` altına gömülü), Canvas 2D (PNG), `node --test`.

**Spec:** `docs/2026-11-18-mola-plani-design.md`

## Global Constraints

- Repoda gerçek isim yok; örnek veri "B2C 1", "Mail 2" gibi etiketlerle.
- CDN yok; tüm dosyalar repoda.
- Zaman birimi dakika (gece yarısından itibaren), adım 15 dk.
- Varsayılanlar: Sabahçı 08:00–17:30, Öğlenci 09:00–18:30, Akşamcı 10:30–20:00; ilk/son yasak 60 dk; 3×15 dk mola; 30 dk yemek; yemek aralığı 11:00–16:00; havuz başına aynı anda 1 mola + 1 yemek; havuzlar B2B/B2C/Satış → 1, Mail → 2; kişi kendi olayları arası hedef 60 dk.
- Mobil öncelikli; 360 px genişlikte kullanılabilir.

## Review Focus

1. 12 kişilik gün, "Sarkmasın": 16:00'dan sonra yemek yok, çift yemek dilimlerinde mola yok.
2. 12 kişilik gün, "Sarksın": taşan yemekler sadece akşamcılarda ve `overflow: true`.
3. Elle değiştirilen (kilitli) olay yeniden oluşturmada yerinde kalır.
4. Hiçbir mola kişinin ilk/son 1 saatine veya kendi yemeğine denk gelmez.
5. OFF / plana dahil olmayan kişi hiçbir günde planda görünmez.

---

### Task 1: Zamanlayıcı (scheduler) + testler

**Files:**
- Create: `js/scheduler.js`, `js/defaults.js`, `tests/scheduler.test.mjs`, `package.json` (`"type":"module"`, `"test":"node --test tests/"`)

**Interfaces:**
- Produces:
  - `DEFAULT_SETTINGS` (defaults.js), `SAMPLE_PEOPLE`, `SAMPLE_WEEK` (16–22 Kasım deseni, etiketli)
  - `toMin("HH:MM") -> number`, `fmt(min) -> "HH:MM"`
  - `generateDay({people, shifts, settings, overflowMode, locks}) -> DayPlan`
    - `people`: `[{id, label, group, included}]`, `shifts`: `{[id]: 'S'|'O'|'A'|'OFF'}`
    - `locks`: `{[id]: {lunch?: min, b0?: min, b1?: min, b2?: min}}`
    - `DayPlan = {rows: [{id,label,group,pool,shift,lunch:{start,end,overflow,locked}|null, breaks:[{start,end,key,locked}]}], issues: [{level:'error'|'warn', personId?, text}], pools: {[pool]: {count, needsChoice}}}`
  - `validateDay(dayPlan, settings) -> issues[]`

- [ ] **Step 1: Testleri yaz** — `tests/scheduler.test.mjs`:
  - `sarksin_12`: SAMPLE Pzt, 1. havuz 12 kişi → yemekler 11:00'dan 30'ar dk ardışık, son biten 17:00; `overflow` olanların hepsi `shift==='A'`, sayısı 2.
  - `sarkmasin_12`: aynı gün `overflowMode:'sarkmasin'` → hiçbir yemek `end > 960`; 15:00 ve 15:30'da 2'şer kişi; o 1. havuz molaları `[900,960)` ile kesişmez.
  - `kurallar`: tüm günler, iki mod → her mola `start >= vardiyaBaş+60`, `end <= vardiyaSon-60`, kişinin yemeğiyle kesişmez; havuz başına aynı anda ≤1 mola, ≤ kapasite yemek; `validateDay` hata vermez (uyarı olabilir).
  - `kilit`: Pzt'de bir kişinin `b0` kilidi 10:15 → sonuçta o mola 10:15 ve `locked:true`.
  - `off_haric`: OFF ve `included:false` kişiler `rows`'ta yok.
- [ ] **Step 2:** `npm test` → FAIL (modül yok).
- [ ] **Step 3: Uygula.** Algoritma (havuz başına):
  - Yemek: kişileri vardiya başlangıcı, sonra kadro sırasına göre diz. 30'luk slotlar 11:00'dan. Slot kapasitesi = `cap.lunch`; `sarkmasin` ve `n > 10*cap` ise son `n-10*cap` slotun kapasitesi +1. Her kişiye: kilitliyse onu, değilse en erken uygun slot (izinli pencere içinde, kapasite boş). `sarkmasin`'de 16:00 ötesine gitme (sığmazsa error). `end > 960` → `overflow`.
  - Bloklu çeyrekler: yemek doluluğunun `cap.lunch`'ı aştığı çeyrekler (mola yasak).
  - Molalar: hedefler — yemekten önceki bölümün ortası, yemekten sonraki bölümün 1/3 ve 2/3'ü (yemek yoksa pencerenin 1/4, 2/4, 3/4'ü), 15'e yuvarla. Kilitliler önce. Kalanlar hedef saate göre sıralanır, her biri için hedefe en yakın uygun çeyrek (eşitlikte erken). Kişisel boşluk 60 → 45 → 30 → 15 → 0 kademeli gevşer. Yerleşemezse 1 adımlık takas: dolu çeyreğin sahibini başka uygun çeyreğe kaydırmayı dene. Yine olmazsa `error` "Mola yerleştirilemedi".
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git init`, commit.

### Task 2: Kayıt (store)

**Files:** Create `js/store.js`
**Interfaces:**
- Produces: `load() -> State`, `save(State)`, `mondayOf(Date) -> 'YYYY-MM-DD'`, `ensureWeek(state, mondayKey)` (yoksa önceki haftayı kopyalar, o da yoksa boş), `exportBackup(state) -> string`, `importBackup(string) -> State` (şema kontrolü).
- `State = {v:1, settings, people, weeks: {[monday]: {shifts: {[id]: string[7]}, days: [{overflowMode, locks}] x7}}, current: {week, day}}`
- İlk açılışta `SAMPLE_PEOPLE` + `SAMPLE_WEEK` (2026-11-16) yüklenir.
- [ ] Uygula, tarayıcıda Task 3 ile birlikte doğrula, commit.

### Task 3: Arayüz + PWA

**Files:** Create `index.html`, `css/app.css`, `js/ui.js`, `js/app.js`, `manifest.json`, `sw.js`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`
- Sekmeler: **Plan** (gün seçici Pzt–Paz, havuz başına özet, "Yemek fazlası: Sarksın/Sarkmasın" anahtarı sadece `needsChoice`'ta, uyarı şeridi, zaman çizelgesi 08:00–20:00 çeyrek sütunlar + sabit sol sütun [etiket, grup rozeti, vardiya], "Liste" görünümü, "Otomatik oluştur" ve "Kilitleri temizle"), **Vardiya** (kişi × 7 gün seçici, hafta seçici, önceki haftayı kopyala), **Kadro** (etiket, grup, plana dahil, ekle/sil/yukarı-aşağı), **Ayarlar** (tüm varsayılanlar + "varsayılana dön"), **Çıktı** (Task 4).
- Bloğa dokununca saat seçici modal (izinli çeyrekler, "Kilitle", "Otomatiğe bırak"). Tarayıcı `alert/confirm` kullanılmaz; kendi modalımız.
- Renkler: mola mavi, yemek turuncu, yasak gri tarama, taşma/ihlal kırmızı.
- `sw.js`: cache-first, `CACHE='mola-v1'`, tüm dosyalar ön-önbellek.
- [ ] Yerel sunucuda (python -m http.server) Chrome'da masaüstü + 390 px mobil görünüm ekran görüntüsüyle doğrula; commit.

### Task 4: Çıktılar

**Files:** Create `js/export.js`, `vendor/xlsx.bundle.js`
- `exportWeekXlsx(state)`: her gün ayrı sayfa (`Pzt 16.11` …), sütunlar Kişi | Grup | Vardiya | Mola 1 | Yemek | Mola 2 | Mola 3 (molalar kronolojik; yemek kendi sütununda), havuz sırası, taşan yemek hücresi kırmızı dolgu, başlık koyu. Dosya adı `Mola-Plani_2026-11-16.xlsx`.
- `exportDayPng(state, dayIndex)`: aynı tablo canvas'a (2× ölçek), başlıkta gün/tarih, alt notta uyarılar. `Mola-Plani_Pzt_16-11.png`.
- `share(blob, name)`: `navigator.canShare({files})` varsa paylaş menüsü, yoksa indir.
- Yedekle/Yükle butonları (store fonksiyonları).
- [ ] Dosyaları üret, Excel'i Python openpyxl ile aç ve içeriği kontrol et; PNG'yi gözle kontrol et; commit.

### Task 5: Yayın

- [ ] Repo `mola-plani` (public), GitHub Pages `main` / root. Link + kullanım notu kullanıcıya.
