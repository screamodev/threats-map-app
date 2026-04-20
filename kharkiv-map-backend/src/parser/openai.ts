import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { config } from '../config.js';
import { getRecentChannelContext } from '../db/client.js';
import { getActiveLiveIncidents } from '../correlation/engine.js';
import type { LiveIncident } from '../correlation/engine.js';
import { resolve } from '../gazetteer/index.js';
import { getKnownPlaceNames } from '../gazetteer/index.js';
import type { ParsedEvent, EventType, WeaponType } from './types.js';

const LLMEventSchema = z.object({
  event_type: z.enum(['tracking', 'impact', 'correction', 'all_clear']),
  weapon_type: z.enum(['shahed', 'bpla', 's300', 'kab', 'iskander', 'missile', 'unknown']),
  weapon_count: z.number().int().min(0).default(1),
  location: z.string().nullable().default(null),
  heading: z.string().nullable().default(null),
  via: z.string().nullable().default(null),
  is_preliminary: z.boolean().default(false),
  is_correction: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
  continues_incident_id: z.string().nullable().default(null),
  continuation_confidence: z.number().min(0).max(1).default(0),
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

function buildSystemPrompt(activeIncidentsJson: string): string {
  const places = getKnownPlaceNames().join(', ');
  return `You are a parser for Ukrainian/Russian-language Telegram channel messages about military attacks on Kharkiv, Ukraine. Parse each message into a structured JSON event.

Known place names in Kharkiv oblast: ${places}

Currently active incidents (JSON array; use id values only from this list for continues_incident_id):
${activeIncidentsJson}

Output schema:
{
  "event_type": "tracking" | "impact" | "correction" | "all_clear",
  "weapon_type": "shahed" | "bpla" | "s300" | "kab" | "iskander" | "missile" | "unknown",
  "weapon_count": number (default 1),
  "location": string | null (current location of threat, use name from the known places list if possible),
  "heading": string | null (where it's heading, "курс на X"),
  "via": string | null (intermediate point, "через X"),
  "is_preliminary": boolean (true if "Предварительно"),
  "is_correction": boolean (true if "Уточнение"),
  "confidence": number 0.0-1.0,
  "continues_incident_id": string | null (id from active incidents if this message clearly updates the same threat; otherwise null),
  "continuation_confidence": number 0.0-1.0 (how sure the message refers to that incident; 0 if unrelated or new threat)
}

Guideline: Set continues_incident_id only when the message clearly continues or corrects a specific threat already listed above; otherwise null and continuation_confidence 0.

Key terminology:
- "БпЛА" / "Ударный БпЛА" = attack UAV/drone → weapon_type: "bpla"
- "Шахед" = Shahed drone → weapon_type: "shahed"
- "курсом на X" / "курс на X" = heading toward X → heading field
- "в районе X" = in the area of X → location field
- "Залетают на X" = entering X → location field
- "Взрыв/Взрывы" / 💥 = explosion → event_type: "impact"
- "направление на X" = heading toward X → heading field
- "через X на Y" = via X toward Y → via + heading fields
- "между X и Y" = between X and Y → location (pick the first one)

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
];

export async function parseWithOpenAI(
  text: string,
  rawMessageId: number,
  sourceChannel: string,
  sourceTimestamp: number,
): Promise<ParsedEvent | null> {
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

    return {
      id: uuid(),
      rawMessageId,
      eventType: parsed.event_type as EventType,
      weaponType: parsed.weapon_type as WeaponType,
      weaponCount: parsed.weapon_count,
      location: parsed.location ? resolve(parsed.location, rawMessageId) : null,
      heading: parsed.heading ? resolve(parsed.heading, rawMessageId) : null,
      via: parsed.via ? resolve(parsed.via, rawMessageId) : null,
      confidence: parsed.confidence * 0.9,
      parserLayer: 'openai',
      isPreliminary: parsed.is_preliminary,
      isCorrection: parsed.is_correction,
      sourceChannel,
      sourceTimestamp,
      continuesIncidentId: continuesId,
      continuationConfidence: continuesId != null ? parsed.continuation_confidence : 0,
    };
  } catch (err) {
    warnOpenAIFallback(describeOpenAIError(err));
    return null;
  }
}
