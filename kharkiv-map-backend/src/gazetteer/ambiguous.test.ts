import { getDb } from '../db/client.js';
import { resolve, seedGazetteer } from './index.js';

process.env.DB_PATH = ':memory:';

console.log('=== Gazetteer Ambiguous Resolver Test ===\n');

getDb();
seedGazetteer();

interface ResolverCase {
  input: string;
  expect: string;
  note: string;
}

const ambiguousCases: ResolverCase[] = [
  {
    input: 'черкаскую лозовую',
    expect: 'Черкаська Лозова',
    note: 'adjective + basename should not drift to Lozova city',
  },
  {
    input: 'русскую лозовую',
    expect: 'Руська Лозова',
    note: 'adjective + basename resolves to hotspot village',
  },
  {
    input: 'черкасская лозовая',
    expect: 'Черкаська Лозова',
    note: 'ru adjective form resolves correctly',
  },
  {
    input: 'русская лозовая',
    expect: 'Руська Лозова',
    note: 'lookalike toponym pair is separated',
  },
  {
    input: 'лозовая',
    expect: 'Лозова',
    note: 'plain basename still maps to city when no qualifier provided',
  },
  {
    input: 'на черкаскую лозовую',
    expect: 'Черкаська Лозова',
    note: 'noisy preposition form keeps intended hotspot',
  },
  {
    input: 'курс на русскую лозовую',
    expect: 'Руська Лозова',
    note: 'noisy phrase with prefix still maps to local hotspot',
  },
  {
    input: 'северная салтовка',
    expect: 'Північна Салтівка',
    note: 'legacy ru form keeps modern canonical without drifting to generic Салтівка',
  },
  {
    input: 'пятихатки',
    expect: "П'ятихатки",
    note: 'legacy apostrophe-less spelling resolves to canonical village',
  },
  {
    input: 'окружной',
    expect: 'Окружна дорога',
    note: 'road colloquial form resolves to ring road canonical',
  },
];

let passed = 0;
let failed = 0;

for (const tc of ambiguousCases) {
  const result = resolve(tc.input);
  const actual = result?.canonicalName || null;
  const ok = actual === tc.expect;

  if (ok) {
    passed++;
    console.log(
      `  ✓ "${tc.input}" → "${actual}" (${result?.matchType}, conf=${result?.confidence.toFixed(2)})`
    );
  } else {
    failed++;
    console.log(
      `  ✗ "${tc.input}" → got "${actual}" expected "${tc.expect}" (${tc.note})`
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${ambiguousCases.length} tests`);
process.exit(failed > 0 ? 1 : 0);
