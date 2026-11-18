import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShiftSheet, mapGroup } from '../js/importer.js';
import { DEFAULT_SETTINGS as S } from '../js/defaults.js';

// Liderin tablosunun düzeni: 1. satır tarihler (Excel seri no), 2. satır başlık, sonra kişiler.
const aoa = [
  [null, null, 46342, 46343, 46344, 46345, 46346, 46347, 46348, '16-22 NOV'],
  ['Ad - Soyad', null, 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz', 'OFF'],
  ['Kişi A', 'B2B', '09:00 - 18:30', '09:00 - 18:30', 'OFF', '09:00 - 18:30', '09:00 - 18:30', '09:00 - 18:30', 'OFF', 2],
  ['Kişi B', 'Digital', 'OFF', '08:00 - 17:30', '10:30 - 20:00', '08:00-17:30', '10:30 - 20:00', 'OFF', 'OFF', 4],
  ['Kişi C', 'Satış', '09:00 - 18:30', 'off', '09:00 - 18:30', '09:00 - 18:30', '09:00 - 18:30', 'OFF', 'OFF', 3],
  [],
];

test('liderin tablosunu okur', () => {
  const r = parseShiftSheet(aoa, S);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows[0], { name: 'Kişi A', group: 'B2B', shifts: ['O', 'O', 'OFF', 'O', 'O', 'O', 'OFF'] });
  assert.equal(r.rows[1].group, 'Mail');
  assert.deepEqual(r.rows[1].shifts, ['OFF', 'S', 'A', 'S', 'A', 'OFF', 'OFF']);
  assert.equal(r.rows[2].group, 'Satış');
  assert.equal(r.rows[2].shifts[1], 'OFF');
  assert.equal(r.firstDate.getDate(), 16);
  assert.equal(r.firstDate.getMonth(), 10);
  assert.deepEqual(r.warnings, []);
});

test('başlık yoksa anlaşılır hata', () => {
  assert.throws(() => parseShiftSheet([['x', 'y']], S), /Ad - Soyad/);
});

test('kanal eşleme', () => {
  assert.equal(mapGroup('Digital', S.groups), 'Mail');
  assert.equal(mapGroup(' b2c ', S.groups), 'B2C');
});
