# Mola Planı — Tasarım Belgesi

Tarih: 2026-11-18 · Durum: onay bekliyor

## 1. Amaç ve neden

Ekipte molalar şu an "biri yemekten dönünce sıradaki çıkar" usulüyle, yazışarak ayarlanıyor. İzinler her gün
değiştiği için sıra karışıyor ve bazı kişilerin yemeği çok geç saate kalıyor. Takım lideri her gün için kurallara
uygun bir mola + yemek planını hızlıca çıkarmak, gerekirse düzeltmek ve ekibe **Excel veya fotoğraf** olarak
göndermek istiyor. Ekip planı liderin gönderdiği çıktıdan takip eder; uygulamayı sadece lider kullanır.

## 2. Hedefler / hedef olmayanlar / başarısızlık sayılacaklar

**Hedefler**
- Lider, WhatsApp'tan gelen **linke tıklayınca** uygulama açılsın — bilgisayarda ve telefonda.
- "Ana ekrana ekle / Yükle" ile program gibi ikonla açılabilsin (PWA), bir kez açıldıktan sonra internetsiz çalışsın.
- O gün çalışanlara göre planı **tek tuşla otomatik** oluştursun; lider elle değiştirebilsin.
- Kural ihlallerini ve yemek taşmalarını **kırmızı** göstersin.
- Çıktı: **Excel (.xlsx)** ve **fotoğraf (PNG)**.
- Lider bir kez girdiği kadroyu/ayarları her açılışta baştan girmesin (cihazda kalıcı kayıt).

**Hedef olmayanlar**
- Ekip üyelerinin uygulamayı kullanması, hesap/giriş sistemi, sunucu, cihazlar arası otomatik eşitleme.
- Vardiya planlaması (vardiyaları lider/şirket belirliyor; uygulama sadece molaları planlar).

**Başarısızlık sayılır (teknik olarak çalışsa bile)**
- Telefonda açılmıyor veya kullanılamayacak kadar sıkışık.
- Lider her gün/hafta her şeyi sıfırdan girmek zorunda kalıyor.
- Aynı havuzda iki kişinin molası/yemeği çakışıyor ve uygulama bunu göstermiyor.
- Gerçek kişi isimleri herkese açık repoya giriyor.

## 3. Kısıtlar

- Barındırma: kullanıcının **GitHub hesabı**, ücretsiz plan → repo **herkese açık**, site linki bilen herkese açık.
  Bu yüzden kodda/repoda **hiçbir gerçek isim veya kişisel veri olmayacak**; veriler sadece liderin cihazında.
- Repoyu sadece sahibi değiştirebilir; liderin verisi uygulama güncellense de silinmez (kayıt anahtarları geriye
  uyumlu tutulacak).
- Tüm kütüphaneler repoya gömülü olacak (CDN yok) → internetsiz çalışma ve kalıcılık.

## 4. Değerlendirilen yollar

| Yol | Artı | Eksi | Karar |
|---|---|---|---|
| **Link (GitHub Pages) + PWA** | Telefonda ve PC'de tek tıkla açılır, ikonla program gibi, güncelleme link değişmeden | Repo herkese açık (veri olmadığı için sorun değil) | **Seçildi** |
| WhatsApp'tan HTML dosyası | Kurulum yok | iPhone'da sadece önizleme açılıyor, Android'de kayıt/indirme güvenilmez | Elendi (telefon şartı) |
| Google E-Tablolar şablonu | Paylaşımı kolay | Uygulama hissi yok, otomatik plan zor, "HTML olsun" isteğine uymuyor | Elendi |

## 5. Alan kuralları (kullanıcının belirledikleri)

**Vardiyalar** (hepsi 9,5 saat):

| Ad | Saat | Mola verilebilir aralık (ilk ve son 1 saat yasak) |
|---|---|---|
| Sabahçı | 08:00–17:30 | 09:00–16:30 |
| Öğlenci | 09:00–18:30 | 10:00–17:30 |
| Akşamcı | 10:30–20:00 | 11:30–19:00 |
| OFF | izinli | plana girmez |

**Molalar (kişi başı):** 3 × 15 dk mola + 1 × 30 dk yemek. "İlk 1 saat / son 1 saat yok" kuralı yemek dahil
tüm molalar için geçerli (mola, yasak saate taşamaz — bitişi de aralıkta olmalı).

**Gruplar ve havuzlar**
- Gruplar (sol tarafta etiket olarak görünür): **B2B**, **B2C**, **Mail** (Excel'de "Digital"), **Satış**.
- **1. havuz:** B2B + B2C + Satış. **2. havuz:** Mail.
- Her havuzda aynı anda **en fazla 1 kişi 15'lik molada** ve **en fazla 1 kişi yemekte** olabilir.
  Molada biri + yemekte başka biri aynı anda olabilir. Havuzlar birbirinden bağımsızdır.
- Kişi bazında "**Plana dahil**" anahtarı: kapalıysa o kişi hiç planlanmaz (gerçek ekipte 2 kişi böyle).

**Yemek**
- Yemek aralığı **11:00–16:00** (ilk yemek 11:00'de başlar).
- Sıra: önce **sabahçılar**, sonra **öğlenciler**, en son **akşamcılar**.
- O günkü kişi sayısı aralığa sığmazsa (havuz kapasitesi 1 iken > 10 kişi) günlük plan ekranında bir
  **"Yemek fazlası" anahtarı** çıkar (gün bazında seçilir, varsayılan: Sarksın):
  - **Sarksın:** yemekler **16:00'dan sonra arka arkaya devam eder**; taşanlar akşamcılardan olur (sıra kuralı
    gereği zaten en sonda). Taşan yemekler **kırmızı** işaretlenir, üstte uyarı ("2 yemek 16:00 sonrasına taştı").
  - **Sarkmasın:** yemekler 16:00'da biter; fazla kişi sayısı kadar 30'luk dilimde **aynı anda 2 kişi yemekte**
    olur (12 kişi → 2 çift dilim). Çift yemek dilimlerinde o havuzdan **kimse 15'lik molada olamaz**. Çift
    dilimler sıranın en sonuna konur (sabahçılar yalnız yer, çiftler öğlenci/akşamcılardan oluşur) — uygulayıcı
    kararı, ayarlardan değiştirilebilir değil, gerekirse sonra.
- Taşma, kişinin kendi "son 1 saat" sınırını da aşıyorsa → plan kurulamaz, açık hata mesajı.
- **Bilinen sıkışıklık:** 1. havuzda 12 kişi × 3 = 36 mola, aynı anda 1 kişi kuralıyla 09:00–19:00 arasındaki
  40 çeyrek saatin neredeyse tamamını doldurur ("Sarkmasın" modunda çift yemek dilimleri bu sayıyı 36'ya indirir).
  Vardiya dağılımına göre birkaç mola yerleşemeyebilir → kırmızı "yerleştirilemedi" + elle yerleştirme;
  ayarlardan mola kapasitesi 2 yapılabilir.

**Gerçek ekip örneği (16–22 Kasım):** 1. havuzda hafta içi 11–12 kişi, hafta sonu ~6; Mail'de 2–3 kişi.
Pazartesi 12 kişi → 2 yemek taşar (16:00–17:00, akşamcılar).

## 6. Kararlaştırılan çözüm

**Teknoloji:** Tek sayfalık statik web uygulaması (HTML + CSS + sade JavaScript, framework yok), GitHub Pages'te,
`manifest.json` + service worker ile yüklenebilir/çevrimdışı. Excel için SheetJS (repoya gömülü). PNG çıktısı
tablonun canvas'a kendimiz çizilmesiyle (ek kütüphane gerekmez). Veriler `localStorage`'da.

**Ekranlar**
1. **Kadro** — kişi listesi: etiket (varsayılan "Sabahçı B2C 1" gibi otomatik, düzenlenebilir), grup, plana dahil.
   Kişi ekle/sil/sırala.
2. **Haftalık vardiya** — satır kişi, sütun 7 gün; hücrede Sabahçı / Öğlenci / Akşamcı / OFF seçimi
   (telefonda dokununca seçenek listesi). "Önceki haftayı kopyala".
3. **Günlük plan** — gün seçici; satır kişi (solda etiket + grup rozeti + vardiya), sütunlar 15'er dakikalık zaman
   çizelgesi 08:00–20:00. Molalar ☕ / yemek 🍽️ blokları, yasak saatler gri, ihlaller ve taşmalar kırmızı.
   Üstte uyarı şeridi. "Otomatik oluştur" butonu. Bir bloğa dokununca saat seçici açılır (sürükle-bırak PC'de
   isteğe bağlı). Telefonda tablo yatay kaydırılır, sol sütun sabit kalır. Alternatif liste görünümü:
   kişi başına "☕ 10:15 · 🍽️ 11:00 · ☕ 13:30 · ☕ 15:00".
4. **Ayarlar** — vardiya saatleri, ilk/son yasak süre, mola sayısı/süresi, yemek süresi ve aralığı, havuz başına
   aynı anda mola/yemek kapasitesi, grup→havuz eşlemesi. Hepsi düzenlenebilir, "varsayılana dön".
5. **Çıktı/Yedek** — "Excel indir" (haftalık: her gün ayrı sayfa; günlük: tek sayfa; sütunlar Kişi | Grup |
   Vardiya | Mola 1 | Yemek | Mola 2 | Mola 3, taşmalar kırmızı), "Fotoğraf indir" (seçili günün tablosu PNG),
   "Yedekle / Yedekten yükle" (JSON dosyası; telefon↔PC taşıma için). Telefonda paylaş menüsü destekleniyorsa
   doğrudan WhatsApp'a paylaşma.

**Otomatik plan (her gün, her havuz için ayrı)**
1. Yemek: kişileri vardiya başlangıcına göre sırala (sabahçı → öğlenci → akşamcı; aynı vardiyada kadro sırası),
   11:00'den itibaren kapasiteye göre 30'ar dakika ardışık yerleştir; kişinin izinli aralığına uymuyorsa bir sonraki
   uygun slota kaydır. 16:00 sonrası = taşma (kırmızı).
2. Molalar: her kişi için 3 molayı izinli aralığına yay (1 tanesi yemekten önce, 2 tanesi sonra hedeflenir),
   hedef saate en yakın boş 15'lik slotu seç; havuz kapasitesi, kişinin kendi yemeğiyle çakışma ve kişinin kendi
   molaları arası en az boşluk (varsayılan 60 dk, sığmazsa kademeli düşürülür) kontrol edilir.
3. Yerleşemeyen mola olursa: kırmızı uyarı + kişi satırında boş blok, lider elle yerleştirir.
4. Elle değiştirilen bloklar "kilitli" kabul edilir; yeniden "Otomatik oluştur" kilitleri koruyarak kalanları dizer
   (tamamen sıfırlamak için ayrı buton).

## 7. Sonraya bırakılanlar

- **Liderin Excel vardiya dosyasını içe aktarma** (A: isim, B: kanal, C–I: günler, hücre "HH:MM - HH:MM" / "OFF").
  Gerçek .xlsx dosyası gelince eklenecek; o zamana kadar vardiyalar uygulamada seçilir.
- Gerçek isimler: lider uygulamada etiketleri isimle değiştirebilir (sadece kendi cihazında kalır).

## 8. Uygulayıcıya bırakılanlar

Renk paleti ve görsel stil (sade, okunaklı, mobil öncelikli), dosya yapısı, mola dağıtım algoritmasının ince
ayarı, PNG çizim detayları, repo adı (öneri: `mola-plani`).
