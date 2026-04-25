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
import { applyNonDroneDistrictAlert, computeDistrictRisk } from './districts/risk.js';
import { config } from './config.js';
import type { WeaponType } from './parser/types.js';

const TRACKED_AERIAL_WEAPON_TYPES = new Set<WeaponType>([
  'bpla',
  'shahed',
  'molniya',
  'fpv',
  'lancet',
  'unknown',
]);

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

  // Sync gazetteer from seed on each start so new aliases/places apply immediately.
  console.log('[init] Syncing gazetteer seed...');
  seedGazetteer();
  rebuildAliasMap();
  console.log('[init] Gazetteer synced');

  // Start API server
  await startServer();

  // Start Telegram listener (if configured)
  if (config.tg.apiId && config.tg.apiHash) {
    try {
      await startListening(async (text, rawMessageId, channelName, timestamp, replyToTelegramId, groupedId) => {
        const event = await parseMessage(
          text,
          rawMessageId,
          channelName,
          timestamp,
          replyToTelegramId,
          groupedId,
        );
        if (!event) {
          console.log(`[pipeline] parse returned null for msg ${rawMessageId} (security filter, no useful fields, or LLM disabled)`);
          return;
        }
        console.log(
          `[pipeline] parsed event: type=${event.eventType} weapon=${event.weaponType}x${event.weaponCount} ` +
          `loc=${event.location?.canonicalName ?? '-'} heading=${event.heading?.canonicalName ?? '-'} ` +
          `via=${event.via?.canonicalName ?? '-'} ` +
          `loc@=${event.location ? `${event.location.lat.toFixed(4)},${event.location.lng.toFixed(4)}` : '-'} ` +
          `head@=${event.heading ? `${event.heading.lat.toFixed(4)},${event.heading.lng.toFixed(4)}` : '-'} ` +
          `conf=${event.confidence.toFixed(2)} layer=${event.parserLayer}`,
        );

        if (!TRACKED_AERIAL_WEAPON_TYPES.has(event.weaponType)) {
          if (event.eventType !== 'all_clear') {
            const affectedDistricts = applyNonDroneDistrictAlert(event);
            console.log(
              `[pipeline] non-drone alert mapped to districts (${affectedDistricts.length}) weapon=${event.weaponType} event=${event.eventType}`,
            );
            recomputeAndBroadcastDistrictRisk();
          } else {
            console.log('[pipeline] skipping non-drone all-clear event');
          }
          return;
        }

        const result = correlateEvent(event);
        if (!result) {
          console.log('[pipeline] correlator dropped event (no location and no heading for tracking)');
          return;
        }
        console.log(
          `[pipeline] correlator action=${result.action} incidentId=${result.incident.id} ` +
          `trajectoryPoints=${result.incident.trajectory.length} status=${result.incident.status}`,
        );
        console.log(
          `[pipeline] continuation decision reason=${result.diagnostics.decisionReason} ` +
          `best=${result.diagnostics.bestScore.toFixed(2)} second=${result.diagnostics.secondBestScore.toFixed(2)} ` +
          `threshold=${result.diagnostics.attachThreshold.toFixed(2)} ` +
          `eventHasGeo=${result.diagnostics.eventHasGeo} weakGeoFollowup=${result.diagnostics.weakGeoFollowup} ` +
          `countDeltaApplied=${result.diagnostics.countDeltaApplied}`,
        );
        if (result.diagnostics.candidateScores.length > 0) {
          const topCandidates = result.diagnostics.candidateScores
            .map((candidate, idx) => (
              `${idx + 1})${candidate.incidentId}:${candidate.score.toFixed(2)}[` +
              `${candidate.reasons.join('|') || '-'}]`
            ))
            .join(' ; ');
          console.log(`[pipeline] continuation candidates ${topCandidates}`);
        }

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
