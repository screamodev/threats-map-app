import { getDb } from '../db/client.js';
import { seedGazetteer, resolve } from './index.js';

// Use in-memory database for testing
process.env.DB_PATH = ':memory:';

console.log('=== Gazetteer Test ===\n');

// Init
getDb();
seedGazetteer();

const testCases = [
  // Exact and alias matches
  { input: 'Алексеевка', expect: 'Олексіївка' },
  { input: 'Алексеевку', expect: 'Олексіївка' },
  { input: 'Лесопарк', expect: 'Лісопарк' },
  { input: 'Сокольники', expect: 'Сокільники' },
  { input: 'М. Киевская', expect: 'Ст. метро Київська' },
  { input: 'Киевская', expect: 'Ст. метро Київська' },
  { input: 'Безруки', expect: 'Безруки' },
  { input: 'Дергачи', expect: 'Дергачі' },
  { input: 'Черкасская Лозовая', expect: 'Черкаська Лозова' },
  { input: 'Русская Лозовая', expect: 'Руська Лозова' },
  { input: 'Пятихатки', expect: "П'ятихатки" },
  { input: 'Печенеги', expect: 'Печеніги' },
  { input: 'окружная', expect: 'Окружна дорога' },
  { input: 'Французкий Бульвар', expect: 'Французький бульвар' },
  { input: 'центр', expect: 'Центр' },
  { input: 'Шевченковский район', expect: 'Шевченківський район' },
  { input: 'Салтовка', expect: 'Салтівка' },
  // Fuzzy matches (typos)
  { input: 'Алексевка', expect: 'Олексіївка' },  // missing е
  // Unresolvable
  { input: 'НесуществующееМесто123', expect: null },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = resolve(tc.input);
  const actual = result?.canonicalName || null;
  const ok = actual === tc.expect;

  if (ok) {
    passed++;
    console.log(`  ✓ "${tc.input}" → "${actual}" (${result?.matchType}, conf=${result?.confidence.toFixed(2)})`);
  } else {
    failed++;
    console.log(`  ✗ "${tc.input}" → got "${actual}" expected "${tc.expect}" (match=${result?.matchType})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${testCases.length} tests`);
process.exit(failed > 0 ? 1 : 0);
