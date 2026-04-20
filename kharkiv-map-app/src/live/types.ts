export type LocationScope = 'kharkiv-city' | 'oblast' | 'external';

export type DangerLevel = 'red' | 'orange' | 'green' | null;

export interface DistrictRiskPayload {
  levels: Record<string, DangerLevel>;
  at: number;
}

export interface LiveIncident {
  id: string;
  weaponType: string;
  weaponTypeLabel: string;
  weaponCount: number;
  status: 'active' | 'impact' | 'expired';
  trajectory: Array<{ lat: number; lng: number; timestamp: number; name: string }>;
  currentHeading: { lat: number; lng: number; name: string } | null;
  bearingDeg: number | null;
  speedKmh: number;
  etaSeconds: number | null;
  locationScope: LocationScope;
  locationType: string;
  confidence: number;
  sourceChannels: string[];
  firstSeenAt: number;
  lastUpdatedAt: number;
  color: string;
}

export type WsMessage =
  | { type: 'snapshot'; payload: LiveIncident[] }
  | { type: 'incident:new'; payload: LiveIncident }
  | { type: 'incident:update'; payload: LiveIncident }
  | { type: 'incident:expire'; payload: { id: string } }
  | { type: 'districts:risk'; payload: DistrictRiskPayload }
  | { type: 'ping' };
