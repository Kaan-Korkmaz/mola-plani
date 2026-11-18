// Çıktılar: Excel (.xlsx, renkli) ve fotoğraf (PNG). İnternet gerekmez.
import { fmt } from './scheduler.js';

const range = (e) => `${fmt(e.start)}–${fmt(e.end)}`;

/** Bir günün planını tabloya çevirir: [{pool, poolName, cells[], over, bad}] */
export function dayTable(plan, st) {
  const pools = [...new Set(plan.rows.map((r) => r.pool))].sort((a, b) => a - b);
  const badIds = new Set(plan.issues.filter((i) => i.level === 'error' && i.personId).map((i) => i.personId));
  const out = [];
  for (const pool of pools) {
    const rs = plan.rows.filter((r) => r.pool === pool).sort((a, b) => a.shiftStart - b.shiftStart || a.order - b.order);
    out.push({ poolHeader: st.poolNames[pool] || `Havuz ${pool}`, count: rs.length });
    for (const r of rs) {
      const sh = st.shifts[r.shift];
      const br = [...r.breaks].sort((a, b) => a.start - b.start);
      const cells = [r.label, r.group, `${sh.name} ${sh.start}–${sh.end}`];
      for (let i = 0; i < Math.max(3, st.breakCount); i++) cells.push(br[i] ? range(br[i]) : (i < st.breakCount ? '—' : ''));
      cells.push(r.lunch ? range(r.lunch) : '—');
      out.push({ cells, over: !!r.lunch?.overflow, bad: badIds.has(r.id) });
    }
  }
  return out;
}

function headFor(st) {
  const h = ['Kişi', 'Grup', 'Vardiya'];
  for (let i = 0; i < Math.max(3, st.breakCount); i++) h.push(`${i + 1}. Mola`);
  h.push('Yemek');
  return h;
}

const S_HEAD = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A8A' } }, alignment: { horizontal: 'center' } };
const S_POOL = { font: { bold: true, color: { rgb: '1E3A8A' } }, fill: { fgColor: { rgb: 'E0E7FF' } } };
const S_OVER = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: 'DC2626' } }, alignment: { horizontal: 'center' } };
const S_BAD = { font: { color: { rgb: 'B91C1C' } }, fill: { fgColor: { rgb: 'FEE2E2' } } };
const S_C = { alignment: { horizontal: 'center' } };
const SH_FILL = { 'Sabahçı': '93C5FD', 'Öğlenci': '4ADE80', 'Akşamcı': 'FB923C' };

function sheetFor(plan, st, title) {
  const XLSX = globalThis.XLSX;
  const head = headFor(st);
  const t = dayTable(plan, st);
  const aoa = [[title], head];
  const styles = [];
  t.forEach((r) => aoa.push(r.poolHeader ? [`${r.poolHeader} — ${r.count} kişi`] : r.cells));
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
    for (let c = 1; c < cols; c++) set(R, c, r.bad ? { ...S_BAD, ...S_C } : S_C);
    if (r.bad) set(R, 0, S_BAD);
    const shName = r.cells[2].split(' ')[0];
    if (SH_FILL[shName]) set(R, 2, { fill: { fgColor: { rgb: SH_FILL[shName] } }, alignment: { horizontal: 'center' } });
    if (r.over) set(R, cols - 1, S_OVER);
  });
  const noteStart = t.length + 3;
  notes.forEach((n, i) => {
    set(noteStart + i, 0, { font: { color: { rgb: n.startsWith('⛔') ? 'B91C1C' : 'B45309' } } });
    merges.push({ s: { r: noteStart + i, c: 0 }, e: { r: noteStart + i, c: cols - 1 } });
  });
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 22 }, ...Array(cols - 3).fill({ wch: 13 })];
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
  const head = headFor(st);
  const t = dayTable(plan, st);
  const notes = plan.issues.map((i) => ({ bad: i.level === 'error', text: i.text }));
  const colW = [150, 70, 190, ...Array(head.length - 3).fill(110)];
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
  const shFill = { 'Sabahçı': '#93c5fd', 'Öğlenci': '#4ade80', 'Akşamcı': '#fb923c' };
  t.forEach((r, idx) => {
    if (r.poolHeader) {
      g.fillStyle = '#e0e7ff'; g.fillRect(x0, y, W - 40, rowH);
      cellText(`${r.poolHeader} — ${r.count} kişi`, x0, y, W - 40, '#1e3a8a', true, 'left');
    } else {
      g.fillStyle = r.bad ? '#fee2e2' : idx % 2 ? '#f9fafb' : '#ffffff'; g.fillRect(x0, y, W - 40, rowH);
      x = x0;
      r.cells.forEach((c, i) => {
        const shName = i === 2 ? c.split(' ')[0] : null;
        if (shName && shFill[shName]) { g.fillStyle = shFill[shName]; g.fillRect(x + 1, y + 1, colW[i] - 2, rowH - 2); }
        const last = i === r.cells.length - 1;
        if (last && r.over) { g.fillStyle = '#dc2626'; g.fillRect(x + 1, y + 1, colW[i] - 2, rowH - 2); }
        cellText(c, x, y, colW[i], last && r.over ? '#fff' : r.bad && i === 0 ? '#b91c1c' : '#111827', i === 0 || (last && r.over), i === 0 ? 'left' : 'center');
        x += colW[i];
      });
    }
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
