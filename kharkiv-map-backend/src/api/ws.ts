import type { WebSocket } from 'ws';
import type { LiveIncident } from '../correlation/engine.js';
import type { DangerLevel } from '../districts/risk.js';

const clients = new Set<WebSocket>();
const MAX_CLIENTS = 100;

export function addClient(ws: WebSocket): boolean {
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1013, 'Too many connections');
    return false;
  }
  clients.add(ws);
  console.log(`[ws] Client connected (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected (${clients.size} total)`);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pong') {
        // heartbeat response, ignore
      }
    } catch {
      // ignore malformed messages
    }
  });

  return true;
}

function broadcast(message: object): void {
  const json = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(json);
    }
  }
}

export function sendSnapshot(
  ws: WebSocket,
  incidents: LiveIncident[],
  districtLevels: Record<string, DangerLevel>
): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type: 'snapshot', payload: incidents }));
  ws.send(
    JSON.stringify({
      type: 'districts:risk',
      payload: { levels: districtLevels, at: Date.now() },
    })
  );
}

export function broadcastDistrictRisk(levels: Record<string, DangerLevel>): void {
  broadcast({ type: 'districts:risk', payload: { levels, at: Date.now() } });
}

export function broadcastNewIncident(incident: LiveIncident): void {
  broadcast({ type: 'incident:new', payload: incident });
}

export function broadcastIncidentUpdate(incident: LiveIncident): void {
  broadcast({ type: 'incident:update', payload: incident });
}

export function broadcastIncidentExpire(incidentId: string): void {
  broadcast({ type: 'incident:expire', payload: { id: incidentId } });
}

// Heartbeat
setInterval(() => {
  broadcast({ type: 'ping' });
}, 30_000);

export function getClientCount(): number {
  return clients.size;
}
