import type { FastifyInstance } from 'fastify';
import { getActiveIncidents, getRecentIncidents, getImpactHeatmap } from '../db/client.js';
import { getActiveLiveIncidents } from '../correlation/engine.js';
import { WEAPON_LABELS, WEAPON_COLORS, type WeaponType } from '../parser/types.js';

export function registerRoutes(app: FastifyInstance): void {
  app.get('/api/incidents/active', async () => {
    return getActiveLiveIncidents();
  });

  app.get<{ Querystring: { hours?: string } }>('/api/incidents/recent', async (request) => {
    const hours = parseInt(request.query.hours || '24', 10);
    const rows = getRecentIncidents(hours);
    return rows.map(row => ({
      ...row,
      trajectory: JSON.parse(row.trajectory),
      source_channels: JSON.parse(row.source_channels),
      weaponTypeLabel: WEAPON_LABELS[row.weapon_type as WeaponType] || row.weapon_type,
      color: WEAPON_COLORS[row.weapon_type as WeaponType] || '#888',
    }));
  });

  app.get('/api/stats/heatmap', async () => {
    const impacts = getImpactHeatmap(24);
    // Count by weapon type from recent incidents
    const recent = getRecentIncidents(24);
    const byWeaponType: Record<string, number> = {};
    for (const row of recent) {
      const wt = row.weapon_type;
      byWeaponType[wt] = (byWeaponType[wt] || 0) + 1;
    }
    return { last24h: impacts, byWeaponType };
  });

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });
}
