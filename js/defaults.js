// Varsayılan ayarlar ve örnek veri. Gerçek isim YOK — repo herkese açık.

export const DEFAULT_SETTINGS = {
  shifts: {
    S: { name: 'Sabahçı', start: '08:00', end: '17:30' },
    O: { name: 'Öğlenci', start: '09:00', end: '18:30' },
    A: { name: 'Akşamcı', start: '10:30', end: '20:00' },
  },
  edgeMin: 60,            // vardiyanın ilk ve son X dakikasında mola yok
  breakCount: 3,          // kişi başı kısa mola sayısı
  breaksBeforeLunch: 1,   // sıra: yemekten önce 1 mola, sonra kalanlar → Mola · Yemek · Mola · Mola
  breakMin: 15,           // kısa mola süresi
  lunchMin: 30,           // yemek süresi
  lunchWindow: { start: '11:00', end: '16:00' }, // yemekler 11:00'de başlar, mümkünse 16:00'da biter (sığmazsa sarkar)
  latestEnd: '18:30',     // yemek dahil TÜM molalar en geç bu saatte bitmiş olur
  capacity: { break: 1, lunch: 1 }, // havuz başına aynı anda
  maxGap: 165,           // en uzun molasız çalışma (vardiya başı/sonu dahil) — kesin kural
  minGap: 60,             // kişinin kendi molaları (yemek dahil) arası EN AZ boşluk — kesin kural
  groups: ['B2B', 'B2C', 'Mail', 'Satış'],
  groupPool: { B2B: 1, B2C: 1, 'Satış': 1, Mail: 2 },
  poolNames: { 1: 'B2B + B2C', 2: 'Mail' },
  // Excel'den yapıştırırken birim adı farklı yazılmışsa hangi birime sayılacağı
  groupAliases: { Digital: 'Mail', Dijital: 'Mail', 'E-posta': 'Mail', Sales: 'Satış' },
};

// Çalışılmayan gün türleri (vardiya planında seçilir)
export const NONWORK = { OFF: 'OFF', RT: 'Resmi tatil', IZ: 'İzinli' };
// Eğitim: kişi o gün çalışıyor (vardiya planında görünür) ama mola planına girmez
export const TRAINING = 'EGT';

export const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

// 16–22 Kasım 2026 vardiya deseni (isimsiz). S=Sabahçı O=Öğlenci A=Akşamcı OFF=izinli
const W = (s) => s.split(' ').map((x) => (x === 'X' ? 'OFF' : x));

export const SAMPLE_PEOPLE = [
  { id: 'p1', label: 'B2B 1', group: 'B2B', included: true },
  { id: 'p2', label: 'B2B 2', group: 'B2B', included: false },
  { id: 'p3', label: 'B2C 1', group: 'B2C', included: true },
  { id: 'p4', label: 'B2C 2', group: 'B2C', included: true },
  { id: 'p5', label: 'B2C 3', group: 'B2C', included: true },
  { id: 'p6', label: 'B2C 4', group: 'B2C', included: true },
  { id: 'p7', label: 'B2C 5', group: 'B2C', included: true },
  { id: 'p8', label: 'B2C 6', group: 'B2C', included: true },
  { id: 'p9', label: 'B2C 7', group: 'B2C', included: true },
  { id: 'p10', label: 'B2C 8', group: 'B2C', included: true },
  { id: 'p11', label: 'B2C 9', group: 'B2C', included: true },
  { id: 'p12', label: 'B2C 10', group: 'B2C', included: false },
  { id: 'p13', label: 'B2C 11', group: 'B2C', included: true },
  { id: 'p14', label: 'Satış 1', group: 'Satış', included: true },
  { id: 'p15', label: 'Mail 1', group: 'Mail', included: true },
  { id: 'p16', label: 'Mail 2', group: 'Mail', included: true },
  { id: 'p17', label: 'Mail 3', group: 'Mail', included: true },
];

export const SAMPLE_WEEK_KEY = '2026-11-16';

export const SAMPLE_SHIFTS = {
  p1: W('O O X O O O X'),
  p2: W('O O O O O X X'),
  p3: W('O O O O X O A'),
  p4: W('S S S S S X S'),
  p5: W('A A A A A A X'),
  p6: W('O O O X S S X'),
  p7: W('A A A A A X X'),
  p8: W('S S S S X S S'),
  p9: W('O O O O O X O'),
  p10: W('O O O A O X X'),
  p11: W('A A A X A A A'),
  p12: W('O O O O O X X'),
  p13: W('O X O O O O O'),
  p14: W('O O O O O X X'),
  p15: W('X O O S S X S'),
  p16: W('S S S A X A A'),
  p17: W('A A A X A S X'),
};
