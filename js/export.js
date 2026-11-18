// Çıktılar: Excel (.xlsx, renkli) ve fotoğraf (PNG). İnternet gerekmez.
import { fmt } from './scheduler.js';

export const GROUP_ORDER = ['B2B', 'B2C', 'Mail', 'Satış'];
export const GROUP_COLOR = { B2B: '7C3AED', B2C: '0891B2', Mail: '15803D', 'Satış': 'BE185D' };
const range = (e) => `${fmt(e.start)}–${fmt(e.end)}`;

/** Sütun düzeni: Operasyon | Vardiya | Kişi | 1. Mola | 2. Mola | Yemek | 3. Mola (yemek son molanın önünde). */
export function columns(st) {
  const k = st.breakCount;
  const lunchAt = k >= 2 ? k - 1 : k; // kaçıncı moladan önce yemek
  const cols = [{ t: 'group', h: 'Operasyon' }, { t: 'shift', h: 'Vardiya' }, { t: 'name', h: 'Kişi' }];
  for (let i = 0; i < k; i++) {
    if (i === lunchAt) cols.push({ t: 'lunch', h: 'Yemek' });
    cols.push({ t: 'break', i, h: `${i + 1}. Mola` });
  }
  if (lunchAt >= k) cols.push({ t: 'lunch', h: 'Yemek' });
  return cols;
}

/** Bir günün planını tabloya çevirir (uygulama, Excel ve PNG aynı tabloyu kullanır). */
export function dayTable(plan, st) {
  const cols = columns(st);
  const badIds = new Set(plan.issues.filter((i) => i.level === 'error').flatMap((i) => i.personIds || (i.personId ? [i.personId] : [])));
  const warnIds = new Set(plan.issues.filter((i) => i.level === 'warn' && i.personId).map((i) => i.personId));
  const rows = [];
  // Sıra: B2B en üstte, sonra B2C, Mail, en altta Satış; grup içinde vardiya saatine göre.
  const rank = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
  const rs = [...plan.rows].sort((a, b) => rank(a.group) - rank(b.group) || a.shiftStart - b.shiftStart || a.order - b.order);
  let prev = null;
  {
    for (const r of rs) {
      const sh = st.shifts[r.shift];
      const br = [...r.breaks].sort((a, b) => a.start - b.start);
      const cells = cols.map((c) => {
        if (c.t === 'shift') return { text: `${sh.start}–${sh.end}`, shift: r.shift };
        if (c.t === 'name') return { text: r.label };
        if (c.t === 'group') return { text: r.group, group: r.group };
        if (c.t === 'lunch') return r.lunch ? { text: range(r.lunch), ev: r.lunch, key: 'lunch', over: r.lunch.overflow } : { text: '—', key: 'lunch' };
        const b = br[c.i];
        return b ? { text: range(b), ev: b, key: b.key } : { text: '—' };
      });
      rows.push({ r, cells, over: !!r.lunch?.overflow, bad: badIds.has(r.id), warn: warnIds.has(r.id), groupStart: prev !== null && prev !== r.group });
      prev = r.group;
    }
  }
  return { cols, rows };
}

const S_HEAD = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A8A' } }, alignment: { horizontal: 'center' } };
const S_POOL = { font: { bold: true, color: { rgb: '1E3A8A' } }, fill: { fgColor: { rgb: 'E0E7FF' } } };
const S_OVER = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: 'DC2626' } }, alignment: { horizontal: 'center' } };
const S_BAD = { font: { color: { rgb: 'B91C1C' } }, fill: { fgColor: { rgb: 'FEE2E2' } } };
const S_C = { alignment: { horizontal: 'center' } };
const SH_FILL = { S: '93C5FD', O: '4ADE80', A: 'FB923C' };

function sheetFor(plan, st, title) {
  const XLSX = globalThis.XLSX;
  const { cols: cdef, rows: t } = dayTable(plan, st);
  const head = cdef.map((c) => c.h);
  const aoa = [[title], head];
  t.forEach((r) => aoa.push(r.poolHeader ? [`${r.poolHeader} — ${r.count} kişi`] : r.cells.map((c) => c.text)));
  const notes = plan.issues.map((i) => `${i.level === 'error' ? '⛔' : '⚠'} ${i.text}`);
  if (notes.length) { aoa.push([]); notes.forEach((n) => aoa.push([n])); }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const cols = head.length;
  const set = (r, c, s) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].s = s; else ws[a] = { t: 's', v: '', s }; };
  set(0, 0, { font: { bold: true, sz: 14 } });
  for (let c = 0; c < cols; c++) set(1, c, S_HEAD);
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols - 1 } }];
  t.forEach((r, i) => {
    const R = i + 2;
    if (r.poolHeader) { for (let c = 0; c < cols; c++) set(R, c, S_POOL); merges.push({ s: { r: R, c: 0 }, e: { r: R, c: cols - 1 } }); return; }
    r.cells.forEach((c, ci) => {
      const t2 = cdef[ci].t;
      let s = t2 === 'name' ? { font: { bold: true } } : { ...S_C };
      if (r.bad) s = { ...s, ...S_BAD };
      if (t2 === 'shift' && SH_FILL[c.shift]) s = { ...S_C, font: { bold: true }, fill: { fgColor: { rgb: SH_FILL[c.shift] } } };
      if (t2 === 'group') s = { ...S_C, font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: GROUP_COLOR[c.group] || '6B7280' } } };
      if (c.over) s = S_OVER;
      set(R, ci, s);
    });
  });
  const noteStart = t.length + 3;
  notes.forEach((n, i) => {
    set(noteStart + i, 0, { font: { color: { rgb: n.startsWith('⛔') ? 'B91C1C' : 'B45309' } } });
    merges.push({ s: { r: noteStart + i, c: 0 }, e: { r: noteStart + i, c: cols - 1 } });
  });
  ws['!merges'] = merges;
  ws['!cols'] = cdef.map((c) => ({ wch: c.t === 'name' ? 22 : c.t === 'group' ? 11 : 14 }));
  return ws;
}

/** days: [{plan, title, sheetName}] */
export function xlsxBlob(days, st) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('Excel kütüphanesi yüklenemedi');
  const wb = XLSX.utils.book_new();
  for (const d of days) XLSX.utils.book_append_sheet(wb, sheetFor(d.plan, st, d.title), d.sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Günün tablosunu PNG olarak çizer. */
export async function pngBlob(plan, st, title) {
  const { cols: cdef, rows: t } = dayTable(plan, st);
  const head = cdef.map((c) => c.h);
  const notes = plan.issues.map((i) => ({ bad: i.level === 'error', text: i.text }));
  const colW = cdef.map((c) => (c.t === 'name' ? 180 : c.t === 'group' ? 100 : c.t === 'shift' ? 130 : 115));
  const W = colW.reduce((a, b) => a + b, 0) + 40;
  const rowH = 34, top = 76;
  const H = top + rowH * (t.length + 1) + (notes.length ? 20 + notes.length * 22 : 0) + 30;
  const scale = 2;
  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1e3a8a'; g.font = 'bold 22px system-ui, Segoe UI, sans-serif';
  g.fillText(title, 20, 40);
  g.fillStyle = '#6b7280'; g.font = '13px system-ui, Segoe UI, sans-serif';
  g.fillText('☕ Mola Planı', 20, 62);
  const x0 = 20;
  const cellText = (txt, x, y, w, color = '#111827', bold = false, align = 'center') => {
    g.fillStyle = color; g.font = `${bold ? 'bold ' : ''}14px system-ui, Segoe UI, sans-serif`;
    g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(txt, align === 'center' ? x + w / 2 : x + 8, y + rowH / 2);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  };
  let y = top;
  let x = x0;
  g.fillStyle = '#1e3a8a'; g.fillRect(x0, y, W - 40, rowH);
  head.forEach((h, i) => { cellText(h, x, y, colW[i], '#fff', true); x += colW[i]; });
  y += rowH;
  const shFill = { S: '#93c5fd', O: '#4ade80', A: '#fb923c' };
  t.forEach((r, idx) => {
    if (r.poolHeader) {
      g.fillStyle = '#e0e7ff'; g.fillRect(x0, y, W - 40, rowH);
      cellText(`${r.poolHeader} — ${r.count} kişi`, x0, y, W - 40, '#1e3a8a', true, 'left');
    } else {
      g.fillStyle = r.bad ? '#fee2e2' : idx % 2 ? '#f9fafb' : '#ffffff'; g.fillRect(x0, y, W - 40, rowH);
      x = x0;
      r.cells.forEach((c, i) => {
        const t2 = cdef[i].t;
        if (t2 === 'shift' && shFill[c.shift]) { g.fillStyle = shFill[c.shift]; g.fillRect(x + 1, y + 1, colW[i] - 2, rowH - 2); }
        if (t2 === 'group') { g.fillStyle = '#' + (GROUP_COLOR[c.group] || '6B7280'); g.fillRect(x + 1, y + 1, colW[i] - 2, rowH - 2); }
        if (c.over) { g.fillStyle = '#dc2626'; g.fillRect(x + 1, y + 1, colW[i] - 2, rowH - 2); }
        const color = c.over || t2 === 'group' ? '#fff' : r.bad && t2 === 'name' ? '#b91c1c' : '#111827';
        cellText(c.text, x, y, colW[i], color, t2 === 'name' || t2 === 'shift' || t2 === 'group' || !!c.over, t2 === 'name' ? 'left' : 'center');
        x += colW[i];
      });
    }
    if (r.groupStart) { g.fillStyle = '#1e3a8a'; g.fillRect(x0, y - 1, W - 40, 2); }
    g.strokeStyle = '#e5e7eb'; g.beginPath(); g.moveTo(x0, y + rowH + .5); g.lineTo(W - 20, y + rowH + .5); g.stroke();
    y += rowH;
  });
  if (notes.length) {
    y += 20;
    g.font = '13px system-ui, Segoe UI, sans-serif';
    notes.forEach((n) => { g.fillStyle = n.bad ? '#b91c1c' : '#b45309'; g.fillText(`${n.bad ? '⛔' : '⚠'} ${n.text}`, x0, y); y += 22; });
  }
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

/** Telefonda paylaş menüsü (WhatsApp vs.), yoksa indir. */
export async function shareOrDownload(blob, name, preferShare) {
  const file = new File([blob], name, { type: blob.type });
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'downloaded';
}
