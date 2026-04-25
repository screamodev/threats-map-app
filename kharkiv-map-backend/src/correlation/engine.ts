import { v4 as uuid } from 'uuid';
import {
  getActiveIncidents,
  insertIncident,
  updateIncident,
  setEventIncidentId,
  getStaleActiveIncidents,
  getIncidentIdByReplyParent,
  type IncidentRow,
} from '../db/client.js';
import type { ResolvedLocation } from '../gazetteer/index.js';
import { resolve as resolvePlace } from '../gazetteer/index.js';
import type { ParsedEvent, WeaponType } from '../parser/types.js';
import { WEAPON_LABELS, WEAPON_COLORS, WEAPON_SPEED_KMH } from '../parser/types.js';

export type LocationScope = 'kharkiv-city' | 'oblast' | 'external';

/** Kharkiv city district short names (parent of neighborhoods / metro / etc.). */
const KHARKIV_DISTRICT_PARENTS = new Set([
  'Шевченківський',
  'Київський',
  'Салтівський',
  'Холодногірський',
  'Новобаварський',
  "Основ'янський",
  'Слобідський',
  'Немишлянський',
  'Індустріальний',
]);

const CONTINUATION_CONFIDENCE_MIN = 0.6;
const BASE_ATTACH_SCORE_MIN = 0.5;
const LOW_GEO_ATTACH_SCORE_MIN = 0.35;
const CHANNEL_RECENT_WINDOW_SEC = 3 * 60;
const ACTIVE_WINDOW_SEC = 20 * 60;
const KHARKIV_CITY_CENTER = { lat: 49.9935, lng: 36.2304 };
const SINGLE_POINT_HEADING_FALLBACK_KM = 14;
const INGRESS_ORIGIN_DISTANCE_KM: Partial<Record<WeaponType, number>> = {
  kab: 28,
  missile: 45,
  ballistic: 70,
  iskander: 70,
  s300: 55,
  rszo: 25,
};
const WEAPONS_WITH_INFERRED_INGRESS = new Set<WeaponType>(Object.keys(INGRESS_ORIGIN_DISTANCE_KM) as WeaponType[]);

const recentIncidentByChannel = new Map<string, { incidentId: string; timestamp: number }>();

export interface LiveIncident {
  id: string;
  weaponType: WeaponType;
  weaponTypeLabel: string;
  weaponCount: number;
  status: 'active' | 'impact' | 'expired';
  trajectory: Array<{ lat: number; lng: number; timestamp: number; name: string }>;
  projectionAnchor: { lat: number; lng: number; timestamp: number; name: string } | null;
  currentHeading: { lat: number; lng: number; name: string } | null;
  /** Bearing from last trajectory point toward currentHeading (degrees, 0–360). */
  bearingDeg: number | null;
  /** Approximate cruise speed from weapon table (km/h). */
  speedKmh: number;
  /** Time to reach heading target at cruise speed, or null if unknown. */
  etaSeconds: number | null;
  locationScope: LocationScope;
  /** Gazetteer place type for the head point (e.g. neighborhood, village). */
  locationType: string;
  confidence: number;
  sourceChannels: string[];
  firstSeenAt: number;
  lastUpdatedAt: number;
  color: string;
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

/** Destination point ~`distanceKm` along initial bearing from (lat, lng). */
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

function deriveLocationScope(loc: ResolvedLocation | null): { scope: LocationScope; locationType: string } {
  if (!loc) {
    return { scope: 'external', locationType: 'unknown' };
  }
  const locationType = loc.type;
  if (loc.parent === 'Харків') {
    return { scope: 'kharkiv-city', locationType };
  }
  if (loc.type === 'district' && loc.parent === 'Харків') {
    return { scope: 'kharkiv-city', locationType };
  }
  if (loc.parent && KHARKIV_DISTRICT_PARENTS.has(loc.parent)) {
    return { scope: 'kharkiv-city', locationType };
  }
  if (loc.parent === 'Харківська область' || (loc.parent?.includes('громада') ?? false)) {
    return { scope: 'oblast', locationType };
  }
  if ((loc.type === 'village' || loc.type === 'city') && loc.parent && loc.parent !== 'Харків') {
    if (!KHARKIV_DISTRICT_PARENTS.has(loc.parent)) {
      return { scope: 'oblast', locationType };
    }
  }
  if (loc.parent == null && loc.type === 'city') {
    return { scope: 'external', locationType };
  }
  return { scope: 'external', locationType };
}

type TrajectoryPoint = { lat: number; lng: number; timestamp: number; name: string };
type ProjectionAnchor = { lat: number; lng: number; timestamp: number; name: string };

function parseProjectionAnchor(value: string | null): ProjectionAnchor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ProjectionAnchor;
    if (
      parsed &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng) &&
      Number.isFinite(parsed.timestamp)
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed historical rows.
  }
  return null;
}

function projectAnchorAt(
  anchor: ProjectionAnchor,
  bearingDeg: number | null,
  speedKmh: number,
  fromTimestamp: number,
  targetTimestamp: number,
): ProjectionAnchor {
  if (bearingDeg == null || speedKmh <= 0 || targetTimestamp <= fromTimestamp) {
    return anchor;
  }
  const elapsedSec = targetTimestamp - fromTimestamp;
  const distanceKm = (speedKmh * elapsedSec) / 3600;
  const projected = destinationKm(anchor.lat, anchor.lng, bearingDeg, distanceKm);
  return {
    lat: projected.lat,
    lng: projected.lng,
    timestamp: targetTimestamp,
    name: anchor.name,
  };
}

function inferIngressOriginForHeadingOnly(
  heading: ResolvedLocation,
  weaponType: WeaponType,
): { lat: number; lng: number } | null {
  if (!WEAPONS_WITH_INFERRED_INGRESS.has(weaponType)) return null;
  const ingressDistanceKm = INGRESS_ORIGIN_DISTANCE_KM[weaponType];
  if (!ingressDistanceKm) return null;

  // Use heading target as destination and back-project from the opposite side
  // of the city vector (typically border/enemy side for north/east oblast alerts).
  const toCity = bearing(
    heading.lat,
    heading.lng,
    KHARKIV_CITY_CENTER.lat,
    KHARKIV_CITY_CENTER.lng,
  );
  const ingressBearing = (toCity + 180) % 360;
  return destinationKm(heading.lat, heading.lng, ingressBearing, ingressDistanceKm);
}

function enrichLiveFields(
  trajectory: TrajectoryPoint[],
  projectionAnchor: ProjectionAnchor | null,
  weaponType: WeaponType,
  explicitHeading: ResolvedLocation | null,
  scopeSource: ResolvedLocation | null
): Pick<
  LiveIncident,
  | 'currentHeading'
  | 'bearingDeg'
  | 'speedKmh'
  | 'etaSeconds'
  | 'locationScope'
  | 'locationType'
> {
  const speedKmh = WEAPON_SPEED_KMH[weaponType] ?? WEAPON_SPEED_KMH.unknown;
  const last = trajectory[trajectory.length - 1];
  const prev = trajectory.length >= 2 ? trajectory[trajectory.length - 2] : null;
  const projectionBase = projectionAnchor ?? last ?? null;

  let resolvedForScope = scopeSource;
  if (!resolvedForScope && last?.name) {
    resolvedForScope = resolvePlace(last.name);
  }
  const { scope: locationScope, locationType } = deriveLocationScope(resolvedForScope);

  let currentHeading: { lat: number; lng: number; name: string } | null = null;
  let projectionAllowed = true;
  if (explicitHeading) {
    const headingEqualsProjectionBase =
      !!projectionBase &&
      Math.abs(projectionBase.lat - explicitHeading.lat) < 0.00001 &&
      Math.abs(projectionBase.lng - explicitHeading.lng) < 0.00001;

    if (headingEqualsProjectionBase && !prev) {
      // Heading-only reports with a single resolved point usually indicate target area,
      // not a reliable motion segment. Keep marker at the mentioned location.
      projectionAllowed = false;
      const inferredBearing = bearing(
        explicitHeading.lat,
        explicitHeading.lng,
        KHARKIV_CITY_CENTER.lat,
        KHARKIV_CITY_CENTER.lng,
      );
      const inferred = destinationKm(
        explicitHeading.lat,
        explicitHeading.lng,
        inferredBearing,
        SINGLE_POINT_HEADING_FALLBACK_KM,
      );
      currentHeading = {
        lat: inferred.lat,
        lng: inferred.lng,
        name: explicitHeading.canonicalName,
      };
    } else {
      currentHeading = {
        lat: explicitHeading.lat,
        lng: explicitHeading.lng,
        name: explicitHeading.canonicalName,
      };
    }
  } else if (prev && last) {
    const segDistKm = haversineKm(prev.lat, prev.lng, last.lat, last.lng);
    if (segDistKm >= 0.15) {
      const segBearing = bearing(prev.lat, prev.lng, last.lat, last.lng);
      const dest = destinationKm(last.lat, last.lng, segBearing, 12);
      currentHeading = { lat: dest.lat, lng: dest.lng, name: '' };
    }
  }

  let bearingDeg: number | null = null;
  let etaSeconds: number | null = null;
  if (projectionBase && currentHeading) {
    bearingDeg = bearing(projectionBase.lat, projectionBase.lng, currentHeading.lat, currentHeading.lng);
    if (projectionAllowed && speedKmh > 0) {
      const distKm = haversineKm(projectionBase.lat, projectionBase.lng, currentHeading.lat, currentHeading.lng);
      etaSeconds = Math.round((distKm / speedKmh) * 3600);
    }
  }

  return {
    currentHeading,
    bearingDeg,
    speedKmh,
    etaSeconds,
    locationScope,
    locationType,
  };
}

const DRONE_TYPES: WeaponType[] = ['bpla', 'shahed'];

function areBothDrones(a: WeaponType, b: WeaponType): boolean {
  return DRONE_TYPES.includes(a) && DRONE_TYPES.includes(b);
}

function rowToLive(row: IncidentRow): LiveIncident {
  const trajectory = JSON.parse(row.trajectory) as TrajectoryPoint[];
  const projectionAnchor = parseProjectionAnchor(row.projection_anchor);
  const last = trajectory[trajectory.length - 1];
  const scopeSource = last?.name ? resolvePlace(last.name) : null;
  const weaponType = row.weapon_type as WeaponType;
  const enrich = enrichLiveFields(trajectory, projectionAnchor, weaponType, null, scopeSource);
  return {
    id: row.id,
    weaponType,
    weaponTypeLabel: WEAPON_LABELS[weaponType] || row.weapon_type,
    weaponCount: row.weapon_count,
    status: row.status as 'active' | 'impact' | 'expired',
    trajectory,
    projectionAnchor,
    ...enrich,
    confidence: row.confidence,
    sourceChannels: JSON.parse(row.source_channels),
    firstSeenAt: row.first_seen_at,
    lastUpdatedAt: row.last_updated_at,
    color: WEAPON_COLORS[weaponType] || '#888',
  };
}

export type CorrelationResult =
  | { action: 'new'; incident: LiveIncident; diagnostics: CorrelationDiagnostics }
  | { action: 'update'; incident: LiveIncident; diagnostics: CorrelationDiagnostics }
  | null;

export interface CandidateScoreBreakdown {
  incidentId: string;
  score: number;
  reasons: string[];
}

export interface CorrelationDiagnostics {
  decisionReason: string;
  bestScore: number;
  secondBestScore: number;
  attachThreshold: number;
  eventHasGeo: boolean;
  weakGeoFollowup: boolean;
  countDeltaApplied: number;
  candidateScores: CandidateScoreBreakdown[];
  phraseIntentHints: string[];
}

type CorrelationIntentHint = 'heading_change' | 'continuation' | 'additional_unit' | 'correction';

function extractCorrelationIntentHints(event: ParsedEvent): Set<CorrelationIntentHint> {
  const hints = new Set<CorrelationIntentHint>();
  const intents = event.phraseIntents ?? [];
  for (const intent of intents) {
    if (
      intent === 'heading_change' ||
      intent === 'continuation' ||
      intent === 'additional_unit' ||
      intent === 'correction'
    ) {
      hints.add(intent);
    }
  }
  if (event.isCorrection) {
    hints.add('correction');
  }
  if (event.isFollowup) {
    hints.add('continuation');
  }
  if ((event.countDelta ?? 0) > 0) {
    hints.add('additional_unit');
  }
  return hints;
}

function rememberChannelIncident(channel: string, incidentId: string, timestamp: number): void {
  const current = recentIncidentByChannel.get(channel);
  if (!current || timestamp >= current.timestamp) {
    recentIncidentByChannel.set(channel, { incidentId, timestamp });
  }
}

function getRecentChannelIncident(channel: string, eventTimestamp: number): string | null {
  const cached = recentIncidentByChannel.get(channel);
  if (!cached) return null;
  if (eventTimestamp - cached.timestamp > CHANNEL_RECENT_WINDOW_SEC) {
    recentIncidentByChannel.delete(channel);
    return null;
  }
  return cached.incidentId;
}

/**
 * Correlate a parsed event with existing incidents or create a new one.
 */
export function correlateEvent(event: ParsedEvent): CorrelationResult {
  if (!event.location && !event.via && !event.heading && event.eventType === 'tracking') {
    return null; // not enough info to correlate
  }

  const activeRows = getActiveIncidents();

  let replyLinkedRow: IncidentRow | null = null;
  if (event.replyToTelegramId != null) {
    const parentIncidentId = getIncidentIdByReplyParent(event.sourceChannel, event.replyToTelegramId);
    if (parentIncidentId) {
      replyLinkedRow = activeRows.find((r) => r.id === parentIncidentId) ?? null;
    }
  }

  let forcedRow: IncidentRow | null = null;
  if (!replyLinkedRow &&
    event.continuesIncidentId &&
    (event.continuationConfidence ?? 0) >= CONTINUATION_CONFIDENCE_MIN
  ) {
    forcedRow = activeRows.find((r) => r.id === event.continuesIncidentId) ?? null;
  }

  let bestScore = 0;
  let secondBestScore = 0;
  let bestRow: IncidentRow | null = null;
  const candidateScores: CandidateScoreBreakdown[] = [];
  let decisionReason = 'new_incident';
  const normalizedCountDelta = Math.max(0, event.countDelta ?? 0);
  const intentHints = extractCorrelationIntentHints(event);
  const countDeltaWithExplicitLocation =
    event.eventType === 'tracking' &&
    normalizedCountDelta > 0 &&
    !!event.location;

  if (replyLinkedRow) {
    bestScore = 1.2;
    bestRow = replyLinkedRow;
    decisionReason = 'reply_link';
    candidateScores.push({
      incidentId: replyLinkedRow.id,
      score: bestScore,
      reasons: ['reply_link'],
    });
  } else if (forcedRow) {
    bestScore = 1;
    bestRow = forcedRow;
    decisionReason = 'llm_link';
    candidateScores.push({
      incidentId: forcedRow.id,
      score: bestScore,
      reasons: ['llm_link'],
    });
  }

  if (!replyLinkedRow && !forcedRow) {
    const eventLat = event.location?.lat || event.via?.lat || event.heading?.lat;
    const eventLng = event.location?.lng || event.via?.lng || event.heading?.lng;
    const eventHasGeo = eventLat != null && eventLng != null;
    const missingWeaponType = event.weaponType === 'unknown';
    const recentChannelIncidentId = getRecentChannelIncident(event.sourceChannel, event.sourceTimestamp);

    for (const row of activeRows) {
      let score = 0;
      const reasons: string[] = [];
      const trajectory = JSON.parse(row.trajectory) as Array<{ lat: number; lng: number; timestamp: number; name: string }>;
      const sourceChannels = JSON.parse(row.source_channels) as string[];
      const sameChannel = sourceChannels.includes(event.sourceChannel);

      // Time window
      const timeDelta = event.sourceTimestamp - row.last_updated_at;
      if (timeDelta > ACTIVE_WINDOW_SEC) continue;
      if (timeDelta < 3 * 60) {
        score += 0.35;
        reasons.push('recent_3m');
      } else if (timeDelta < 7 * 60) {
        score += 0.25;
        reasons.push('recent_7m');
      } else {
        score += 0.1;
        reasons.push('recent_active_window');
      }

      if (sameChannel) {
        score += 0.2;
        reasons.push('same_channel');
      }

      // Weapon type match
      if (event.weaponType === row.weapon_type) {
        score += 0.35;
        reasons.push('weapon_exact');
      } else if (areBothDrones(event.weaponType, row.weapon_type as WeaponType)) {
        score += 0.15;
        reasons.push('weapon_drone_family');
      } else if (missingWeaponType) {
        score += 0.1;
        reasons.push('weapon_missing_softmatch');
      }

      // Spatial continuity
      const lastPos = trajectory[trajectory.length - 1];
      if (lastPos && eventHasGeo) {
        const dist = haversineKm(eventLat, eventLng, lastPos.lat, lastPos.lng);
        if (dist < 5) {
          score += 0.3;
          reasons.push('distance_lt_5km');
        } else if (dist < 15) {
          score += 0.15;
          reasons.push('distance_lt_15km');
        } else if (dist > 30) {
          score -= 0.2;
          reasons.push('distance_gt_30km_penalty');
        }
      }

      // Heading alignment
      if (event.heading && trajectory.length >= 2) {
        const prev = trajectory[trajectory.length - 2];
        const last = trajectory[trajectory.length - 1];
        const segmentDistanceKm = haversineKm(prev.lat, prev.lng, last.lat, last.lng);
        if (segmentDistanceKm >= 0.15) {
          const prevBearing = bearing(prev.lat, prev.lng, last.lat, last.lng);
          const newBearing = bearing(last.lat, last.lng, event.heading.lat, event.heading.lng);
          const angleDiff = Math.abs(prevBearing - newBearing);
          if (angleDiff < 30 || angleDiff > 330) {
            score += 0.1;
            reasons.push('bearing_alignment');
          }
        }
      }

      if (event.isFollowup) {
        score += 0.2;
        reasons.push('followup_phrase');
      }
      if (intentHints.has('continuation')) {
        score += 0.15;
        reasons.push('intent_continuation');
      }
      if (intentHints.has('additional_unit') && sameChannel && timeDelta < 12 * 60) {
        score += 0.18;
        reasons.push('intent_additional_unit');
      }
      if (intentHints.has('heading_change') && event.heading && !event.location && timeDelta < 12 * 60) {
        score += 0.1;
        reasons.push('intent_heading_change');
      }
      if (intentHints.has('correction')) {
        score += 0.08;
        reasons.push('intent_correction');
      }
      if (missingWeaponType && sameChannel && timeDelta < 7 * 60) {
        score += 0.25;
        reasons.push('missing_weapon_continuation_boost');
      }
      if (recentChannelIncidentId && row.id === recentChannelIncidentId) {
        score += 0.2;
        reasons.push('channel_recent_tiebreak');
      }
      if (normalizedCountDelta > 0 && sameChannel && timeDelta < 10 * 60) {
        score += 0.35;
        reasons.push('count_delta_followup');
      }

      // Count consistency
      if (event.weaponCount === row.weapon_count) {
        score += 0.05;
        reasons.push('count_consistency');
      }

      // Correction bonus
      if (event.isCorrection) {
        score += 0.1;
        reasons.push('correction_bonus');
      }

      candidateScores.push({
        incidentId: row.id,
        score,
        reasons,
      });

      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestRow = row;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }
  }

  const eventLat = event.location?.lat || event.via?.lat || event.heading?.lat;
  const eventLng = event.location?.lng || event.via?.lng || event.heading?.lng;
  const eventHasGeo = eventLat != null && eventLng != null;
  const weakGeoFollowup = !eventHasGeo && !!event.isFollowup;
  let attachThreshold = eventHasGeo ? BASE_ATTACH_SCORE_MIN : LOW_GEO_ATTACH_SCORE_MIN;
  if (bestScore - secondBestScore < 0.08 && secondBestScore >= attachThreshold) {
    attachThreshold += 0.1;
  }
  if (weakGeoFollowup) {
    attachThreshold = Math.min(attachThreshold, 0.32);
  }
  if (normalizedCountDelta > 0) {
    attachThreshold = Math.min(attachThreshold, 0.3);
  }
  if (countDeltaWithExplicitLocation && !replyLinkedRow && !forcedRow) {
    // "One more" + explicit location usually describes an additional target
    // near the same area, not a direction update of the existing track.
    attachThreshold = Number.POSITIVE_INFINITY;
    decisionReason = 'count_delta_explicit_location_new_incident';
  }

  candidateScores.sort((a, b) => b.score - a.score);

  if (bestScore >= attachThreshold && bestRow) {
    if (decisionReason === 'new_incident') {
      decisionReason = 'implicit_score';
    }
    // Append to existing incident
    const trajectory = JSON.parse(bestRow.trajectory) as Array<{ lat: number; lng: number; timestamp: number; name: string }>;
    let projectionAnchor = parseProjectionAnchor(bestRow.projection_anchor);
    const sourceChannels = JSON.parse(bestRow.source_channels) as string[];

    const isHeadingOnlyTrackingUpdate =
      event.eventType === 'tracking' &&
      !event.location &&
      !event.via &&
      !!event.heading;

    // "One more" follow-up with heading-only signal should increase count
    // without mutating trajectory direction (it may describe another group path).
    const suppressHeadingOnlyCountDeltaTrack =
      normalizedCountDelta > 0 &&
      isHeadingOnlyTrackingUpdate &&
      !!event.isFollowup;

    const shouldAppendTrajectoryPoint = !isHeadingOnlyTrackingUpdate;
    if (!projectionAnchor) {
      const lastPoint = trajectory[trajectory.length - 1];
      projectionAnchor = lastPoint
        ? {
            lat: lastPoint.lat,
            lng: lastPoint.lng,
            timestamp: lastPoint.timestamp,
            name: lastPoint.name,
          }
        : null;
    }
    if (projectionAnchor && event.sourceTimestamp >= bestRow.last_updated_at) {
      const priorEnrich = enrichLiveFields(
        trajectory,
        projectionAnchor,
        bestRow.weapon_type as WeaponType,
        null,
        null,
      );
      projectionAnchor = projectAnchorAt(
        projectionAnchor,
        priorEnrich.bearingDeg,
        priorEnrich.speedKmh,
        bestRow.last_updated_at,
        event.sourceTimestamp,
      );
    }

    // Add new point to trajectory
    const newLat = event.location?.lat || event.via?.lat || event.heading?.lat;
    const newLng = event.location?.lng || event.via?.lng || event.heading?.lng;
    const newName = event.location?.canonicalName || event.via?.canonicalName || event.heading?.canonicalName || '';
    if (shouldAppendTrajectoryPoint && !suppressHeadingOnlyCountDeltaTrack && newLat != null && newLng != null) {
      const lastPoint = trajectory[trajectory.length - 1];
      const isDuplicatePoint =
        !!lastPoint && haversineKm(lastPoint.lat, lastPoint.lng, newLat, newLng) < 0.15;
      if (!isDuplicatePoint) {
        trajectory.push({ lat: newLat, lng: newLng, timestamp: event.sourceTimestamp, name: newName });
        projectionAnchor = { lat: newLat, lng: newLng, timestamp: event.sourceTimestamp, name: newName };
      }
    }

    // Update channels
    if (!sourceChannels.includes(event.sourceChannel)) {
      sourceChannels.push(event.sourceChannel);
    }

    // Update status
    let status = bestRow.status;
    if (event.eventType === 'impact') status = 'impact';

    // Update confidence (average with new)
    const newConfidence = (bestRow.confidence + event.confidence) / 2;

    const updatedWeaponCount = Math.max(
      bestRow.weapon_count,
      bestRow.weapon_count + normalizedCountDelta,
      event.weaponCount,
    );

    updateIncident(bestRow.id, {
      status,
      lastUpdatedAt: event.sourceTimestamp,
      weaponCount: updatedWeaponCount,
      sourceChannels,
      confidence: newConfidence,
      trajectory,
      projectionAnchor,
    });

    setEventIncidentId(event.id, bestRow.id);
    rememberChannelIncident(event.sourceChannel, bestRow.id, event.sourceTimestamp);

    const weaponType = bestRow.weapon_type as WeaponType;
    const scopeSource = shouldAppendTrajectoryPoint
      ? (event.location ?? event.via ?? event.heading ?? null)
      : null;
    const enrich = enrichLiveFields(
      trajectory,
      projectionAnchor,
      weaponType,
      event.heading ?? null,
      scopeSource,
    );

    return {
      action: 'update',
      incident: {
        id: bestRow.id,
        weaponType,
        weaponTypeLabel: WEAPON_LABELS[weaponType] || bestRow.weapon_type,
        weaponCount: updatedWeaponCount,
        status: status as 'active' | 'impact' | 'expired',
        trajectory,
        projectionAnchor,
        ...enrich,
        confidence: newConfidence,
        sourceChannels,
        firstSeenAt: bestRow.first_seen_at,
        lastUpdatedAt: event.sourceTimestamp,
        color: WEAPON_COLORS[weaponType] || '#888',
      },
      diagnostics: {
        decisionReason,
        bestScore,
        secondBestScore,
        attachThreshold,
        eventHasGeo,
        weakGeoFollowup,
        countDeltaApplied: normalizedCountDelta,
        candidateScores: candidateScores.slice(0, 5),
        phraseIntentHints: [...intentHints],
      },
    };
  }

  // Create new incident
  const incidentId = uuid();
  const trajectory: Array<{ lat: number; lng: number; timestamp: number; name: string }> = [];
  const isHeadingOnlyTrackingEvent =
    event.eventType === 'tracking' &&
    !event.location &&
    !event.via &&
    !!event.heading;
  const inferredIngress = isHeadingOnlyTrackingEvent
    ? inferIngressOriginForHeadingOnly(event.heading as ResolvedLocation, event.weaponType)
    : null;
  const lat = inferredIngress?.lat ?? event.location?.lat ?? event.via?.lat ?? event.heading?.lat;
  const lng = inferredIngress?.lng ?? event.location?.lng ?? event.via?.lng ?? event.heading?.lng;
  const name = inferredIngress
    ? ''
    : event.location?.canonicalName || event.via?.canonicalName || event.heading?.canonicalName || '';
  if (lat && lng) {
    trajectory.push({ lat, lng, timestamp: event.sourceTimestamp, name });
  }
  const projectionAnchor = lat && lng
    ? { lat, lng, timestamp: event.sourceTimestamp, name }
    : null;

  const status = event.eventType === 'impact' ? 'impact' : 'active';

  insertIncident({
    id: incidentId,
    weaponType: event.weaponType,
    weaponCount: event.weaponCount,
    status,
    firstSeenAt: event.sourceTimestamp,
    lastUpdatedAt: event.sourceTimestamp,
    sourceChannels: [event.sourceChannel],
    confidence: event.confidence,
    trajectory,
    projectionAnchor,
  });

  setEventIncidentId(event.id, incidentId);
  rememberChannelIncident(event.sourceChannel, incidentId, event.sourceTimestamp);

  const scopeSource = event.location ?? event.via ?? event.heading ?? null;
  const enrich = enrichLiveFields(trajectory, projectionAnchor, event.weaponType, event.heading ?? null, scopeSource);

  const incident: LiveIncident = {
    id: incidentId,
    weaponType: event.weaponType,
    weaponTypeLabel: WEAPON_LABELS[event.weaponType] || event.weaponType,
    weaponCount: event.weaponCount,
    status: status as 'active' | 'impact',
    trajectory,
    projectionAnchor,
    ...enrich,
    confidence: event.confidence,
    sourceChannels: [event.sourceChannel],
    firstSeenAt: event.sourceTimestamp,
    lastUpdatedAt: event.sourceTimestamp,
    color: WEAPON_COLORS[event.weaponType] || '#888',
  };

  return {
    action: 'new',
    incident,
    diagnostics: {
      decisionReason,
      bestScore,
      secondBestScore,
      attachThreshold,
      eventHasGeo,
      weakGeoFollowup,
      countDeltaApplied: 0,
      candidateScores: candidateScores.slice(0, 5),
      phraseIntentHints: [...intentHints],
    },
  };
}

/**
 * Expire stale active incidents (no update for 30 min).
 * Returns expired incident IDs.
 */
export function expireStaleIncidents(): string[] {
  const stale = getStaleActiveIncidents(30 * 60);
  const expired: string[] = [];
  for (const row of stale) {
    updateIncident(row.id, { status: 'expired' });
    expired.push(row.id);
  }
  return expired;
}

/**
 * Get all active incidents as LiveIncident objects.
 */
export function getActiveLiveIncidents(): LiveIncident[] {
  return getActiveIncidents().map(rowToLive);
}
