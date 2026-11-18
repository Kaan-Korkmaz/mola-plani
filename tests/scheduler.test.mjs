import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDay, toMin } from '../js/scheduler.js';
import { DEFAULT_SETTINGS as S, SAMPLE_PEOPLE, SAMPLE_SHIFTS } from '../js/defaults.js';

const dayShifts = (d) => Object.fromEntries(Object.entries(SAMPLE_SHIFTS).map(([id, w]) => [id, w[d]]));
const gen = (d, locks = {}, people = SAMPLE_PEOPLE, shifts = dayShifts(d)) =>
  generateDay({ people, shifts, settings: S, locks });
const pool1 = (plan) => plan.rows.filter((r) => r.pool === 1);
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

test('yemek: 12 kişide ardışık, aynı anda asla 2 yemek, taşanlar akşamcı', () => {
  const rows = pool1(gen(0));
  assert.equal(rows.length, 12);
  const lunches = rows.map((r) => r.lunch).sort((a, b) => a.start - b.start);
  lunches.forEach((l, i) => assert.equal(l.start, toMin('11:00') + 30 * i));
  const over = rows.filter((r) => r.lunch.overflow);
  assert.equal(over.length, 2);
  over.forEach((r) => assert.equal(r.shift, 'A'));
});

test('kurallar: 16-22 Kasım haftasının her günü', () => {
  for (let d = 0; d < 7; d++) {
    const plan = gen(d);
    assert.deepEqual(plan.issues.filter((i) => i.level === 'error'), [], `gün ${d}`);
    for (const r of plan.rows) {
      const sh = S.shifts[r.shift];
      const lo = toMin(sh.start) + 60, hi = Math.min(toMin(sh.end) - 60, toMin('18:30'));
      assert.ok(r.lunch, `gün ${d} ${r.label} yemek yok`);
      assert.equal(r.breaks.length, 3, `gün ${d} ${r.label} mola sayısı`);
      const evs = [r.lunch, ...r.breaks].sort((a, b) => a.start - b.start);
      for (const e of evs) assert.ok(e.start >= lo && e.end <= hi, `gün ${d} ${r.label} pencere ${e.start}`);
      for (let k = 1; k < evs.length; k++)
        assert.ok(evs[k].start - evs[k - 1].end >= 60, `gün ${d} ${r.label}: molalar arası 1 saatten az`);
      const pts = [toMin(sh.start), ...evs.flatMap((e) => [e.start, e.end]), toMin(sh.end)];
      for (let k = 0; k < pts.length; k += 2) assert.ok(pts[k + 1] - pts[k] <= 165, `gün ${d} ${r.label}: 2 sa 45 dk'dan uzun molasız`);
    }
    for (const pool of [1, 2]) {
      const rows = plan.rows.filter((r) => r.pool === pool);
      for (let t = toMin('08:00'); t < toMin('20:00'); t += 15) {
        const q = { start: t, end: t + 15 };
        const nl = rows.filter((r) => overlaps(r.lunch, q)).length;
        const nb = rows.filter((r) => r.breaks.some((b) => overlaps(b, q))).length;
        assert.ok(nl <= 1, `gün ${d} havuz ${pool} ${t}: aynı anda ${nl} yemek`);
        assert.ok(nb <= 1 || (nb === 2 && nl === 0 && plan.pools[pool].crowded), `gün ${d} havuz ${pool} ${t}: ${nb} mola, ${nl} yemek`);
      }
    }
  }
});

test('kalabalık gün: aynı anda 2 mola uyarıyla ve nedeniyle bildirilir', () => {
  const plan = gen(0);
  const w = plan.issues.filter((i) => i.level === 'warn' && /programda yer olmadığı için/.test(i.text));
  assert.ok(plan.pools[1].crowded);
  assert.ok(w.length >= 1);
  assert.match(w[0].text, /yemekte kimse yok/);
});

test('kilit: elle konan mola yerinde kalır', () => {
  const b = gen(0, { p4: { b0: toMin('10:15') } }).rows.find((x) => x.id === 'p4').breaks.find((x) => x.key === 'b0');
  assert.equal(b.start, toMin('10:15'));
  assert.equal(b.locked, true);
});

test('elle değiştirilen mola saate göre sıralanır', () => {
  const r = gen(1, { p4: { b0: toMin('15:00') } }).rows.find((x) => x.id === 'p4');
  const starts = r.breaks.map((b) => b.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('plana girmeyenler: OFF, Resmi tatil, İzinli, plana dahil olmayan', () => {
  const ids = gen(0, {}, SAMPLE_PEOPLE, { ...dayShifts(0), p3: 'RT', p4: 'IZ' }).rows.map((r) => r.id);
  for (const id of ['p2', 'p12', 'p15', 'p3', 'p4']) assert.ok(!ids.includes(id), id);
});

test('az kişi: yemekler vardiyaya göre yayılır (Mail: sabahçı 11:00, akşamcı 15:30)', () => {
  const mail = gen(0).rows.filter((r) => r.pool === 2).sort((a, b) => a.shiftStart - b.shiftStart);
  assert.equal(mail[0].lunch.start, toMin('11:00'));
  assert.equal(mail[1].lunch.start, toMin('15:30'));
});

test('elle iki kişi aynı yemeğe konursa çakışma notu yazılır', () => {
  const plan = gen(0, { p3: { lunch: 720 }, p4: { lunch: 720 } });
  assert.ok(plan.issues.some((i) => i.level === 'error' && /yemek 12:00\) ↔ .*yemek 12:00\) çakışıyor/.test(i.text)));
});
