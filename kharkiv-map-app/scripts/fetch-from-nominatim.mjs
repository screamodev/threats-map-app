#!/usr/bin/env node
import { writeFileSync } from 'fs';

const districts = [
  { id: 7340971, name: 'Салтівський район' },
  { id: 7340973, name: 'Київський район' },
  { id: 3796255, name: 'Шевченківський район' },
  { id: 3801249, name: 'Холодногірський район' },
  { id: 3801278, name: 'Новобаварський район' },
  { id: 3801315, name: "Основ'янський район" },
  { id: 7340970, name: 'Слобідський район' },
  { id: 7340972, name: 'Немишлянський район' },
  { id: 7340969, name: 'Індустріальний район' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPolygon(osmId, name) {
  // Nominatim lookup by OSM ID with polygon_geojson
  const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=R${osmId}&format=json&polygon_geojson=1`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'kharkiv-map-app/1.0 (educational project)' },
  });
  if (!resp.ok) throw new Error(`Error ${resp.status} for ${name}`);
  const data = await resp.json();
  if (data.length === 0 || !data[0].geojson) {
    console.warn(`  No geometry found for ${name} (R${osmId})`);
    return null;
  }
  console.log(`  OK: ${name} — ${data[0].geojson.type}`);
  return {
    type: 'Feature',
    properties: { name, osmId },
    geometry: data[0].geojson,
  };
}

async function main() {
  console.log('Fetching district polygons from Nominatim...\n');
  const features = [];

  for (const d of districts) {
    const f = await fetchPolygon(d.id, d.name);
    if (f) features.push(f);
    await sleep(1200); // Nominatim rate limit: 1 req/sec
  }

  const geojson = { type: 'FeatureCollection', features };
  writeFileSync('public/data/districts.geojson', JSON.stringify(geojson));
  console.log(`\nSaved ${features.length} districts to public/data/districts.geojson`);

  // Now fetch Belgorod oblast
  console.log('\nFetching Belgorod Oblast boundary...');
  await sleep(1200);
  const belgorod = await fetchPolygon(72169, 'Бєлгородська область');
  if (belgorod) {
    const bg = { type: 'FeatureCollection', features: [belgorod] };
    writeFileSync('public/data/belgorod-border.geojson', JSON.stringify(bg));
    console.log('Saved Belgorod border to public/data/belgorod-border.geojson');
  }
}

main().catch(console.error);
