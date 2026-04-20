#!/usr/bin/env node
/**
 * One-time script to fetch GeoJSON data from Overpass API.
 * Run: node scripts/fetch-geodata.mjs
 */

import { writeFileSync } from 'fs';

// Use alternative server if main is overloaded
const OVERPASS_URL = 'https://overpass.kumi.systems/api/interpreter';

async function query(overpassQL) {
  const resp = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'kharkiv-map-app/1.0 (data fetch script)',
    },
    body: `data=${encodeURIComponent(overpassQL)}`,
  });
  if (!resp.ok) throw new Error(`Overpass error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

function osmToGeoJSON(osmData) {
  // Build node lookup
  const nodes = {};
  for (const el of osmData.elements) {
    if (el.type === 'node') {
      nodes[el.id] = [el.lon, el.lat];
    }
  }

  // Build way geometries
  const ways = {};
  for (const el of osmData.elements) {
    if (el.type === 'way') {
      ways[el.id] = el.nodes.map((nid) => nodes[nid]).filter(Boolean);
    }
  }

  // Build features from relations
  const features = [];
  for (const el of osmData.elements) {
    if (el.type === 'relation') {
      const rings = [];
      const outerWays = el.members.filter((m) => m.type === 'way' && m.role === 'outer');
      const innerWays = el.members.filter((m) => m.type === 'way' && m.role === 'inner');

      const outerCoords = mergeWays(outerWays.map((m) => ways[m.ref]).filter(Boolean));
      const innerCoords = mergeWays(innerWays.map((m) => ways[m.ref]).filter(Boolean));

      if (outerCoords.length === 0) continue;

      const polygonCoords = outerCoords.map((ring) => ring);
      for (const inner of innerCoords) {
        polygonCoords.push(inner);
      }

      features.push({
        type: 'Feature',
        properties: { ...el.tags, osmId: el.id },
        geometry: {
          type: polygonCoords.length === 1 ? 'Polygon' : 'Polygon',
          coordinates: polygonCoords,
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

function mergeWays(wayCoords) {
  if (wayCoords.length === 0) return [];

  // Try to merge connected ways into rings
  const rings = [];
  const remaining = wayCoords.map((w) => [...w]);

  while (remaining.length > 0) {
    const ring = remaining.shift();
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        const ringEnd = ring[ring.length - 1];
        const wStart = w[0];
        const wEnd = w[w.length - 1];

        if (coordsEqual(ringEnd, wStart)) {
          ring.push(...w.slice(1));
          remaining.splice(i, 1);
          merged = true;
          break;
        } else if (coordsEqual(ringEnd, wEnd)) {
          ring.push(...w.reverse().slice(1));
          remaining.splice(i, 1);
          merged = true;
          break;
        } else if (coordsEqual(ring[0], wEnd)) {
          ring.unshift(...w.slice(0, -1));
          remaining.splice(i, 1);
          merged = true;
          break;
        } else if (coordsEqual(ring[0], wStart)) {
          ring.unshift(...w.reverse().slice(0, -1));
          remaining.splice(i, 1);
          merged = true;
          break;
        }
      }
    }
    rings.push(ring);
  }

  return rings;
}

function coordsEqual(a, b) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) < 0.0000001 && Math.abs(a[1] - b[1]) < 0.0000001;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDistricts() {
  console.log('Fetching Kharkiv districts...');
  // Kharkiv city relation is 2555133. Use area pivot from relation ID.
  // Area IDs = relation ID + 3600000000
  const data = await query(`
    [out:json][timeout:120];
    area(3602555133)->.city;
    rel(area.city)["admin_level"="9"]["boundary"="administrative"];
    out body;
    >;
    out skel qt;
  `);
  console.log(`  Got ${data.elements.length} elements`);
  const geojson = osmToGeoJSON(data);
  console.log(`  Converted to ${geojson.features.length} features`);
  for (const f of geojson.features) {
    console.log(`    - ${f.properties.name || 'unnamed'}`);
  }
  writeFileSync('public/data/districts.geojson', JSON.stringify(geojson));
  console.log('  Saved to public/data/districts.geojson');
}

async function fetchOblast() {
  console.log('Fetching Kharkiv Oblast boundary...');
  const data = await query(`
    [out:json][timeout:120];
    rel(71254);
    out body;
    >;
    out skel qt;
  `);
  console.log(`  Got ${data.elements.length} elements`);
  const geojson = osmToGeoJSON(data);
  console.log(`  Converted to ${geojson.features.length} features`);
  writeFileSync('public/data/oblast.geojson', JSON.stringify(geojson));
  console.log('  Saved to public/data/oblast.geojson');
}

async function fetchBelgorodBorder() {
  console.log('Fetching Belgorod Oblast boundary...');
  const data = await query(`
    [out:json][timeout:120];
    rel(72169);
    out body;
    >;
    out skel qt;
  `);
  console.log(`  Got ${data.elements.length} elements`);
  const geojson = osmToGeoJSON(data);
  console.log(`  Converted to ${geojson.features.length} features`);
  writeFileSync('public/data/belgorod-border.geojson', JSON.stringify(geojson));
  console.log('  Saved to public/data/belgorod-border.geojson');
}

async function main() {
  try {
    await fetchDistricts();
    console.log('');
    console.log('Waiting 10s to avoid rate limiting...');
    await sleep(10000);
    await fetchOblast();
    console.log('');
    console.log('Waiting 10s to avoid rate limiting...');
    await sleep(10000);
    await fetchBelgorodBorder();
    console.log('\nDone! All GeoJSON files saved to public/data/');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
