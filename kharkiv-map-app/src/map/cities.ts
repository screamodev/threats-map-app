import L from 'leaflet';
import { cities } from '../data/cities';

export function addCityMarkers(map: L.Map): void {
  for (const city of cities) {
    const isMajor = city.type === 'major';
    const isRussian = city.nameUk.includes('РФ');

    // Circle marker
    L.circleMarker(city.coords, {
      radius: isMajor ? 5 : 3,
      fillColor: isRussian ? '#ff4444' : '#ffffff',
      color: isRussian ? '#ff6666' : '#aaaaaa',
      weight: 1,
      fillOpacity: 0.8,
      opacity: 0.6,
    }).addTo(map);

    // Label
    const label = L.divIcon({
      className: 'city-label',
      html: `<span style="font-size:${isMajor ? '12px' : '10px'};color:${isRussian ? '#ff8888' : '#bbb'}">${city.nameUk}</span>`,
      iconSize: [100, 16],
      iconAnchor: [-6, 8],
    });
    L.marker(city.coords, { icon: label, interactive: false }).addTo(map);
  }
}
