import { GENERATED_WEAPON_ALIASES } from '../generated/weapon-aliases.js';
import type { WeaponType } from './types.js';

const aliasToWeapon = new Map<string, WeaponType>();

for (const [weapon, aliases] of Object.entries(GENERATED_WEAPON_ALIASES) as Array<
  [WeaponType, readonly string[]]
>) {
  for (const alias of aliases) {
    aliasToWeapon.set(alias.toLowerCase(), weapon);
  }
}

const STATIC_FALLBACK_MATCHERS: Array<{ pattern: RegExp; weapon: WeaponType }> = [
  { pattern: /[Іи]скандер/i, weapon: 'iskander' },
  { pattern: /с-?300/i, weapon: 's300' },
  { pattern: /каб/i, weapon: 'kab' },
  { pattern: /крылат(?:ая|ые)?\s+ракет|к[рр]\b|ракет[аыі]/i, weapon: 'missile' },
  { pattern: /баллист/i, weapon: 'ballistic' },
  { pattern: /рсзо/i, weapon: 'rszo' },
  { pattern: /ланцет/i, weapon: 'lancet' },
  { pattern: /fpv/i, weapon: 'fpv' },
  { pattern: /молни/i, weapon: 'molniya' },
];

function hasAliasMatch(normalizedText: string, alias: string): boolean {
  if (alias.length <= 3) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(
      normalizedText,
    );
  }
  return normalizedText.includes(alias);
}

export function detectWeaponTypeFromText(text: string): WeaponType {
  const normalized = text.toLowerCase();

  let bestMatch: { weapon: WeaponType; length: number } | null = null;
  for (const [alias, weapon] of aliasToWeapon.entries()) {
    if (!alias || alias.length < 2) continue;
    if (!hasAliasMatch(normalized, alias)) continue;
    if (!bestMatch || alias.length > bestMatch.length) {
      bestMatch = { weapon, length: alias.length };
    }
  }

  if (bestMatch) return bestMatch.weapon;

  for (const fallback of STATIC_FALLBACK_MATCHERS) {
    if (fallback.pattern.test(text)) return fallback.weapon;
  }

  if (/БпЛА|БПЛА|дрон|ударн/i.test(text)) return 'bpla';
  return 'unknown';
}
