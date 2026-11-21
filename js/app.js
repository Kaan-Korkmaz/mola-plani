import { generateDay, toMin, fmt } from './scheduler.js';
import { DEFAULT_SETTINGS, DAY_NAMES, NONWORK, TRAINING } from './defaults.js';
import { load, save, reset, ensureWeek, copyWeek, addDays, mondayOf, exportBackup, importBackup, newId } from './store.js';
import { xlsxBlob, pngBlob, shareOrDownload, dayTable, shiftTable, shiftXlsxBlob, shiftPngBlob } from './export.js';
import { parsePaste, weekdayOf } from './excel-yapistir.js';

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
const isOff = (v) => !v || v in NONWORK;
const active = () => state.people.filter((p) => !p.deleted);
const groupClass = (g) => ({ B2B: 'g-B2B', B2C: 'g-B2C', 'Satış': 'g-Satış', Mail: 'g-Mail' }[g] || 'g-other');

function planFor(i) {
  const w = week();
  const day = w.days[i];
  return generateDay({
    people: active(),
    shifts: Object.fromEntries(Object.entries(w.shifts).map(([id, arr]) => [id, arr[i]])),
    settings: state.settings,
    locks: day.locks,
  });
}

function toast(msg, actionLabel, onAction) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (actionLabel ? ` <button class="toast-btn">${esc(actionLabel)}</button>` : '');
  t.hidden = false;
  if (actionLabel) t.querySelector('.toast-btn').onclick = () => { t.hidden = true; onAction(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), actionLabel ? 7000 : 2600);
}

function openModal(html, bind) {
  const m = $('#modal');
  m.innerHTML = html;
  $('#modalBg').hidden = false;
  bind?.(m);
}
function closeModal() { $('#modalBg').hidden = true; $('#modal').innerHTML = ''; $('#modal').classList.remove('wide'); }
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
  const needs = Object.entries(plan.pools).filter(([, p]) => p.needsChoice);
  const errors = plan.issues.filter((x) => x.level === 'error');
  const warns = plan.issues.filter((x) => x.level === 'warn');
  const lockCount = Object.values(day.locks).reduce((n, o) => n + Object.keys(o).length, 0);
  const pools = Object.entries(plan.pools).map(([p, info]) =>
    `<span class="pill ${info.needsChoice ? 'bad' : ''}">${esc(st.poolNames[p] || 'Havuz ' + p)}: ${info.count} kişi</span>`).join('');

  const overflow = needs.length ? `
    <div class="ovbox"><b>Yemek fazlası:</b> <span class="muted">${needs.map(([p, info]) => `${esc(st.poolNames[p])} ${info.count} kişi; ${st.lunchWindow.start}–${st.lunchWindow.end} arasına ${info.capacity} yemek sığıyor.`).join(' ')}
      Yemekler tek tek devam eder, ${st.lunchWindow.end} sonrasına sarkanlar <b style="color:var(--bad)">kırmızı</b>. Tüm molalar en geç ${st.latestEnd} biter.</span></div>` : '';

  // O gün çalışmayanlar (OFF / Resmi tatil / İzinli)
  const offs = {};
  for (const p of active()) { const v = week().shifts[p.id]?.[i]; if (isOff(v)) (offs[v || 'OFF'] ||= []).push(p.label); else if (v === TRAINING) (offs.EGT ||= []).push(p.label); }
  const offHtml = Object.keys(offs).length ? `<div class="muted" style="margin-top:6px">${Object.entries(offs).map(([k, names]) => `<b>${k === 'EGT' ? 'Eğitimde' : NONWORK[k]}:</b> ${esc(names.join(', '))}`).join(' · ')}</div>` : '';

  const issuesHtml = errors.length || warns.length
    ? `<ul class="issues">${[...errors, ...warns].map((x) => `<li class="${x.level}">${x.level === 'error' ? '⛔' : '⚠️'} ${esc(x.text)}</li>`).join('')}</ul>`
    : `<div class="ok-line">✔ Tüm kurallar sağlanıyor</div>`;

  const body = plan.rows.length ? (view === 'grid' ? timelineHtml(plan, i) : tableHtml(plan, i)) : '';
  return { plan, html: `
    <section class="day-sec">
    <div class="card">
      <h2 style="margin:0">${dayTitle(i)}</h2>
      <div class="pools" style="margin-top:8px">${pools || '<span class="muted">Bu gün çalışan yok.</span>'}</div>
      ${plan.rows.length ? (errors.length
        ? `<div class="sum-bad">⛔ ${errors.length} sorun var — ayrıntılar tablonun altında</div>`
        : `<div class="ok-line">✔ Tüm kurallar sağlanıyor</div>`) : ''}
      ${overflow}
      ${offHtml}
      ${lockCount ? `<div class="row" style="margin-top:8px"><button class="btn small" data-clear="${i}">Elle değişiklikleri sil (${lockCount})</button></div>` : ''}
    </div>
    ${body}
    ${plan.rows.length && (errors.length || warns.length) ? `<div class="notes"><b>Notlar · ${DAY_NAMES[i]}</b>${issuesHtml}</div>` : ''}
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
  const vis = cols;
  let out = `<div class="tbl-wrap card" style="padding:0"><table class="plan"><thead><tr>${vis.map((c) => `<th class="c-${c.t}">${c.h}</th>`).join('')}</tr></thead><tbody>`;
  for (const row of rows) {
    if (row.poolHeader) { out += `<tr class="pool"><td colspan="${vis.length}">${esc(row.poolHeader)} · ${row.count} kişi</td></tr>`; continue; }
    const r = row.r;
    const evs = [...(r.lunch ? [r.lunch] : []), ...r.breaks];
    const adj = (e) => evs.some((o) => o !== e && (o.start >= e.end ? o.start - e.end : e.start - o.end) < st.minGap);
    out += `<tr class="${row.groupStart ? 'gstart' : ''}">`;
    cols.forEach((c, i) => {
      const cell = row.cells[i];
      if (c.t === 'group') { out += `<td class="c-group ${groupClass(r.group)}">${esc(cell.text)}</td>`; return; }
      if (c.t === 'shift') { out += `<td class="sh-${cell.shift} c-shift">${cell.text}</td>`; return; }
      if (c.t === 'name') { out += `<td class="c-name"><b>${esc(cell.text)}</b></td>`; return; }
      if (!cell.ev) { out += `<td class="c-ev">—</td>`; return; }
      const e = cell.ev;
      const cls = ['ev', c.t, cell.over ? 'over' : '', bad.has(`${r.id}:${e.start}`) ? 'bad' : adj(e) ? 'adj' : ''].join(' ');
      out += `<td class="c-ev"><button class="${cls}" data-pid="${r.id}" data-ev="${cell.key}" data-day="${di}">${fmt(e.start)}<span class="to">–${fmt(e.end)}</span>${e.locked ? ' 🔒' : ''}</button></td>`;
    });
    out += '</tr>';
  }
  return out + `</tbody></table></div>
    <div class="legend muted"><span class="lg lunch"></span>Yemek <span class="lg over"></span>${st.lunchWindow.end} sonrası <span class="lg adj"></span>Molalar arası ${st.minGap} dk'dan az <span class="lg bad"></span>Kural dışı · Saate dokunup değiştirebilirsin</div>`;
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
    const lunchMax = st.capacity.lunch;
    const crowded = !!plan.pools[pool]?.crowded;
    for (let t = TL_START; t < TL_END; t += 15) {
      const inL = rs.filter((r) => r.lunch && r.lunch.start < t + 15 && t < r.lunch.end);
      const inB = rs.flatMap((r) => r.breaks.filter((b) => b.start < t + 15 && t < b.end).map((b) => [r, b]));
      if (inL.length > lunchMax) inL.forEach((r) => set.add(`${r.id}:${r.lunch.start}`));
      const okDouble = crowded && inB.length === st.capacity.break + 1 && inL.length === 0;
      if ((inB.length > st.capacity.break && !okDouble) || (inB.length && inL.length > st.capacity.lunch)) inB.forEach(([r, b]) => set.add(`${r.id}:${b.start}`));
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
      // Molaları saate göre yeniden numarala: en erken mola 1., sonra 2., 3. (kilitli olanlar dahil)
      if (!isLunch) {
        const row = planFor(di).rows.find((x) => x.id === pid);
        if (row) {
          const fresh = day.locks[pid].lunch != null ? { lunch: day.locks[pid].lunch } : {};
          [...row.breaks].sort((a, c) => a.start - c.start).forEach((br, i) => { if (br.locked) fresh[`b${i}`] = br.start; });
          day.locks[pid] = fresh;
        }
      }
      persist(); closeModal(); render();
      const mine = planFor(di).issues.filter((x) => x.level === 'error' && (x.personIds || [x.personId]).includes(pid));
      toast(mine.length ? `⛔ ${mine[0].text}` : `${r.label}: ${isLunch ? 'yemek' : 'mola'} ${fmt(+b.dataset.s)} 🔒 — çakışma yok`);
    }));
  });
}

// ---------- VARDİYA ----------
/** Haftalık satırın özeti: en çok kullanılan vardiya + izinli günler. */
function weekSummary(arr) {
  const cnt = {};
  arr.forEach((v) => { if (!isOff(v)) cnt[v] = (cnt[v] || 0) + 1; });
  const keys = Object.keys(cnt);
  const main = keys.sort((a, b) => cnt[b] - cnt[a])[0] || 'O';
  return { main, mixed: keys.length > 1, off: arr.map((v, d) => (isOff(v) ? d : -1)).filter((d) => d >= 0) };
}

function renderVardiya() {
  const w = week();
  const st = state.settings;
  const SH = [['S', st.shifts.S], ['O', st.shifts.O], ['A', st.shifts.A]];
  const opts = (v) => SH.map(([k, s]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${s.start}–${s.end}</option>`).join('') +
    `<option value="${TRAINING}" ${v === TRAINING ? 'selected' : ''}>Eğitim</option>` +
    Object.entries(NONWORK).map(([k, n]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${n}</option>`).join('');
  const gopts = (g) => st.groups.map((x) => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const cards = active().map((p) => {
    const sm = weekSummary(w.shifts[p.id]);
    const allOff = sm.off.length === 7;
    return `<div class="wk ${p.included ? '' : 'excluded'}">
      <div class="wk-top">
        <input class="wk-name" value="${esc(p.label)}" data-name="${p.id}" placeholder="Ad Soyad" aria-label="Ad Soyad">
        <select data-grp="${p.id}" aria-label="Kanal">${gopts(p.group)}</select>
      </div>
      <div class="wk-mid">
        <select class="sh sh-${allOff ? 'OFF' : sm.main} wk-shift" data-shift="${p.id}" aria-label="Vardiya saati">
          ${SH.map(([k, s]) => `<option value="${k}" ${!allOff && sm.main === k ? 'selected' : ''}>${s.start} – ${s.end}</option>`).join('')}
          <option value="${TRAINING}" ${!allOff && sm.main === TRAINING ? 'selected' : ''}>Eğitim (mola planına girmez)</option>
          ${allOff ? '<option selected value="">Bu hafta yok</option>' : ''}
        </select>
        ${sm.mixed ? '<span class="muted">bazı günler farklı saatte</span>' : ''}
      </div>
      <div class="wk-off"><span class="muted">İzin:</span>
        ${DAY_NAMES.map((n, d) => { const v = w.shifts[p.id][d]; return `<button class="offc ${isOff(v) ? 'on off-' + (v || 'OFF') : ''}" title="${isOff(v) ? NONWORK[v || 'OFF'] : 'Çalışıyor'}" data-off="${p.id}" data-d="${d}">${n}</button>`; }).join('')}
      </div>
      <div class="wk-bot">
        <label class="switch"><input type="checkbox" data-inc="${p.id}" ${p.included ? 'checked' : ''}> Mola planına dahil</label>
        <button class="btn small danger" data-del="${p.id}" aria-label="Sil">✕ Sil</button>
      </div>
    </div>`;
  }).join('');
  const head = DAY_NAMES.map((n, d) => `<th>${n}<br><small>${dayShort(d)}</small></th>`).join('');
  const rows = active().map((p) => `<tr class="${p.included ? '' : 'excluded'}"><td class="name">${esc(p.label)} <span class="badge ${groupClass(p.group)}">${esc(p.group)}</span></td>
    ${w.shifts[p.id].map((v, d) => `<td><select class="sh sh-${v}" data-pid="${p.id}" data-d="${d}">${opts(v)}</select></td>`).join('')}</tr>`).join('');
  $('#view').innerHTML = `
    <div class="card"><h2>Kadro · haftalık vardiya</h2>
      <div class="row">
        <div class="field"><label>Haftanın tarihi</label><input type="date" id="wkDate" value="${state.current.week}"></div>
        <span class="muted">${esc($('#weekLabel').textContent)}</span>
      </div>
      <p class="muted" style="margin:8px 0 0">Her kişi için adını, kanalını, vardiya saatini ve izin günlerini (1–2 gün) seç. Mola tablosu otomatik oluşur. İsimler sadece bu cihazda kalır.</p>
      <div class="row" style="margin-top:8px">
        <span class="px-pair"><button class="btn small primary" id="pasteX">📋 Excel'den yapıştır</button><button class="info-btn" id="pasteHelp" title="Excel'den yapıştırma nasıl kullanılır?" aria-label="Excel'den yapıştırma nasıl kullanılır?">i</button></span>
        <button class="btn small primary" id="addP2">+ Kişi ekle</button>
        <button class="btn small" id="copyPrev">⟲ Önceki haftayı kopyala</button>
        ${state.people.some((p) => p.deleted) ? `<button class="btn small" id="goDel">🗑 Silinenler (${state.people.filter((p) => p.deleted).length})</button>` : ''}
      </div></div>
    <div class="wk-list">${cards}</div>
    ${state.people.some((p) => p.deleted) ? `<div class="card del-card" id="delCard"><h2>🗑 Silinen kişiler (${state.people.filter((p) => p.deleted).length})</h2>
      <p class="muted" style="margin:0 0 8px">Yanlışlıkla sildiysen geri ekle. İşten ayrılan kişiyi "Tamamen kaldır" ile sil.</p>
      ${state.people.filter((p) => p.deleted).map((p) => `<div class="row del-row"><b>${esc(p.label || 'İsimsiz')}</b> <span class="badge ${groupClass(p.group)}">${esc(p.group)}</span>
        <span style="flex:1"></span><button class="btn small" data-restore="${p.id}">↩ Geri ekle</button>
        <button class="btn small danger" data-purge="${p.id}">Tamamen kaldır</button></div>`).join('')}</div>` : ''}
    <div class="row" style="margin:12px 0"><button class="btn primary" id="toPlan">✔ Mola planını gör</button></div>
    <details class="card"><summary><b>Haftalık vardiya planı</b> <span class="muted">— gün gün saat, OFF, Resmi tatil, İzinli</span></summary>
      <div class="tbl-wrap" style="margin-top:8px"><table class="grid"><thead><tr><th>Kişi</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row" style="margin-top:8px">
        <button class="btn small primary" id="shX">📊 Vardiya planı Excel</button>
        <button class="btn small primary" id="shP">📷 Vardiya planı fotoğrafı</button>
        <span style="flex:1"></span>
        <button class="btn small danger" id="clearWeek">Haftayı OFF yap</button></div>
    </details>
`;
  const v = $('#view');
  const rerender = () => { const y = window.scrollY; const open = v.querySelector('details')?.open; persist(); render(); if (open) v.querySelector('details').open = true; window.scrollTo(0, y); };
  $('#wkDate').onchange = (e) => {
    if (!e.target.value) return;
    const [y, m, d] = e.target.value.split('-').map(Number);
    state.current.week = mondayOf(new Date(y, m - 1, d)); week(); persist(); render();
  };
  v.querySelectorAll('[data-name]').forEach((el) => (el.onchange = () => {
    const p = state.people.find((x) => x.id === el.dataset.name); p.label = el.value.trim() || p.label || 'İsimsiz'; rerender();
  }));
  v.querySelectorAll('[data-grp]').forEach((el) => (el.onchange = () => {
    state.people.find((x) => x.id === el.dataset.grp).group = el.value; rerender();
  }));
  v.querySelectorAll('[data-shift]').forEach((el) => (el.onchange = () => {
    if (!el.value) return;
    const arr = w.shifts[el.dataset.shift];
    const allOff = arr.every(isOff);
    for (let d = 0; d < 7; d++) if (allOff || !isOff(arr[d])) arr[d] = el.value;
    rerender();
  }));
  v.querySelectorAll('[data-off]').forEach((el) => (el.onclick = () => {
    const arr = w.shifts[el.dataset.off], d = +el.dataset.d;
    if (isOff(arr[d])) arr[d] = weekSummary(arr).main;
    else {
      if (arr.filter(isOff).length >= 2) toast("Not: bu kişinin 2'den fazla izin günü oldu");
      arr[d] = 'OFF';
    }
    rerender();
  }));
  v.querySelectorAll('select.sh[data-pid]').forEach((s) => (s.onchange = () => {
    w.shifts[s.dataset.pid][+s.dataset.d] = s.value; rerender();
  }));
  v.querySelectorAll('[data-inc]').forEach((el) => (el.onchange = () => {
    state.people.find((x) => x.id === el.dataset.inc).included = el.checked; rerender();
  }));
  v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const p = state.people.find((x) => x.id === b.dataset.del);
    p.deleted = true; rerender();
    toast(`${p.label || 'Kişi'} silindi`, 'Geri al', () => { p.deleted = false; rerender(); });
  }));
  v.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = () => {
    const p = state.people.find((x) => x.id === b.dataset.restore); p.deleted = false; rerender(); toast(`${p.label} geri eklendi`);
  }));
  v.querySelectorAll('[data-purge]').forEach((b) => (b.onclick = () => {
    const p = state.people.find((x) => x.id === b.dataset.purge);
    confirmBox(`${p.label || 'Bu kişi'} tamamen kaldırılsın mı? Geçmiş haftalardaki vardiyaları da silinir, geri alınamaz.`, 'Tamamen kaldır', () => {
      state.people = state.people.filter((x) => x.id !== p.id);
      for (const wk of Object.values(state.weeks)) { delete wk.shifts[p.id]; wk.days.forEach((d) => delete d.locks[p.id]); }
      persist(); render();
    });
  }));
  $('#goDel')?.addEventListener('click', () => $('#delCard').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  $('#shX').onclick = () => doShift('xlsx');
  $('#shP').onclick = () => doShift('png');
  $('#pasteX').onclick = pasteExcel;
  $('#pasteHelp').onclick = () => openModal(`<h2>📋 Excel'den yapıştırma — nasıl kullanılır?</h2>${excelHelpHtml()}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-x>Kapat</button><button class="btn primary" data-go>📋 Yapıştırmaya başla</button></div>`, (m) => {
    m.classList.add('wide');
    $('[data-x]', m).onclick = closeModal;
    $('[data-go]', m).onclick = () => { closeModal(); pasteExcel(); };
  });
  $('#addP2').onclick = () => {
    const id = newId(state);
    state.people.push({ id, label: '', group: 'B2C', included: true });
    for (const wk of Object.values(state.weeks)) wk.shifts[id] = Array(7).fill('OFF');
    w.shifts[id] = Array(7).fill('O');
    persist(); render();
    const inp = [...document.querySelectorAll('.wk-name')].at(-1); inp.scrollIntoView({ block: 'center' }); inp.focus();
  };
  $('#toPlan').onclick = () => { tab = 'plan'; state.current.all = true; persist(); render(); window.scrollTo(0, 0); };
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

// ---------- EXCEL'DEN YAPIŞTIR ----------
const mondayKey = (date) => addDays(date, -weekdayOf(date));
const shortDate = (date) => { const [, m, d] = date.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
function cellLabel(c) {
  if (!c) return '—';
  if (c.resigned) return 'İstifa';
  if (c.code === TRAINING) return 'Eğitim';
  if (c.code in NONWORK) return NONWORK[c.code];
  const sh = state.settings.shifts[c.code];
  return `${sh.start}–${sh.end}`;
}

function excelHelpHtml() {
  const st = state.settings;
  const al = Object.entries(st.groupAliases || {}).map(([k, v]) => `${esc(k)} → ${esc(v)}`).join(', ');
  return `<div class="help">
    <h3>1. Excel'de ne seçmeliyim?</h3>
    <ul>
      <li>Tablonun <b>tarih satırından</b> (23-Nov, 24-Nov…) başlayıp <b>son kişinin Pazar hücresine</b> kadar olan alanı fareyle seç.</li>
      <li>Seçimde şunlar olsun: <b>Ad Soyad</b> sütunu, <b>Birim</b> sütunu (B2B, B2C, Digital, Satış), <b>Pzt…Paz</b> gün sütunları.</li>
      <li>Sağdaki OFF sayısı sütunu, boş satırlar, renkler ve başlıktaki "23-29 NOV" gibi yazılar seçime girse de sorun olmaz, yok sayılır.</li>
      <li>Sonra <b>Ctrl+C</b> (Mac'te ⌘+C) ile kopyala.</li>
    </ul>
    <h3>2. Uygulamaya nasıl yapıştırırım?</h3>
    <ul>
      <li>Kadro → <b>📋 Excel'den yapıştır</b> → açılan kutuya tıkla → <b>Ctrl+V</b>.</li>
      <li>Yapıştırır yapıştırmaz altta <b>önizleme</b> çıkar: herkesin 7 günü renkli olarak görünür. Henüz hiçbir şey kaydedilmedi.</li>
      <li>Kontrol et, doğruysa <b>✔ Vardiyaları işle</b>'ye bas. Vazgeçersen hiçbir şey değişmez.</li>
    </ul>
    <h3>3. Hücrelerde ne yazabilir?</h3>
    <ul>
      <li><b>Saat aralığı:</b> ${['S', 'O', 'A'].map((k) => `${st.shifts[k].start} - ${st.shifts[k].end}`).join(', ')}. "9-18:30" ya da "10.30-20.00" gibi yazımlar da olur.</li>
      <li><b>OFF</b> (ya da X, Hafta tatili) → izin günü.</li>
      <li><b>İzinli</b>, Yıllık izin, Rapor → İzinli. <b>Resmi tatil</b>, RT, Bayram → Resmi tatil. <b>Eğitim</b> → çalışıyor ama mola planına girmez.</li>
      <li><b>ISTIFA</b> → o kişi kadrodan çıkar, Silinen kişiler'e taşınır (önizlemedeki işareti kaldırırsan taşınmaz).</li>
      <li>Uygulamada olmayan bir saat (ör. 12:00 - 21:00) en yakın vardiyaya sayılır; önizlemede <b style="color:#b45309">turuncu çerçeveyle</b> uyarır.</li>
      <li>Boş hücre → o gün değiştirilmez.</li>
    </ul>
    <h3>4. Kişiler ve birimler</h3>
    <ul>
      <li>İsimler kadroyla <b>büyük/küçük harf ve boşluk fark etmeden</b> eşleşir.</li>
      <li>Kadroda olmayan isim <b>yeni kişi</b> olarak eklenir (önizlemede "yeni" yazar). Silinenlerdeki biri Excel'de çalışıyorsa geri eklenir.</li>
      <li>Excel'de olmayan kadro kişilerinin vardiyalarına <b>dokunulmaz</b>.</li>
      <li>Birim Excel'de farklı yazılıyorsa eşleşir: ${al || '—'}. Değiştirmek için Ayarlar → Havuzlar.</li>
    </ul>
    <h3>5. Hangi haftaya yazılır?</h3>
    <ul>
      <li>Seçimde <b>tarih satırı varsa</b> tarih oradan okunur, doğru haftaya yazılır ve uygulama o haftayı açar.</li>
      <li>Tarih satırı yoksa <b>şu an seçili haftaya</b> yazılır. Önizlemedeki <b>İlk gün</b> kutusundan tarihi değiştirebilirsin.</li>
      <li>Aralık iki haftaya taşıyorsa (ör. Perşembe–Çarşamba) her gün kendi haftasına yazılır.</li>
    </ul>
    <h3>6. Bilmen gerekenler</h3>
    <ul>
      <li>Yapıştırılan günlerdeki vardiyalar Excel'dekiyle <b>değiştirilir</b>. Vardiyası değişen kişinin o günkü elle ayarlanmış molaları sıfırlanır, mola planı yeniden oluşur.</li>
      <li>"Mola planına dahil" ayarı ve diğer bilgiler korunur.</li>
      <li>Yanlış yapıştırdıysan aynı Excel'i düzeltip tekrar yapıştırman yeterli.</li>
    </ul></div>`;
}

function pasteExcel() {
  let res = null, start = null;
  openModal(`
    <h2>📋 Excel'den vardiya yapıştır</h2>
    <p class="muted" style="margin:0 0 6px">Excel'de tarih satırından son kişinin Pazar hücresine kadar seç, <b>Ctrl+C</b> ile kopyala, aşağıya <b>Ctrl+V</b> ile yapıştır.</p>
    <details class="px-help"><summary><span class="info-btn" aria-hidden="true">i</span> Nasıl kullanılır? (ayrıntılı)</summary>${excelHelpHtml()}</details>
    <textarea id="pxText" rows="4" spellcheck="false" placeholder="Buraya yapıştır…"></textarea>
    <div id="pxOut"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px">
      <button class="btn" data-x>Vazgeç</button>
      <button class="btn primary" id="pxApply" disabled>✔ Vardiyaları işle</button>
    </div>`, (m) => {
    m.classList.add('wide');
    const ta = $('#pxText', m), out = $('#pxOut', m), ok = $('#pxApply', m);
    $('[data-x]', m).onclick = closeModal;
    const draw = () => {
      if (!ta.value.trim()) { res = null; out.innerHTML = ''; ok.disabled = true; return; }
      res = parsePaste(ta.value, { settings: state.settings, people: state.people, fallbackMonday: state.current.week, startDate: start || undefined });
      ok.disabled = !res.rows.length;
      if (!res.rows.length) { out.innerHTML = `<ul class="issues">${res.warns.map((w) => `<li class="error">⛔ ${esc(w)}</li>`).join('')}</ul>`; return; }
      const d = res.dates;
      const twoWeeks = mondayKey(d[0]) !== mondayKey(d[d.length - 1]);
      const fresh = res.rows.filter((r) => !r.personId && !r.resigned).length;
      const resigned = res.rows.filter((r) => r.resigned && r.personId && !r.deleted);
      const head = d.map((x) => `<th>${DAY_NAMES[weekdayOf(x)]}<br><small>${shortDate(x)}</small></th>`).join('');
      const rows = res.rows.map((r) => {
        const tag = r.resigned ? '<span class="pill bad">istifa</span>' : !r.personId ? '<span class="pill">yeni</span>' : r.deleted ? '<span class="pill">geri eklenecek</span>' : '';
        return `<tr class="${r.resigned ? 'excluded' : ''}"><td class="name">${esc(r.name)} ${tag}</td><td>${esc(r.group || '?')}</td>
          ${r.cells.map((c) => `<td class="${c && !c.resigned ? 'sh-' + c.code : ''}${c?.warn ? ' px-warn' : ''}" title="${esc(c?.warn || c?.raw || 'boş — değişmez')}">${esc(cellLabel(c))}</td>`).join('')}</tr>`;
      }).join('');
      out.innerHTML = `
        <div class="row" style="margin-top:10px">
          <div class="field"><label>İlk gün</label><input type="date" id="pxStart" value="${d[0]}"></div>
          <span class="muted">${shortDate(d[0])} – ${shortDate(d[d.length - 1])} · ${res.detected || start ? "tarih Excel'den alındı" : "Excel'de tarih yok — seçili haftaya yazılacak, gerekirse ilk günü değiştir"}${twoWeeks ? ' · iki haftaya yayılıyor, her gün kendi haftasına yazılır' : ''}</span>
        </div>
        <div class="pools" style="margin:8px 0">
          <span class="pill">${res.rows.length} kişi</span>
          ${fresh ? `<span class="pill">${fresh} yeni kişi eklenecek</span>` : ''}
          ${res.rows.some((r) => r.resigned) ? `<span class="pill bad">${res.rows.filter((r) => r.resigned).length} istifa</span>` : ''}
        </div>
        <div class="tbl-wrap"><table class="grid px-grid"><thead><tr><th>Kişi</th><th>Birim</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
        ${resigned.length ? `<label class="switch" style="margin-top:8px"><input type="checkbox" id="pxResign" checked> İstifa edenleri (${esc(resigned.map((r) => r.name).join(', '))}) <b>Silinen kişiler</b>'e taşı</label>` : ''}
        ${res.missing.length ? `<p class="muted" style="margin:8px 0 0">Excel'de olmayanlar (vardiyalarına dokunulmaz): ${esc(res.missing.join(', '))}</p>` : ''}
        ${res.warns.length ? `<ul class="issues">${res.warns.map((w) => `<li class="warn">⚠️ ${esc(w)}</li>`).join('')}</ul>` : ''}
        <p class="muted" style="margin:8px 0 0">Bu günlerdeki vardiyalar Excel'dekiyle değiştirilir; değişen günlerde o kişinin elle ayarlanmış molaları sıfırlanır.</p>`;
      $('#pxStart', out).onchange = (e) => { if (e.target.value) { start = e.target.value; draw(); } };
    };
    ta.addEventListener('input', draw);
    ok.onclick = () => { if (res?.rows.length) applyPaste(res, !!$('#pxResign', m)?.checked); };
    ta.focus();
  });
}

function applyPaste(res, resignDelete) {
  let added = 0, updated = 0, removed = 0;
  for (const r of res.rows) {
    let p = r.personId ? state.people.find((x) => x.id === r.personId) : null;
    if (r.resigned) {
      if (p && resignDelete && !p.deleted) { p.deleted = true; removed++; }
      if (!p || p.deleted) continue;
    }
    if (!p) {
      p = { id: newId(state), label: r.name, group: r.group || 'B2C', included: true };
      state.people.push(p);
      for (const wk of Object.values(state.weeks)) wk.shifts[p.id] = Array(7).fill('OFF');
      added++;
    } else {
      if (r.group) p.group = r.group;
      if (p.deleted) p.deleted = false;
      updated++;
    }
    r.cells.forEach((c, k) => {
      if (!c) return;
      const date = res.dates[k], wk = ensureWeek(state, mondayKey(date)), d = weekdayOf(date);
      if (wk.shifts[p.id][d] !== c.code) { wk.shifts[p.id][d] = c.code; delete wk.days[d].locks[p.id]; }
    });
  }
  state.current.week = mondayKey(res.dates[0]);
  ensureWeek(state, state.current.week);
  persist(); closeModal(); render();
  toast([`${updated + added} kişinin vardiyası işlendi`, added && `${added} yeni kişi`, removed && `${removed} istifa silinenlere taşındı`].filter(Boolean).join(' · '));
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
      ${num('minGap', 'Kişinin molaları arası en az (dk)', st.minGap, 15)}
      ${num('maxGap', 'En uzun molasız çalışma (dk)', st.maxGap ?? 165, 15)}
${time('latestEnd', 'Tüm molalar en geç bitiş', st.latestEnd || '18:30')}
    </div></div>
    <div class="card form"><h2>Havuzlar</h2>
      <p class="muted" style="margin:0">Aynı havuzdakiler aynı anda molaya/yemeğe çıkamaz. Farklı havuzlar birbirini etkilemez.</p>
      <div class="grid2">${st.groups.map((g) => `<div class="field"><label>${esc(g)}</label><select data-path="groupPool.${g}" data-num="1">
        ${[1, 2, 3].map((n) => `<option value="${n}" ${st.groupPool[g] === n ? 'selected' : ''}>${n}. havuz</option>`).join('')}</select></div>`).join('')}</div>
      <div class="grid2">${[1, 2, 3].map((n) => `<div class="field"><label>${n}. havuz adı</label><input data-path="poolNames.${n}" value="${esc(st.poolNames[n] || '')}"></div>`).join('')}</div>
      <div class="field" style="margin-top:8px"><label>Excel'de farklı yazılan birimler (Excel'deki = uygulamadaki)</label>
        <input id="aliases" value="${esc(Object.entries(st.groupAliases || {}).map(([k, v]) => `${k}=${v}`).join(', '))}" placeholder="Digital=Mail, Sales=Satış"></div>
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
  $('#aliases').onchange = (e) => {
    st.groupAliases = Object.fromEntries(e.target.value.split(',').map((x) => x.split('=').map((y) => y.trim()))
      .filter(([k, v]) => k && v && st.groups.includes(v)));
    persist(); render(); toast('Kaydedildi');
  };
  $('#defSet').onclick = () => confirmBox('Tüm kurallar varsayılana dönsün mü? (Kadro ve vardiyalar korunur)', 'Döndür', () => {
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); persist(); render();
  });
  $('#wipe').onclick = () => confirmBox('Bu cihazdaki tüm kadro, vardiya ve ayarlar silinsin mi? Önce yedek almanı öneririm.', 'Hepsini sil', () => {
    state = reset(); persist(); render();
  });
}

// ---------- YARDIM ----------
function renderYardim() {
  const st = state.settings;
  const q = (title, body) => `<details class="faq"><summary>${title}</summary><div>${body}</div></details>`;
  $('#view').innerHTML = `
    <div class="card"><h2>❓ Nasıl kullanılır?</h2>
      <p class="muted" style="margin:0">Kısaca: <b>Kadro</b>'da haftayı gir → <b>Mola Planı</b>'na bak, gerekirse düzelt → <b>Çıktı</b>'dan gönder.</p></div>
    <div class="card faq-list">
      ${q('Uygulamayı program gibi nasıl açarım?', `<ul>
        <li><b>iPhone:</b> Safari → Paylaş ⬆ → "Ana Ekrana Ekle".</li>
        <li><b>Android:</b> Chrome ⋮ menü → "Ana ekrana ekle" / "Uygulamayı yükle".</li>
        <li><b>Bilgisayar:</b> adres çubuğundaki "Yükle" simgesi.</li></ul>`)}
      ${q('Kadroya kişi nasıl eklenir?', `<ul>
        <li><b>Kadro</b> → <b>+ Kişi ekle</b>.</li>
        <li>Ad soyad yaz, birimini seç (B2B, B2C, Mail, Satış).</li>
        <li>Vardiya saatini seç, izin günlerine dokun.</li></ul>`)}
      ${q("Excel'deki vardiya planını nasıl aktarırım?", `<ul>
        <li>Excel'de isimlerden son güne kadar olan alanı seç (tarih ve Pzt/Sal başlıklarıyla birlikte), <b>Ctrl+C</b>.</li>
        <li>Kadro → <b>📋 Excel'den yapıştır</b> → kutuya <b>Ctrl+V</b>.</li>
        <li>Önizlemeyi kontrol et, <b>Vardiyaları işle</b>'ye bas. Kadroda olmayan isimler yeni kişi olarak eklenir, "ISTIFA" yazanlar Silinen kişiler'e taşınır.</li>
        <li>Excel'de tarih yoksa seçili haftaya yazılır; önizlemedeki <b>İlk gün</b>'den değiştirebilirsin.</li>
        <li>Birim farklı yazıyorsa (Digital → Mail) Ayarlar → Havuzlar'dan eşleştir.</li></ul>`)}
      ${q('Haftanın vardiyası nasıl girilir?', `<ul>
        <li>Kadro'da üstten <b>haftanın tarihini</b> seç.</li>
        <li>Her kartta vardiya saatini seç: 08:00 / 09:00 / 10:30 ya da <b>Eğitim</b>.</li>
        <li>İzin günlerine dokun (Pzt, Çar…) — sarı olur, o gün OFF sayılır.</li>
        <li>Bir gün farklı saat, <b>Resmi tatil</b>, <b>İzinli</b> veya <b>Eğitim</b> için: altta <b>Haftalık vardiya planı</b>'nı aç, o günü değiştir.</li>
        <li>Yeni hafta: üstteki ok ile ileri git (önceki hafta kopyalanır) ya da <b>Önceki haftayı kopyala</b>.</li></ul>`)}
      ${q('Kim mola planına girmez?', `<ul>
        <li>O gün OFF, Resmi tatil, İzinli veya <b>Eğitim</b>'de olanlar.</li>
        <li>Kartında <b>"Mola planına dahil"</b> işareti kaldırılanlar.</li>
        <li>Bunlar vardiya planında görünmeye devam eder.</li></ul>`)}
      ${q('Mola planı hangi kurallarla oluşur?', `<ul>
        <li>Kişi başı ${st.breakCount} × ${st.breakMin} dk mola + ${st.lunchMin} dk yemek.</li>
        <li>Vardiyanın ilk ve son ${st.edgeMin} dk'sında mola yok; tüm molalar en geç <b>${st.latestEnd}</b> biter.</li>
        <li>İki mola arası en az <b>${st.minGap} dk</b>, molasız en fazla <b>${Math.floor((st.maxGap ?? 165) / 60)} sa ${(st.maxGap ?? 165) % 60 ? ((st.maxGap ?? 165) % 60) + ' dk' : ''}</b> çalışılır.</li>
        <li>Yemekler ${st.lunchWindow.start}'de başlar: önce sabahçılar, sonra öğlenciler, en son akşamcılar.</li>
        <li>Aynı birim havuzunda aynı anda <b>en fazla 1 kişi yemekte, 1 kişi molada</b> (B2B+B2C+Satış bir havuz, Mail ayrı havuz).</li>
        <li>Kalabalık günde yer kalmazsa, yemekte kimse yokken 2 kişi molaya çıkabilir — altta nedeniyle yazar.</li></ul>`)}
      ${q('Bir molanın saatini nasıl değiştiririm?', `<ul>
        <li>Mola Planı'nda saate dokun → yeni saati seç. Seçtiğin saat 🔒 kilitlenir, diğerleri ona göre yeniden dizilir.</li>
        <li>Molalar her zaman saate göre 1., 2., 3. olarak sıralanır.</li>
        <li>Çakışma olursa tablonun altında <b>Notlar</b>'da "kim kiminle çakışıyor" yazar.</li>
        <li>Geri almak için: saate dokun → <b>Otomatiğe bırak</b>, ya da <b>Elle değişiklikleri sil</b>.</li></ul>`)}
      ${q('Renkler ne anlama geliyor?', `<ul>
        <li><span class="lg lunch"></span> Sarı: yemek.</li>
        <li><span class="lg over"></span> Kırmızı dolu: ${st.lunchWindow.end} sonrasına sarkan yemek.</li>
        <li><span class="lg bad"></span> Kırmızı çerçeve: kural dışı / çakışma.</li>
        <li><span class="lg adj"></span> Turuncu: molalar arası ${st.minGap} dk'dan az.</li></ul>`)}
      ${q('Yanlışlıkla birini sildim, ne yapmalıyım?', `<ul>
        <li>Silince altta birkaç saniye <b>Geri al</b> çıkar.</li>
        <li>Kaçırdıysan: Kadro → <b>Silinen kişiler</b> → <b>Geri ekle</b>.</li>
        <li>İşten ayrılan kişi için oradan <b>Tamamen kaldır</b>.</li></ul>`)}
      ${q('Planı ekibe nasıl gönderirim?', `<ul>
        <li><b>Çıktı</b> → günün fotoğrafı, günün Excel'i veya haftalık mola Excel'i.</li>
        <li>Haftalık <b>vardiya planı</b> (kim hangi gün hangi vardiyada) için de Excel/fotoğraf var.</li>
        <li>Telefonda paylaş menüsü açılır, WhatsApp'ı seç.</li></ul>`)}
      ${q('Verilerim nerede? Başka cihazda nasıl açarım?', `<ul>
        <li>Her şey sadece bu cihazda saklanır, hiçbir yere gönderilmez.</li>
        <li>Başka cihaza taşımak için: Çıktı → <b>Yedeği indir</b>, diğer cihazda <b>Yedekten yükle</b>.</li>
        <li>Tarayıcı verisini silersen kayıt gider — ara sıra yedek al.</li></ul>`)}
      ${q('Ayarlar ne işe yarar?', `<ul>
        <li>Vardiya saatleri, mola/yemek süreleri, yemek aralığı, 18:30 sınırı, molalar arası süreler ve havuzlar buradan değişir.</li>
        <li>Bozulursa <b>Kuralları varsayılana döndür</b>.</li></ul>`)}
    </div>`;
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
async function doShift(kind) {
  const heads = DAY_NAMES.map((n, d) => `${n} ${dayShort(d)}`);
  const table = shiftTable(active(), week().shifts, state.settings, heads);
  const title = `Haftalık Vardiya Planı · ${$('#weekLabel').textContent}`;
  const blob = kind === 'xlsx' ? shiftXlsxBlob(table, title) : await shiftPngBlob(table, title);
  report(await shareOrDownload(blob, `Vardiya-Plani_${state.current.week}.${kind === 'xlsx' ? 'xlsx' : 'png'}`, true));
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
        <button class="btn primary" data-a="xweek">📊 Haftalık mola Excel'i (7 sayfa)</button>
      </div>
      <h2 style="margin-top:14px">Haftalık vardiya planı</h2>
      <p class="muted" style="margin:0 0 8px">Mola değil, kimin hangi gün hangi vardiyada olduğu (eğitimdekiler, izinliler dahil).</p>
      <div class="row">
        <button class="btn primary" data-a="shx">📊 Vardiya planı Excel</button>
        <button class="btn primary" data-a="shp">📷 Vardiya planı fotoğrafı</button>
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
  v.querySelector('[data-a="shx"]').onclick = () => doShift('xlsx');
  v.querySelector('[data-a="shp"]').onclick = () => doShift('png');
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
  ({ plan: renderPlan, kadro: renderVardiya, ayarlar: renderAyarlar, yardim: renderYardim, cikti: renderCikti })[tab]();
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (tab === 'cikti') render(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');

// İlk açılışta bu haftaya git (örnek verisi olan hafta hariç: kayıt yoksa örnek hafta açılır)
if (!localStorage.getItem('mola-plani:v1')) persist();
render();
