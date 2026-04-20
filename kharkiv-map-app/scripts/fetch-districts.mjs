#!/usr/bin/env node
import { writeFileSync } from 'fs';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function query(overpassQL) {
  const resp = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'kharkiv-map-app/1.0',
    },
    body: `data=${encodeURIComponent(overpassQL)}`,
  });
  if (!resp.ok) throw new Error(`Overpass error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// First, let's find what admin levels exist within Kharkiv's bbox
const data = await query(`
  [out:json][timeout:120];
  (
    relation["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10)$"](49.85,36.05,50.15,36.45);
  );
  out tags;
`);

console.log('Relations found:');
for (const el of data.elements) {
  console.log(`  ${el.tags?.name} — admin_level=${el.tags?.admin_level}, id=${el.id}`);
}
