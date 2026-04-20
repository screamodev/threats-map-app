import { createMap } from './map/setup';
import { addDistrictsLayer } from './map/districts';
import { addOblastLayer, addBelgorodBorder } from './map/oblast';
import { addCityMarkers } from './map/cities';
import { renderLegend } from './ui/legend';
import { renderSidebar } from './ui/sidebar';
import { startConnection, onStatus } from './live/connection';
import { initLiveLayer } from './live/layer';
import { initIncidentsPanel } from './live/incidents-panel';

async function init() {
  const map = createMap();

  // Render UI
  renderSidebar();
  renderLegend();

  // Load map layers
  await Promise.all([
    addDistrictsLayer(map),
    addOblastLayer(map),
    addBelgorodBorder(map),
  ]);

  addCityMarkers(map);

  // Initialize live layer
  initLiveLayer(map);
  initIncidentsPanel();

  // Connect to backend WebSocket
  startConnection();

  // Update connection status indicator
  onStatus((status) => {
    const dot = document.getElementById('connection-dot');
    if (dot) {
      dot.className = `connection-dot ${status}`;
      dot.title =
        status === 'connected' ? "З'єднано" :
        status === 'connecting' ? "З'єднання..." :
        "Від'єднано";
    }
  });
}

init();
