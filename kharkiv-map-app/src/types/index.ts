export type RiskLevel = 'high' | 'medium' | 'med-low' | 'low';

export interface DistrictRisk {
  id: string;
  nameUk: string;
  riskLevel: RiskLevel;
  description: string;
  hasMetro: boolean;
}

export interface AttackVector {
  id: string;
  weaponNameUk: string;
  weaponType: string;
  origin: [number, number]; // [lat, lng]
  target: [number, number];
  flightTimeLabel: string;
  flightDurationMs: number; // animation duration
  directionUk: string;
  color: string;
  dashArray?: string;
}

export interface CityMarker {
  nameUk: string;
  coords: [number, number];
  type: 'major' | 'minor';
}

export const RISK_COLORS: Record<RiskLevel, string> = {
  high: '#e53935',
  medium: '#ff9800',
  'med-low': '#fdd835',
  low: '#4caf50',
};

export const RISK_LABELS_UK: Record<RiskLevel, string> = {
  high: 'Високий',
  medium: 'Середній',
  'med-low': 'Середньо-низький',
  low: 'Низький',
};
