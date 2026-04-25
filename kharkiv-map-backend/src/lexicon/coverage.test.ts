import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/client.js';
import { getGazetteerRuntimeCorpus, resolve, seedGazetteer } from '../gazetteer/index.js';
import { normalize } from '../gazetteer/fuzzy.js';
import { lexiconSchema } from './schema.js';

interface AliasMismatch {
  alias: string;
  expectedCanonical: string;
  actualCanonical: string | null;
}

interface CoverageBudget {
  canonicalMismatches: number;
  unresolvedAliases: number;
  wrongResolutionAliases: number;
}

const MAX_CANONICALS_PREVIEW = 80;
const MAX_GROUPS_PREVIEW = 30;
const MAX_ITEMS_PER_GROUP = 5;
const BASELINE_BUDGET: CoverageBudget = {
  canonicalMismatches: 109,
  unresolvedAliases: 226,
  wrongResolutionAliases: 39,
};

const CANONICAL_EQUIVALENTS = new Map<string, Set<string>>([
  ['северна салтівка', new Set(['північна салтівка'])],
  ['північна салтівка', new Set(['северна салтівка'])],
  ['алексіївка', new Set(['олексіївка'])],
  ['олексіївка', new Set(['алексіївка'])],
  ['пятихатки', new Set(["п'ятихатки"])],
  ["п'ятихатки", new Set(['пятихатки'])],
  ['окружна (дорога)', new Set(['окружна дорога'])],
  ['окружна дорога', new Set(['окружна (дорога)'])],
  ['шаровка', new Set(['шарівка'])],
  ['шарівка', new Set(['шаровка'])],
  ['холодна гора (хг)', new Set(['холодна гора'])],
  ['холодна гора', new Set(['холодна гора (хг)'])],
]);

console.log('=== Lexicon Coverage Test ===\n');

getDb();
seedGazetteer();

const __dirname = dirname(fileURLToPath(import.meta.url));
const lexiconPath = join(__dirname, '../../../alert_lexicon.json');
const lexicon = lexiconSchema.parse(JSON.parse(readFileSync(lexiconPath, 'utf8')));
const runtimeCorpus = getGazetteerRuntimeCorpus();

const runtimeCanonicals = new Set(runtimeCorpus.map((entry) => entry.normalizedCanonical));
const missingCanonicals = lexicon.location_dictionary.filter(
  (entry) => !runtimeCanonicals.has(normalize(entry.canonical))
);
const missingCanonicalsAfterEquivalents = missingCanonicals.filter((entry) => {
  const expected = normalize(entry.canonical);
  const equivalents = CANONICAL_EQUIVALENTS.get(expected);
  if (!equivalents) return true;
  for (const alias of equivalents) {
    if (runtimeCanonicals.has(alias)) return false;
  }
  return true;
});

const ambiguityAllowlist = new Map<string, Set<string>>();
for (const term of lexicon.top_ambiguous_terms) {
  const allowedCanonicals = new Set(term.possible_mappings.map((mapping) => normalize(mapping)));
  ambiguityAllowlist.set(normalize(term.term), allowedCanonicals);
}

let aliasesChecked = 0;
const unresolvedAliases: AliasMismatch[] = [];
const mismatchedAliases: AliasMismatch[] = [];
const allowlistedAmbiguities: AliasMismatch[] = [];

for (const location of lexicon.location_dictionary) {
  const expectedNorm = normalize(location.canonical);
  for (const alias of location.aliases) {
    if (!alias.trim()) continue;

    aliasesChecked++;
    const resolved = resolve(alias);
    const actualCanonical = resolved?.canonicalName ?? null;
    const actualNorm = actualCanonical ? normalize(actualCanonical) : null;

    const equivalentCanonicals = CANONICAL_EQUIVALENTS.get(expectedNorm);
    const isEquivalentCanonical =
      !!actualNorm &&
      !!equivalentCanonicals &&
      equivalentCanonicals.has(actualNorm);

    if (actualNorm === expectedNorm || isEquivalentCanonical) continue;

    const allowlistedCanonicals = ambiguityAllowlist.get(normalize(alias));
    const isAllowlistedAmbiguity =
      allowlistedCanonicals &&
      actualNorm &&
      allowlistedCanonicals.has(expectedNorm) &&
      allowlistedCanonicals.has(actualNorm);

    const mismatch: AliasMismatch = {
      alias,
      expectedCanonical: location.canonical,
      actualCanonical,
    };

    if (isAllowlistedAmbiguity) {
      allowlistedAmbiguities.push(mismatch);
      continue;
    }

    if (!actualCanonical) {
      unresolvedAliases.push(mismatch);
      continue;
    }

    mismatchedAliases.push(mismatch);
  }
}

const regressionBudget: CoverageBudget = {
  canonicalMismatches: Number(process.env.LEXICON_MAX_CANONICAL_MISMATCHES ?? BASELINE_BUDGET.canonicalMismatches),
  unresolvedAliases: Number(process.env.LEXICON_MAX_UNRESOLVED_ALIASES ?? BASELINE_BUDGET.unresolvedAliases),
  wrongResolutionAliases: Number(process.env.LEXICON_MAX_WRONG_RESOLUTIONS ?? BASELINE_BUDGET.wrongResolutionAliases),
};
const failCount =
  (missingCanonicalsAfterEquivalents.length > regressionBudget.canonicalMismatches ? 1 : 0) +
  (unresolvedAliases.length > regressionBudget.unresolvedAliases ? 1 : 0) +
  (mismatchedAliases.length > regressionBudget.wrongResolutionAliases ? 1 : 0);

function printCanonicalList(title: string, values: string[], limit: number): void {
  if (values.length === 0) return;
  console.log(`\n--- ${title} (${values.length}) ---`);
  for (const value of values.slice(0, limit)) {
    console.log(`  - ${value}`);
  }
  const extra = values.length - limit;
  if (extra > 0) {
    console.log(`  ... +${extra} more`);
  }
}

function printMismatchGroups(title: string, items: AliasMismatch[]): void {
  if (items.length === 0) return;
  console.log(`\n--- ${title} (${items.length}) ---`);

  const grouped = new Map<string, AliasMismatch[]>();
  for (const item of items) {
    const key = item.expectedCanonical;
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  const sortedGroups = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [canonical, group] of sortedGroups.slice(0, MAX_GROUPS_PREVIEW)) {
    console.log(`  - ${canonical} (${group.length})`);
    for (const item of group.slice(0, MAX_ITEMS_PER_GROUP)) {
      const actual = item.actualCanonical ?? 'unresolved';
      console.log(`      • "${item.alias}" -> ${actual}`);
    }
    const extra = group.length - MAX_ITEMS_PER_GROUP;
    if (extra > 0) {
      console.log(`      • ... +${extra} more`);
    }
  }

  const hiddenGroups = sortedGroups.length - MAX_GROUPS_PREVIEW;
  if (hiddenGroups > 0) {
    console.log(`  ... +${hiddenGroups} more canonical groups`);
  }
}

console.log(`Runtime canonicals: ${runtimeCorpus.length}`);
console.log(`Lexicon canonicals: ${lexicon.location_dictionary.length}`);
console.log(`Aliases checked: ${aliasesChecked}`);
console.log(`Allowlisted ambiguities: ${allowlistedAmbiguities.length}`);
console.log(`Canonical mismatches: ${missingCanonicalsAfterEquivalents.length}`);
console.log(`Alias unresolved: ${unresolvedAliases.length}`);
console.log(`Alias wrong-resolution: ${mismatchedAliases.length}`);
console.log(
  `Regression budget: canonical<=${regressionBudget.canonicalMismatches}, unresolved<=${regressionBudget.unresolvedAliases}, wrong-resolution<=${regressionBudget.wrongResolutionAliases}`
);

printCanonicalList(
  'Missing canonicals in runtime gazetteer',
  missingCanonicalsAfterEquivalents.map((entry) => entry.canonical),
  MAX_CANONICALS_PREVIEW
);
printMismatchGroups('Unresolved aliases by expected canonical', unresolvedAliases);
printMismatchGroups('Alias resolution mismatches by expected canonical', mismatchedAliases);

if (allowlistedAmbiguities.length > 0) {
  const allowlistedByTerm = [...new Set(allowlistedAmbiguities.map((item) => normalize(item.alias)))].sort();
  printCanonicalList('Allowlisted ambiguous terms hit', allowlistedByTerm, MAX_CANONICALS_PREVIEW);
}

process.exit(failCount > 0 ? 1 : 0);
