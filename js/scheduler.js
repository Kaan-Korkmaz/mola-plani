// Mola / yemek planlayıcı — saf mantık (tarayıcı ve Node'da çalışır).
// Zaman: gece yarısından itibaren dakika. Izgara: 15 dk.

const Q = 15;

export function toMin(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function fmt(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const roundQ = (m) => Math.round(m / Q) * Q;

/** Kişinin bir olayı, diğer olaylarına en az `gap` dk uzak mı? */
function farEnough(ev, others, gap) {
  return others.every((o) => ev.end + gap <= o.start || o.end + gap <= ev.start);
}

/**
 * Bir günün planını üretir.
 * @returns {{rows:Array, issues:Array, pools:Object, overflowMode:string}}
 */
export function generateDay({ people, shifts, settings, overflowMode, locks = {} }) {
  const st = settings;
  const mode = overflowMode || st.defaultOverflow || 'sarksin';
  const rows = [];
  people.forEach((p, order) => {
    if (!p.included) return;
    const sh = shifts[p.id];
    const def = sh && sh !== 'OFF' ? st.shifts[sh] : null;
    if (!def) return;
    const start = toMin(def.start), end = toMin(def.end);
    rows.push({
      id: p.id, label: p.label, group: p.group,
      pool: st.groupPool[p.group] ?? 1,
      shift: sh, order,
      shiftStart: start, shiftEnd: end,
      winStart: start + st.edgeMin, winEnd: end - st.edgeMin,
      lunch: null, breaks: [],
    });
  });

  const issues = [];
  const pools = {};
  const poolIds = [...new Set(rows.map((r) => r.pool))].sort((a, b) => a - b);
  for (const pool of poolIds) {
    const rs = rows.filter((r) => r.pool === pool);
    pools[pool] = planPool(rs, st, mode, locks, issues);
  }
  const plan = { rows, issues, pools, overflowMode: mode };
  plan.issues.push(...validateDay(plan, st));
  return plan;
}

function planPool(rs, st, mode, locks, issues) {
  const lw0 = toMin(st.lunchWindow.start), lw1 = toMin(st.lunchWindow.end);
  const L = st.lunchMin, B = st.breakMin;
  const capL = st.capacity.lunch, capB = st.capacity.break;
  const slotCount = Math.floor((lw1 - lw0) / L);
  const normal = slotCount * capL;
  const n = rs.length;
  const needsChoice = n > normal;
  const strict = mode === 'sarkmasin' && needsChoice;

  // --- Yemek ---
  const extraCap = {}; // slotStart -> ek kapasite (Sarkmasın)
  if (strict) {
    let extra = n - normal;
    for (let i = 0; extra > 0; i++, extra--) {
      const s = lw1 - L * ((i % slotCount) + 1);
      extraCap[s] = (extraCap[s] || 0) + 1;
    }
  }
  const lunchOcc = (s, e) => rs.filter((r) => r.lunch && overlaps(r.lunch, { start: s, end: e })).length;
  const lunchCap = (s) => capL + (extraCap[s] || 0);

  for (const r of rs) {
    const lk = locks[r.id]?.lunch;
    if (lk != null) r.lunch = { start: lk, end: lk + L, locked: true };
  }
  const ordered = [...rs].sort((a, b) => a.shiftStart - b.shiftStart || a.order - b.order);
  for (const r of ordered) {
    if (r.lunch) continue;
    const limit = strict ? Math.min(lw1, r.winEnd) : r.winEnd;
    for (let s = lw0; s + L <= limit; s += L) {
      if (s < r.winStart) continue;
      let ok = true;
      for (let t = s; t < s + L; t += Q) if (lunchOcc(t, t + Q) >= lunchCap(s)) { ok = false; break; }
      if (ok) { r.lunch = { start: s, end: s + L, locked: false }; break; }
    }
    if (!r.lunch) issues.push({ level: 'error', personId: r.id, text: `${r.label}: yemek molası yerleştirilemedi` });
  }
  for (const r of rs) if (r.lunch) r.lunch.overflow = r.lunch.end > lw1;

  // Mola yasak çeyrekler: yemek doluluğu normal kapasiteyi aşıyorsa
  const blocked = (t) => lunchOcc(t, t + Q) > capL;

  // --- Kısa molalar ---
  const items = [];
  for (const r of rs) {
    const lk = locks[r.id] || {};
    const { targets: tg, before } = breakTargets(r, st);
    for (let k = 0; k < st.breakCount; k++) {
      const key = `b${k}`;
      if (lk[key] != null) r.breaks.push({ start: lk[key], end: lk[key] + B, key, locked: true });
      else items.push({ r, key, target: tg[k], pre: !!r.lunch && k < before });
    }
  }
  // Önce yemekten önceki molalar (yemeği erken olan önce — en sıkışık olan), sonra diğerleri.
  items.sort((a, b) => (b.pre - a.pre) || (a.pre ? a.r.lunch.start - b.r.lunch.start : 0) || a.target - b.target || a.r.order - b.r.order);

  const breakOcc = (t, except) =>
    rs.reduce((n, r) => n + r.breaks.filter((b) => b !== except && overlaps(b, { start: t, end: t + Q })).length, 0);

  const feasible = (it, s, gap, ignoreOcc = false, except = null) => {
    const r = it.r;
    if (s < r.winStart || s + B > r.winEnd) return false;
    const ev = { start: s, end: s + B };
    const own = r.breaks.filter((b) => b !== except);
    if (r.lunch && overlaps(ev, r.lunch)) return false;
    if (own.some((b) => overlaps(ev, b))) return false;
    if (!farEnough(ev, [...(r.lunch ? [r.lunch] : []), ...own], gap)) return false;
    for (let t = s; t < s + B; t += Q) {
      if (blocked(t)) return false;
      if (!ignoreOcc && breakOcc(t, except) >= capB) return false;
    }
    return true;
  };

  const candidates = (it) => {
    const out = [];
    for (let s = it.r.winStart; s + B <= it.r.winEnd; s += Q) out.push(s);
    return out.sort((a, b) => Math.abs(a - it.target) - Math.abs(b - it.target) || a - b);
  };

  const passes = [];
  for (let g = st.minGap; g > 0; g -= Q) passes.push([g, true]);
  passes.push([0, true], [st.minGap, false], [0, false]);

  let pending = items;
  for (const [gap, keepSide] of passes) {
    const next = [];
    for (const it of pending) {
      const side = (c) => !keepSide || !it.r.lunch || (it.pre ? c + B <= it.r.lunch.start : c >= it.r.lunch.end);
      const s = candidates(it).find((c) => side(c) && feasible(it, c, gap));
      if (s != null) it.r.breaks.push({ start: s, end: s + B, key: it.key, locked: false });
      else next.push(it);
    }
    pending = next;
    if (!pending.length) break;
  }

  // 1 adımlık takas: dolu bir çeyreği boşaltmak için oradaki molayı başka yere kaydır
  for (const it of pending) {
    let done = false;
    for (const s of candidates(it)) {
      if (!feasible(it, s, 0, true)) continue;
      const blockers = rs.flatMap((r) => r.breaks.filter((b) => !b.locked && overlaps(b, { start: s, end: s + B })).map((b) => ({ r, b })));
      if (blockers.length !== 1) continue;
      const { r: br, b } = blockers[0];
      const bit = { r: br, key: b.key, target: b.start };
      const bIdx = br.breaks.indexOf(b);
      br.breaks.splice(bIdx, 1);
      it.r.breaks.push({ start: s, end: s + B, key: it.key, locked: false });
      const alt = candidates(bit).find((c) => feasible(bit, c, 0));
      if (alt != null) {
        br.breaks.push({ start: alt, end: alt + B, key: b.key, locked: false });
        done = true;
        break;
      }
      it.r.breaks.pop();
      br.breaks.splice(bIdx, 0, b);
    }
    if (!done) issues.push({ level: 'error', personId: it.r.id, text: `${it.r.label}: ${Number(it.key.slice(1)) + 1}. mola yerleştirilemedi — elle yerleştirin` });
  }

  for (const r of rs) r.breaks.sort((a, b) => a.start - b.start);
  return { count: n, needsChoice, capacity: normal };
}

/** Molaları kişinin penceresine, yemeğin önü ve arkasına orantılı yayar. */
function breakTargets(r, st) {
  const B = st.breakMin, k = st.breakCount;
  if (!r.lunch) {
    const span = r.winEnd - B - r.winStart;
    return { targets: Array.from({ length: k }, (_, i) => roundQ(r.winStart + (span * (i + 1)) / (k + 1))), before: 0 };
  }
  const seg1 = [r.winStart, r.lunch.start - B];
  const seg2 = [r.lunch.end, r.winEnd - B];
  const len1 = Math.max(0, seg1[1] - seg1[0]), len2 = Math.max(0, seg2[1] - seg2[0]);
  // Tercih: son mola hariç hepsi yemekten önce (tablo sırası: 1. Mola, 2. Mola, Yemek, 3. Mola).
  // Yemekten önce yeterli yer yoksa sığdığı kadar.
  let n1 = Math.min(k - 1, Math.floor((len1 + B) / (B + 45)));
  if (len2 < B) n1 = k;
  n1 = Math.max(0, n1);
  const spread = ([a, b], m) => Array.from({ length: m }, (_, i) => roundQ(a + ((b - a) * (i + 1)) / (m + 1)));
  return { targets: [...spread(seg1, n1), ...spread(seg2, k - n1)], before: n1 };
}

/** Plan üzerindeki kural ihlallerini listeler (elle değişiklikten sonra da kullanılır). */
export function validateDay(plan, st) {
  const out = [];
  const lw1 = toMin(st.lunchWindow.end);
  const capL = st.capacity.lunch, capB = st.capacity.break;
  for (const r of plan.rows) {
    const evs = [...(r.lunch ? [{ ...r.lunch, name: 'Yemek' }] : []), ...r.breaks.map((b) => ({ ...b, name: 'Mola' }))];
    for (const e of evs) {
      if (e.start < r.winStart || e.end > r.winEnd)
        out.push({ level: 'error', personId: r.id, text: `${r.label}: ${e.name} ${fmt(e.start)} vardiyanın ilk/son ${st.edgeMin} dakikasına denk geliyor` });
    }
    for (let i = 0; i < evs.length; i++)
      for (let j = i + 1; j < evs.length; j++)
        if (overlaps(evs[i], evs[j]))
          out.push({ level: 'error', personId: r.id, text: `${r.label}: ${evs[i].name} ${fmt(evs[i].start)} ile ${evs[j].name} ${fmt(evs[j].start)} çakışıyor` });
        else if (evs[i].end === evs[j].start || evs[j].end === evs[i].start)
          out.push({ level: 'warn', personId: r.id, text: `${r.label}: ${evs[i].name} ${fmt(evs[i].start)} ve ${evs[j].name} ${fmt(evs[j].start)} arka arkaya` });
  }
  const poolIds = [...new Set(plan.rows.map((r) => r.pool))];
  for (const pool of poolIds) {
    const rs = plan.rows.filter((r) => r.pool === pool);
    const lunchMax = plan.overflowMode === 'sarkmasin' && plan.pools[pool]?.needsChoice ? capL + 1 : capL;
    const name = st.poolNames[pool] || `Havuz ${pool}`;
    for (let t = 0; t < 24 * 60; t += Q) {
      const q = { start: t, end: t + Q };
      const inL = rs.filter((r) => r.lunch && overlaps(r.lunch, q));
      const inB = rs.filter((r) => r.breaks.some((b) => overlaps(b, q)));
      if (inL.length > lunchMax)
        out.push({ level: 'error', text: `${name}: ${fmt(t)}'de aynı anda ${inL.length} kişi yemekte (${inL.map((r) => r.label).join(', ')})` });
      if (inB.length > capB)
        out.push({ level: 'error', text: `${name}: ${fmt(t)}'de aynı anda ${inB.length} kişi molada (${inB.map((r) => r.label).join(', ')})` });
      if (inL.length > capL && inB.length)
        out.push({ level: 'error', text: `${name}: ${fmt(t)}'de 2 kişi yemekteyken mola verilmiş (${inB.map((r) => r.label).join(', ')})` });
    }
    const over = rs.filter((r) => r.lunch && r.lunch.end > lw1);
    if (over.length)
      out.push({ level: 'warn', text: `${name}: ${over.length} yemek ${st.lunchWindow.end} sonrasına sarktı (${over.map((r) => r.label).join(', ')})` });
  }
  // Aynı mesajı bir kez göster
  const seen = new Set();
  return out.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)));
}
