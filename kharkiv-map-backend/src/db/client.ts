import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.dbPath);
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    db.exec(schema);
    ensureRawMessagesColumns(db);
    ensureIncidentsColumns(db);
  }
  return db;
}

function ensureRawMessagesColumns(database: Database.Database): void {
  const cols = database
    .prepare("SELECT name FROM pragma_table_info('raw_messages')")
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('reply_to_telegram_id')) {
    database.exec('ALTER TABLE raw_messages ADD COLUMN reply_to_telegram_id INTEGER');
  }
  if (!names.has('grouped_id')) {
    database.exec('ALTER TABLE raw_messages ADD COLUMN grouped_id INTEGER');
  }
}

function ensureIncidentsColumns(database: Database.Database): void {
  const cols = database
    .prepare("SELECT name FROM pragma_table_info('incidents')")
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('projection_anchor')) {
    database.exec('ALTER TABLE incidents ADD COLUMN projection_anchor TEXT');
  }
}

// --- Raw messages ---

export function insertRawMessage(
  telegramId: number,
  channelId: number,
  channelName: string,
  text: string,
  timestamp: number,
  replyToTelegramId: number | null = null,
  groupedId: number | null = null,
): number {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO raw_messages (
      telegram_id, reply_to_telegram_id, grouped_id, channel_id, channel_name, text, timestamp
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    telegramId,
    replyToTelegramId,
    groupedId,
    channelId,
    channelName,
    text,
    timestamp,
  );
  // With INSERT OR IGNORE, lastInsertRowid can keep a previous unrelated value.
  // Return 0 for duplicates so callers can reliably skip re-processing.
  if ((result.changes as number) === 0) return 0;
  return Number(result.lastInsertRowid);
}

export function markMessageProcessed(id: number, status: number = 1): void {
  getDb().prepare('UPDATE raw_messages SET processed = ? WHERE id = ?').run(status, id);
}

export function getUnprocessedMessages(limit: number = 50) {
  return getDb()
    .prepare('SELECT * FROM raw_messages WHERE processed = 0 ORDER BY timestamp ASC LIMIT ?')
    .all(limit) as Array<{
    id: number;
    telegram_id: number;
    reply_to_telegram_id: number | null;
    grouped_id: number | null;
    channel_id: number;
    channel_name: string;
    text: string;
    timestamp: number;
  }>;
}

export interface RecentChannelContextRow {
  text: string;
  parsedSummary: string | null;
  eventId: string | null;
  incidentId: string | null;
  timestamp: number;
}

/**
 * Recent messages from the same channel within the time window, excluding the current row.
 * Newest-first limited in SQL, returned oldest-first for conversational order.
 */
export function getRecentChannelContext(
  channelName: string,
  sinceUnix: number,
  limit: number,
  excludeRawMessageId: number,
): RecentChannelContextRow[] {
  const cap = Math.min(Math.max(1, limit), 8);
  const rows = getDb()
    .prepare(
      `
    SELECT rm.text AS text,
           rm.timestamp AS timestamp,
           pe.id AS event_id,
           pe.incident_id AS incident_id,
           pe.event_type AS event_type,
           pe.weapon_type AS weapon_type,
           pe.location_name AS location_name,
           pe.heading_name AS heading_name
    FROM raw_messages rm
    LEFT JOIN parsed_events pe ON pe.raw_message_id = rm.id AND pe.filtered_out = 0
    WHERE rm.channel_name = ?
      AND rm.timestamp >= ?
      AND rm.id != ?
    ORDER BY rm.timestamp DESC
    LIMIT ?
  `,
    )
    .all(channelName, sinceUnix, excludeRawMessageId, cap) as Array<{
    text: string;
    timestamp: number;
    event_id: string | null;
    incident_id: string | null;
    event_type: string | null;
    weapon_type: string | null;
    location_name: string | null;
    heading_name: string | null;
  }>;

  const mapped: RecentChannelContextRow[] = rows.reverse().map((r) => ({
    text: r.text,
    timestamp: r.timestamp,
    eventId: r.event_id,
    incidentId: r.incident_id,
    parsedSummary: r.event_id
      ? [
          r.event_type,
          r.weapon_type,
          r.location_name ? `loc:${r.location_name}` : null,
          r.heading_name ? `→${r.heading_name}` : null,
          r.incident_id ? `inc:${r.incident_id}` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : null,
  }));

  return mapped;
}

// --- Parsed events ---

export function insertParsedEvent(event: {
  id: string;
  rawMessageId: number;
  eventType: string;
  weaponType: string | null;
  weaponCount: number;
  locationName: string | null;
  locationLat: number | null;
  locationLng: number | null;
  headingName: string | null;
  headingLat: number | null;
  headingLng: number | null;
  viaName: string | null;
  viaLat: number | null;
  viaLng: number | null;
  confidence: number;
  parserLayer: string;
  isPreliminary: boolean;
  isCorrection: boolean;
  incidentId: string | null;
  filteredOut: boolean;
}): void {
  getDb().prepare(`
    INSERT INTO parsed_events
    (id, raw_message_id, event_type, weapon_type, weapon_count,
     location_name, location_lat, location_lng,
     heading_name, heading_lat, heading_lng,
     via_name, via_lat, via_lng,
     confidence, parser_layer, is_preliminary, is_correction,
     incident_id, filtered_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.rawMessageId, event.eventType, event.weaponType, event.weaponCount,
    event.locationName, event.locationLat, event.locationLng,
    event.headingName, event.headingLat, event.headingLng,
    event.viaName, event.viaLat, event.viaLng,
    event.confidence, event.parserLayer,
    event.isPreliminary ? 1 : 0, event.isCorrection ? 1 : 0,
    event.incidentId, event.filteredOut ? 1 : 0,
  );
}

export function setEventIncidentId(eventId: string, incidentId: string): void {
  getDb().prepare('UPDATE parsed_events SET incident_id = ? WHERE id = ?').run(incidentId, eventId);
}

/**
 * Resolve an incident via a Telegram parent message link inside the same channel.
 * Returns the most recent parsed event incident id for that parent telegram message.
 */
export function getIncidentIdByReplyParent(
  channelName: string,
  parentTelegramId: number,
): string | null {
  const row = getDb()
    .prepare(
      `
    SELECT pe.incident_id AS incident_id
    FROM raw_messages rm
    JOIN parsed_events pe ON pe.raw_message_id = rm.id
    WHERE rm.channel_name = ?
      AND rm.telegram_id = ?
      AND pe.filtered_out = 0
      AND pe.incident_id IS NOT NULL
    ORDER BY pe.created_at DESC
    LIMIT 1
  `,
    )
    .get(channelName, parentTelegramId) as { incident_id: string } | undefined;
  return row?.incident_id ?? null;
}

// --- Incidents ---

export interface IncidentRow {
  id: string;
  weapon_type: string;
  weapon_count: number;
  status: string;
  first_seen_at: number;
  last_updated_at: number;
  source_channels: string;
  confidence: number;
  trajectory: string;
  projection_anchor: string | null;
}

export function insertIncident(incident: {
  id: string;
  weaponType: string;
  weaponCount: number;
  status: string;
  firstSeenAt: number;
  lastUpdatedAt: number;
  sourceChannels: string[];
  confidence: number;
  trajectory: Array<{ lat: number; lng: number; timestamp: number; name: string }>;
  projectionAnchor?: { lat: number; lng: number; timestamp: number; name: string } | null;
}): void {
  getDb().prepare(`
    INSERT INTO incidents (
      id, weapon_type, weapon_count, status, first_seen_at, last_updated_at,
      source_channels, confidence, trajectory, projection_anchor
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    incident.id, incident.weaponType, incident.weaponCount, incident.status,
    incident.firstSeenAt, incident.lastUpdatedAt,
    JSON.stringify(incident.sourceChannels), incident.confidence,
    JSON.stringify(incident.trajectory),
    incident.projectionAnchor ? JSON.stringify(incident.projectionAnchor) : null,
  );
}

export function updateIncident(id: string, updates: {
  status?: string;
  lastUpdatedAt?: number;
  weaponCount?: number;
  sourceChannels?: string[];
  confidence?: number;
  trajectory?: Array<{ lat: number; lng: number; timestamp: number; name: string }>;
  projectionAnchor?: { lat: number; lng: number; timestamp: number; name: string } | null;
}): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.lastUpdatedAt !== undefined) { sets.push('last_updated_at = ?'); values.push(updates.lastUpdatedAt); }
  if (updates.weaponCount !== undefined) { sets.push('weapon_count = ?'); values.push(updates.weaponCount); }
  if (updates.sourceChannels !== undefined) { sets.push('source_channels = ?'); values.push(JSON.stringify(updates.sourceChannels)); }
  if (updates.confidence !== undefined) { sets.push('confidence = ?'); values.push(updates.confidence); }
  if (updates.trajectory !== undefined) { sets.push('trajectory = ?'); values.push(JSON.stringify(updates.trajectory)); }
  if (updates.projectionAnchor !== undefined) {
    sets.push('projection_anchor = ?');
    values.push(updates.projectionAnchor ? JSON.stringify(updates.projectionAnchor) : null);
  }

  if (sets.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getActiveIncidents(): IncidentRow[] {
  return getDb()
    .prepare("SELECT * FROM incidents WHERE status IN ('active', 'impact') ORDER BY last_updated_at DESC")
    .all() as IncidentRow[];
}

export function getRecentIncidents(hours: number = 24): IncidentRow[] {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  return getDb()
    .prepare('SELECT * FROM incidents WHERE last_updated_at > ? ORDER BY last_updated_at DESC')
    .all(since) as IncidentRow[];
}

export function clearAllIncidents(): number {
  const result = getDb().prepare('DELETE FROM incidents').run();
  return result.changes;
}

export function getStaleActiveIncidents(maxAgeSeconds: number = 1800): IncidentRow[] {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  return getDb()
    .prepare("SELECT * FROM incidents WHERE status = 'active' AND last_updated_at < ?")
    .all(cutoff) as IncidentRow[];
}

// --- Gazetteer ---

export function insertGazetteerEntry(entry: {
  canonical: string;
  lat: number;
  lng: number;
  type: string;
  parent: string | null;
  aliases: string[];
}): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO gazetteer (canonical, lat, lng, type, parent, aliases)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entry.canonical, entry.lat, entry.lng, entry.type, entry.parent, JSON.stringify(entry.aliases));
}

export function getAllGazetteerEntries() {
  return getDb().prepare('SELECT * FROM gazetteer').all() as Array<{
    id: number;
    canonical: string;
    lat: number;
    lng: number;
    type: string;
    parent: string | null;
    aliases: string;
  }>;
}

export function clearGazetteerEntries(): void {
  getDb().prepare('DELETE FROM gazetteer').run();
}

// --- Unmatched locations ---

export function logUnmatchedLocation(name: string, messageId?: number): void {
  getDb().prepare(`
    INSERT INTO unmatched_locations (name) VALUES (?)
    ON CONFLICT(name) DO UPDATE SET occurrence_count = occurrence_count + 1
  `).run(name);
}

export function getImpactHeatmap(hours: number = 24) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  return getDb().prepare(`
    SELECT location_lat as lat, location_lng as lng, COUNT(*) as count
    FROM parsed_events
    WHERE event_type = 'impact' AND location_lat IS NOT NULL AND created_at > ? AND filtered_out = 0
    GROUP BY ROUND(location_lat, 3), ROUND(location_lng, 3)
  `).all(since) as Array<{ lat: number; lng: number; count: number }>;
}
