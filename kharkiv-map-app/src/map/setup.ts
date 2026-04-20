import L from 'leaflet';

const KHARKIV_CENTER: L.LatLngExpression = [49.9935, 36.2304];
const DEFAULT_ZOOM = 9;

export function createMap(): L.Map {
  const map = L.map('map', {
    center: KHARKIV_CENTER,
    zoom: DEFAULT_ZOOM,
    minZoom: 7,
    maxZoom: 15,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  return map;
}
