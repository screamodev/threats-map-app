import { getDb } from './db/client.js';
import { seedGazetteer, rebuildAliasMap } from './gazetteer/index.js';
import { startServer } from './api/server.js';
import { startListening } from './telegram/listener.js';
import { parseMessage } from './parser/index.js';
import { correlateEvent, expireStaleIncidents, getActiveLiveIncidents } from './correlation/engine.js';
import {
  broadcastNewIncident,
  broadcastIncidentUpdate,
  broadcastIncidentExpire,
  broadcastDistrictRisk,
} from './api/ws.js';
import { computeDistrictRisk } from './districts/risk.js';
import { config } from './config.js';

function recomputeAndBroadcastDistrictRisk(): void {
  const active = getActiveLiveIncidents();
  const levels = Object.fromEntries(computeDistrictRisk(active));
  broadcastDistrictRisk(levels);
}

async function main() {
  console.log('[init] Starting Kharkiv Threat Map backend...');

  // Initialize database
  console.log('[init] Database initialized at:', config.dbPath);
  getDb();

  // Seed gazetteer if empty
  const { getAllGazetteerEntries } = await import('./db/client.js');
  if (getAllGazetteerEntries().length === 0) {
    console.log('[init] Seeding gazetteer...');
    seedGazetteer();
    console.log('[init] Gazetteer seeded');
  } else {
    rebuildAliasMap();
    console.log('[init] Gazetteer loaded');
  }

  // Start API server
  await startServer();

  // Start Telegram listener (if configured)
  if (config.tg.apiId && config.tg.apiHash) {
    try {
      await startListening(async (text, rawMessageId, channelName, timestamp) => {
        const event = await parseMessage(text, rawMessageId, channelName, timestamp);
        if (!event) {
          console.log(`[pipeline] parse returned null for msg ${rawMessageId} (security filter, no useful fields, or LLM disabled)`);
          return;
        }
        console.log(
          `[pipeline] parsed event: type=${event.eventType} weapon=${event.weaponType}x${event.weaponCount} ` +
          `loc=${event.location?.canonicalName ?? '-'} heading=${event.heading?.canonicalName ?? '-'} ` +
          `via=${event.via?.canonicalName ?? '-'} conf=${event.confidence.toFixed(2)} layer=${event.parserLayer}`,
        );

        const result = correlateEvent(event);
        if (!result) {
          console.log('[pipeline] correlator dropped event (no location and no heading for tracking)');
          return;
        }
        console.log(
          `[pipeline] correlator action=${result.action} incidentId=${result.incident.id} ` +
          `trajectoryPoints=${result.incident.trajectory.length} status=${result.incident.status}`,
        );

        if (result.action === 'new') {
          broadcastNewIncident(result.incident);
          recomputeAndBroadcastDistrictRisk();
        } else if (result.action === 'update') {
          broadcastIncidentUpdate(result.incident);
          recomputeAndBroadcastDistrictRisk();
        }
      });
    } catch (err) {
      console.error('[telegram] Failed to start listener:', err);
      console.log('[telegram] Running in API-only mode (no Telegram)');
    }
  } else {
    console.log('[init] Telegram not configured, running in API-only mode');
  }

  // Expire stale incidents every 60 seconds
  setInterval(() => {
    const expired = expireStaleIncidents();
    for (const id of expired) {
      broadcastIncidentExpire(id);
      console.log(`[correlation] Expired incident ${id}`);
    }
    if (expired.length > 0) {
      recomputeAndBroadcastDistrictRisk();
    }
  }, 60_000);

  console.log('[init] Backend ready');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
