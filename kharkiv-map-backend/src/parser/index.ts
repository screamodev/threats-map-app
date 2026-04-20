import { parseWithRegex } from './regex.js';
import { parseWithOpenAI } from './openai.js';
import { containsAirDefenseInfo } from '../security/filter.js';
import { insertParsedEvent, markMessageProcessed } from '../db/client.js';
import type { ParsedEvent } from './types.js';
import { config } from '../config.js';

/**
 * Two-layer parser: OpenAI first when configured, regex fallback on null or API/parse errors.
 */
export async function parseMessage(
  text: string,
  rawMessageId: number,
  sourceChannel: string,
  sourceTimestamp: number,
): Promise<ParsedEvent | null> {
  // Security filter first
  const filteredOut = containsAirDefenseInfo(text);
  if (filteredOut) {
    console.warn(`[filter] Air defense mention filtered from ${sourceChannel}`);
    // Still store the event but mark as filtered
    const event = parseWithRegex(text, rawMessageId, sourceChannel, sourceTimestamp);
    if (event) {
      insertParsedEvent({
        id: event.id,
        rawMessageId: event.rawMessageId,
        eventType: event.eventType,
        weaponType: event.weaponType,
        weaponCount: event.weaponCount,
        locationName: event.location?.rawName || null,
        locationLat: event.location?.lat || null,
        locationLng: event.location?.lng || null,
        headingName: event.heading?.rawName || null,
        headingLat: event.heading?.lat || null,
        headingLng: event.heading?.lng || null,
        viaName: event.via?.rawName || null,
        viaLat: event.via?.lat || null,
        viaLng: event.via?.lng || null,
        confidence: event.confidence,
        parserLayer: event.parserLayer,
        isPreliminary: event.isPreliminary,
        isCorrection: event.isCorrection,
        incidentId: null,
        filteredOut: true,
      });
    }
    markMessageProcessed(rawMessageId, 1);
    return null;
  }

  let event: ParsedEvent | null = null;

  if (config.openai.apiKey) {
    event = await parseWithOpenAI(text, rawMessageId, sourceChannel, sourceTimestamp);
  }

  if (!event) {
    event = parseWithRegex(text, rawMessageId, sourceChannel, sourceTimestamp);
  }

  if (!event) {
    markMessageProcessed(rawMessageId, 2); // failed
    return null;
  }

  // Store parsed event
  insertParsedEvent({
    id: event.id,
    rawMessageId: event.rawMessageId,
    eventType: event.eventType,
    weaponType: event.weaponType,
    weaponCount: event.weaponCount,
    locationName: event.location?.rawName || null,
    locationLat: event.location?.lat || null,
    locationLng: event.location?.lng || null,
    headingName: event.heading?.rawName || null,
    headingLat: event.heading?.lat || null,
    headingLng: event.heading?.lng || null,
    viaName: event.via?.rawName || null,
    viaLat: event.via?.lat || null,
    viaLng: event.via?.lng || null,
    confidence: event.confidence,
    parserLayer: event.parserLayer,
    isPreliminary: event.isPreliminary,
    isCorrection: event.isCorrection,
    incidentId: null,
    filteredOut: false,
  });

  markMessageProcessed(rawMessageId, 1);
  return event;
}
