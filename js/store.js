// Kayıt: her şey liderin cihazında (localStorage). Sunucu yok.
import { DEFAULT_SETTINGS, SAMPLE_PEOPLE, SAMPLE_SHIFTS, SAMPLE_WEEK_KEY } from './defaults.js';

const KEY = 'mola-plani:v1';
const clone = (x) => JSON.parse(JSON.stringify(x));

export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const wd = (d.getDay() + 6) % 7; // Pzt=0
  d.setDate(d.getDate() - wd);
  return ymd(d);
}

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return ymd(dt);
}

function emptyWeek(people) {
  return {
    shifts: Object.fromEntries(people.map((p) => [p.id, Array(7).fill('OFF')])),
    days: Array.from({ length: 7 }, () => ({ overflowMode: null, locks: {} })),
  };
}

function freshState() {
  return {
    v: 1,
    settings: clone(DEFAULT_SETTINGS),
    people: clone(SAMPLE_PEOPLE),
    weeks: {
      [SAMPLE_WEEK_KEY]: {
        shifts: clone(SAMPLE_SHIFTS),
        days: Array.from({ length: 7 }, () => ({ overflowMode: null, locks: {} })),
      },
    },
    current: { week: SAMPLE_WEEK_KEY, day: 0, view: 'grid' },
  };
}

/** Eski kayıtları yeni sürümün beklediği alanlarla tamamlar (veri kaybetmeden). */
function migrate(s) {
  const d = clone(DEFAULT_SETTINGS);
  s.settings = { ...d, ...s.settings, shifts: { ...d.shifts, ...(s.settings?.shifts || {}) },
    capacity: { ...d.capacity, ...(s.settings?.capacity || {}) },
    lunchWindow: { ...d.lunchWindow, ...(s.settings?.lunchWindow || {}) },
    groupPool: { ...d.groupPool, ...(s.settings?.groupPool || {}) },
    poolNames: { ...d.poolNames, ...(s.settings?.poolNames || {}) } };
  s.settings.groups = s.settings.groups.filter((g) => g !== 'Eğitim');
  delete s.settings.noBreakGroups;
  s.people ||= [];
  s.weeks ||= {};
  s.current ||= { week: mondayOf(new Date()), day: 0, view: 'grid' };
  ensureWeek(s, s.current.week);
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('Kayıt okunamadı', e); }
  return freshState();
}

export function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function reset() {
  localStorage.removeItem(KEY);
  return freshState();
}

/** Hafta yoksa: bir önceki haftanın vardiyalarını kopyalar, o da yoksa boş açar. */
export function ensureWeek(state, key) {
  if (!state.weeks[key]) {
    const prev = state.weeks[addDays(key, -7)];
    state.weeks[key] = prev
      ? { shifts: clone(prev.shifts), days: Array.from({ length: 7 }, () => ({ overflowMode: null, locks: {} })) }
      : emptyWeek(state.people);
  }
  const w = state.weeks[key];
  for (const p of state.people) w.shifts[p.id] ||= Array(7).fill('OFF');
  return w;
}

export function copyWeek(state, fromKey, toKey) {
  const src = state.weeks[fromKey];
  if (!src) return false;
  state.weeks[toKey] = { shifts: clone(src.shifts), days: Array.from({ length: 7 }, () => ({ overflowMode: null, locks: {} })) };
  return true;
}

export function exportBackup(state) {
  return JSON.stringify({ app: 'mola-plani', ...state }, null, 1);
}

export function importBackup(text) {
  const s = JSON.parse(text);
  if (s.app !== 'mola-plani' || !Array.isArray(s.people) || typeof s.weeks !== 'object')
    throw new Error('Bu dosya bir Mola Planı yedeği değil.');
  delete s.app;
  return migrate(s);
}

export function newId(state) {
  let i = state.people.length + 1;
  while (state.people.some((p) => p.id === `p${i}`)) i++;
  return `p${i}`;
}
