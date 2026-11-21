// Excel'den kopyalanan vardiya tablosunu (sekmeyle ayrılmış metin) okur.
// Beklenen biçim (esnek): Ad Soyad | Birim | Pzt … Paz | (fazla sütunlar yok sayılır)
// Hücreler: "09:00 - 18:30", "9-18.30", "OFF", "İzinli", "Resmi tatil", "Eğitim", "ISTIFA" …
// Üst satırlarda tarih ("23-Nov", "23.Kas", "23.11.2026") ve gün adı (Pzt, Sal…) varsa kullanılır.

const TR = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
export const norm = (s) => String(s ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
  .replace(/[çğıöşüâîû]/g, (c) => TR[c]).replace(/\s+/g, ' ').trim();

const DAY_KEYS = [
  ['pzt', 'pazartesi', 'pts', 'mon', 'monday'],
  ['sal', 'sali', 'tue', 'tuesday'],
  ['car', 'carsamba', 'crs', 'wed', 'wednesday'],
  ['per', 'persembe', 'prs', 'thu', 'thursday'],
  ['cum', 'cuma', 'fri', 'friday'],
  ['cmt', 'cumartesi', 'sat', 'saturday'],
  ['paz', 'pazar', 'sun', 'sunday'],
];
const dayIndex = (cell) => { const n = norm(cell).replace(/\.$/, ''); return DAY_KEYS.findIndex((ks) => ks.includes(n)); };

const MONTHS = [['oca', 'jan'], ['sub', 'feb'], ['mar'], ['nis', 'apr'], ['may'], ['haz', 'jun'],
  ['tem', 'jul'], ['agu', 'aug'], ['eyl', 'sep'], ['eki', 'oct'], ['kas', 'nov'], ['ara', 'dec']];
const monthOf = (w) => { const p = norm(w).slice(0, 3); return MONTHS.findIndex((ks) => ks.includes(p)); };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDaysYmd = (key, n) => { const [y, m, d] = key.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
export const weekdayOf = (key) => { const [y, m, d] = key.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; };

/** Hücre bir tarih mi? Yıl yoksa bugüne en yakın yıl seçilir. Dönüş: 'YYYY-MM-DD' ya da null */
export function parseDate(cell, today = new Date()) {
  const s = norm(cell);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ymd(new Date(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[-./ ]+([a-z]+|\d{1,2})\.?(?:[-./ ]+(\d{2,4}))?$/);
  if (!m) return null;
  const day = +m[1];
  const mon = /^\d+$/.test(m[2]) ? +m[2] - 1 : monthOf(m[2]);
  if (mon < 0 || mon > 11 || day < 1 || day > 31) return null;
  if (m[3]) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return ymd(new Date(y, mon, day)); }
  const ty = today.getFullYear();
  const best = [ty - 1, ty, ty + 1].map((y) => new Date(y, mon, day))
    .sort((a, b) => Math.abs(a - today) - Math.abs(b - today))[0];
  return ymd(best);
}

const WORDS = {
  OFF: ['off', 'x', 'hafta tatili', 'ht', 'izin gunu', 'tatil'],
  IZ: ['izin', 'izinli', 'yillik izin', 'yi', 'ui', 'ucretsiz izin', 'rapor', 'raporlu', 'mazeret', 'mazeret izni'],
  RT: ['rt', 'resmi tatil', 'bayram', 'resmi'],
  EGT: ['egitim', 'egt', 'training'],
};
const RESIGN = ['istifa', 'ayrildi', 'cikis', 'isten ayrildi'];
const toMin = (h, m) => +h * 60 + (+m || 0);
const hm = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Tek hücreyi vardiya koduna çevirir.
 * Dönüş: null (vardiya değil) | { code, resigned?, warn?, raw }
 * Bilinmeyen saat aralığı en yakın başlangıçlı vardiyaya eşlenir ve warn döner.
 */
export function parseCell(cell, settings) {
  const raw = String(cell ?? '').trim();
  const s = norm(raw);
  if (!s) return null;
  if (RESIGN.includes(s)) return { code: 'OFF', resigned: true, raw };
  for (const [code, ws] of Object.entries(WORDS)) if (ws.includes(s)) return { code, raw };
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?$/) || s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const start = toMin(m[1], m[2]);
  const end = m[3] != null ? toMin(m[3], m[4]) : null;
  // "23-11" gibi tarihler saat sanılmasın: saat 0–23, bitiş başlangıçtan sonra
  if (+m[1] > 23 || (m[3] != null && (+m[3] > 24 || end <= start))) return null;
  const sh = Object.entries(settings.shifts).map(([k, v]) => ({ k, s: hm(v.start), e: hm(v.end) }));
  const exact = sh.find((x) => x.s === start && (end == null || x.e === end));
  if (exact) return { code: exact.k, raw };
  const near = sh.sort((a, b) => Math.abs(a.s - start) - Math.abs(b.s - start))[0];
  return { code: near.k, raw, warn: `${raw} tanımlı değil → ${settings.shifts[near.k].start}–${settings.shifts[near.k].end} sayıldı` };
}

/** Birim hücresi: Ayarlar'daki birimler + takma adlar (örn. Digital → Mail) */
export function parseGroup(cell, settings) {
  const s = norm(cell);
  if (!s) return null;
  const g = settings.groups.find((x) => norm(x) === s);
  if (g) return g;
  const al = Object.entries(settings.groupAliases || {}).find(([k]) => norm(k) === s);
  return al && settings.groups.includes(al[1]) ? al[1] : null;
}

/**
 * Yapıştırılan metni çözer.
 * @param text  Excel'den kopyalanan metin
 * @param opt   { settings, people, fallbackMonday:'YYYY-MM-DD', startDate?:'YYYY-MM-DD', today?:Date }
 * @returns { rows:[{name, group, cells:[parsed|null]×n, personId, deleted, resigned}], dates:[ymd]×n, detected, missing:[label], warns:[text] }
 */
export function parsePaste(text, { settings, people, fallbackMonday, startDate, today = new Date() }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
    .map((l) => l.split('\t').map((c) => c.replace(/^"(.*)"$/s, '$1').trim()));
  const isData = (r) => r.filter((c) => parseCell(c, settings)).length >= 3;
  const firstData = lines.findIndex(isData);
  if (firstData < 0) return { rows: [], dates: [], detected: false, missing: [], warns: ['Vardiya satırı bulunamadı. Excel\'de isimlerin ve günlerin olduğu hücreleri seçip kopyala.'] };

  // Gün sütunları: başlıkta gün adları varsa onlar, yoksa ilk veri satırındaki ilk vardiya hücresinden itibaren 7 sütun
  let dayCols = null, dayNames = null;
  for (const r of lines.slice(0, firstData)) {
    const idx = r.map((c, i) => [i, dayIndex(c)]).filter(([, d]) => d >= 0);
    if (idx.length >= 5) { dayCols = idx.map(([i]) => i); dayNames = idx.map(([, d]) => d); break; }
  }
  if (!dayCols) {
    const data = lines.filter(isData);
    const first = Math.min(...data.map((r) => r.findIndex((c) => parseCell(c, settings))));
    dayCols = Array.from({ length: 7 }, (_, k) => first + k);
  }
  const n = dayCols.length;

  // Tarihler: gün sütununa denk gelen ilk tarih hücresi çapa olur
  let dates, detected = false;
  if (startDate) dates = dayCols.map((_, k) => addDaysYmd(startDate, k));
  else {
    let anchor = null;
    for (const r of lines.slice(0, firstData)) {
      for (let k = 0; k < n && !anchor; k++) { const d = parseDate(r[dayCols[k]], today); if (d) anchor = { k, d }; }
      if (anchor) break;
    }
    if (anchor) { dates = dayCols.map((_, k) => addDaysYmd(anchor.d, k - anchor.k)); detected = true; }
    else dates = dayCols.map((_, k) => addDaysYmd(fallbackMonday, (dayNames ? dayNames[0] : 0) + k));
  }

  const byName = new Map(people.map((p) => [norm(p.label), p]));
  const warns = [];
  if (dayNames && !startDate) dayNames.forEach((d, k) => {
    if (weekdayOf(dates[k]) !== d) warns.push(`Tarih ile gün adı uyuşmuyor (${dates[k]}). İlk gün tarihini kontrol et.`);
  });
  const rows = [];
  for (const r of lines.slice(firstData)) {
    if (!isData(r)) continue;
    const before = r.slice(0, dayCols[0]);
    let group = null, name = '';
    for (const c of before) {
      const g = parseGroup(c, settings);
      if (g && !group) { group = g; continue; }
      if (!name && /\p{L}/u.test(c) && !parseCell(c, settings)) name = c.replace(/\s+/g, ' ').trim();
    }
    if (!name) { warns.push('İsmi olmayan bir satır atlandı.'); continue; }
    const cells = dayCols.map((i) => parseCell(r[i], settings));
    cells.forEach((c) => c?.warn && warns.push(`${name}: ${c.warn}`));
    const p = byName.get(norm(name));
    const filled = cells.filter(Boolean);
    rows.push({ name, group, cells, personId: p?.id || null, deleted: !!p?.deleted,
      resigned: filled.length > 0 && filled.every((c) => c.resigned) });
  }
  const seen = new Set(rows.map((r) => r.personId).filter(Boolean));
  const missing = people.filter((p) => !p.deleted && !seen.has(p.id)).map((p) => p.label);
  return { rows, dates, detected, missing, warns: [...new Set(warns)] };
}
