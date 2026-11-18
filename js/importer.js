// Liderin haftalık vardiya Excel'ini okur.
// Beklenen düzen (esnek): bir satırda "Ad - Soyad" başlığı; yanında kanal sütunu (B2B/B2C/Digital/Satış);
// ardından 7 gün sütunu (Pzt..Paz). Hücreler "09:00 - 18:30" veya "OFF". Üstte tarih satırı olabilir.
import { toMin } from './scheduler.js';

const norm = (s) => String(s ?? '').trim().toLocaleLowerCase('tr');

export function mapGroup(raw, groups) {
  const v = norm(raw);
  if (!v) return 'B2C';
  if (v.includes('digital') || v.includes('dijital') || v.includes('mail')) return 'Mail';
  const hit = groups.find((g) => norm(g) === v);
  if (hit) return hit;
  if (v.includes('b2b')) return 'B2B';
  if (v.includes('b2c')) return 'B2C';
  if (v.includes('satış') || v.includes('satis')) return 'Satış';
  return String(raw).trim();
}

/** "09:00 - 18:30" → vardiya anahtarı (başlangıç saatine en yakın vardiya). OFF/izin/boş → 'OFF'. */
export function mapShift(raw, settings) {
  const v = String(raw ?? '').trim();
  const m = v.match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return { key: 'OFF', exact: /^(off|izin|izinli|rapor|yıllık|-)?$/i.test(v) };
  const start = +m[1] * 60 + +m[2];
  let best = null, bestD = Infinity;
  for (const [k, s] of Object.entries(settings.shifts)) {
    const d = Math.abs(toMin(s.start) - start);
    if (d < bestD) { bestD = d; best = k; }
  }
  return { key: best, exact: bestD === 0 };
}

function excelDate(v) {
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  if (v instanceof Date) return v;
  return null;
}

/**
 * @param aoa satırlar (2B dizi, XLSX.utils.sheet_to_json(ws,{header:1,raw:true}))
 * @returns {{rows:[{name,group,shifts:string[7]}], firstDate:Date|null, warnings:string[]}}
 */
export function parseShiftSheet(aoa, settings) {
  const warnings = [];
  let hr = -1, nameCol = -1;
  for (let r = 0; r < Math.min(aoa.length, 15) && hr < 0; r++) {
    (aoa[r] || []).forEach((c, i) => { if (hr < 0 && /ad\s*[-–]?\s*soyad|isim|personel/i.test(String(c ?? ''))) { hr = r; nameCol = i; } });
  }
  if (hr < 0) throw new Error('"Ad - Soyad" başlığı bulunamadı. Vardiya tablosunu yükleyin.');

  // Gün sütunları: isim satırlarında saat/OFF içeren ilk 7 ardışık sütun
  const dataRows = aoa.slice(hr + 1).filter((r) => r && String(r[nameCol] ?? '').trim());
  const looksShift = (v) => /\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}|^\s*off\s*$/i.test(String(v ?? ''));
  let dayCol = -1;
  const width = Math.max(...dataRows.map((r) => r.length), 0);
  for (let c = nameCol + 1; c < width && dayCol < 0; c++) {
    if (dataRows.filter((r) => looksShift(r[c])).length >= Math.max(1, dataRows.length / 2)) dayCol = c;
  }
  if (dayCol < 0) throw new Error('Vardiya saatleri bulunamadı ("09:00 - 18:30" veya "OFF").');
  const groupCol = dayCol - 1 > nameCol ? dayCol - 1 : -1;

  // Tarih: başlık satırının üstündeki satırlarda gün sütununda
  let firstDate = null;
  for (let r = hr; r >= 0 && !firstDate; r--) firstDate = excelDate(aoa[r]?.[dayCol]);

  const rows = [];
  for (const r of dataRows) {
    const name = String(r[nameCol]).trim();
    if (/^(toplam|total)$/i.test(name)) continue;
    const shifts = [];
    for (let d = 0; d < 7; d++) {
      const raw = r[dayCol + d];
      const { key, exact } = mapShift(raw, settings);
      if (!exact && String(raw ?? '').trim()) warnings.push(`${name} ${d + 1}. gün: "${String(raw).trim()}" → ${key === 'OFF' ? 'OFF' : settings.shifts[key].name} sayıldı`);
      shifts.push(key);
    }
    rows.push({ name, group: mapGroup(groupCol >= 0 ? r[groupCol] : '', settings.groups), shifts });
  }
  return { rows, firstDate, warnings };
}
