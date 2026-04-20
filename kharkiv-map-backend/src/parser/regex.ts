import { v4 as uuid } from 'uuid';
import { resolve, type ResolvedLocation } from '../gazetteer/index.js';
import type { EventType, WeaponType, ParsedEvent } from './types.js';

/**
 * Layer 1: Regex-based parser for Telegram monitoring channel messages.
 * Returns null if confidence is too low (falls through to OpenAI).
 */
export function parseWithRegex(
  text: string,
  rawMessageId: number,
  sourceChannel: string,
  sourceTimestamp: number,
): ParsedEvent | null {
  const clean = text.replace(/\s+/g, ' ').trim();

  // --- Flags ---
  const isPreliminary = /^Предварительно/i.test(clean);
  const isCorrection = /^Уточнение/i.test(clean);

  // --- Event type ---
  let eventType: EventType = 'tracking';
  if (/Взрыв[ыа]?\s/i.test(clean) || /💥/.test(clean)) {
    eventType = 'impact';
  } else if (/упал[иа]?/i.test(clean)) {
    eventType = 'impact';
  } else if (/отбой|чисто|відбій/i.test(clean)) {
    eventType = 'all_clear';
  } else if (isCorrection) {
    eventType = 'correction';
  }

  // --- Weapon type ---
  let weaponType: WeaponType = 'unknown';
  if (/Шахед/i.test(clean)) {
    weaponType = 'shahed';
  } else if (/С-300/i.test(clean)) {
    weaponType = 's300';
  } else if (/КАБ/i.test(clean)) {
    weaponType = 'kab';
  } else if (/[Іі]скандер|Искандер/i.test(clean)) {
    weaponType = 'iskander';
  } else if (/ракет[аыі]/i.test(clean)) {
    weaponType = 'missile';
  } else if (/БпЛА|БПЛА|дрон/i.test(clean)) {
    weaponType = 'bpla';
  } else if (/[Зз]алетают|[Мм]олния/i.test(clean)) {
    // "Залетают" without explicit weapon type implies drones in this context
    weaponType = 'bpla';
  }

  // --- Weapon count ---
  let weaponCount = 1;
  // Try multiple patterns for count extraction
  const countPatterns = [
    /(?:^|[\s,🔴⚠])(\d+)\s+(?:Ударн\S+\s+)?(?:БпЛА|БПЛА|Шахед|ракет|дрон)/i,
    /(?:^|[\s,])(\d+)\s+[Зз]алетают/i,
    /(?:^|[\s,])(\d+)\s+[Бб]ерут/i,
  ];
  for (const pat of countPatterns) {
    const m = clean.match(pat);
    if (m) { weaponCount = parseInt(m[1], 10); break; }
  }
  // "Оба" = both = 2
  if (/\bОба\b/i.test(clean) && weaponCount === 1) weaponCount = 2;

  // --- Location extraction ---
  let location: ResolvedLocation | null = null;
  let heading: ResolvedLocation | null = null;
  let via: ResolvedLocation | null = null;

  // Pattern: "через X на Y" (via + heading)
  const viaMatch = clean.match(/[Чч]ерез\s+(.+?)\s+на\s+(.+?)(?:[⚠💥,]|$)/i);
  if (viaMatch) {
    via = resolve(viaMatch[1].trim(), rawMessageId);
    heading = resolve(viaMatch[2].trim(), rawMessageId);
  }

  // Pattern: "между X и Y" (between two places)
  if (!location) {
    const betweenMatch = clean.match(/[Мм]ежду\s+(.+?)\s+и\s+(.+?)(?:[⚠💥,]|$)/i);
    if (betweenMatch) {
      const loc1 = resolve(betweenMatch[1].trim(), rawMessageId);
      const loc2 = resolve(betweenMatch[2].trim(), rawMessageId);
      // Use midpoint if both resolve
      if (loc1 && loc2) {
        location = {
          rawName: `${betweenMatch[1].trim()} — ${betweenMatch[2].trim()}`,
          canonicalName: `${loc1.canonicalName} — ${loc2.canonicalName}`,
          lat: (loc1.lat + loc2.lat) / 2,
          lng: (loc1.lng + loc2.lng) / 2,
          type: 'composite',
          parent: null,
          matchType: 'alias',
          confidence: Math.min(loc1.confidence, loc2.confidence) * 0.9,
        };
      } else {
        location = loc1 || loc2;
      }
    }
  }

  // Pattern: "Взрыв(ы) в районе X"
  if (!location && eventType === 'impact') {
    const impactMatch = clean.match(/[Вв]зрыв[ыа]?\s+в\s+район[еу]?\s+(.+?)(?:[⚠💥,]|$)/i);
    if (impactMatch) {
      location = resolve(impactMatch[1].trim(), rawMessageId);
    }
  }

  // Pattern: "в районе X - Y" (location range)
  if (!location) {
    const areaRangeMatch = clean.match(/в\s+район[еу]?\s+(.+?)\s*[-–]\s*(.+?)(?:[,⚠💥]|$)/i);
    if (areaRangeMatch) {
      location = resolve(areaRangeMatch[1].trim(), rawMessageId);
      // Second location could be a heading
      if (!heading) {
        const loc2 = resolve(areaRangeMatch[2].trim(), rawMessageId);
        if (loc2) heading = loc2;
      }
    }
  }

  // Pattern: "в районе X"
  if (!location) {
    const areaMatch = clean.match(/в\s+район[еу]?\s+(.+?)(?:[,⚠💥]|$)/i);
    if (areaMatch) {
      location = resolve(areaMatch[1].trim(), rawMessageId);
    }
  }

  // Pattern: "курсом/курс (сейчас) на X"
  if (!heading && !viaMatch) {
    const courseMatch = clean.match(/курсо?м?\s+(?:сейчас\s+)?на\s+(.+?)(?:[⚠💥,]|$)/i);
    if (courseMatch) {
      // May contain comma-separated list
      const targets = courseMatch[1].split(/,\s*/);
      heading = resolve(targets[0].trim(), rawMessageId);
      // If no location yet, take the last target as additional info
      if (!location && targets.length > 1) {
        location = heading;
        heading = resolve(targets[targets.length - 1].trim(), rawMessageId);
      }
    }
  }

  // Pattern: "направлении/направление на X"
  if (!heading && !viaMatch) {
    const dirMatch = clean.match(/направлени[еия]\s+(?:на\s+)?(.+?)(?:[⚠💥,]|$)/i);
    if (dirMatch) {
      heading = resolve(dirMatch[1].trim(), rawMessageId);
    }
  }

  // Pattern: "Залетают на/в X, Y, Z"
  if (!location) {
    const enterMatch = clean.match(/[Зз]алетают\s+(?:на|в)\s+(.+?)(?:[⚠💥]|$)/i);
    if (enterMatch) {
      const places = enterMatch[1].split(/,\s*/);
      location = resolve(places[0].trim(), rawMessageId);
      if (places.length > 1 && !heading) {
        heading = resolve(places[places.length - 1].trim(), rawMessageId);
      }
    }
  }

  // Pattern: "на X" at end (generic heading, lower confidence)
  if (!location && !heading) {
    const genericOnMatch = clean.match(/(?:^|\s)на\s+(.+?)(?:[⚠💥,]|$)/i);
    if (genericOnMatch) {
      const resolved = resolve(genericOnMatch[1].trim(), rawMessageId);
      if (resolved) {
        heading = resolved;
      }
    }
  }

  // --- Confidence calculation ---
  let confidence = 0.0;
  if (weaponType !== 'unknown') confidence += 0.3;
  if (eventType !== 'tracking' || location || heading) confidence += 0.2;
  if (location && location.matchType !== 'unresolved') confidence += 0.2;
  if (heading && heading.matchType !== 'unresolved') confidence += 0.1;
  if (isPreliminary) confidence *= 0.8;

  // If we couldn't determine anything useful, fall through to OpenAI
  if (weaponType === 'unknown' && !location && !heading && eventType === 'tracking') {
    return null; // confidence too low
  }

  return {
    id: uuid(),
    rawMessageId,
    eventType,
    weaponType,
    weaponCount,
    location,
    heading,
    via,
    confidence: Math.min(confidence, 0.95),
    parserLayer: 'regex',
    isPreliminary,
    isCorrection,
    sourceChannel,
    sourceTimestamp,
  };
}
