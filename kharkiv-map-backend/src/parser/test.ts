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
  group?: 'north-hotspots' | 'east-hotspots' | 'city-districts' | 'general';
  eventType: string;
  weaponType: string;
  weaponCount?: number;
  locationContains?: string | null;
  headingContains?: string | null;
  viaContains?: string | null;
  isPreliminary?: boolean;
  isCorrection?: boolean;
  isFollowup?: boolean;
  countDelta?: number;
  phraseIntentsIncludes?: string[];
}

const testCases: TestCase[] = [
  {
    input: 'Шахед курсом на Печенеги⚠️',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'shahed',
    headingContains: 'Печеніги',
  },
  {
    input: '🔴ТРЕВОГА 2 Ударных БпЛА в районе Безруки - Дергачи, курс Русская Лозовая⚠️',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'bpla', weaponCount: 2,
    locationContains: 'Безруки',
  },
  {
    input: 'Ударные БпЛА двигаются в направлении Пятихаток, могут быть еще в воздухе⚠️',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'bpla',
    headingContains: "П'ятихатки",
  },
  {
    input: '2 Залетают на Лесопарк, Алексеевку, Шевченковский район внимательно⚠️',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'bpla', weaponCount: 2,
    locationContains: 'Лісопарк',
  },
  {
    input: 'Взрыв в районе Сокольники💥',
    group: 'city-districts',
    eventType: 'impact', weaponType: 'unknown',
    locationContains: 'Сокільники',
  },
  {
    input: 'Предварительно 2 БпЛА упали, еще 2 Ударных БпЛА на Лесопарк⚠️',
    group: 'city-districts',
    eventType: 'impact', weaponType: 'bpla',
    isPreliminary: true,
  },
  {
    input: 'Залетают в Харьков, курс сейчас на Алексеевку, Лесопарк, Сокольники⚠️',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'bpla',
    headingContains: 'Олексіївка',
  },
  {
    input: 'Берут направление на центр⚠️',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Центр',
  },
  {
    input: 'БпЛА Между центром и Киевская⚠️',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'bpla',
    locationContains: 'Центр',
  },
  {
    input: 'Через Киевскую на Французкий Бульвар⚠️',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Французький бульвар',
    viaContains: 'Київська',
  },
  {
    input: 'Берет направление на М. Киевская⚠️',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Київська',
  },
  {
    input: 'БпЛА Молния на Дергачи⚠️',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'molniya',
    headingContains: 'Дергачі',
  },
  {
    input: 'FPV на Вовчанськ',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'fpv',
    headingContains: 'Вовчанськ',
  },
  {
    input: 'Угроза БПЛА Ланцет на Циркуны',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'lancet',
    headingContains: 'Циркуни',
  },
  {
    input: 'Тревога по баллистике с Таганрога',
    group: 'general',
    eventType: 'tracking', weaponType: 'ballistic',
  },
  {
    input: 'Запуски РСЗО по северной части области',
    group: 'general',
    eventType: 'tracking', weaponType: 'rszo',
  },
  {
    input: 'Уточнение, 2 Ударных БпЛА, уже в районе Черкасской Лозовой⚠️',
    group: 'north-hotspots',
    eventType: 'correction', weaponType: 'bpla', weaponCount: 2,
    isCorrection: true,
    locationContains: 'Черкаська Лозова',
  },
  {
    input: 'Летит на черкаскую лозовую⚠️',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Черкаська Лозова',
  },
  {
    input: 'курс на русскую лозовую⚠️',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Руська Лозова',
  },
  {
    input: 'БпЛА в районе русской лозовой⚠️',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'bpla',
    locationContains: 'Руська Лозова',
  },
  {
    input: 'Взрывы в районе окружной💥',
    group: 'city-districts',
    eventType: 'impact', weaponType: 'unknown',
    locationContains: 'Окружна дорога',
  },
  {
    input: 'подлетает к харькову',
    group: 'general',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Харків',
  },
  {
    input: 'безлюдовка',
    group: 'east-hotspots',
    eventType: 'tracking', weaponType: 'unknown',
    locationContains: 'Безлюдівка',
  },
  {
    input: 'заходит на малую даниловку',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Мала Данилівка',
  },
  {
    input: 'шахед через рогань на индустриальный район⚠️',
    group: 'east-hotspots',
    eventType: 'tracking', weaponType: 'shahed',
    headingContains: 'Індустріальний район',
    viaContains: 'Рогань',
  },
  {
    input: 'каб на козачку',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'kab',
    headingContains: 'Козача Лопань',
  },
  {
    input: 'Шахед повернул на Алексеевку',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'shahed',
    headingContains: 'Олексіївка',
    phraseIntentsIncludes: ['heading_change'],
  },
  {
    input: 'довернул на лесопарк',
    group: 'city-districts',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Лісопарк',
    phraseIntentsIncludes: ['heading_change'],
  },
  {
    input: 'развернулся и идет на печенеги',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Печеніги',
  },
  {
    input: 'Летит дальше на Слатино',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Слатине',
  },
  {
    input: 'Свернул на старый салтов',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'unknown',
    headingContains: 'Старий Салтів',
  },
  {
    input: 'БПЛА неизвестного типа на Шевченково',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'bpla',
    headingContains: 'Шевченкове',
  },
  {
    input: 'Шаболда на Гуты',
    group: 'north-hotspots',
    eventType: 'tracking', weaponType: 'shahed',
    headingContains: 'Гути',
  },
];

const hotspotSmokeCases: Array<{ input: string; expect: string }> = [
  { input: 'на черкаскую лозовую', expect: 'Черкаська Лозова' },
  { input: 'курс на русскую лозовую', expect: 'Руська Лозова' },
  { input: 'на алексеевку', expect: 'Олексіївка' },
  { input: 'в сторону лесопарка', expect: 'Лісопарк' },
  { input: 'на печенеги', expect: 'Печеніги' },
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
  if (tc.isFollowup && !result.isFollowup) {
    checks.push('isFollowup: expected true');
    ok = false;
  }
  if (tc.countDelta !== undefined && (result.countDelta ?? 0) !== tc.countDelta) {
    checks.push(`countDelta: got ${result.countDelta ?? 0} want ${tc.countDelta}`);
    ok = false;
  }
  if (tc.phraseIntentsIncludes?.length) {
    const intents = new Set(result.phraseIntents ?? []);
    for (const expectedIntent of tc.phraseIntentsIncludes) {
      if (!intents.has(expectedIntent)) {
        checks.push(`intent: missing "${expectedIntent}"`);
        ok = false;
      }
    }
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

console.log('\n=== Hotspot Smoke List ===');
for (const smoke of hotspotSmokeCases) {
  const result = parseWithRegex(smoke.input, 0, 'test-smoke', now);
  const candidate =
    result?.location?.canonicalName ||
    result?.heading?.canonicalName ||
    result?.via?.canonicalName ||
    '';
  if (!candidate.includes(smoke.expect)) {
    failed++;
    console.log(`  ✗ "${smoke.input}" → got "${candidate || '-'}" expected contains "${smoke.expect}"`);
    continue;
  }
  passed++;
  console.log(`  ✓ "${smoke.input}" → "${candidate}"`);
}

const grouped = testCases.reduce<Record<string, { total: number; failed: number }>>((acc, tc) => {
  const key = tc.group || 'general';
  acc[key] = acc[key] || { total: 0, failed: 0 };
  acc[key].total++;
  return acc;
}, {});

for (const tc of testCases) {
  const key = tc.group || 'general';
  const result = parseWithRegex(tc.input, 0, 'test-grouping', now);
  const loc = result?.location?.canonicalName || '';
  const head = result?.heading?.canonicalName || '';
  const via = result?.via?.canonicalName || '';
  const failedGroupCheck =
    (tc.locationContains && !loc.includes(tc.locationContains)) ||
    (tc.headingContains && !head.includes(tc.headingContains)) ||
    (tc.viaContains && !via.includes(tc.viaContains)) ||
    result?.eventType !== tc.eventType ||
    result?.weaponType !== tc.weaponType;
  if (!result || failedGroupCheck) grouped[key].failed++;
}

console.log('\n=== Grouped Hotspot Summary ===');
for (const [group, stats] of Object.entries(grouped)) {
  console.log(`  ${group}: ${stats.total - stats.failed}/${stats.total} passed`);
}
process.exit(failed > 0 ? 1 : 0);
