import { generateDay, toMin, fmt } from './scheduler.js';
import { DEFAULT_SETTINGS, DAY_NAMES } from './defaults.js';
import { load, save, reset, ensureWeek, copyWeek, addDays, mondayOf, exportBackup, importBackup, newId } from './store.js';
import { xlsxBlob, pngBlob, shareOrDownload, dayTable } from './export.js';
import { parseShiftSheet } from './importer.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const DAY_LONG = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const TL_START = 8 * 60, TL_END = 20 * 60;

let state = load();
let tab = 'plan';
let installEvt = null;

const persist = () => { save(state); };
const week = () => ensureWeek(state, state.current.week);
const dateOf = (i) => { const [y, m, d] = addDays(state.current.week, i).split('-').map(Number); return { y, m, d }; };
const dayShort = (i) => { const { m, d } = dateOf(i); return `${d} ${MONTHS[m - 1]}`; };
const dayTitle = (i) => { const { y, m, d } = dateOf(i); return `${DAY_LONG[i]} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`; };
const groupClass = (g) => (['B2B', 'B2C', 'Satış', 'Mail'].includes(g) ? `g-${g}` : 'g-other');

function planFor(i) {
  const w = week();
  const day = w.days[i];
  return generateDay({
    people: state.people,
    shifts: Object.fromEntries(Object.entries(w.shifts).map(([id, arr]) => [id, arr[i]])),
    settings: state.settings,
    overflowMode: day.overflowMode || state.settings.defaultOverflow,
    locks: day.locks,
  });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

function openModal(html, bind) {
  const m = $('#modal');
  m.innerHTML = html;
  $('#modalBg').hidden = false;
  bind?.(m);
}
function closeModal() { $('#modalBg').hidden = true; $('#modal').innerHTML = ''; }
$('#modalBg').addEventListener('click', (e) => { if (e.target.id === 'modalBg') closeModal(); });

function confirmBox(text, okLabel, onOk) {
  openModal(`<h2>${esc(text)}</h2><div class="row" style="justify-content:flex-end;margin-top:12px">
    <button class="btn" data-x>Vazgeç</button><button class="btn danger" data-ok>${esc(okLabel)}</button></div>`, (m) => {
    $('[data-x]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = () => { closeModal(); onOk(); };
  });
}

// ---------- Üst çubuk ----------
function renderTop() {
  const k = state.current.week;
  const end = addDays(k, 6).split('-').map(Number);
  const st = k.split('-').map(Number);
  $('#weekLabel').textContent = `${st[2]} ${MONTHS[st[1] - 1]} – ${end[2]} ${MONTHS[end[1] - 1]} ${end[0]}`;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}
$('#prevWeek').onclick = () => { state.current.week = addDays(state.current.week, -7); week(); persist(); render(); };
$('#nextWeek').onclick = () => { state.current.week = addDays(state.current.week, 7); week(); persist(); render(); };
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); } });

// ---------- PLAN ----------
function daySection(i, view) {
  const plan = planFor(i);
  const st = state.settings;
  const day = week().days[i];
  const mode = day.overflowMode || st.defaultOverflow;
  const needs = Object.entries(plan.pools).filter(([, p]) => p.needsChoice);
  const errors = plan.issues.filter((x) => x.level === 'error');
  const warns = plan.issues.filter((x) => x.level === 'warn');
  const lockCount = Object.values(day.locks).reduce((n, o) => n + Object.keys(o).length, 0);
  const pools = Object.entries(plan.pools).map(([p, info]) =>
    `<span class="pill ${info.needsChoice ? 'bad' : ''}">${esc(st.poolNames[p] || 'Havuz ' + p)}: ${info.count} kişi</span>`).join('');

  const overflow = needs.length ? `
    <div class="ovbox">
      <b>Yemek fazlası:</b> <span class="muted">${needs.map(([p, info]) => `${esc(st.poolNames[p])} ${info.count} kişi, ${st.lunchWindow.start}–${st.lunchWindow.end} arasına ${info.capacity} yemek sığıyor.`).join(' ')}</span>
      <div class="row" style="margin-top:6px">
        <div class="seg">
          <button data-ov="sarksin" data-day="${i}" class="${mode === 'sarksin' ? 'active' : ''}">Sarksın</button>
          <button data-ov="sarkmasin" data-day="${i}" class="${mode === 'sarkmasin' ? 'active' : ''}">Sarkmasın</button>
        </div>
        <span class="muted">${mode === 'sarksin'
          ? `${st.lunchWindow.end} sonrasına sarkanlar <b style="color:var(--bad)">kırmızı</b>.`
          : `Yemekler ${st.lunchWindow.end}'da biter; son dilimlerde 2 kişi aynı anda yemekte, o sırada mola yok.`}</span>
      </div>
    </div>` : '';

  const issuesHtml = errors.length || warns.length
    ? `<ul class="issues">${[...errors, ...warns].map((x) => `<li class="${x.level}">${x.level === 'error' ? '⛔' : '⚠️'} ${esc(x.text)}</li>`).join('')}</ul>`
    : `<div class="ok-line">✔ Tüm kurallar sağlanıyor</div>`;

  const body = plan.rows.length ? (view === 'grid' ? timelineHtml(plan, i) : tableHtml(plan, i)) : '';
  return { plan, html: `
    <section class="day-sec">
    <div class="card">
      <h2 style="margin:0">${dayTitle(i)}</h2>
      <div class="pools" style="margin-top:8px">${pools || '<span class="muted">Bu gün çalışan yok.</span>'}</div>
      ${plan.rows.length ? issuesHtml : ''}
      ${overflow}
      ${lockCount ? `<div class="row" style="margin-top:8px"><button class="btn small" data-clear="${i}">Elle değişiklikleri sil (${lockCount})</button></div>` : ''}
    </div>
    ${body}
    </section>` };
}

function renderPlan() {
  const all = !!state.current.all;
  const i = state.current.day;
  const view = state.current.mode || 'table';
  const days = DAY_NAMES.map((n, d) => `<button data-day="${d}" class="${!all && d === i ? 'active' : ''}">${n}<small>${dayShort(d)}</small></button>`).join('')
    + `<button data-day="all" class="${all ? 'active' : ''}">Tüm<small>hafta</small></button>`;
  const idx = all ? [0, 1, 2, 3, 4, 5, 6] : [i];
  const secs = idx.map((d) => ({ d, ...daySection(d, view) }));
  $('#view').innerHTML = `
    <div class="card">
      <div class="days" id="days">${days}</div>
      <div class="row" style="justify-content:space-between;margin-top:8px">
        <span class="muted">Saate dokunup değiştirebilirsin.</span>
        <div class="seg" id="viewSeg">
          <button data-v="table" class="${view === 'table' ? 'active' : ''}">Tablo</button>
          <button data-v="grid" class="${view === 'grid' ? 'active' : ''}">Çizelge</button>
        </div>
      </div>
    </div>
    ${secs.map((x) => x.html).join('')}
    <div class="row" style="margin-top:12px">
      ${all ? '' : '<button class="btn primary" id="qPng">📷 Bu günün fotoğrafı</button>'}
      <button class="btn ${all ? 'primary' : ''}" id="qXlsx">📊 Haftalık Excel</button>
    </div>`;

  const plans = Object.fromEntries(secs.map((x) => [x.d, x.plan]));
  $('#days').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.day === 'all') state.current.all = true;
    else { state.current.all = false; state.current.day = +b.dataset.day; }
    persist(); render();
  };
  $('#viewSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.current.mode = b.dataset.v; persist(); render(); } };
  const v = $('#view');
  v.querySelectorAll('[data-ov]').forEach((b) => (b.onclick = () => { week().days[+b.dataset.day].overflowMode = b.dataset.ov; persist(); render(); }));
  v.querySelectorAll('[data-clear]').forEach((b) => (b.onclick = () => confirmBox(`${dayTitle(+b.dataset.clear)}: elle değişiklikler silinsin mi?`, 'Sil', () => {
    week().days[+b.dataset.clear].locks = {}; persist(); render(); })));
  v.querySelectorAll('[data-ev]').forEach((b) => (b.onclick = () => editEvent(plans[+b.dataset.day], b.dataset.pid, b.dataset.ev, +b.dataset.day)));
  $('#qPng')?.addEventListener('click', () => doPng(true));
  $('#qXlsx').onclick = () => doXlsx(true);
}

function timelineHtml(plan, di) {
  const st = state.settings;
  const q = (m) => `calc(var(--q) * ${(m - TL_START) / 15})`;
  const w = (m) => `calc(var(--q) * ${m / 15})`;
  const bad = badMap(plan);
  let hours = '';
  for (let h = 8; h <= 20; h++) hours += `<span style="left:${q(h * 60)}${h === 8 ? ';transform:none;margin-left:3px' : h === 20 ? ';transform:translateX(-100%)' : ''}">${String(h).padStart(2, '0')}:00</span>`;
  const lw0 = toMin(st.lunchWindow.start), lw1 = toMin(st.lunchWindow.end);
  let out = `<div class="tl-wrap"><div class="tl"><div class="tl-head"><div class="tl-left">Kişi</div><div class="tl-hours">${hours}</div></div>`;
  for (const [pool, rs] of groupByPool(plan)) {
    out += `<div class="tl-pool"><div class="tl-left">${esc(st.poolNames[pool] || 'Havuz ' + pool)} · ${rs.length} kişi</div></div>`;
    for (const r of rs) {
      const sh = st.shifts[r.shift];
      let blocks = `<div class="tl-lunchzone" style="left:${q(lw0)};width:${w(lw1 - lw0)}"></div>`;
      if (r.shiftStart > TL_START) blocks += `<div class="tl-off" style="left:0;width:${w(r.shiftStart - TL_START)}"></div>`;
      if (r.shiftEnd < TL_END) blocks += `<div class="tl-off" style="left:${q(r.shiftEnd)};width:${w(TL_END - r.shiftEnd)}"></div>`;
      blocks += `<div class="tl-edge" style="left:${q(r.shiftStart)};width:${w(r.winStart - r.shiftStart)}"></div>`;
      blocks += `<div class="tl-edge" style="left:${q(r.winEnd)};width:${w(r.shiftEnd - r.winEnd)}"></div>`;
      const evs = [...(r.lunch ? [{ ...r.lunch, key: 'lunch', kind: 'lunch' }] : []), ...r.breaks.map((b) => ({ ...b, kind: 'break' }))];
      for (const e of evs) {
        const cls = ['blk', e.kind, e.kind === 'lunch' && e.overflow ? 'over' : '', e.locked ? 'locked' : '', bad.has(`${r.id}:${e.start}`) ? 'bad' : ''].join(' ');
        blocks += `<button class="${cls}" style="left:${q(e.start)};width:${w(e.end - e.start)}" data-pid="${r.id}" data-ev="${e.key}" data-day="${di}"
          title="${e.kind === 'lunch' ? 'Yemek' : 'Mola'} ${fmt(e.start)}–${fmt(e.end)}">${e.kind === 'lunch' ? '🍽 ' + fmt(e.start) : '☕'}</button>`;
        if (e.kind === 'break') blocks += `<span class="blk-t" style="left:calc(${q(e.start)} + ${w(7.5)})">${fmt(e.start)}</span>`;
      }
      out += `<div class="tl-row"><div class="tl-left"><b>${esc(r.label)}</b>
        <span class="badge ${groupClass(r.group)}">${esc(r.group)}</span> <small>${esc(sh.name)} ${sh.start}–${sh.end}</small></div>
        <div class="tl-track">${blocks}</div></div>`;
    }
  }
  return out + '</div></div>';
}

function tableHtml(plan, di) {
  const st = state.settings;
  const bad = badMap(plan);
  const { cols, rows } = dayTable(plan, st);
  const vis = cols.filter((c) => c.t !== 'group');
  let out = `<div class="tbl-wrap card" style="padding:0"><table class="plan"><thead><tr>${vis.map((c) => `<th class="c-${c.t}">${c.h}</th>`).join('')}</tr></thead><tbody>`;
  for (const row of rows) {
    if (row.poolHeader) { out += `<tr class="pool"><td colspan="${vis.length}">${esc(row.poolHeader)} · ${row.count} kişi</td></tr>`; continue; }
    const r = row.r;
    const evs = [...(r.lunch ? [r.lunch] : []), ...r.breaks];
    const adj = (e) => evs.some((o) => o !== e && (o.end === e.start || e.end === o.start));
    out += '<tr>';
    cols.forEach((c, i) => {
      if (c.t === 'group') return;
      const cell = row.cells[i];
      if (c.t === 'shift') { out += `<td class="sh-${cell.shift} c-shift">${cell.text}</td>`; return; }
      if (c.t === 'name') { out += `<td class="c-name"><b>${esc(cell.text)}</b> <span class="badge ${groupClass(r.group)}">${esc(r.group)}</span></td>`; return; }
      if (!cell.ev) { out += `<td class="c-ev">—</td>`; return; }
      const e = cell.ev;
      const cls = ['ev', c.t, cell.over ? 'over' : '', bad.has(`${r.id}:${e.start}`) ? 'bad' : adj(e) ? 'adj' : ''].join(' ');
      out += `<td class="c-ev"><button class="${cls}" data-pid="${r.id}" data-ev="${cell.key}" data-day="${di}">${fmt(e.start)}<span class="to">–${fmt(e.end)}</span>${e.locked ? ' 🔒' : ''}</button></td>`;
    });
    out += '</tr>';
  }
  return out + `</tbody></table></div>
    <div class="legend muted"><span class="lg lunch"></span>Yemek <span class="lg over"></span>${st.lunchWindow.end} sonrası <span class="lg adj"></span>Arka arkaya <span class="lg bad"></span>Kural dışı · Saate dokunup değiştirebilirsin</div>`;
}

function groupByPool(plan) {
  const m = new Map();
  [...plan.rows].sort((a, b) => a.pool - b.pool || a.shiftStart - b.shiftStart || a.order - b.order)
    .forEach((r) => { if (!m.has(r.pool)) m.set(r.pool, []); m.get(r.pool).push(r); });
  return m;
}

/** Hatalı olayları işaretlemek için: aynı çeyrekte kapasite aşımı vb. */
function badMap(plan) {
  const st = state.settings;
  const set = new Set();
  for (const pool of new Set(plan.rows.map((r) => r.pool))) {
    const rs = plan.rows.filter((r) => r.pool === pool);
    const lunchMax = plan.overflowMode === 'sarkmasin' && plan.pools[pool]?.needsChoice ? st.capacity.lunch + 1 : st.capacity.lunch;
    for (let t = TL_START; t < TL_END; t += 15) {
      const inL = rs.filter((r) => r.lunch && r.lunch.start < t + 15 && t < r.lunch.end);
      const inB = rs.flatMap((r) => r.breaks.filter((b) => b.start < t + 15 && t < b.end).map((b) => [r, b]));
      if (inL.length > lunchMax) inL.forEach((r) => set.add(`${r.id}:${r.lunch.start}`));
      if (inB.length > st.capacity.break || (inB.length && inL.length > st.capacity.lunch)) inB.forEach(([r, b]) => set.add(`${r.id}:${b.start}`));
    }
  }
  for (const r of plan.rows) {
    const evs = [...(r.lunch ? [r.lunch] : []), ...r.breaks];
    for (const e of evs) {
      if (e.start < r.winStart || e.end > r.winEnd) set.add(`${r.id}:${e.start}`);
      if (evs.some((o) => o !== e && o.start < e.end && e.start < o.end)) set.add(`${r.id}:${e.start}`);
    }
  }
  return set;
}

function editEvent(plan, pid, key, di) {
  const st = state.settings;
  const r = plan.rows.find((x) => x.id === pid);
  const isLunch = key === 'lunch';
  const cur = isLunch ? r.lunch : r.breaks.find((b) => b.key === key);
  const len = isLunch ? st.lunchMin : st.breakMin;
  const day = week().days[di];
  const others = plan.rows.filter((x) => x.pool === r.pool && x.id !== pid);
  let btns = '';
  for (let s = r.winStart; s + len <= r.winEnd; s += 15) {
    const ev = { start: s, end: s + len };
    const who = others.filter((o) => (isLunch ? [o.lunch] : o.breaks).some((e) => e && e.start < ev.end && ev.start < e.end)).map((o) => o.label);
    const own = (isLunch ? r.breaks : [r.lunch, ...r.breaks.filter((b) => b.key !== key)]).some((e) => e && e.start < ev.end && ev.start < e.end);
    const busy = who.length || own;
    btns += `<button data-s="${s}" class="${cur && cur.start === s ? 'cur' : busy ? 'busy' : ''}">${fmt(s)}${busy ? `<small>${own ? 'kendi molası' : esc(who.join(', '))}</small>` : ''}</button>`;
  }
  const locked = cur?.locked;
  openModal(`
    <h2>${esc(r.label)} · ${isLunch ? 'Yemek' : 'Mola'} · ${DAY_NAMES[di]}</h2>
    <div class="muted">${esc(st.shifts[r.shift].name)} ${st.shifts[r.shift].start}–${st.shifts[r.shift].end} · şu an ${cur ? fmt(cur.start) : '—'}${locked ? ' 🔒 elle ayarlandı' : ''}</div>
    <div class="muted" style="margin-top:6px">Yeni saat seç (gri olanlar dolu — yine de seçebilirsin, uygulama uyarır):</div>
    <div class="times">${btns}</div>
    <div class="row" style="justify-content:space-between">
      ${locked ? '<button class="btn" data-auto>Otomatiğe bırak</button>' : '<span></span>'}
      <button class="btn" data-x>Kapat</button>
    </div>`, (m) => {
    $('[data-x]', m).onclick = closeModal;
    $('[data-auto]', m)?.addEventListener('click', () => {
      if (day.locks[pid]) { delete day.locks[pid][key]; if (!Object.keys(day.locks[pid]).length) delete day.locks[pid]; }
      persist(); closeModal(); render();
    });
    m.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => {
      day.locks[pid] ||= {};
      day.locks[pid][key] = +b.dataset.s;
      persist(); closeModal(); render();
      toast(`${r.label}: ${isLunch ? 'yemek' : 'mola'} ${fmt(+b.dataset.s)} 🔒`);
    }));
  });
}

// ---------- VARDİYA ----------
function renderVardiya() {
  const w = week();
  const st = state.settings;
  const opts = (v) => [['S', st.shifts.S], ['O', st.shifts.O], ['A', st.shifts.A]]
    .map(([k, s]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${s.start}–${s.end}</option>`).join('') +
    `<option value="OFF" ${v === 'OFF' ? 'selected' : ''}>OFF</option>`;
  const head = DAY_NAMES.map((n, d) => `<th>${n}<br><small>${dayShort(d)}</small></th>`).join('');
  const rows = state.people.map((p) => `<tr class="${p.included ? '' : 'excluded'}"><td class="name">${esc(p.label)} <span class="badge ${groupClass(p.group)}">${esc(p.group)}</span></td>
    ${w.shifts[p.id].map((v, d) => `<td><select class="sh sh-${v}" data-pid="${p.id}" data-d="${d}">${opts(v)}</select></td>`).join('')}</tr>`).join('');
  $('#view').innerHTML = `
    <div class="card"><h2>Haftalık vardiya</h2>
      <p class="muted" style="margin:0">Her hücreye dokunup vardiyayı seç. Soluk satırlar plana dahil değil (Kadro'dan değişir).</p>
      <div class="row" style="margin-top:8px">
        <label class="btn small primary">📥 Vardiya Excel'ini yükle<input type="file" id="impX" accept=".xlsx,.xls,.csv" hidden></label>
        <button class="btn small" id="copyPrev">⟲ Önceki haftayı kopyala</button>
        <button class="btn small danger" id="clearWeek">Haftayı OFF yap</button>
      </div></div>
    <div class="tbl-wrap card" style="padding:0"><table class="grid"><thead><tr><th>Kişi</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  $('#view').querySelectorAll('select.sh').forEach((s) => (s.onchange = () => {
    w.shifts[s.dataset.pid][+s.dataset.d] = s.value;
    s.className = `sh sh-${s.value}`;
    persist();
  }));
  $('#impX').onchange = (e) => { const f = e.target.files[0]; if (f) importShiftFile(f); e.target.value = ''; };
  $('#copyPrev').onclick = () => {
    const prev = addDays(state.current.week, -7);
    if (!state.weeks[prev]) return toast('Önceki haftanın kaydı yok');
    confirmBox('Önceki haftanın vardiyaları bu haftaya kopyalansın mı? (Bu haftadaki seçimler değişir)', 'Kopyala', () => {
      copyWeek(state, prev, state.current.week); persist(); render(); toast('Kopyalandı');
    });
  };
  $('#clearWeek').onclick = () => confirmBox('Bu haftadaki tüm vardiyalar OFF yapılsın mı?', 'OFF yap', () => {
    for (const id in w.shifts) w.shifts[id] = Array(7).fill('OFF');
    w.days.forEach((d) => (d.locks = {})); persist(); render();
  });
}

const normName = (s) => String(s).trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');

async function importShiftFile(file) {
  try {
    const XLSX = globalThis.XLSX;
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const res = parseShiftSheet(aoa, state.settings);
    const key = res.firstDate ? mondayOf(res.firstDate) : state.current.week;
    const w = ensureWeek(state, key);
    let added = 0;
    const seen = new Set();
    for (const row of res.rows) {
      let p = state.people.find((x) => normName(x.label) === normName(row.name));
      if (!p) {
        p = { id: newId(state), label: row.name, group: row.group, included: true };
        state.people.push(p); added++;
        for (const wk of Object.values(state.weeks)) wk.shifts[p.id] ||= Array(7).fill('OFF');
      } else p.group = row.group;
      w.shifts[p.id] = row.shifts;
      seen.add(p.id);
    }
    for (const p of state.people) if (!seen.has(p.id)) w.shifts[p.id] = Array(7).fill('OFF');
    w.days.forEach((d) => (d.locks = {}));
    state.current.week = key;
    persist(); render();
    const excluded = state.people.filter((p) => seen.has(p.id) && !p.included).map((p) => p.label);
    openModal(`<h2>Vardiya yüklendi ✔</h2>
      <p>${res.rows.length} kişi okundu${added ? `, ${added} yeni kişi kadroya eklendi` : ''}. Hafta: <b>${esc($('#weekLabel').textContent)}</b></p>
      ${excluded.length ? `<p class="muted">Plana dahil olmayanlar (Kadro'dan değişir): ${esc(excluded.join(', '))}</p>` : ''}
      ${added ? '<p class="muted">Yeni kişileri plana dahil etmek istemiyorsan Kadro sekmesinden kapat.</p>' : ''}
      ${res.warnings.length ? `<ul class="issues">${res.warnings.map((x) => `<li class="warn">⚠️ ${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" data-go>Mola planına git</button></div>`, (m) => {
      $('[data-go]', m).onclick = () => { closeModal(); tab = 'plan'; state.current.all = true; persist(); render(); window.scrollTo(0, 0); };
    });
  } catch (err) {
    openModal(`<h2>Dosya okunamadı</h2><p>${esc(err.message || err)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-x>Tamam</button></div>`,
      (m) => ($('[data-x]', m).onclick = closeModal));
  }
}

// ---------- KADRO ----------
function renderKadro() {
  const st = state.settings;
  const gopts = (g) => st.groups.map((x) => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
  $('#view').innerHTML = `
    <div class="card"><h2>Kadro</h2>
      <p class="muted" style="margin:0">İsim yazabilirsin — sadece bu cihazda kalır, hiçbir yere gönderilmez. "Plana dahil" kapalı olan kişi mola planında görünmez.</p></div>
    <div class="kadro">${state.people.map((p, i) => `
      <div class="kadro-row">
        <input value="${esc(p.label)}" data-k="label" data-i="${i}" aria-label="İsim">
        <select data-k="group" data-i="${i}">${gopts(p.group)}</select>
        <label class="switch"><input type="checkbox" data-k="included" data-i="${i}" ${p.included ? 'checked' : ''}> Plana dahil</label>
        <div class="acts">
          <button class="btn small" data-up="${i}" aria-label="Yukarı">↑</button>
          <button class="btn small" data-down="${i}" aria-label="Aşağı">↓</button>
          <button class="btn small danger" data-del="${i}" aria-label="Sil">✕</button>
        </div>
      </div>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="addP">+ Kişi ekle</button></div>`;
  const v = $('#view');
  v.querySelectorAll('[data-k]').forEach((el) => (el.onchange = () => {
    const p = state.people[+el.dataset.i];
    p[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim() || p.label;
    persist();
  }));
  const move = (i, d) => { const a = state.people; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; persist(); render(); };
  v.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => move(+b.dataset.up, -1)));
  v.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => move(+b.dataset.down, 1)));
  v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const p = state.people[+b.dataset.del];
    confirmBox(`${p.label} kadrodan silinsin mi?`, 'Sil', () => {
      state.people.splice(+b.dataset.del, 1);
      for (const w of Object.values(state.weeks)) { delete w.shifts[p.id]; w.days.forEach((d) => delete d.locks[p.id]); }
      persist(); render();
    });
  }));
  $('#addP').onclick = () => {
    const id = newId(state);
    state.people.push({ id, label: `Kişi ${state.people.length + 1}`, group: 'B2C', included: true });
    for (const w of Object.values(state.weeks)) w.shifts[id] = Array(7).fill('OFF');
    persist(); render();
    toast('Eklendi — Vardiya sekmesinden günlerini seç');
  };
}

// ---------- AYARLAR ----------
function renderAyarlar() {
  const st = state.settings;
  const num = (path, label, val, step = 1) => `<div class="field"><label>${label}</label><input type="number" min="0" step="${step}" data-path="${path}" value="${val}"></div>`;
  const time = (path, label, val) => `<div class="field"><label>${label}</label><input type="time" step="900" data-path="${path}" value="${val}"></div>`;
  $('#view').innerHTML = `
    <div class="card form"><h2>Vardiyalar</h2>
      ${['S', 'O', 'A'].map((k) => `<div class="grid2">
        <div class="field"><label>Ad</label><input data-path="shifts.${k}.name" value="${esc(st.shifts[k].name)}"></div>
        ${time(`shifts.${k}.start`, 'Başlangıç', st.shifts[k].start)}${time(`shifts.${k}.end`, 'Bitiş', st.shifts[k].end)}</div>`).join('')}
    </div>
    <div class="card form"><h2>Mola kuralları</h2><div class="grid2">
      ${num('edgeMin', 'İlk/son kaç dk mola yok', st.edgeMin, 15)}
      ${num('breakCount', 'Kısa mola sayısı', st.breakCount)}
      ${num('breakMin', 'Kısa mola (dk)', st.breakMin, 15)}
      ${num('lunchMin', 'Yemek (dk)', st.lunchMin, 15)}
      ${time('lunchWindow.start', 'Yemek başlangıç', st.lunchWindow.start)}
      ${time('lunchWindow.end', 'Yemek bitiş', st.lunchWindow.end)}
      ${num('capacity.break', 'Aynı anda molada (havuz başı)', st.capacity.break)}
      ${num('capacity.lunch', 'Aynı anda yemekte (havuz başı)', st.capacity.lunch)}
      ${num('minGap', 'Kişinin molaları arası hedef (dk)', st.minGap, 15)}
      <div class="field"><label>10'dan fazla kişide varsayılan</label><select data-path="defaultOverflow">
        <option value="sarksin" ${st.defaultOverflow === 'sarksin' ? 'selected' : ''}>Sarksın</option>
        <option value="sarkmasin" ${st.defaultOverflow === 'sarkmasin' ? 'selected' : ''}>Sarkmasın</option></select></div>
    </div></div>
    <div class="card form"><h2>Havuzlar</h2>
      <p class="muted" style="margin:0">Aynı havuzdakiler aynı anda molaya/yemeğe çıkamaz. Farklı havuzlar birbirini etkilemez.</p>
      <div class="grid2">${st.groups.map((g) => `<div class="field"><label>${esc(g)}</label><select data-path="groupPool.${g}" data-num="1">
        ${[1, 2, 3].map((n) => `<option value="${n}" ${st.groupPool[g] === n ? 'selected' : ''}>${n}. havuz</option>`).join('')}</select></div>`).join('')}</div>
      <div class="grid2">${[1, 2, 3].map((n) => `<div class="field"><label>${n}. havuz adı</label><input data-path="poolNames.${n}" value="${esc(st.poolNames[n] || '')}"></div>`).join('')}</div>
    </div>
    <div class="card row">
      <button class="btn" id="defSet">Kuralları varsayılana döndür</button>
      <button class="btn danger" id="wipe">Tüm verileri sil (örneğe dön)</button>
    </div>`;
  $('#view').querySelectorAll('[data-path]').forEach((el) => (el.onchange = () => {
    const parts = el.dataset.path.split('.');
    let o = st;
    for (const p of parts.slice(0, -1)) o = o[p];
    const last = parts.at(-1);
    let val = el.value;
    if (el.type === 'number' || el.dataset.num) val = Math.max(0, Number(val) || 0);
    if (el.type === 'time' && !val) return;
    o[last] = val;
    persist(); toast('Kaydedildi');
  }));
  $('#defSet').onclick = () => confirmBox('Tüm kurallar varsayılana dönsün mü? (Kadro ve vardiyalar korunur)', 'Döndür', () => {
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); persist(); render();
  });
  $('#wipe').onclick = () => confirmBox('Bu cihazdaki tüm kadro, vardiya ve ayarlar silinsin mi? Önce yedek almanı öneririm.', 'Hepsini sil', () => {
    state = reset(); persist(); render();
  });
}

// ---------- ÇIKTI ----------
const fileDate = (i) => { const { m, d } = dateOf(i); return `${DAY_NAMES[i]}_${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`; };

async function doPng(share) {
  const i = state.current.day;
  const blob = await pngBlob(planFor(i), state.settings, `Mola Planı · ${dayTitle(i)}`);
  report(await shareOrDownload(blob, `Mola-Plani_${fileDate(i)}.png`, share));
}
async function doXlsx(share, onlyDay = false) {
  const idx = onlyDay ? [state.current.day] : [0, 1, 2, 3, 4, 5, 6];
  const days = idx.map((i) => ({ plan: planFor(i), title: `Mola Planı · ${dayTitle(i)}`, sheetName: `${DAY_NAMES[i]} ${dayShort(i)}` }));
  const blob = xlsxBlob(days, state.settings);
  const name = onlyDay ? `Mola-Plani_${fileDate(state.current.day)}.xlsx` : `Mola-Plani_${state.current.week}.xlsx`;
  report(await shareOrDownload(blob, name, share));
}
function report(r) { if (r === 'downloaded') toast('İndirildi'); else if (r === 'shared') toast('Paylaşıldı'); }

function renderCikti() {
  const canShare = !!navigator.canShare;
  $('#view').innerHTML = `
    <div class="card"><h2>Planı gönder</h2>
      <p class="muted" style="margin:0 0 8px">Seçili gün: <b>${dayTitle(state.current.day)}</b> (Plan sekmesinden değişir)</p>
      <div class="row">
        <button class="btn primary" data-a="png">📷 Günün fotoğrafı</button>
        <button class="btn primary" data-a="xday">📊 Günün Excel'i</button>
        <button class="btn primary" data-a="xweek">📊 Haftalık Excel (7 sayfa)</button>
      </div>
      ${canShare ? '<p class="muted" style="margin:8px 0 0">Telefonda paylaş menüsü açılır — WhatsApp\'ı seçebilirsin.</p>' : ''}
    </div>
    <div class="card"><h2>Yedek</h2>
      <p class="muted" style="margin:0 0 8px">Kadro, vardiyalar ve ayarlar sadece bu cihazda. Başka cihaza taşımak ya da tarayıcı verisi silinirse geri almak için yedek al.</p>
      <div class="row">
        <button class="btn" data-a="bak">💾 Yedeği indir</button>
        <label class="btn" style="display:inline-block">📂 Yedekten yükle<input type="file" accept=".json,application/json" id="restore" hidden></label>
      </div>
    </div>
    <div class="card"><h2>Program gibi kullan</h2>
      ${installEvt ? '<button class="btn primary" id="install">⬇ Uygulamayı yükle</button>' : ''}
      <ul class="muted" style="margin:8px 0 0;padding-left:18px">
        <li><b>iPhone (Safari):</b> Paylaş ⬆ → "Ana Ekrana Ekle"</li>
        <li><b>Android (Chrome):</b> ⋮ menü → "Ana ekrana ekle" / "Uygulamayı yükle"</li>
        <li><b>Bilgisayar (Chrome/Edge):</b> adres çubuğundaki "Yükle" simgesi</li>
      </ul>
    </div>`;
  const v = $('#view');
  v.querySelector('[data-a="png"]').onclick = () => doPng(true);
  v.querySelector('[data-a="xday"]').onclick = () => doXlsx(true, true);
  v.querySelector('[data-a="xweek"]').onclick = () => doXlsx(true);
  v.querySelector('[data-a="bak"]').onclick = async () => {
    const blob = new Blob([exportBackup(state)], { type: 'application/json' });
    report(await shareOrDownload(blob, `Mola-Plani-yedek_${new Date().toISOString().slice(0, 10)}.json`, false));
  };
  $('#restore').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { state = importBackup(await f.text()); persist(); render(); toast('Yedek yüklendi'); }
    catch (err) { toast(err.message || 'Dosya okunamadı'); }
  };
  $('#install')?.addEventListener('click', async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); });
}

// ---------- Genel ----------
function render() {
  renderTop();
  ({ plan: renderPlan, vardiya: renderVardiya, kadro: renderKadro, ayarlar: renderAyarlar, cikti: renderCikti })[tab]();
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (tab === 'cikti') render(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');

// İlk açılışta bu haftaya git (örnek verisi olan hafta hariç: kayıt yoksa örnek hafta açılır)
if (!localStorage.getItem('mola-plani:v1')) persist();
render();
