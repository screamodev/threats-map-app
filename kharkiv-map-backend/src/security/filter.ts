/**
 * Filter out messages that mention air defense positions or actions.
 * These must NOT be broadcast to protect Ukrainian forces.
 */

const AIR_DEFENSE_KEYWORDS = [
  'ППО', 'ПВО', 'ЗРК', 'ПЗРК',
  'зенітний', 'зенітна', 'зенитный', 'зенитная',
  'перехоплення', 'перехватил', 'перехвачен',
  'збили', 'збито', 'сбили', 'сбит',
  'работает ПВО', 'працює ППО',
  'позиція ППО', 'позиция ПВО',
];

export function containsAirDefenseInfo(text: string): boolean {
  const lower = text.toLowerCase();
  return AIR_DEFENSE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}
