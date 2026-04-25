import { clearAllIncidents, getDb } from '../db/client.js';
import { seedGazetteer } from '../gazetteer/index.js';
import { parseWithRegex } from '../parser/regex.js';
import type { ParsedEvent } from '../parser/types.js';
import { resolve } from '../gazetteer/index.js';
import { correlateEvent, getActiveLiveIncidents, expireStaleIncidents } from './engine.js';

process.env.DB_PATH = ':memory:';

console.log('=== Correlation Test ===\n');

getDb();
seedGazetteer();
clearAllIncidents();

// Simulate a sequence of messages tracking the same drone group
const messages = [
  { text: '2 Ударных БпЛА в районе Безруки - Дергачи, курс Русская Лозовая⚠️', delay: 0 },
  { text: 'Уточнение, 2 Ударных БпЛА, уже в районе Черкасской Лозовой⚠️', delay: 120 },
  { text: 'Оба берут курс на окружную, Алексеевку, Шевченковский район внимательно⚠️', delay: 240 },
  { text: '2 Залетают на Лесопарк, Алексеевку, Шевченковский район внимательно⚠️', delay: 360 },
  { text: 'Взрывы в районе окружной💥', delay: 480 },
];

const baseTime = Math.floor(Date.now() / 1000);
let newCount = 0;
let updateCount = 0;
let incidentId: string | null = null;

for (const msg of messages) {
  const timestamp = baseTime + msg.delay;
  const event = parseWithRegex(msg.text, 0, 'test_channel', timestamp);

  if (!event) {
    console.log(`  SKIP: "${msg.text.slice(0, 50)}..." (no parse)`);
    continue;
  }

  const result = correlateEvent(event);
  if (!result) {
    console.log(`  SKIP: "${msg.text.slice(0, 50)}..." (no correlation result)`);
    continue;
  }

  if (result.action === 'new') {
    newCount++;
    incidentId = result.incident.id;
    console.log(`  NEW incident ${result.incident.id.slice(0, 8)}... — ${result.incident.weaponTypeLabel} x${result.incident.weaponCount}`);
  } else {
    updateCount++;
    console.log(`  UPDATE incident ${result.incident.id.slice(0, 8)}... — trajectory ${result.incident.trajectory.length} points, status=${result.incident.status}`);
  }
}

console.log(`\nResults: ${newCount} new, ${updateCount} updates`);

// Check: should be 1 incident with multiple trajectory points
const active = getActiveLiveIncidents();
console.log(`\nActive incidents: ${active.length}`);

let passed = 0;
let failed = 0;

if (newCount === 1) {
  console.log('  ✓ Exactly 1 new incident created');
  passed++;
} else {
  console.log(`  ✗ Expected 1 new incident, got ${newCount}`);
  failed++;
}

if (updateCount >= 3) {
  console.log(`  ✓ ${updateCount} updates to the same incident`);
  passed++;
} else {
  console.log(`  ✗ Expected ≥3 updates, got ${updateCount}`);
  failed++;
}

if (active.length >= 1) {
  const inc = active[0];
  console.log(`  Incident: ${inc.weaponTypeLabel} x${inc.weaponCount}, trajectory ${inc.trajectory.length} points, status=${inc.status}`);

  if (inc.trajectory.length >= 3) {
    console.log('  ✓ Trajectory has ≥3 points');
    passed++;
  } else {
    console.log(`  ✗ Expected ≥3 trajectory points, got ${inc.trajectory.length}`);
    failed++;
  }

  // Last message was an impact, so status should be 'impact'
  if (inc.status === 'impact') {
    console.log('  ✓ Status is "impact" after explosion message');
    passed++;
  } else {
    console.log(`  ✗ Expected status "impact", got "${inc.status}"`);
    failed++;
  }

  if (inc.weaponCount === 2) {
    console.log('  ✓ Weapon count is 2');
    passed++;
  } else {
    console.log(`  ✗ Expected weapon count 2, got ${inc.weaponCount}`);
    failed++;
  }
}

console.log('\n=== Follow-up Sequence Test (Pechenegy → Staryi Saltiv → Chuhuiv → One More) ===\n');

const followupMessages = [
  { text: 'Шахед на печенеги', delay: 0 },
  { text: 'на старый салтов', delay: 60 },
  { text: 'уже в районе чугуева', delay: 120 },
  { text: 'еще один шахед на печенеги', delay: 180, forceCountDelta: 1 },
];

const followupBaseTime = baseTime + 3600;
let followupNew = 0;
let followupUpdates = 0;
let followupIncidentId: string | null = null;
let followupFinalCount = 0;
let trajectoryBeforeOneMore = 0;
let trajectoryAfterOneMore = 0;

for (const msg of followupMessages) {
  const timestamp = followupBaseTime + msg.delay;
  const event = parseWithRegex(msg.text, 0, 'test_followup_channel', timestamp);

  if (!event) {
    console.log(`  ✗ Expected parse for "${msg.text}" but got null`);
    failed++;
    continue;
  }
  if (msg.forceCountDelta !== undefined) {
    trajectoryBeforeOneMore = getActiveLiveIncidents().find((i) => i.id === followupIncidentId)?.trajectory.length ?? 0;
    event.countDelta = msg.forceCountDelta;
    event.isFollowup = true;
  }

  const result = correlateEvent(event);
  if (!result) {
    console.log(`  ✗ Expected correlation result for "${msg.text}" but got null`);
    failed++;
    continue;
  }

  followupFinalCount = result.incident.weaponCount;
  if (msg.forceCountDelta !== undefined) {
    trajectoryAfterOneMore = result.incident.trajectory.length;
  }

  if (result.action === 'new') {
    followupNew++;
    followupIncidentId = result.incident.id;
    console.log(`  NEW ${result.incident.id.slice(0, 8)}... count=${result.incident.weaponCount}`);
    continue;
  }

  followupUpdates++;
  if (followupIncidentId && result.incident.id !== followupIncidentId) {
    console.log(`  ✗ Update linked to different incident: expected ${followupIncidentId.slice(0, 8)}..., got ${result.incident.id.slice(0, 8)}...`);
    failed++;
  } else {
    console.log(`  UPDATE ${result.incident.id.slice(0, 8)}... count=${result.incident.weaponCount}`);
  }
}

if (followupNew === 1) {
  console.log('  ✓ Exactly 1 incident created in follow-up sequence');
  passed++;
} else {
  console.log(`  ✗ Expected 1 new incident in follow-up sequence, got ${followupNew}`);
  failed++;
}

if (followupUpdates === 3) {
  console.log('  ✓ All follow-up messages updated the same incident');
  passed++;
} else {
  console.log(`  ✗ Expected 3 updates in follow-up sequence, got ${followupUpdates}`);
  failed++;
}

if (followupFinalCount === 2) {
  console.log('  ✓ "One more" incremented weapon count to 2');
  passed++;
} else {
  console.log(`  ✗ Expected final weapon count 2, got ${followupFinalCount}`);
  failed++;
}

if (trajectoryBeforeOneMore > 0 && trajectoryAfterOneMore === trajectoryBeforeOneMore) {
  console.log('  ✓ Heading-only "one more" did not change trajectory direction');
  passed++;
} else {
  console.log(`  ✗ Expected trajectory to stay at ${trajectoryBeforeOneMore}, got ${trajectoryAfterOneMore}`);
  failed++;
}

console.log('\n=== Hotspot Movement Slang Regression ===\n');

const movementCases = [
  { text: 'Шахед на печенеги', tsOffset: 0, expectAction: 'new' as const },
  { text: 'повернул на старый салтов', tsOffset: 90, expectAction: 'update' as const, expectHeading: 'Старий Салтів' },
  { text: 'довернул на чугуев', tsOffset: 180, expectAction: 'update' as const, expectHeading: 'Чугуїв' },
  { text: 'развернулся на харьков', tsOffset: 270, expectAction: 'update' as const, expectHeading: 'Харків' },
];

const movementBase = followupBaseTime + 8000;
let movementIncidentId: string | null = null;
let movementTrajectoryLen = 0;
for (const step of movementCases) {
  const event = parseWithRegex(step.text, 0, 'test_movement_channel', movementBase + step.tsOffset);
  if (!event) {
    console.log(`  ✗ Expected parse for "${step.text}"`);
    failed++;
    continue;
  }
  const result = correlateEvent(event);
  if (!result) {
    console.log(`  ✗ Expected correlation result for "${step.text}"`);
    failed++;
    continue;
  }
  if (result.action !== step.expectAction) {
    console.log(`  ✗ Expected action=${step.expectAction}, got ${result.action} for "${step.text}"`);
    failed++;
  } else {
    console.log(`  ✓ ${step.text} → ${result.action}`);
    passed++;
  }
  if (!movementIncidentId) {
    movementIncidentId = result.incident.id;
    movementTrajectoryLen = result.incident.trajectory.length;
  } else if (result.incident.id !== movementIncidentId) {
    console.log('  ✗ Movement slang update linked to different incident');
    failed++;
  }
  if (step.expectHeading) {
    const heading = result.incident.currentHeading?.name ?? '';
    if (heading.includes(step.expectHeading)) {
      console.log(`  ✓ Heading updated to "${step.expectHeading}"`);
      passed++;
    } else {
      console.log(`  ✗ Expected heading "${step.expectHeading}", got "${heading || '-'}"`);
      failed++;
    }
    if (result.incident.trajectory.length === movementTrajectoryLen) {
      console.log('  ✓ Heading-only slang did not add trajectory point');
      passed++;
    } else {
      console.log(`  ✗ Expected trajectory length ${movementTrajectoryLen}, got ${result.incident.trajectory.length}`);
      failed++;
    }
  }
}

console.log('\n=== Count-Delta With Explicit Location Splits Track ===\n');

const splitStart = resolve('Чугуїв', 0);
const splitHeading = resolve('Харків', 0);
const splitExtraLocation = resolve('Салтівка', 0);

if (!splitStart || !splitHeading || !splitExtraLocation) {
  console.log('  ✗ Failed to resolve split regression places');
  failed++;
} else {
  const splitBase = followupBaseTime + 4500;
  const initialEvent: ParsedEvent = {
    id: 'test-split-initial',
    rawMessageId: 0,
    eventType: 'tracking',
    weaponType: 'shahed',
    weaponCount: 1,
    location: splitStart,
    heading: splitHeading,
    via: null,
    confidence: 0.8,
    parserLayer: 'regex',
    isPreliminary: false,
    isCorrection: false,
    sourceChannel: 'test_split_channel',
    sourceTimestamp: splitBase,
    continuesIncidentId: null,
    continuationConfidence: 0,
    isFollowup: false,
    countDelta: 0,
  };

  const initialResult = correlateEvent(initialEvent);
  if (!initialResult) {
    console.log('  ✗ Expected initial incident for split regression');
    failed++;
  } else {
    const initialIncidentId = initialResult.incident.id;
    const initialTrajectoryLen = initialResult.incident.trajectory.length;

    const oneMoreAtLocation: ParsedEvent = {
      ...initialEvent,
      id: 'test-split-followup',
      sourceTimestamp: splitBase + 90,
      location: splitExtraLocation,
      heading: null,
      isFollowup: true,
      countDelta: 1,
    };
    const splitResult = correlateEvent(oneMoreAtLocation);
    if (!splitResult) {
      console.log('  ✗ Expected split result for explicit-location count delta');
      failed++;
    } else {
      if (splitResult.action === 'new' && splitResult.incident.id !== initialIncidentId) {
        console.log('  ✓ "One more" with explicit location created a new incident');
        passed++;
      } else {
        console.log(`  ✗ Expected new incident, got action=${splitResult.action}`);
        failed++;
      }

      const activeNow = getActiveLiveIncidents();
      const originalAfter = activeNow.find((i) => i.id === initialIncidentId);
      if (originalAfter && originalAfter.trajectory.length === initialTrajectoryLen) {
        console.log('  ✓ Original incident trajectory stayed unchanged');
        passed++;
      } else {
        console.log(`  ✗ Expected original trajectory length ${initialTrajectoryLen}, got ${originalAfter?.trajectory.length ?? -1}`);
        failed++;
      }
    }
  }
}

console.log('\n=== Via Preference Test (Kupyansk -> Chuhuiv) ===\n');

const viaLocation = resolve("Куп'янськ", 0);
const viaHeading = resolve('Чугуїв', 0);
if (!viaLocation || !viaHeading) {
  console.log('  ✗ Failed to resolve via/heading places for via preference case');
  failed++;
} else {
  const viaEvent: ParsedEvent = {
    id: 'test-via-event',
    rawMessageId: 0,
    eventType: 'tracking',
    weaponType: 'shahed',
    weaponCount: 1,
    location: null,
    heading: viaHeading,
    via: viaLocation,
    confidence: 0.8,
    parserLayer: 'regex',
    isPreliminary: false,
    isCorrection: false,
    sourceChannel: 'test_via_channel',
    sourceTimestamp: followupBaseTime + 4000,
    continuesIncidentId: null,
    continuationConfidence: 0,
    isFollowup: false,
    countDelta: 0,
  };
  const viaResult = correlateEvent(viaEvent);
  if (!viaResult) {
    console.log('  ✗ Expected correlation result for via preference case');
    failed++;
  } else {
    const startPoint = viaResult.incident.trajectory[0];
    if (startPoint?.name.includes("Куп'янськ")) {
      console.log('  ✓ Incident starts from via location (Куп\'янськ), not heading');
      passed++;
    } else {
      console.log(`  ✗ Expected start point Куп'янськ, got "${startPoint?.name ?? '-'}"`);
      failed++;
    }
  }
}

console.log('\n=== Heading-Only Update Regression (No Teleport) ===\n');

const headingStart = resolve("Куп'янськ", 0);
const headingInitialTarget = resolve('Чугуїв', 0);
const headingOnlyTarget = resolve('Харків', 0);

if (!headingStart || !headingInitialTarget || !headingOnlyTarget) {
  console.log('  ✗ Failed to resolve heading regression places');
  failed++;
} else {
  const headingBase = followupBaseTime + 5000;
  const initialTrackingEvent: ParsedEvent = {
    id: 'test-heading-initial',
    rawMessageId: 0,
    eventType: 'tracking',
    weaponType: 'shahed',
    weaponCount: 1,
    location: headingStart,
    heading: headingInitialTarget,
    via: null,
    confidence: 0.8,
    parserLayer: 'regex',
    isPreliminary: false,
    isCorrection: false,
    sourceChannel: 'test_heading_channel',
    sourceTimestamp: headingBase,
    continuesIncidentId: null,
    continuationConfidence: 0,
    isFollowup: false,
    countDelta: 0,
  };

  const initialResult = correlateEvent(initialTrackingEvent);
  if (!initialResult) {
    console.log('  ✗ Expected initial heading regression incident');
    failed++;
  } else {
    const beforeTrajectoryLen = initialResult.incident.trajectory.length;
    const beforeBearing = initialResult.incident.bearingDeg;

    const headingOnlyFollowupEvent: ParsedEvent = {
      ...initialTrackingEvent,
      id: 'test-heading-followup',
      location: null,
      via: null,
      heading: headingOnlyTarget,
      sourceTimestamp: headingBase + 120,
      isFollowup: true,
    };

    const followupResult = correlateEvent(headingOnlyFollowupEvent);
    if (!followupResult) {
      console.log('  ✗ Expected heading-only follow-up update');
      failed++;
    } else {
      const afterTrajectoryLen = followupResult.incident.trajectory.length;
      const afterBearing = followupResult.incident.bearingDeg;
      const headingName = followupResult.incident.currentHeading?.name ?? '';

      if (afterTrajectoryLen === beforeTrajectoryLen) {
        console.log('  ✓ Heading-only update kept trajectory length unchanged');
        passed++;
      } else {
        console.log(`  ✗ Expected trajectory length ${beforeTrajectoryLen}, got ${afterTrajectoryLen}`);
        failed++;
      }

      if (afterBearing !== null && beforeBearing !== afterBearing) {
        console.log('  ✓ Heading-only update refreshed bearing direction');
        passed++;
      } else {
        console.log(`  ✗ Expected bearing change, before=${beforeBearing}, after=${afterBearing}`);
        failed++;
      }

      if (headingName.includes('Харків')) {
        console.log('  ✓ Heading-only update refreshed current heading metadata');
        passed++;
      } else {
        console.log(`  ✗ Expected heading target "Харків", got "${headingName || '-'}"`);
        failed++;
      }
    }
  }
}

console.log('\n=== Inferred Ingress Origin For Heading-Only KAB ===\n');

const kozachaLopan = resolve('Козача Лопань', 0);
if (!kozachaLopan) {
  console.log('  ✗ Failed to resolve Козача Лопань for ingress-origin test');
  failed++;
} else {
  const headingOnlyKabEvent: ParsedEvent = {
    id: 'test-heading-only-kab-ingress',
    rawMessageId: 0,
    eventType: 'tracking',
    weaponType: 'kab',
    weaponCount: 1,
    location: null,
    heading: kozachaLopan,
    via: null,
    confidence: 0.8,
    parserLayer: 'regex',
    isPreliminary: false,
    isCorrection: false,
    sourceChannel: 'test_ingress_origin_channel',
    sourceTimestamp: followupBaseTime + 7000,
    continuesIncidentId: null,
    continuationConfidence: 0,
    isFollowup: false,
    countDelta: 0,
  };

  const ingressResult = correlateEvent(headingOnlyKabEvent);
  if (!ingressResult) {
    console.log('  ✗ Expected new incident for heading-only KAB');
    failed++;
  } else {
    const startPoint = ingressResult.incident.trajectory[0];
    const headingPoint = ingressResult.incident.currentHeading;
    if (!startPoint || !headingPoint) {
      console.log('  ✗ Missing trajectory start or heading point for ingress-origin test');
      failed++;
    } else {
      const startsOutsideTarget =
        Math.abs(startPoint.lat - kozachaLopan.lat) > 0.02 ||
        Math.abs(startPoint.lng - kozachaLopan.lng) > 0.02;
      if (startsOutsideTarget) {
        console.log('  ✓ Heading-only KAB starts from inferred ingress origin, not target point');
        passed++;
      } else {
        console.log('  ✗ Expected inferred ingress origin away from target coordinates');
        failed++;
      }

      const headingMatchesTarget =
        Math.abs(headingPoint.lat - kozachaLopan.lat) < 0.0001 &&
        Math.abs(headingPoint.lng - kozachaLopan.lng) < 0.0001;
      if (headingMatchesTarget) {
        console.log('  ✓ Heading-only KAB keeps destination at reported location');
        passed++;
      } else {
        console.log('  ✗ Expected heading destination to match reported location');
        failed++;
      }
    }
  }
}

console.log('\n=== Production Chain Regression (Kozacha Lopan -> Slatyne -> Staryi Saltiv) ===\n');

const productionChainMessages = [
  {
    text: 'Каб на козачью лопань',
    tsOffset: 0,
    expectedHeading: 'Козача Лопань',
    expectedAction: 'new' as const,
  },
  {
    text: 'Летит дальше на Слатино',
    tsOffset: 120,
    expectedHeading: 'Слатине',
    expectedAction: 'update' as const,
  },
  {
    text: 'Свернул на старый салтов',
    tsOffset: 240,
    expectedHeading: 'Старий Салтів',
    expectedAction: 'update' as const,
  },
];

const productionBaseTime = followupBaseTime + 10_000;
let productionIncidentId: string | null = null;
let previousAnchorTs = -1;
let previousAnchorLat = NaN;
let previousAnchorLng = NaN;

for (const step of productionChainMessages) {
  const parsed = parseWithRegex(step.text, 0, 'test_production_chain', productionBaseTime + step.tsOffset);
  if (!parsed) {
    console.log(`  ✗ Expected parse for "${step.text}"`);
    failed++;
    continue;
  }

  if (!parsed.heading?.canonicalName.includes(step.expectedHeading)) {
    console.log(
      `  ✗ Parser heading mismatch for "${step.text}": got "${parsed.heading?.canonicalName ?? '-'}", expected contains "${step.expectedHeading}"`,
    );
    failed++;
  } else {
    console.log(`  ✓ Parser resolved heading "${parsed.heading.canonicalName}"`);
    passed++;
  }

  const correlated = correlateEvent(parsed);
  if (!correlated) {
    console.log(`  ✗ Expected correlation result for "${step.text}"`);
    failed++;
    continue;
  }

  if (correlated.action !== step.expectedAction) {
    console.log(`  ✗ Expected action=${step.expectedAction}, got ${correlated.action}`);
    failed++;
  } else {
    console.log(`  ✓ Correlation action "${correlated.action}"`);
    passed++;
  }

  if (!productionIncidentId) {
    productionIncidentId = correlated.incident.id;
  } else if (correlated.incident.id !== productionIncidentId) {
    console.log('  ✗ Chain step attached to different incident');
    failed++;
  } else {
    console.log('  ✓ Chain step stayed on the same incident');
    passed++;
  }

  const anchor = correlated.incident.projectionAnchor;
  if (!anchor) {
    console.log('  ✗ Projection anchor missing on chain result');
    failed++;
    continue;
  }

  if (anchor.timestamp < previousAnchorTs) {
    console.log(`  ✗ Projection anchor timestamp regressed: ${anchor.timestamp} < ${previousAnchorTs}`);
    failed++;
  } else {
    console.log(`  ✓ Projection anchor timestamp monotonic (${anchor.timestamp})`);
    passed++;
  }

  previousAnchorTs = anchor.timestamp;
  previousAnchorLat = anchor.lat;
  previousAnchorLng = anchor.lng;
}

if (productionIncidentId) {
  const snapshotIncident = getActiveLiveIncidents().find((incident) => incident.id === productionIncidentId);
  if (!snapshotIncident) {
    console.log('  ✗ Snapshot/reconnect check: chain incident missing from active snapshot');
    failed++;
  } else if (!snapshotIncident.projectionAnchor) {
    console.log('  ✗ Snapshot/reconnect check: projection anchor missing in active snapshot payload');
    failed++;
  } else if (snapshotIncident.projectionAnchor.timestamp < previousAnchorTs) {
    console.log(
      `  ✗ Snapshot/reconnect check: anchor timestamp regressed in snapshot (${snapshotIncident.projectionAnchor.timestamp} < ${previousAnchorTs})`,
    );
    failed++;
  } else {
    console.log('  ✓ Snapshot/reconnect check: active snapshot preserves projection anchor continuity');
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
