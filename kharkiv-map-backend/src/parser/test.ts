import { getDb } from '../db/client.js';
import { seedGazetteer } from '../gazetteer/index.js';
import { parseWithRegex } from './regex.js';

// Use in-memory database for testing
process.env.DB_PATH = ':memory:';

console.log('=== Parser Regex Test ===\n');

getDb();
seedGazetteer();

interface TestCase {
  input: string;
  eventType: string;
  weaponType: string;
  weaponCount?: number;
  locationContains?: string | null;
  headingContains?: string | null;
  viaContains?: string | null;
  isPreliminary?: boolean;
  isCorrection?: boolean;
}

const testCases: TestCase[] = [
  {
    input: 'Шахед курсом на Печенеги⚠️',
    eventType: 'tracking', weaponType: 'shahed',
    headingContains: 'Печеніги',
  },
  {
    input: '🔴ТРЕВОГА 2 Ударных БпЛА в районе Безруки - Дергачи, курс Русская Лозовая⚠️',
    eventType: 'tracking', weaponType: 'bpla', weaponCount: 2,
    locationContains: 'Безруки',
  },
  {
    input: 'Ударные БпЛА двигаются в направлении Пятихаток, могут быть еще в воздухе⚠️',
    eventType: 'tracking', weaponType: 'bpla',
    headingContains: "П'ятихатки",
  },
  {
    input: '2 Залетают на Лесопарк, Алексеевку, Шевченковский район внимательно⚠️',
    eventType: 'tracking', weaponType: 'bpla', weaponCount: 2,
    locationContains: 'Лісопарк',
  },
  {
    input: 'Взрыв в районе Сокольники💥',
    eventType: 'impact', weaponType: 'unknown',
    locationContains: 'Сокільники',
  },
  {
    input: 'Предварительно 2 БпЛА упали, еще 2 Ударных БпЛА на Лесопарк⚠️',
    eventType: 'impact', weaponType: 'bpla',
    isPreliminary: true,
  },
  {
    input: 'Залетают в Харьков, курс сейчас на Алексеевку, Лесопарк, Сокольники⚠️',
    eventType: 'tracking', weaponType: 'bpla',
    headingContains: 'Олексіївка',
  },
  {
    input: 'Берут направление на центр⚠️',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Центр',
  },
  {
    input: 'БпЛА Между центром и Киевская⚠️',
    eventType: 'tracking', weaponType: 'bpla',
    locationContains: 'Центр',
  },
  {
    input: 'Через Киевскую на Французкий Бульвар⚠️',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Французький бульвар',
    viaContains: 'Київська',
  },
  {
    input: 'Берет направление на М. Киевская⚠️',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Київська',
  },
  {
    input: 'БпЛА Молния на Дергачи⚠️',
    eventType: 'tracking', weaponType: 'bpla',
    headingContains: 'Дергачі',
  },
  {
    input: 'Уточнение, 2 Ударных БпЛА, уже в районе Черкасской Лозовой⚠️',
    eventType: 'correction', weaponType: 'bpla', weaponCount: 2,
    isCorrection: true,
    locationContains: 'Черкаська Лозова',
  },
  {
    input: 'Взрывы в районе окружной💥',
    eventType: 'impact', weaponType: 'unknown',
    locationContains: 'Окружна дорога',
  },
];

let passed = 0;
let failed = 0;
const now = Math.floor(Date.now() / 1000);

for (const tc of testCases) {
  const result = parseWithRegex(tc.input, 0, 'test', now);

  const checks: string[] = [];
  let ok = true;

  if (!result) {
    console.log(`  ✗ "${tc.input.slice(0, 50)}..." → null (no parse)`);
    failed++;
    continue;
  }

  if (result.eventType !== tc.eventType) {
    checks.push(`eventType: got ${result.eventType} want ${tc.eventType}`);
    ok = false;
  }
  if (result.weaponType !== tc.weaponType) {
    checks.push(`weaponType: got ${result.weaponType} want ${tc.weaponType}`);
    ok = false;
  }
  if (tc.weaponCount && result.weaponCount !== tc.weaponCount) {
    checks.push(`count: got ${result.weaponCount} want ${tc.weaponCount}`);
    ok = false;
  }
  if (tc.locationContains !== undefined) {
    const loc = result.location?.canonicalName || '';
    if (tc.locationContains && !loc.includes(tc.locationContains)) {
      checks.push(`location: got "${loc}" want contains "${tc.locationContains}"`);
      ok = false;
    }
  }
  if (tc.headingContains !== undefined) {
    const head = result.heading?.canonicalName || '';
    if (tc.headingContains && !head.includes(tc.headingContains)) {
      checks.push(`heading: got "${head}" want contains "${tc.headingContains}"`);
      ok = false;
    }
  }
  if (tc.viaContains !== undefined) {
    const v = result.via?.canonicalName || '';
    if (tc.viaContains && !v.includes(tc.viaContains)) {
      checks.push(`via: got "${v}" want contains "${tc.viaContains}"`);
      ok = false;
    }
  }
  if (tc.isPreliminary && !result.isPreliminary) {
    checks.push('isPreliminary: expected true');
    ok = false;
  }
  if (tc.isCorrection && !result.isCorrection) {
    checks.push('isCorrection: expected true');
    ok = false;
  }

  if (ok) {
    passed++;
    const loc = result.location?.canonicalName || '-';
    const head = result.heading?.canonicalName || '-';
    console.log(`  ✓ "${tc.input.slice(0, 50)}..." → ${result.eventType}/${result.weaponType} x${result.weaponCount} loc="${loc}" head="${head}" conf=${result.confidence.toFixed(2)}`);
  } else {
    failed++;
    console.log(`  ✗ "${tc.input.slice(0, 50)}..." → ${checks.join('; ')}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${testCases.length} tests`);
process.exit(failed > 0 ? 1 : 0);
