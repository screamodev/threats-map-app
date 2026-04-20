import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { config } from '../config.js';
import { registerRoutes } from './routes.js';
import { addClient, sendSnapshot } from './ws.js';
import { getActiveLiveIncidents } from '../correlation/engine.js';
import { computeDistrictRisk } from '../districts/risk.js';

export async function startServer() {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, {
    origin: true, // Allow all in dev; restrict in production
  });

  await app.register(fastifyWebsocket);

  // WebSocket endpoint
  app.get('/live', { websocket: true }, (socket) => {
    const added = addClient(socket);
    if (added) {
      const active = getActiveLiveIncidents();
      const districtLevels = Object.fromEntries(computeDistrictRisk(active));
      sendSnapshot(socket, active, districtLevels);
    }
  });

  // HTTP routes
  registerRoutes(app);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[server] Listening on port ${config.port}`);

  return app;
}
