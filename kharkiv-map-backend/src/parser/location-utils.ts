import { resolve, type ResolvedLocation } from '../gazetteer/index.js';

function dedupeParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

function splitLocationCandidates(raw: string): string[] {
  const normalized = raw
    .replace(/[(){}\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  // Channel messages often use separators for approximate/dual naming:
  // "Шаровка/Коломак", "X - Y", "X, Y".
  const parts = normalized
    .split(/[\/|,;]|(?:\s[-–—]\s)/)
    .map((v) => v.trim())
    .filter((v) => v.length >= 2);

  return dedupeParts(parts.length ? parts : [normalized]);
}

export function resolveBestEffortLocation(rawName: string, messageId?: number): ResolvedLocation | null {
  const direct = resolve(rawName, messageId);
  if (direct) return direct;

  const parts = splitLocationCandidates(rawName);
  if (!parts.length) return null;

  const resolvedParts = parts
    .map((part) => ({ part, resolved: resolve(part, messageId) }))
    .filter((x): x is { part: string; resolved: ResolvedLocation } => x.resolved != null);

  if (!resolvedParts.length) return null;

  if (resolvedParts.length === 1) {
    const hit = resolvedParts[0].resolved;
    return {
      ...hit,
      rawName,
      confidence: Math.max(0.35, hit.confidence * 0.85),
    };
  }

  const avgLat = resolvedParts.reduce((sum, x) => sum + x.resolved.lat, 0) / resolvedParts.length;
  const avgLng = resolvedParts.reduce((sum, x) => sum + x.resolved.lng, 0) / resolvedParts.length;
  const best = resolvedParts.reduce((a, b) => (a.resolved.confidence >= b.resolved.confidence ? a : b)).resolved;

  return {
    rawName,
    canonicalName: resolvedParts.map((x) => x.resolved.canonicalName).join(' / '),
    lat: avgLat,
    lng: avgLng,
    type: 'composite',
    parent: best.parent,
    matchType: 'alias',
    confidence: Math.max(0.3, Math.min(0.8, best.confidence * 0.8)),
  };
}
