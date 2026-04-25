import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { config } from '../config.js';
import { getRecentChannelContext } from '../db/client.js';
import { getActiveLiveIncidents } from '../correlation/engine.js';
import type { LiveIncident } from '../correlation/engine.js';
import { getKnownPlaceNames } from '../gazetteer/index.js';
import type { ParsedEvent, EventType, WeaponType } from './types.js';
import { resolveBestEffortLocation } from './location-utils.js';
import type { ResolvedLocation } from '../gazetteer/index.js';
import { GENERATED_WEAPON_ALIASES } from '../generated/weapon-aliases.js';
import { detectPhraseIntents } from './intents.js';

const CANONICAL_WEAPON_TYPES = Object.keys(GENERATED_WEAPON_ALIASES) as WeaponType[];

const LLMEventSchema = z.object({
  event_type: z.enum(['tracking', 'impact', 'correction', 'all_clear']),
  weapon_type: z.enum(CANONICAL_WEAPON_TYPES as [WeaponType, ...WeaponType[]]),
  weapon_count: z.number().int().min(0).default(1),
  location: z.string().nullable().default(null),
  heading: z.string().nullable().default(null),
  via: z.string().nullable().default(null),
  is_preliminary: z.boolean().default(false),
  is_correction: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
  continues_incident_id: z.string().nullable().default(null),
  continuation_confidence: z.number().min(0).max(1).default(0),
  is_followup: z.boolean().default(false),
  count_delta: z.number().int().min(0).default(0),
});

let client: OpenAI | null = null;

/** Incremented each time OpenAI fails and the caller should fall back to regex. */
let openaiRegexFallbackCount = 0;

function warnOpenAIFallback(reason: string) {
  openaiRegexFallbackCount++;
  console.warn(
    `[parser] OpenAI parse failed (${reason}), using regex fallback (#${openaiRegexFallbackCount})`,
  );
}

function describeOpenAIError(err: unknown): string {
  if (err instanceof APIConnectionError || err instanceof APIConnectionTimeoutError) {
    return 'network';
  }
  if (err instanceof APIError) {
    if (err.code === 'insufficient_quota') return 'insufficient_quota';
    if (err.status === 401) return 'unauthorized';
    if (err.status === 429) return 'rate_limited';
    return err.message || 'api_error';
  }
  if (err instanceof z.ZodError) {
    return 'invalid_llm_schema';
  }
  if (err instanceof SyntaxError) {
    return 'invalid_json';
  }
  return err instanceof Error ? err.message : String(err);
}

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return client;
}

function compactIncidentsForPrompt(incidents: LiveIncident[]): unknown[] {
  return incidents.map((i) => {
    const tr = i.trajectory;
    const last = tr.length ? tr[tr.length - 1] : null;
    return {
      id: i.id,
      weapon: i.weaponType,
      lastPoint: last ? { lat: last.lat, lng: last.lng, name: last.name } : null,
      heading: i.currentHeading,
      lastUpdatedAt: i.lastUpdatedAt,
    };
  });
}

function extractSlashPair(text: string): [string, string] | null {
  const m = text.match(/([A-Za-zА-Яа-яІіЇїЄєЁё'’`.-]{2,}(?:\s+[A-Za-zА-Яа-яІіЇїЄєЁё'’`.-]{2,})?\s*\/\s*[A-Za-zА-Яа-яІіЇїЄєЁё'’`.-]{2,}(?:\s+[A-Za-zА-Яа-яІіЇїЄєЁё'’`.-]{2,})?)/);
  if (!m) return null;
  const parts = m[1].split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return [parts[0], parts[1]];
}

function hasOnPairIntent(text: string): boolean {
  return /(?:^|\s)(?:на|курс(?:ом)?\s+на|направлени[ея]\s+на)\s+[^\n]*\//i.test(text);
}

function toCompositeLocation(
  rawName: string,
  first: ResolvedLocation,
  second: ResolvedLocation
): ResolvedLocation {
  return {
    rawName,
    canonicalName: `${first.canonicalName} / ${second.canonicalName}`,
    lat: (first.lat + second.lat) / 2,
    lng: (first.lng + second.lng) / 2,
    type: 'composite',
    parent: first.parent ?? second.parent ?? null,
    matchType: 'alias',
    confidence: Math.max(0.35, Math.min(first.confidence, second.confidence) * 0.85),
  };
}

const KHARKIV_CENTER = { lat: 49.9935, lng: 36.2304 };
// Rough anchor on RU-border side of Kharkiv oblast (for directional heuristics only).
const ENEMY_SIDE_ANCHOR = { lat: 50.42, lng: 36.75 };

function distanceSq(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = aLat - bLat;
  const dLng = aLng - bLng;
  return dLat * dLat + dLng * dLng;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function destinationKm(lat: number, lng: number, bearingDeg: number, distanceKm: number): { lat: number; lng: number } {
  const R = 6371;
  const δ = distanceKm / R;
  const θ = bearingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lng * Math.PI / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * sinδ * cosφ1,
      cosδ - sinφ1 * sinφ2
    );
  return { lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

/** Midpoint area for a two-place shorthand ("X/Y"). */
function midpointPair(
  rawName: string,
  left: ResolvedLocation,
  right: ResolvedLocation
): ResolvedLocation {
  return {
    rawName,
    canonicalName: `${left.canonicalName} / ${right.canonicalName}`,
    lat: (left.lat + right.lat) / 2,
    lng: (left.lng + right.lng) / 2,
    type: 'composite',
    parent: left.parent ?? right.parent ?? null,
    matchType: 'alias',
    confidence: Math.max(0.35, Math.min(left.confidence, right.confidence) * 0.85),
  };
}

/**
 * For "на X/Y": place current point *before* the pair area from enemy-side direction,
 * and let heading point toward the pair area.
 */
function estimateApproachFromEnemySide(
  rawName: string,
  left: ResolvedLocation,
  right: ResolvedLocation
): ResolvedLocation {
  const mid = midpointPair(rawName, left, right);
  const pairSpanKm = haversineKm(left.lat, left.lng, right.lat, right.lng);
  const approachBearing = bearing(mid.lat, mid.lng, ENEMY_SIDE_ANCHOR.lat, ENEMY_SIDE_ANCHOR.lng);
  // Move back from the target area toward border side by adaptive offset.
  const approachOffsetKm = Math.max(6, Math.min(14, pairSpanKm * 1.1));
  const p = destinationKm(mid.lat, mid.lng, approachBearing, approachOffsetKm);

  return {
    rawName,
    canonicalName: `${mid.canonicalName} (approach)`,
    lat: p.lat,
    lng: p.lng,
    type: 'composite',
    parent: mid.parent,
    matchType: 'alias',
    confidence: Math.max(0.42, mid.confidence * 0.92),
  };
}

function incidentPointToResolved(
  name: string,
  lat: number,
  lng: number,
): ResolvedLocation {
  return {
    rawName: name || 'incident_last_point',
    canonicalName: name || 'Incident last point',
    lat,
    lng,
    type: 'composite',
    parent: null,
    matchType: 'alias',
    confidence: 0.45,
  };
}

function isIncidentSyntheticPoint(value: ResolvedLocation | null): boolean {
  if (!value) return false;
  return value.canonicalName === 'Incident last point' || value.rawName === 'incident_last_point';
}

function hasContinuationCue(text: string, phraseIntents: string[]): boolean {
  if (phraseIntents.includes('continuation') || phraseIntents.includes('heading_change')) {
    return true;
  }
  return /(?:^|\s)(?:далее|далі|дальше|летит\s+дальше|свернул(?:[аи]?)|змін(?:ив|или)\s+курс)(?:$|\s|[,.!?:;])/iu.test(text);
}

function extractDirectionalHeadingHint(text: string, rawMessageId: number): ResolvedLocation | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  const patterns = [
    /(?:^|\s)(?:далее|далі)\s+на\s+(.+?)(?:[⚠💥,]|$)/i,
    /курсо?м?\s+(?:сейчас\s+)?на\s+(.+?)(?:[⚠💥,]|$)/i,
    /направлени[еия]\s+(?:на\s+)?(.+?)(?:[⚠💥,]|$)/i,
    /(?:лет(?:ит|ят)|двига(?:ется|ются)|бер[её]т?\s+курс)\s+на\s+(.+?)(?:[⚠💥,]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (!match) continue;
    const resolved = resolveBestEffortLocation(match[1].trim(), rawMessageId);
    if (resolved) return resolved;
  }
  return null;
}

function buildTrackingFallbackFromIncident(
  active: LiveIncident[],
  sourceChannel: string,
  sourceTimestamp: number,
  continuesId: string | null,
  continuationConfidence: number,
): { location: ResolvedLocation | null; heading: ResolvedLocation | null } | null {
  let candidate: LiveIncident | null = null;

  if (continuesId && continuationConfidence >= 0.35) {
    candidate = active.find((i) => i.id === continuesId) ?? null;
  }

  if (!candidate) {
    candidate = active
      .filter((i) => i.sourceChannels.includes(sourceChannel))
      .filter((i) => sourceTimestamp - i.lastUpdatedAt <= config.openai.contextWindowMin * 60)
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)[0] ?? null;
  }

  if (!candidate) return null;
  const last = candidate.trajectory[candidate.trajectory.length - 1];
  if (!last) return null;

  const location = incidentPointToResolved(last.name, last.lat, last.lng);
  const heading = candidate.currentHeading
    ? incidentPointToResolved(candidate.currentHeading.name, candidate.currentHeading.lat, candidate.currentHeading.lng)
    : null;

  return { location, heading };
}

function buildSystemPrompt(activeIncidentsJson: string): string {
  const places = getKnownPlaceNames().join(', ');
  return `You are a parser for Ukrainian/Russian-language Telegram channel messages about military attacks on Kharkiv, Ukraine. Parse each message into a structured JSON event.

Known place names in Kharkiv oblast: ${places}

Currently active incidents (JSON array; use id values only from this list for continues_incident_id):
${activeIncidentsJson}

Output schema:
{
  "event_type": "tracking" | "impact" | "correction" | "all_clear",
  "weapon_type": ${CANONICAL_WEAPON_TYPES.map((t) => `"${t}"`).join(' | ')},
  "weapon_count": number (default 1),
  "location": string | null (current location of threat, use name from the known places list if possible),
  "heading": string | null (where it's heading, "курс на X"),
  "via": string | null (intermediate point, "через X"),
  "is_preliminary": boolean (true if "Предварительно"),
  "is_correction": boolean (true if "Уточнение"),
  "confidence": number 0.0-1.0,
  "continues_incident_id": string | null (id from active incidents if this message clearly updates the same threat; otherwise null),
  "continuation_confidence": number 0.0-1.0 (how sure the message refers to that incident; 0 if unrelated or new threat),
  "is_followup": boolean (true for continuation phrases like "далее", "уже возле", "еще", "ще", "далі"),
  "count_delta": number (default 0; set to 1 for phrases like "еще один", "ще один", "+1")
}

Guideline: Set continues_incident_id only when the message clearly continues or corrects a specific threat already listed above; otherwise null and continuation_confidence 0.
Guideline: Set is_followup=true when the message reads like a continuation update, even if weapon type is omitted.
Guideline: Set count_delta=1 when the message says one additional target ("еще один", "ще один", "+1").

Key terminology:
- "БпЛА" / "Ударный БпЛА" = attack UAV/drone → weapon_type: "bpla"
- "Шахед"/"Шаболда" = Shahed drone → weapon_type: "shahed"
- "Молния" = Molniya UAV → weapon_type: "molniya"
- "FPV" = FPV drone → weapon_type: "fpv"
- "курсом на X" / "курс на X" = heading toward X → heading field
- "в районе X" = in the area of X → location field
- "Залетают на X" = entering X → location field
- "Взрыв/Взрывы" / 💥 = explosion → event_type: "impact"
- "направление на X" = heading toward X → heading field
- "далее на X" = continues heading toward X → heading field
- "через X на Y" = via X toward Y → via + heading fields
- "между X и Y" = between X and Y → location (pick the first one)
- If admins use local or approximate names (like "Шаровка/Коломак", "X - Y"), preserve the raw wording in location/heading/via and infer the closest known place.

Return ONLY valid JSON, no explanation.`;
}

const FEW_SHOT_EXAMPLES = [
  {
    input: 'Шахед курсом на Печенеги⚠️',
    output:
      '{"event_type":"tracking","weapon_type":"shahed","weapon_count":1,"location":null,"heading":"Печенеги","via":null,"is_preliminary":false,"is_correction":false,"confidence":0.8,"continues_incident_id":null,"continuation_confidence":0}',
  },
  {
    input: '2 Ударных БпЛА в районе Безруки - Дергачи, курс Русская Лозовая⚠️',
    output:
      '{"event_type":"tracking","weapon_type":"bpla","weapon_count":2,"location":"Безруки","heading":"Русская Лозовая","via":null,"is_preliminary":false,"is_correction":false,"confidence":0.85,"continues_incident_id":null,"continuation_confidence":0}',
  },
  {
    input: 'Взрыв в районе Сокольники💥',
    output:
      '{"event_type":"impact","weapon_type":"unknown","weapon_count":1,"location":"Сокольники","heading":null,"via":null,"is_preliminary":false,"is_correction":false,"confidence":0.9,"continues_incident_id":null,"continuation_confidence":0}',
  },
  {
    input: 'Берут направление на центр⚠️',
    output:
      '{"event_type":"tracking","weapon_type":"unknown","weapon_count":1,"location":null,"heading":"центр","via":null,"is_preliminary":false,"is_correction":false,"confidence":0.6,"continues_incident_id":null,"continuation_confidence":0}',
  },
  {
    input: 'Через Киевскую на Французкий Бульвар⚠️',
    output:
      '{"event_type":"tracking","weapon_type":"unknown","weapon_count":1,"location":null,"heading":"Французкий Бульвар","via":"Киевская","is_preliminary":false,"is_correction":false,"confidence":0.7,"continues_incident_id":null,"continuation_confidence":0}',
  },
  {
    input: 'Далее на Ст Салтов⚠️',
    output:
      '{"event_type":"tracking","weapon_type":"unknown","weapon_count":1,"location":null,"heading":"Ст Салтов","via":null,"is_preliminary":false,"is_correction":false,"confidence":0.7,"continues_incident_id":null,"continuation_confidence":0,"is_followup":true,"count_delta":0}',
  },
  {
    input: 'Еще один шахед на Печенеги',
    output:
      '{"event_type":"tracking","weapon_type":"shahed","weapon_count":1,"location":null,"heading":"Печенеги","via":null,"is_preliminary":false,"is_correction":false,"confidence":0.82,"continues_incident_id":null,"continuation_confidence":0,"is_followup":true,"count_delta":1}',
  },
];

export async function parseWithOpenAI(
  text: string,
  rawMessageId: number,
  sourceChannel: string,
  sourceTimestamp: number,
): Promise<ParsedEvent | null> {
  const phraseIntents = detectPhraseIntents(text);
  const active = getActiveLiveIncidents();
  const activeIncidentsJson = JSON.stringify(compactIncidentsForPrompt(active));

  const sinceUnix = sourceTimestamp - config.openai.contextWindowMin * 60;
  const channelCtx = getRecentChannelContext(
    sourceChannel,
    sinceUnix,
    config.openai.contextMessages,
    rawMessageId,
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(activeIncidentsJson) },
  ];

  for (const ex of FEW_SHOT_EXAMPLES) {
    messages.push({ role: 'user', content: ex.input });
    messages.push({ role: 'assistant', content: ex.output });
  }

  for (const row of channelCtx) {
    messages.push({ role: 'user', content: row.text });
    messages.push({
      role: 'assistant',
      content:
        row.parsedSummary != null
          ? `[prior parse summary] ${row.parsedSummary}`
          : '[no structured parse for prior message]',
    });
  }

  messages.push({ role: 'user', content: text });

  try {
    const response = await getClient().chat.completions.create({
      model: config.openai.model,
      max_tokens: 512,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      warnOpenAIFallback('empty_response');
      return null;
    }

    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = LLMEventSchema.parse(JSON.parse(jsonStr));

    const activeIds = new Set(active.map((i) => i.id));
    const continuesId =
      parsed.continues_incident_id && activeIds.has(parsed.continues_incident_id)
        ? parsed.continues_incident_id
        : null;

    let location = parsed.location ? resolveBestEffortLocation(parsed.location, rawMessageId) : null;
    let heading = parsed.heading ? resolveBestEffortLocation(parsed.heading, rawMessageId) : null;
    const via = parsed.via ? resolveBestEffortLocation(parsed.via, rawMessageId) : null;

    // Improve approximate placement for "X/Y" local shorthand:
    // use midpoint when both parts resolve, and keep second part as heading hint if missing.
    const slashPair = extractSlashPair(text);
    if (slashPair) {
      const left = resolveBestEffortLocation(slashPair[0], rawMessageId);
      const right = resolveBestEffortLocation(slashPair[1], rawMessageId);
      if (left && right) {
        const rawPair = `${slashPair[0]} / ${slashPair[1]}`;
        location = hasOnPairIntent(text)
          ? estimateApproachFromEnemySide(rawPair, left, right)
          : toCompositeLocation(rawPair, left, right);
        if (!heading) {
          heading = hasOnPairIntent(text)
            ? midpointPair(rawPair, left, right)
            : toCompositeLocation(rawPair, left, right);
        }
      } else if (!heading && !location) {
        location = left || right;
      } else if (!heading) {
        heading = right || left;
      }
    }

    // Let AI continuation fallback reconstruct usable geo from active incidents
    // before delegating to regex.
    if (parsed.event_type === 'tracking' && !location && !heading && !via) {
      const inferred = buildTrackingFallbackFromIncident(
        active,
        sourceChannel,
        sourceTimestamp,
        continuesId,
        parsed.continuation_confidence,
      );
      if (inferred) {
        location = inferred.location;
        heading = inferred.heading;
      } else {
        warnOpenAIFallback('tracking_without_geo');
        return null;
      }
    }

    // If fallback injected "Incident last point", but text contains explicit directional
    // hint (e.g. "летит дальше на Слатино"), treat it as heading-only update.
    if (
      parsed.event_type === 'tracking' &&
      isIncidentSyntheticPoint(location) &&
      (heading == null || isIncidentSyntheticPoint(heading)) &&
      hasContinuationCue(text, phraseIntents)
    ) {
      const hintedHeading = extractDirectionalHeadingHint(text, rawMessageId);
      if (hintedHeading) {
        heading = hintedHeading;
        location = null;
      }
    }

    return {
      id: uuid(),
      rawMessageId,
      eventType: parsed.event_type as EventType,
      weaponType: parsed.weapon_type as WeaponType,
      weaponCount: parsed.weapon_count,
      location,
      heading,
      via,
      confidence: parsed.confidence * 0.9,
      parserLayer: 'openai',
      isPreliminary: parsed.is_preliminary,
      isCorrection: parsed.is_correction,
      sourceChannel,
      sourceTimestamp,
      continuesIncidentId: continuesId,
      continuationConfidence: continuesId != null ? parsed.continuation_confidence : 0,
      isFollowup: parsed.is_followup,
      countDelta: parsed.count_delta,
      phraseIntents,
    };
  } catch (err) {
    warnOpenAIFallback(describeOpenAIError(err));
    return null;
  }
}
