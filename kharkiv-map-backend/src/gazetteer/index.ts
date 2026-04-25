import {
  getAllGazetteerEntries,
  insertGazetteerEntry,
  logUnmatchedLocation,
  clearGazetteerEntries,
} from '../db/client.js';
import { GAZETTEER_SEED } from './data.js';
import { damerauLevenshtein, normalize } from './fuzzy.js';
import { GENERATED_AMBIGUOUS_TERMS } from '../generated/ambiguity.js';

export interface ResolvedLocation {
  rawName: string;
  canonicalName: string;
  lat: number;
  lng: number;
  type: string;
  parent: string | null;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'unresolved';
  confidence: number;
}

interface GazEntry {
  canonical: string;
  lat: number;
  lng: number;
  type: string;
  parent: string | null;
}

export interface GazetteerRuntimeCorpusEntry {
  canonical: string;
  normalizedCanonical: string;
  normalizedAliases: string[];
}

const KHARKIV_CENTER = { lat: 49.9935, lng: 36.2304 };
const NEARBY_KHARKIV_RADIUS_KM = 90;
const KHARKIV_CITY_PARENT = 'Харків';
const KHARKIV_OBLAST_PARENT = 'Харківська область';

const AMBIGUITY_PRIORITY_WEIGHT: Record<string, number> = {
  HIGH: 0.22,
  MEDIUM: 0.12,
  LOW: 0.06,
};

const AMBIGUOUS_TERM_PRIORITY = new Map<string, keyof typeof AMBIGUITY_PRIORITY_WEIGHT>(
  GENERATED_AMBIGUOUS_TERMS.map(term => [normalize(term.term), term.priority])
);

function tokenize(value: string): string[] {
  return value
    .split(/[^a-zа-яіїєґ0-9']+/i)
    .map(part => part.trim())
    .filter(Boolean);
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function lexicalScore(query: string, alias: string): number {
  const queryTokens = tokenize(query);
  const aliasTokens = tokenize(alias);
  if (queryTokens.length === 0 || aliasTokens.length === 0) return 0;

  const aliasSet = new Set(aliasTokens);
  const overlapCount = queryTokens.filter(token => aliasSet.has(token)).length;
  const overlapRatio = overlapCount / queryTokens.length;

  const prefixBonus = alias.startsWith(query) || query.startsWith(alias) ? 0.2 : 0;
  const containsBonus = alias.includes(query) || query.includes(alias) ? 0.1 : 0;
  const orderedTokenBonus =
    queryTokens.length > 1 &&
    aliasTokens.length > 1 &&
    queryTokens[0] === aliasTokens[0] &&
    queryTokens[queryTokens.length - 1] === aliasTokens[aliasTokens.length - 1]
      ? 0.3
      : 0;

  return overlapRatio + prefixBonus + containsBonus + orderedTokenBonus;
}

function toResolved(
  rawName: string,
  entry: GazEntry,
  matchType: ResolvedLocation['matchType'],
  confidence: number
): ResolvedLocation {
  return {
    rawName,
    canonicalName: entry.canonical,
    lat: entry.lat,
    lng: entry.lng,
    type: entry.type,
    parent: entry.parent,
    matchType,
    confidence,
  };
}

// In-memory lookup map: normalized alias → entry
let aliasMap: Map<string, GazEntry[]> = new Map();
let allNormalized: Array<{ normalized: string; entry: GazEntry }> = [];

function isKharkivNearby(entry: GazEntry): boolean {
  if (entry.parent === KHARKIV_CITY_PARENT) return true;
  if (entry.parent === KHARKIV_OBLAST_PARENT) return true;
  if (entry.parent?.includes('громада')) return true;
  return haversineKm(entry.lat, entry.lng, KHARKIV_CENTER.lat, KHARKIV_CENTER.lng) <= NEARBY_KHARKIV_RADIUS_KM;
}

function scoreCandidate(normQuery: string, alias: string, entry: GazEntry): number {
  const lexical = lexicalScore(normQuery, alias);
  const queryTokens = tokenize(normQuery);
  const aliasTokens = tokenize(alias);
  const qualifierBonus =
    queryTokens.length > 1 && aliasTokens.length > 1 && aliasTokens.length >= queryTokens.length
      ? 0.3
      : 0;
  const nearbyBonus = isKharkivNearby(entry) ? 0.25 : 0;
  const proximityBias =
    1 /
    (1 +
      haversineKm(
        entry.lat,
        entry.lng,
        KHARKIV_CENTER.lat,
        KHARKIV_CENTER.lng
      ));
  const ambiguityPriority = AMBIGUOUS_TERM_PRIORITY.get(normQuery);
  const ambiguityPenalty = ambiguityPriority ? AMBIGUITY_PRIORITY_WEIGHT[ambiguityPriority] : 0;
  return lexical * 2.1 + qualifierBonus + nearbyBonus + proximityBias - ambiguityPenalty;
}

function rankCandidates(
  normQuery: string,
  candidates: Array<{ entry: GazEntry; aliases: Set<string> }>
): GazEntry | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].entry;
  const ranked = candidates
    .map(candidate => ({
      entry: candidate.entry,
      score: Math.max(...[...candidate.aliases].map(alias => scoreCandidate(normQuery, alias, candidate.entry))),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.canonical.localeCompare(b.entry.canonical, 'uk');
    });
  return ranked[0]?.entry ?? null;
}

export function seedGazetteer(): void {
  // Keep DB gazetteer in sync with source-of-truth seed data.
  clearGazetteerEntries();
  for (const entry of GAZETTEER_SEED) {
    insertGazetteerEntry({
      canonical: entry.canonical,
      lat: entry.lat,
      lng: entry.lng,
      type: entry.type,
      parent: entry.parent,
      aliases: entry.aliases,
    });
  }
  rebuildAliasMap();
}

export function rebuildAliasMap(): void {
  aliasMap = new Map();
  allNormalized = [];

  const rows = getAllGazetteerEntries();
  for (const row of rows) {
    const entry: GazEntry = {
      canonical: row.canonical,
      lat: row.lat,
      lng: row.lng,
      type: row.type,
      parent: row.parent,
    };

    // Index canonical name
    const normCanon = normalize(row.canonical);
    const canonExisting = aliasMap.get(normCanon) ?? [];
    if (!canonExisting.some(candidate => candidate.canonical === entry.canonical)) {
      canonExisting.push(entry);
    }
    aliasMap.set(normCanon, canonExisting);
    allNormalized.push({ normalized: normCanon, entry });

    // Index all aliases
    const aliases: string[] = JSON.parse(row.aliases);
    for (const alias of aliases) {
      const normAlias = normalize(alias);
      const existing = aliasMap.get(normAlias) ?? [];
      if (!existing.some(candidate => candidate.canonical === entry.canonical)) {
        existing.push(entry);
      }
      aliasMap.set(normAlias, existing);
      allNormalized.push({ normalized: normAlias, entry });
    }
  }
}

export function resolve(rawName: string, messageId?: number): ResolvedLocation | null {
  if (!rawName || rawName.trim().length === 0) return null;

  const norm = normalize(rawName);

  // Step 1: Exact match (canonical or alias)
  const exactCandidates = aliasMap.get(norm);
  if (exactCandidates && exactCandidates.length > 0) {
    const byCanonical = exactCandidates.map(entry => ({ entry, aliases: new Set([norm]) }));
    const exact = rankCandidates(norm, byCanonical);
    if (!exact) return null;
    const matchType: ResolvedLocation['matchType'] =
      normalize(exact.canonical) === norm ? 'exact' : 'alias';
    return toResolved(rawName, exact, matchType, 0.95);
  }

  // Step 2: Substring / contains match
  const substringMatches: Array<{ entry: GazEntry; alias: string }> = [];
  for (const { normalized: alias, entry } of allNormalized) {
    if (alias.includes(norm) || norm.includes(alias)) {
      // Avoid very short substrings creating false matches
      if (Math.min(alias.length, norm.length) >= 3) {
        substringMatches.push({ entry, alias });
      }
    }
  }
  // Deduplicate by canonical name and keep all matching aliases for lexical scoring.
  const byCanonical = new Map<string, { entry: GazEntry; aliases: Set<string> }>();
  for (const match of substringMatches) {
    const existing = byCanonical.get(match.entry.canonical);
    if (existing) {
      existing.aliases.add(match.alias);
      continue;
    }
    byCanonical.set(match.entry.canonical, {
      entry: match.entry,
      aliases: new Set([match.alias]),
    });
  }
  const uniqueSubstring = [...byCanonical.values()];
  if (uniqueSubstring.length === 1) {
    return toResolved(rawName, uniqueSubstring[0].entry, 'alias', 0.8);
  }
  if (uniqueSubstring.length > 1) {
    const ranked = rankCandidates(norm, uniqueSubstring);
    if (ranked) {
      return toResolved(rawName, ranked, 'alias', 0.75);
    }
  }

  // Step 3: Fuzzy match (Damerau-Levenshtein ≤ 2)
  let bestDist = Infinity;
  let bestEntry: GazEntry | null = null;
  for (const { normalized: alias, entry } of allNormalized) {
    // Only compare if lengths are within 3 chars
    if (Math.abs(alias.length - norm.length) > 3) continue;
    const dist = damerauLevenshtein(norm, alias);
    if (dist < bestDist && dist <= 2) {
      bestDist = dist;
      bestEntry = entry;
    }
  }
  if (bestEntry) {
    return toResolved(rawName, bestEntry, 'fuzzy', bestDist === 1 ? 0.7 : 0.55);
  }

  // Step 4: Unresolved — log for manual review
  logUnmatchedLocation(rawName, messageId);
  return null;
}

/**
 * Get all place names for use in LLM prompts.
 */
export function getKnownPlaceNames(): string[] {
  return allNormalized.map(e => e.entry.canonical)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Read-only normalized gazetteer corpus from runtime DB state.
 * Used by coverage checks that need parity against resolver behavior.
 */
export function getGazetteerRuntimeCorpus(): GazetteerRuntimeCorpusEntry[] {
  const rows = getAllGazetteerEntries();
  const corpus = rows.map((row) => {
    const aliases: string[] = JSON.parse(row.aliases);
    const normalizedAliases = [...new Set([row.canonical, ...aliases].map((alias) => normalize(alias)))].sort();
    return {
      canonical: row.canonical,
      normalizedCanonical: normalize(row.canonical),
      normalizedAliases,
    };
  });
  return corpus.sort((a, b) => a.canonical.localeCompare(b.canonical, 'uk'));
}
