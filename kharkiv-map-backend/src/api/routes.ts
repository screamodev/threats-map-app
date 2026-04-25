import type { FastifyInstance } from 'fastify';
import { getActiveIncidents, getRecentIncidents, getImpactHeatmap, clearAllIncidents } from '../db/client.js';
import { getActiveLiveIncidents } from '../correlation/engine.js';
import { WEAPON_LABELS, WEAPON_COLORS, type WeaponType } from '../parser/types.js';
import { broadcastDistrictRisk, broadcastIncidentExpire } from './ws.js';
import { computeDistrictRisk, resetDistrictRiskState } from '../districts/risk.js';

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
      projection_anchor: row.projection_anchor ? JSON.parse(row.projection_anchor) : null,
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

  app.post('/api/dev/clear-targets', async (_request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      reply.code(403);
      return { ok: false, error: 'disabled_in_production' };
    }

    const active = getActiveLiveIncidents();
    const activeIds = active.map((i) => i.id);

    const deleted = clearAllIncidents();

    for (const id of activeIds) {
      broadcastIncidentExpire(id);
    }

    resetDistrictRiskState();
    const levels = Object.fromEntries(computeDistrictRisk([]));
    broadcastDistrictRisk(levels);

    return {
      ok: true,
      deleted,
      expiredBroadcasted: activeIds.length,
    };
  });
}
