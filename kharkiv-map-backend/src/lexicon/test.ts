import { GENERATED_LOCATION_ALIASES } from '../generated/location-aliases.js';
import { GENERATED_WEAPON_ALIASES } from '../generated/weapon-aliases.js';
import { GENERATED_PHRASE_INTENTS } from '../generated/phrase-intents.js';
import { GENERATED_AMBIGUOUS_TERMS, GENERATED_PRIORITY_HOTSPOTS } from '../generated/ambiguity.js';

console.log('=== Lexicon Consistency Test ===\n');

let failed = 0;
let passed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

assert(Object.keys(GENERATED_WEAPON_ALIASES).length >= 10, 'weapon canonicals generated');
assert(Object.keys(GENERATED_LOCATION_ALIASES).length > 0, 'location aliases generated');
assert(GENERATED_PHRASE_INTENTS.length > 0, 'phrase intents generated');
assert(GENERATED_AMBIGUOUS_TERMS.length > 0, 'ambiguous terms generated');
assert(GENERATED_PRIORITY_HOTSPOTS.length > 0, 'priority hotspots generated');

const normalize = (s: string): string => s.toLowerCase().replace(/[ʼ'`]/g, '').trim();
const normalizeHotspotSegment = (s: string): string =>
  normalize(s)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zа-яіїєґ0-9\s-]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

for (const [weapon, aliases] of Object.entries(GENERATED_WEAPON_ALIASES)) {
  const unique = new Set(aliases.map((x) => x.toLowerCase().trim()));
  assert(unique.size === aliases.length, `${weapon}: no duplicate aliases`);
}

const aliasOwner = new Map<string, string>();
for (const [weapon, aliases] of Object.entries(GENERATED_WEAPON_ALIASES)) {
  for (const alias of aliases) {
    const key = alias.toLowerCase().trim();
    const prev = aliasOwner.get(key);
    assert(!prev || prev === weapon, `weapon alias "${alias}" not conflicting`);
    if (!prev) aliasOwner.set(key, weapon);
  }
}

const locationCorpus = new Set<string>();
for (const [canonical, aliases] of Object.entries(GENERATED_LOCATION_ALIASES)) {
  locationCorpus.add(normalize(canonical));
  for (const alias of aliases) {
    locationCorpus.add(normalize(alias));
  }
}

for (const hotspot of GENERATED_PRIORITY_HOTSPOTS) {
  const segments = hotspot
    .split('/')
    .map((part) => normalizeHotspotSegment(part))
    .filter(Boolean);
  const hasAny = segments.some((segment) => {
    if (locationCorpus.has(segment)) return true;
    return segment
      .split(' ')
      .filter((token) => token.length >= 4)
      .some((token) => locationCorpus.has(token));
  });
  assert(hasAny, `hotspot "${hotspot}" covered by generated location aliases`);
}

const allowedPriorities = new Set(['HIGH', 'MEDIUM', 'LOW']);
for (const term of GENERATED_AMBIGUOUS_TERMS) {
  assert(term.term.trim().length > 0, `ambiguous term "${term.term}" has non-empty label`);
  assert(term.possibleMappings.length > 0, `ambiguous term "${term.term}" has at least one mapping`);
  assert(allowedPriorities.has(term.priority), `ambiguous term "${term.term}" has valid priority`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
