import L from 'leaflet';

export async function addOblastLayer(map: L.Map): Promise<void> {
  try {
    const resp = await fetch('/data/oblast.geojson');
    const geojson = await resp.json();
    L.geoJSON(geojson, {
      style: {
        color: '#88aacc',
        weight: 2,
        opacity: 0.6,
        fillColor: 'transparent',
        fillOpacity: 0,
        dashArray: '8 4',
      },
    }).addTo(map);
  } catch {
    console.warn('Could not load oblast GeoJSON');
  }
}

export async function addBelgorodBorder(map: L.Map): Promise<void> {
  try {
    const resp = await fetch('/data/belgorod-border.geojson');
    const geojson = await resp.json();
    L.geoJSON(geojson, {
      style: {
        color: '#ff4444',
        weight: 2.5,
        opacity: 0.7,
        dashArray: '6 4',
        fillColor: 'transparent',
        fillOpacity: 0,
      },
    }).addTo(map);

    // Add "РОСІЯ" label near the border
    const label = L.divIcon({
      className: 'city-label',
      html: '<span style="color:#ff6666;font-size:13px;font-weight:700;letter-spacing:3px">РОСІЯ</span>',
      iconSize: [60, 20],
      iconAnchor: [30, 10],
    });
    L.marker([50.55, 36.80], { icon: label, interactive: false }).addTo(map);
  } catch {
    console.warn('Could not load Belgorod border GeoJSON');
  }
}
