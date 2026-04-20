import { getAllGazetteerEntries, insertGazetteerEntry, logUnmatchedLocation } from '../db/client.js';
import { GAZETTEER_SEED } from './data.js';
import { damerauLevenshtein, normalize } from './fuzzy.js';

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
let aliasMap: Map<string, GazEntry> = new Map();
let allNormalized: Array<{ normalized: string; entry: GazEntry }> = [];

export function seedGazetteer(): void {
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
    aliasMap.set(normCanon, entry);
    allNormalized.push({ normalized: normCanon, entry });

    // Index all aliases
    const aliases: string[] = JSON.parse(row.aliases);
    for (const alias of aliases) {
      const normAlias = normalize(alias);
      aliasMap.set(normAlias, entry);
      allNormalized.push({ normalized: normAlias, entry });
    }
  }
}

export function resolve(rawName: string, messageId?: number): ResolvedLocation | null {
  if (!rawName || rawName.trim().length === 0) return null;

  const norm = normalize(rawName);

  // Step 1: Exact match (canonical or alias)
  const exact = aliasMap.get(norm);
  if (exact) {
    const matchType: ResolvedLocation['matchType'] =
      aliasMap.has(normalize(exact.canonical)) && normalize(exact.canonical) === norm ? 'exact' : 'alias';
    return toResolved(rawName, exact, matchType, 0.95);
  }

  // Step 2: Substring / contains match
  const substringMatches: GazEntry[] = [];
  for (const { normalized: alias, entry } of allNormalized) {
    if (alias.includes(norm) || norm.includes(alias)) {
      // Avoid very short substrings creating false matches
      if (Math.min(alias.length, norm.length) >= 3) {
        substringMatches.push(entry);
      }
    }
  }
  // Deduplicate by canonical name
  const uniqueSubstring = [...new Map(substringMatches.map(e => [e.canonical, e])).values()];
  if (uniqueSubstring.length === 1) {
    return toResolved(rawName, uniqueSubstring[0], 'alias', 0.8);
  }
  if (uniqueSubstring.length > 1) {
    // Pick the entry whose alias is closest in length to the query
    const best = uniqueSubstring.reduce((a, b) =>
      Math.abs(a.canonical.length - rawName.length) < Math.abs(b.canonical.length - rawName.length) ? a : b
    );
    return toResolved(rawName, best, 'alias', 0.7);
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
