import { getDb } from '../db/client.js';
import { seedGazetteer } from '../gazetteer/index.js';
import { parseWithRegex } from '../parser/regex.js';
import { correlateEvent, getActiveLiveIncidents, expireStaleIncidents } from './engine.js';

process.env.DB_PATH = ':memory:';

console.log('=== Correlation Test ===\n');

getDb();
seedGazetteer();

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
