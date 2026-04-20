import { DistrictRisk } from '../types';

export const districtRisks: DistrictRisk[] = [
  {
    id: 'saltivskyi',
    nameUk: 'Салтівський',
    riskLevel: 'high',
    description: 'Найближчий до лінії фронту на північному сході. Найбільш обстрілюваний район міста з 2022 року. Масові руйнування житлового фонду.',
    hasMetro: true,
  },
  {
    id: 'kyivskyi',
    nameUk: 'Київський',
    riskLevel: 'high',
    description: 'Північна частина міста, під постійним обстрілом С-300 з Бєлгорода. Близькість до кордону робить район вкрай вразливим.',
    hasMetro: true,
  },
  {
    id: 'shevchenkivskyi',
    nameUk: 'Шевченківський',
    riskLevel: 'medium',
    description: 'Центральний район. Зазнає ударів КАБами та ракетами, але менше ніж північні райони.',
    hasMetro: true,
  },
  {
    id: 'nemyshlianskyi',
    nameUk: 'Немишлянський',
    riskLevel: 'medium',
    description: 'Східний район, вразливий до ударів з напрямку Вовчанська та Куп\'янська.',
    hasMetro: true,
  },
  {
    id: 'industrialnyi',
    nameUk: 'Індустріальний',
    riskLevel: 'medium',
    description: 'Промислова зона на сході. Періодичні обстріли інфраструктурних об\'єктів.',
    hasMetro: false,
  },
  {
    id: 'kholodnohirskyi',
    nameUk: 'Холодногірський',
    riskLevel: 'med-low',
    description: 'Центрально-західний район. Відносно захищений завдяки розташуванню та рельєфу.',
    hasMetro: true,
  },
  {
    id: 'slobidskyi',
    nameUk: 'Слобідський',
    riskLevel: 'med-low',
    description: 'Південно-центральний район. Менша інтенсивність обстрілів порівняно з північними районами.',
    hasMetro: true,
  },
  {
    id: 'novobavarskyi',
    nameUk: 'Новобаварський',
    riskLevel: 'low',
    description: 'Південний район, найвіддаленіший від лінії фронту. Найбезпечніший для проживання.',
    hasMetro: false,
  },
  {
    id: 'osnovianskyi',
    nameUk: 'Основ\'янський',
    riskLevel: 'low',
    description: 'Південно-західний район. Максимальна відстань від кордону з РФ забезпечує відносну безпеку.',
    hasMetro: true,
  },
];

// Map OSM district names to our IDs
export const osmNameToId: Record<string, string> = {
  'Салтівський район': 'saltivskyi',
  'Київський район': 'kyivskyi',
  'Шевченківський район': 'shevchenkivskyi',
  'Холодногірський район': 'kholodnohirskyi',
  'Новобаварський район': 'novobavarskyi',
  'Основ\'янський район': 'osnovianskyi',
  'Слобідський район': 'slobidskyi',
  'Немишлянський район': 'nemyshlianskyi',
  'Індустріальний район': 'industrialnyi',
  // Alternate names without "район"
  'Салтівський': 'saltivskyi',
  'Київський': 'kyivskyi',
  'Шевченківський': 'shevchenkivskyi',
  'Холодногірський': 'kholodnohirskyi',
  'Новобаварський': 'novobavarskyi',
  'Основ\'янський': 'osnovianskyi',
  'Слобідський': 'slobidskyi',
  'Немишлянський': 'nemyshlianskyi',
  'Індустріальний': 'industrialnyi',
};
