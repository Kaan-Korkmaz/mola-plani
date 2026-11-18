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
  const slotFree = (s) => {
    for (let t = s; t < s + L; t += Q) if (lunchOcc(t, t + Q) >= lunchCap(s)) return false;
    return true;
  };
  // Kişi az ise (aralığa rahat sığıyorsa) yemekleri 11:00–16:00'ya vardiya sırasıyla yay:
  // sabahçı başta, akşamcı sonda. Kalabalıkta arka arkaya dizilir (aşağıdaki döngü).
  if (!needsChoice) {
    const SHIFT_POS = { S: 0, O: 0.5, A: 1 };
    ordered.forEach((r, i) => {
      if (r.lunch) return;
      const frac = n > 1 ? i / (n - 1) : SHIFT_POS[r.shift] ?? 0;
      const desired = lw0 + Math.round(frac * (slotCount - 1)) * L;
      const cands = [];
      for (let s = lw0; s + L <= lw1; s += L) if (s >= r.winStart && s + L <= r.winEnd) cands.push(s);
      cands.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || b - a);
      const s = cands.find(slotFree);
      if (s != null) r.lunch = { start: s, end: s + L, locked: false };
    });
  }
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
  // Kurallar: kişinin olayları (yemek dahil) arası en az G dk, en fazla MAXG dk molasız çalışma
  // (vardiya başı → ilk mola ve son mola → vardiya sonu dahil). Havuzda aynı anda capB kişi molada.
  // Yöntem: her kişi için kurallara uyan tüm mola kombinasyonları çıkarılır; havuzda çakışmayacak
  // şekilde kişiler birkaç farklı sırayla yerleştirilir, en iyi sonuç seçilir.
  const G = st.minGap;
  const MAXG = st.maxGap ?? 150;
  const people = [];
  for (const r of rs) {
    const lk = locks[r.id] || {};
    const allKeys = Array.from({ length: st.breakCount }, (_, k) => `b${k}`);
    for (const key of allKeys)
      if (lk[key] != null) r.breaks.push({ start: lk[key], end: lk[key] + B, key, locked: true });
    const freeKeys = allKeys.filter((k) => lk[k] == null);
    const fixed = [...(r.lunch ? [r.lunch] : []), ...r.breaks].sort((a, b) => a.start - b.start);
    const pts = [{ start: r.shiftStart, end: r.shiftStart, shift: true }, ...fixed, { start: r.shiftEnd, end: r.shiftEnd, shift: true }];
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const A = pts[i], Z = pts[i + 1];
      const a = A.end, z = Z.start, len = z - a;
      const gA = A.shift ? st.edgeMin : G, gZ = Z.shift ? st.edgeMin : G;
      const need = Math.max(0, Math.ceil((len - MAXG) / (MAXG + B)));
      const cap = len >= gA + B + gZ ? Math.floor((len - gA - gZ + G) / (B + G)) : 0;
      segs.push({ a, z, gA, gZ, len, need, cap, m: 0, preLunch: Z === r.lunch });
    }
    let free = freeKeys.length;
    for (const s of segs) { s.m = Math.min(s.need, s.cap); free -= s.m; }
    if (free < 0) {
      issues.push({ level: 'error', personId: r.id, text: `${r.label}: ${MAXG / 60} saat kuralı için ${st.breakCount} mola yetmiyor` });
      for (let i = segs.length - 1; i >= 0 && free < 0; i--) { const cut = Math.min(segs[i].m, -free); segs[i].m -= cut; free += cut; }
    }
    while (free > 0) {
      const open = segs.filter((s) => s.m < s.cap);
      if (!open.length) break;
      const pre = open.find((s) => s.preLunch && s.m < st.breakCount - 1);
      const pick = pre || open.sort((x, y) => y.len / (y.m + 1) - x.len / (x.m + 1))[0];
      pick.m++; free--;
    }
    if (free > 0) issues.push({ level: 'error', personId: r.id, text: `${r.label}: ${free} mola için kurallara uygun boşluk yok — elle yerleştirilemedi` });
    // Tercih edilen dağılım (yemekten önce 2 mola) + diğer geçerli dağılımlar (küçük cezayla)
    const pref = segs.map((s) => s.m);
    const total = pref.reduce((a, b) => a + b, 0);
    const allocs = [];
    const recA = (i, left, cur) => {
      if (i === segs.length) { if (left === 0) allocs.push([...cur]); return; }
      for (let m = Math.min(segs[i].need, pref[i]); m <= Math.min(segs[i].cap, left); m++) { cur.push(m); recA(i + 1, left - m, cur); cur.pop(); }
    };
    recA(0, total, []);
    let combos = [];
    for (const al of allocs) {
      const pen = al.reduce((s, m, i) => s + Math.abs(m - pref[i]), 0) * 45;
      const sg = segs.map((s, i) => ({ ...s, m: al[i] }));
      for (const c of combosFor(r, sg, st, G, MAXG, B)) combos.push({ xs: c.xs, cost: c.cost + pen });
    }
    combos.sort((a, b) => a.cost - b.cost);
    if (combos.length > 3000) combos = combos.slice(0, 3000);
    people.push({ r, segs, freeKeys, combos });
  }

  const blockedQ = new Set();
  for (let t = 0; t < 24 * 60; t += Q) if (blocked(t)) blockedQ.add(t);
  const lockedOcc = new Map();
  for (const r of rs) for (const b of r.breaks) for (let t = b.start; t < b.end; t += Q) lockedOcc.set(t, (lockedOcc.get(t) || 0) + 1);

  const run = (order) => {
    const occ = new Map(lockedOcc);
    const chosen = new Map();
    let fails = 0, cost = 0;
    for (const p of order) {
      if (!p.combos.length) { if (p.segs.some((s) => s.m)) fails++; chosen.set(p, []); continue; }
      const c = p.combos.find((cb) => cb.xs.every((x) => !blockedQ.has(x) && (occ.get(x) || 0) < capB));
      if (!c) { fails++; chosen.set(p, null); continue; }
      for (const x of c.xs) occ.set(x, (occ.get(x) || 0) + 1);
      chosen.set(p, c.xs); cost += c.cost;
    }
    return { chosen, fails, cost, occ };
  };

  // Denenecek sıralar: en kısıtlı önce, yemeği erken olan önce, vardiyaya göre + sabit tohumlu karışık sıralar
  const orders = [
    [...people].sort((a, b) => a.combos.length - b.combos.length || a.r.order - b.r.order),
    [...people].sort((a, b) => (a.r.lunch?.start ?? 0) - (b.r.lunch?.start ?? 0) || a.r.order - b.r.order),
    [...people].sort((a, b) => a.r.shiftStart - b.r.shiftStart || a.r.order - b.r.order),
  ];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 60; k++) orders.push([...people].map((p) => [rnd(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
  let best = null;
  for (const o of orders) {
    const res = run(o);
    if (!best || res.fails < best.fails || (res.fails === best.fails && res.cost < best.cost)) best = res;
    if (best.fails === 0 && o === orders[2]) break; // ilk üç sıradan biri tam çözdüyse yeter
  }

  // Tam arama: hızlı denemeler herkesi yerleştiremediyse, en kısıtlı kişiden başlayarak geri izlemeli ara
  if (best.fails > 0) {
    const need = people.filter((p) => p.combos.length);
    const occ = new Map(lockedOcc);
    const pick = new Map();
    let nodes = 0, found = false;
    const fitsNow = (xs) => xs.every((x) => !blockedQ.has(x) && (occ.get(x) || 0) < capB);
    const dfs = () => {
      if (++nodes > 20000) return false;
      let bestP = null, bestList = null;
      for (const p of need) {
        if (pick.has(p)) continue;
        const list = [];
        for (const c of p.combos) { if (fitsNow(c.xs)) { list.push(c); if (bestList && list.length >= bestList.length) break; } }
        if (!list.length) return false;
        if (!bestList || list.length < bestList.length) { bestP = p; bestList = list; }
      }
      if (!bestP) return true;
      for (const c of bestList) {
        c.xs.forEach((x) => occ.set(x, (occ.get(x) || 0) + 1));
        pick.set(bestP, c);
        if (dfs()) return true;
        pick.delete(bestP);
        c.xs.forEach((x) => occ.set(x, occ.get(x) - 1));
        if (nodes > 20000) return false;
      }
      return false;
    };
    found = dfs();
    if (found) {
      best = { chosen: new Map(people.map((p) => [p, pick.get(p)?.xs ?? []])), fails: 0, cost: 0, occ };
    }
  }

  // Onarım: açıkta kalan kişiye yer aç — çakıştığı en fazla 2 kişiyi başka kombinasyonlarına kaydır
  const fits = (xs, occ) => xs.every((x) => !blockedQ.has(x) && (occ.get(x) || 0) < capB);
  const add = (xs, occ, d) => xs.forEach((x) => occ.set(x, (occ.get(x) || 0) + d));
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (const p of people) {
      if (best.chosen.get(p) !== null) continue;
      const owner = new Map();
      for (const [q, xs] of best.chosen) if (xs && q !== p) xs.forEach((x) => owner.set(x, q));
      for (const c of p.combos.slice(0, 400)) {
        if (c.xs.some((x) => blockedQ.has(x))) continue;
        const victims = [...new Set(c.xs.filter((x) => (best.occ.get(x) || 0) >= capB).map((x) => owner.get(x)))];
        if (!victims.length || victims.length > 2 || victims.some((v) => !v)) continue;
        const occ = new Map(best.occ);
        victims.forEach((v) => add(best.chosen.get(v), occ, -1));
        if (!fits(c.xs, occ)) continue;
        add(c.xs, occ, 1);
        const moved = [];
        for (const v of victims) {
          const alt = v.combos.find((cb) => fits(cb.xs, occ));
          if (!alt) break;
          add(alt.xs, occ, 1); moved.push([v, alt]);
        }
        if (moved.length !== victims.length) continue;
        best.occ = occ;
        best.chosen.set(p, c.xs);
        moved.forEach(([v, alt]) => best.chosen.set(v, alt.xs));
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  for (const p of people) {
    const xs = best.chosen.get(p);
    if (xs) { for (const x of xs) p.r.breaks.push({ start: x, end: x + B, key: null, locked: false }); continue; }
    // Tam çözüm yoksa: kurallara uyan kombinasyonlardan boş yerlere en çok oturanı, kalanını hata olarak yaz
    let bestPart = [];
    for (const c of p.combos) {
      const ok = c.xs.filter((x) => !blockedQ.has(x) && (best.occ.get(x) || 0) < capB);
      if (ok.length > bestPart.length) bestPart = ok;
      if (bestPart.length === c.xs.length - 1) break;
    }
    for (const x of bestPart) { p.r.breaks.push({ start: x, end: x + B, key: null, locked: false }); best.occ.set(x, (best.occ.get(x) || 0) + 1); }
    const miss = p.segs.reduce((n, s) => n + s.m, 0) - bestPart.length;
    if (miss > 0) issues.push({ level: 'error', personId: p.r.id, text: `${p.r.label}: ${miss} mola kurallara uygun yere yerleştirilemedi — elle yerleştirin` });
  }

  // Otomatik molalara anahtar ver: saate göre sırayla (kilitliler kendi anahtarını korur)
  for (const p of people) {
    p.r.breaks.sort((a, b) => a.start - b.start);
    const keys = [...p.freeKeys];
    for (const b of p.r.breaks) if (!b.locked) b.key = keys.shift();
  }
  return { count: n, needsChoice, capacity: normal };
}

/** Bir kişinin kurallara uyan mola kombinasyonları (maliyete göre sıralı). */
function combosFor(r, segs, st, G, MAXG, B) {
  const perSeg = segs.map((s) => {
    if (!s.m) return [{ xs: [], cost: 0 }];
    const lo = Math.max(s.a + s.gA, r.winStart), hi = Math.min(s.z - s.gZ - B, r.winEnd - B);
    const targets = Array.from({ length: s.m }, (_, i) => roundQ(lo + ((hi - lo) * (i + 1)) / (s.m + 1)));
    const out = [];
    const rec = (i, prevEnd, xs, cost) => {
      if (out.length > 4000) return;
      if (i === s.m) {
        const tail = s.z - prevEnd;
        if (tail >= s.gZ && tail <= MAXG) out.push({ xs: [...xs], cost });
        return;
      }
      const minGap = i === 0 ? s.gA : G;
      for (let x = Math.max(lo, prevEnd + minGap); x <= Math.min(hi, prevEnd + MAXG); x += Q) {
        // kalan molalar için yer kalmalı
        const left = s.m - i - 1;
        if (x + B + left * (G + B) + s.gZ > s.z) break;
        xs.push(x); rec(i + 1, x + B, xs, cost + Math.abs(x - targets[i])); xs.pop();
      }
    };
    rec(0, s.a, [], 0);
    return out;
  });
  let combos = [{ xs: [], cost: 0 }];
  for (const list of perSeg) {
    const next = [];
    for (const c of combos) for (const l of list) next.push({ xs: [...c.xs, ...l.xs], cost: c.cost + l.cost });
    combos = next.length > 20000 ? next.sort((a, b) => a.cost - b.cost).slice(0, 20000) : next;
  }
  return combos.filter((c) => c.xs.length).sort((a, b) => a.cost - b.cost);
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
    const MAXG = st.maxGap ?? 150;
    const dur = (m) => (m % 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m / 60} saat`);
    const seq = [...evs].sort((a, b) => a.start - b.start);
    let prevEnd = r.shiftStart;
    for (const e of [...seq, { start: r.shiftEnd, end: r.shiftEnd }]) {
      if (e.start - prevEnd > MAXG)
        out.push({ level: 'error', personId: r.id, text: `${r.label}: ${fmt(prevEnd)}–${fmt(e.start)} arası ${dur(e.start - prevEnd)} molasız (en fazla ${dur(MAXG)})` });
      prevEnd = Math.max(prevEnd, e.end);
    }
    for (let i = 0; i < evs.length; i++)
      for (let j = i + 1; j < evs.length; j++)
        if (overlaps(evs[i], evs[j]))
          out.push({ level: 'error', personId: r.id, text: `${r.label}: ${evs[i].name} ${fmt(evs[i].start)} ile ${evs[j].name} ${fmt(evs[j].start)} çakışıyor` });
        else {
          const [a, b] = evs[i].start < evs[j].start ? [evs[i], evs[j]] : [evs[j], evs[i]];
          const gap = b.start - a.end;
          if (gap < st.minGap)
            out.push({ level: 'error', personId: r.id, text: `${r.label}: ${a.name} ${fmt(a.start)} ile ${b.name} ${fmt(b.start)} arası ${gap} dk — en az ${st.minGap} dk olmalı` });
        }
  }
  const poolIds = [...new Set(plan.rows.map((r) => r.pool))];
  for (const pool of poolIds) {
    const rs = plan.rows.filter((r) => r.pool === pool);
    const lunchMax = plan.overflowMode === 'sarkmasin' && plan.pools[pool]?.needsChoice ? capL + 1 : capL;
    const name = st.poolNames[pool] || `Havuz ${pool}`;
    // Çakışmaları kişi kişi yaz: "A (mola 10:30) ↔ B (mola 10:30) çakışıyor"
    const pairs = (list, kind) => {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const [ra, ea] = list[i], [rb, eb] = list[j];
          out.push({ level: 'error', conflict: true, personIds: [ra.id, rb.id], personId: ra.id,
            text: `${ra.label} (${kind} ${fmt(ea.start)}) ↔ ${rb.label} (${kind} ${fmt(eb.start)}) çakışıyor` });
        }
    };
    for (let t = 0; t < 24 * 60; t += Q) {
      const q = { start: t, end: t + Q };
      const inL = rs.filter((r) => r.lunch && overlaps(r.lunch, q)).map((r) => [r, r.lunch]);
      const inB = rs.flatMap((r) => r.breaks.filter((b) => overlaps(b, q)).map((b) => [r, b]));
      if (inL.length > lunchMax) pairs(inL, 'yemek');
      if (inB.length > capB) pairs(inB, 'mola');
      if (inL.length > capL && inB.length)
        for (const [r, b] of inB)
          out.push({ level: 'error', conflict: true, personIds: [r.id, ...inL.map(([x]) => x.id)], personId: r.id,
            text: `${r.label} (mola ${fmt(b.start)}) — o sırada 2 kişi yemekte: ${inL.map(([x]) => x.label).join(', ')}` });
    }
    const over = rs.filter((r) => r.lunch && r.lunch.end > lw1);
    if (over.length)
      out.push({ level: 'warn', text: `${name}: ${over.length} yemek ${st.lunchWindow.end} sonrasına sarktı (${over.map((r) => r.label).join(', ')})` });
  }
  // Aynı mesajı bir kez göster
  const seen = new Set();
  return out.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)));
}
