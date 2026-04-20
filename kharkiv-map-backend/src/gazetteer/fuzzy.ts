/**
 * Damerau-Levenshtein distance — handles insertions, deletions, substitutions, and transpositions.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const d: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0));

  for (let i = 0; i <= la; i++) d[i][0] = i;
  for (let j = 0; j <= lb; j++) d[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      // transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }

  return d[la][lb];
}

/**
 * Normalize Russian/Ukrainian text for comparison:
 * lowercase, strip some common suffixes (accusative case endings), transliterate і↔и etc.
 */
export function normalize(text: string): string {
  let s = text.trim().toLowerCase();
  // Remove trailing emoji/symbols
  s = s.replace(/[⚠💥🔴\s]+$/, '');
  // Normalize Ukrainian ↔ Russian common letters
  s = s.replace(/і/g, 'и');
  s = s.replace(/ї/g, 'и');
  s = s.replace(/є/g, 'е');
  s = s.replace(/ґ/g, 'г');
  // Remove soft sign differences
  // Keep ь as-is since it matters in some words
  return s;
}

/**
 * Strip common Russian/Ukrainian accusative case endings for better matching.
 * "Алексеевку" → "Алексеевк", "Пятихаток" → "Пятихат"
 */
export function stripCaseEnding(text: string): string {
  const s = text.trim();
  // Common accusative/genitive/locative suffixes
  if (s.endsWith('ку')) return s.slice(0, -2) + 'ка';
  if (s.endsWith('ой')) return s.slice(0, -2) + 'а';
  if (s.endsWith('ою')) return s.slice(0, -2) + 'а';
  if (s.endsWith('ом')) return s.slice(0, -2);
  if (s.endsWith('ів')) return s.slice(0, -2);
  return s;
}
