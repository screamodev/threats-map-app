import type { ResolvedLocation } from '../gazetteer/index.js';

export type EventType = 'tracking' | 'impact' | 'correction' | 'all_clear';

export type WeaponType =
  | 'shahed'
  | 'bpla'
  | 's300'
  | 'kab'
  | 'iskander'
  | 'missile'
  | 'unknown';

export interface ParsedEvent {
  id: string;
  rawMessageId: number;
  eventType: EventType;
  weaponType: WeaponType;
  weaponCount: number;
  location: ResolvedLocation | null;
  heading: ResolvedLocation | null;
  via: ResolvedLocation | null;
  confidence: number;
  parserLayer: 'regex' | 'openai';
  isPreliminary: boolean;
  isCorrection: boolean;
  sourceChannel: string;
  sourceTimestamp: number;
  /** When set by OpenAI, id of an active incident this message continues; used by correlation. */
  continuesIncidentId?: string | null;
  /** 0–1; 0 = unrelated to prior incidents. From OpenAI only. */
  continuationConfidence?: number;
}

export const WEAPON_LABELS: Record<WeaponType, string> = {
  shahed: 'Шахед-136',
  bpla: 'Ударний БпЛА',
  s300: 'С-300',
  kab: 'КАБ',
  iskander: 'Іскандер',
  missile: 'Ракета',
  unknown: 'Невідомо',
};

/** Approximate cruise speed (km/h) for ETA and live display; not radar-derived. */
export const WEAPON_SPEED_KMH: Record<WeaponType, number> = {
  shahed: 180,
  bpla: 150,
  s300: 2000,
  kab: 900,
  iskander: 2100,
  missile: 900,
  unknown: 200,
};

export const WEAPON_COLORS: Record<WeaponType, string> = {
  shahed: '#aa66ff',
  bpla: '#ff8800',
  s300: '#ff4444',
  kab: '#ff8800',
  iskander: '#ff2266',
  missile: '#ff4444',
  unknown: '#888888',
};
