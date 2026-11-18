import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDay, validateDay, toMin } from '../js/scheduler.js';
import { DEFAULT_SETTINGS as S, SAMPLE_PEOPLE, SAMPLE_SHIFTS } from '../js/defaults.js';

const dayShifts = (d) => Object.fromEntries(Object.entries(SAMPLE_SHIFTS).map(([id, w]) => [id, w[d]]));
const gen = (d, overflowMode = 'sarksin', locks = {}) =>
  generateDay({ people: SAMPLE_PEOPLE, shifts: dayShifts(d), settings: S, overflowMode, locks });
const pool1 = (plan) => plan.rows.filter((r) => r.pool === 1);
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

test('sarksin_12: pazartesi yemekler ardışık, 17:00 biter, taşanlar akşamcı', () => {
  const plan = gen(0);
  const rows = pool1(plan);
  assert.equal(rows.length, 12);
  const lunches = rows.map((r) => r.lunch).sort((a, b) => a.start - b.start);
  lunches.forEach((l, i) => assert.equal(l.start, toMin('11:00') + 30 * i));
  assert.equal(lunches.at(-1).end, toMin('17:00'));
  const over = rows.filter((r) => r.lunch.overflow);
  assert.equal(over.length, 2);
  over.forEach((r) => assert.equal(r.shift, 'A'));
  assert.equal(plan.pools[1].needsChoice, true);
});

test('sarkmasin_12: 16:00 sonrası yemek yok, çift dilimde mola yok', () => {
  const plan = gen(0, 'sarkmasin');
  const rows = pool1(plan);
  rows.forEach((r) => assert.ok(r.lunch.end <= toMin('16:00'), r.label));
  const at = (t) => rows.filter((r) => r.lunch.start === toMin(t)).length;
  assert.equal(at('15:00'), 2);
  assert.equal(at('15:30'), 2);
  const dbl = { start: toMin('15:00'), end: toMin('16:00') };
  rows.forEach((r) => r.breaks.forEach((b) => assert.ok(!overlaps(b, dbl), `${r.label} ${b.start}`)));
});

for (const mode of ['sarksin', 'sarkmasin']) {
  test(`kurallar (${mode}): tüm günler`, () => {
    for (let d = 0; d < 7; d++) {
      const plan = gen(d, mode);
      for (const r of plan.rows) {
        const sh = S.shifts[r.shift];
        const lo = toMin(sh.start) + 60, hi = toMin(sh.end) - 60;
        assert.ok(r.lunch, `gün ${d} ${r.label} yemek yok`);
        assert.equal(r.breaks.length, 3, `gün ${d} ${r.label} mola sayısı`);
        for (const e of [r.lunch, ...r.breaks]) assert.ok(e.start >= lo && e.end <= hi, `gün ${d} ${r.label} pencere`);
        r.breaks.forEach((b) => assert.ok(!overlaps(b, r.lunch), `gün ${d} ${r.label} yemekle çakışma`));
      }
      for (const pool of [1, 2]) {
        const rows = plan.rows.filter((r) => r.pool === pool);
        for (let t = toMin('08:00'); t < toMin('20:00'); t += 15) {
          const q = { start: t, end: t + 15 };
          const nb = rows.filter((r) => r.breaks.some((b) => overlaps(b, q))).length;
          assert.ok(nb <= 1, `gün ${d} havuz ${pool} ${t} aynı anda ${nb} mola`);
        }
      }
      const errs = validateDay(plan, S).filter((i) => i.level === 'error');
      assert.deepEqual(errs, [], `gün ${d}`);
    }
  });
}

test('kilit: elle konan mola yerinde kalır', () => {
  const plan = gen(0, 'sarksin', { p4: { b0: toMin('10:15') } });
  const r = plan.rows.find((x) => x.id === 'p4');
  const b = r.breaks.find((x) => x.key === 'b0');
  assert.equal(b.start, toMin('10:15'));
  assert.equal(b.locked, true);
});

test('off_haric: OFF ve plana dahil olmayanlar yok', () => {
  const plan = gen(0);
  const ids = plan.rows.map((r) => r.id);
  assert.ok(!ids.includes('p2'));  // plana dahil değil
  assert.ok(!ids.includes('p12')); // plana dahil değil
  assert.ok(!ids.includes('p15')); // Pzt OFF
});

test('az_kisi: Mail 2 kişi → yemekler vardiyaya göre yayılır (11:00 sabahçı, 15:30 akşamcı)', () => {
  const plan = gen(0);
  const mail = plan.rows.filter((r) => r.pool === 2).sort((a, b) => a.shiftStart - b.shiftStart);
  assert.equal(mail[0].shift, 'S');
  assert.equal(mail[0].lunch.start, toMin('11:00'));
  assert.equal(mail[1].shift, 'A');
  assert.equal(mail[1].lunch.start, toMin('15:30'));
});

test('az_kisi: hafta sonu 1. havuz yemekleri 16:00 öncesi ve sıra vardiyaya göre', () => {
  const plan = gen(6); // Pazar
  const rs = pool1(plan).sort((a, b) => a.shiftStart - b.shiftStart || a.lunch.start - b.lunch.start);
  rs.forEach((r) => assert.ok(r.lunch.end <= toMin('16:00')));
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i].lunch.start >= rs[i - 1].lunch.start, 'sıra korunur');
  assert.ok(rs.at(-1).lunch.start - rs[0].lunch.start >= 180, 'yayılmış');
});
