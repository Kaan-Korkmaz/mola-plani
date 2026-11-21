import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaste, parseCell, parseDate } from '../js/excel-yapistir.js';
import { DEFAULT_SETTINGS as S } from '../js/defaults.js';

const T = (rows) => rows.map((r) => r.join('\t')).join('\r\n');
const today = new Date(2026, 10, 21);
// Gerçek isim yok (repo herkese açık); biçim gelen vardiya sheet'iyle aynı
const people = [
  { id: 'p1', label: 'Ali Veli', group: 'B2B' },
  { id: 'p2', label: 'Şule Çağlı', group: 'B2C' },
  { id: 'p3', label: 'Mail Kişi', group: 'Mail' },
  { id: 'p4', label: 'Giden Kişi', group: 'B2C' },
  { id: 'p5', label: 'Excelde Yok', group: 'B2C' },
];
const SHEET = T([
  ['', '', '23-Nov', '24-Nov', '25-Nov', '26-Nov', '27-Nov', '28-Nov', '29-Nov', '23-29 NOV'],
  ['Ad - Soyad', '', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz', 'OFF'],
  ['Ali Veli', 'B2B', '09:00 - 18:30', '09:00 - 18:30', 'OFF', '09:00 - 18:30', '09:00 - 18:30', '09:00 - 18:30', 'OFF', '2'],
  ['ŞULE ÇAĞLI ', 'B2C', '08:00 - 17:30', '10:30 - 20:00', '08:00 - 17:30', 'OFF', '10:30 - 20:00', 'OFF', '08:00 - 17:30', '2'],
  ['Mail Kişi', 'Digital', '10:30 - 20:00', '09:00 - 18:30', '09:00 - 18:30', 'OFF', 'OFF', '08:00 - 17:30', '09:00 - 18:30', '2'],
  ['Giden Kişi', 'B2C', 'ISTIFA', 'ISTIFA', 'ISTIFA', 'ISTIFA', 'ISTIFA', 'ISTIFA', 'ISTIFA', '0'],
  ['Yeni Kişi', 'Satış', '09:00 - 18:30', '09:00 - 18:30', '09:00 - 18:30', '09:00 - 18:30', '09:00 - 18:30', 'OFF', 'OFF', '2'],
]);

test('gelen sheet biçimi: tarih, gün, kişi, birim, vardiya', () => {
  const r = parsePaste(SHEET, { settings: S, people, fallbackMonday: '2026-11-16', today });
  assert.equal(r.detected, true);
  assert.deepEqual(r.dates, ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.rows[0].cells.map((c) => c.code), ['O', 'O', 'OFF', 'O', 'O', 'O', 'OFF']);
  assert.equal(r.rows[1].personId, 'p2');               // büyük harf + sondaki boşluk eşleşir
  assert.deepEqual(r.rows[1].cells.map((c) => c.code), ['S', 'A', 'S', 'OFF', 'A', 'OFF', 'S']);
  assert.equal(r.rows[2].group, 'Mail');                // Digital → Mail
  assert.equal(r.rows[3].resigned, true);
  assert.equal(r.rows[4].personId, null);               // yeni kişi
  assert.equal(r.rows[4].group, 'Satış');
  assert.deepEqual(r.missing, ['Excelde Yok']);
  assert.deepEqual(r.warns, []);
});

test('sadece isim + vardiya kopyalanırsa (başlıksız) seçili haftaya yazılır', () => {
  const r = parsePaste(T([['Ali Veli', 'B2B', '09:00 - 18:30', 'OFF', '08:00-17:30', '10.30-20.00', '9-18:30', 'İzinli', 'Resmi tatil', '2']]),
    { settings: S, people, fallbackMonday: '2026-11-23', today });
  assert.equal(r.detected, false);
  assert.equal(r.dates[0], '2026-11-23');
  assert.deepEqual(r.rows[0].cells.map((c) => c.code), ['O', 'OFF', 'S', 'A', 'O', 'IZ', 'RT']);
});

test('ilk gün elle değiştirilince tarihler kayar (haftaya taşan aralık)', () => {
  const r = parsePaste(SHEET, { settings: S, people, fallbackMonday: '2026-11-16', startDate: '2026-11-26', today });
  assert.equal(r.dates[0], '2026-11-26');
  assert.equal(r.dates[6], '2026-12-02');
});

test('hücre ve tarih çözümü', () => {
  assert.equal(parseCell('Eğitim', S).code, 'EGT');
  assert.equal(parseCell('23-11', S), null);            // tarih saat sanılmaz
  assert.match(parseCell('12:00 - 21:00', S).warn, /tanımlı değil/);
  assert.equal(parseDate('23.Kas', today), '2026-11-23');
  assert.equal(parseDate('05-Jan', today), '2027-01-05'); // yılsız: bugüne en yakın yıl
  assert.equal(parseDate('23.11.2026', today), '2026-11-23');
});
