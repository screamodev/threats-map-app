import type { ResolvedLocation } from '../gazetteer/index.js';

export type EventType = 'tracking' | 'impact' | 'correction' | 'all_clear';

export type WeaponType =
  | 'shahed'
  | 'bpla'
  | 's300'
  | 'kab'
  | 'iskander'
  | 'missile'
  | 'fpv'
  | 'molniya'
  | 'lancet'
  | 'ballistic'
  | 'rszo'
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
  /** Follow-up intent marker (e.g., "далее", "уже возле", "ще"). */
  isFollowup?: boolean;
  /** Delta to apply to tracked count when message says "one more". */
  countDelta?: number;
  /** Lexicon-derived phrase intent hints used by correlator scoring. */
  phraseIntents?: string[];
  /** Reply linkage from Telegram message metadata, if known. */
  replyToTelegramId?: number | null;
  /** Telegram media grouping id (album/thread-like grouping), if known. */
  groupedId?: number | null;
}

export const WEAPON_LABELS: Record<WeaponType, string> = {
  shahed: 'Шахед-136',
  bpla: 'Ударний БпЛА',
  s300: 'С-300',
  kab: 'КАБ',
  iskander: 'Іскандер',
  missile: 'Ракета',
  fpv: 'FPV-дрон',
  molniya: 'Молнія',
  lancet: 'Ланцет',
  ballistic: 'Балістика',
  rszo: 'РСЗВ',
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
  fpv: 120,
  molniya: 220,
  lancet: 300,
  ballistic: 2500,
  rszo: 700,
  unknown: 200,
};

export const WEAPON_COLORS: Record<WeaponType, string> = {
  shahed: '#aa66ff',
  bpla: '#ff8800',
  s300: '#ff4444',
  kab: '#ff8800',
  iskander: '#ff2266',
  missile: '#ff4444',
  fpv: '#ffb020',
  molniya: '#ffa000',
  lancet: '#cc5500',
  ballistic: '#ff0033',
  rszo: '#ff6644',
  unknown: '#888888',
};
