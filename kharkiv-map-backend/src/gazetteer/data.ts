export interface GazetteerSeedEntry {
  canonical: string;
  lat: number;
  lng: number;
  type: 'neighborhood' | 'village' | 'metro' | 'road' | 'landmark' | 'district' | 'city';
  parent: string | null;
  aliases: string[];
}

export const GAZETTEER_SEED: GazetteerSeedEntry[] = [
  // === Kharkiv city neighborhoods ===
  {
    canonical: 'Олексіївка',
    lat: 50.0300, lng: 36.2000,
    type: 'neighborhood', parent: 'Шевченківський',
    aliases: ['Алексеевка', 'Алексіївка', 'Олексіївський масив', 'Алексеевку'],
  },
  {
    canonical: 'Лісопарк',
    lat: 50.0400, lng: 36.2700,
    type: 'neighborhood', parent: 'Київський',
    aliases: ['Лесопарк', 'Лісопарковий'],
  },
  {
    canonical: 'Салтівка',
    lat: 50.0350, lng: 36.3000,
    type: 'neighborhood', parent: 'Салтівський',
    aliases: ['Салтовка', 'Салтівський масив', 'Салтівський'],
  },
  {
    canonical: 'Сокільники',
    lat: 50.0600, lng: 36.2800,
    type: 'neighborhood', parent: 'Київський',
    aliases: ['Сокольники', 'Сокільницький'],
  },
  {
    canonical: 'ХТЗ',
    lat: 49.9600, lng: 36.3200,
    type: 'neighborhood', parent: 'Індустріальний',
    aliases: ['Тракторний завод', 'Тракторный'],
  },
  {
    canonical: 'Павлове Поле',
    lat: 50.0050, lng: 36.2350,
    type: 'neighborhood', parent: 'Шевченківський',
    aliases: ['Павлово Поле', 'Павлівка'],
  },
  {
    canonical: 'Нові Будинки',
    lat: 50.0500, lng: 36.2200,
    type: 'neighborhood', parent: 'Київський',
    aliases: ['Новые Дома', 'Нові Будинки'],
  },
  {
    canonical: 'Баварія',
    lat: 49.9750, lng: 36.2100,
    type: 'neighborhood', parent: 'Новобаварський',
    aliases: ['Бавария', 'Новая Бавария', 'Нова Баварія'],
  },
  {
    canonical: 'Жихор',
    lat: 49.9300, lng: 36.1600,
    type: 'neighborhood', parent: 'Основ\'янський',
    aliases: ['Жихарь', 'Жихарі'],
  },
  {
    canonical: 'Холодна Гора',
    lat: 49.9900, lng: 36.2000,
    type: 'neighborhood', parent: 'Холодногірський',
    aliases: ['Холодная Гора', 'Холодногірський'],
  },
  {
    canonical: 'Рогань',
    lat: 49.9700, lng: 36.3800,
    type: 'neighborhood', parent: 'Індустріальний',
    aliases: ['Рогань', 'Рогані'],
  },
  {
    canonical: 'Горизонт',
    lat: 50.0200, lng: 36.2900,
    type: 'neighborhood', parent: 'Салтівський',
    aliases: ['Горизонт'],
  },
  {
    canonical: 'Північна Салтівка',
    lat: 50.0500, lng: 36.2900,
    type: 'neighborhood', parent: 'Салтівський',
    aliases: ['Северная Салтовка', 'Пн. Салтівка', 'Северная'],
  },
  {
    canonical: 'Центр',
    lat: 49.9935, lng: 36.2304,
    type: 'neighborhood', parent: 'Шевченківський',
    aliases: ['центр', 'центре', 'Центр Харкова', 'Центр Харькова', 'центром'],
  },

  // === Metro stations ===
  {
    canonical: 'Ст. метро Київська',
    lat: 50.0120, lng: 36.2290,
    type: 'metro', parent: 'Київський',
    aliases: ['М. Киевская', 'м. Київська', 'Киевская', 'Київська метро', 'М. Київська', 'Киевской'],
  },
  {
    canonical: 'Ст. метро Холодна Гора',
    lat: 49.9890, lng: 36.1940,
    type: 'metro', parent: 'Холодногірський',
    aliases: ['м. Холодная Гора', 'Холодная Гора метро', 'м. Холодна Гора'],
  },
  {
    canonical: 'Ст. метро Олексіївська',
    lat: 50.0350, lng: 36.1950,
    type: 'metro', parent: 'Шевченківський',
    aliases: ['м. Алексеевская', 'м. Олексіївська', 'Алексеевская'],
  },
  {
    canonical: 'Ст. метро Героїв Праці',
    lat: 50.0450, lng: 36.3100,
    type: 'metro', parent: 'Салтівський',
    aliases: ['м. Героев Труда', 'Героїв Праці', 'Героев Труда'],
  },
  {
    canonical: 'Ст. метро Студентська',
    lat: 50.0200, lng: 36.2500,
    type: 'metro', parent: 'Салтівський',
    aliases: ['м. Студенческая', 'Студентська', 'Студенческая'],
  },
  {
    canonical: 'Ст. метро Академіка Барабашова',
    lat: 50.0270, lng: 36.2750,
    type: 'metro', parent: 'Салтівський',
    aliases: ['м. Барабашова', 'Барабашова', 'Барабашово', 'Барабашова метро'],
  },

  // === Villages around Kharkiv ===
  {
    canonical: 'Безруки',
    lat: 50.1300, lng: 36.0500,
    type: 'village', parent: 'Дергачівська громада',
    aliases: ['Безруків', 'Безруки'],
  },
  {
    canonical: 'Дергачі',
    lat: 50.1103, lng: 36.1256,
    type: 'village', parent: 'Дергачівська громада',
    aliases: ['Дергачи', 'Дергачів'],
  },
  {
    canonical: 'Черкаська Лозова',
    lat: 50.0800, lng: 36.2100,
    type: 'village', parent: 'Дергачівська громада',
    aliases: ['Черкасская Лозовая', 'Черк. Лозова', 'Черкасской Лозовой'],
  },
  {
    canonical: 'Руська Лозова',
    lat: 50.1200, lng: 36.2800,
    type: 'village', parent: 'Дергачівська громада',
    aliases: ['Русская Лозовая', 'Рус. Лозова', 'Русская Лозовая'],
  },
  {
    canonical: "П'ятихатки",
    lat: 50.0700, lng: 36.1800,
    type: 'village', parent: 'Харків',
    aliases: ['Пятихатки', 'Пятихаткі', 'Пятихаток'],
  },
  {
    canonical: 'Печеніги',
    lat: 49.8800, lng: 36.9300,
    type: 'village', parent: 'Чугуївська громада',
    aliases: ['Печенеги', 'Печенігі', 'Печенег'],
  },
  {
    canonical: 'Малинівка',
    lat: 50.0800, lng: 36.3300,
    type: 'village', parent: 'Харків',
    aliases: ['Малиновка', 'Малинівку'],
  },
  {
    canonical: 'Циркуни',
    lat: 50.0900, lng: 36.2400,
    type: 'village', parent: 'Дергачівська громада',
    aliases: ['Циркуны', 'Циркуні'],
  },
  {
    canonical: 'Липці',
    lat: 50.1600, lng: 36.3500,
    type: 'village', parent: 'Харківська область',
    aliases: ['Липцы', 'Липці'],
  },
  {
    canonical: 'Золочів',
    lat: 50.2800, lng: 35.9700,
    type: 'village', parent: 'Золочівська громада',
    aliases: ['Золочев', 'Золочів'],
  },
  {
    canonical: 'Мерефа',
    lat: 49.8200, lng: 36.0500,
    type: 'village', parent: 'Мерефянська громада',
    aliases: ['Мерефа', 'Мерефу'],
  },
  {
    canonical: 'Люботин',
    lat: 49.9400, lng: 35.9300,
    type: 'village', parent: 'Люботинська громада',
    aliases: ['Люботин'],
  },
  {
    canonical: 'Солоніцівка',
    lat: 49.9900, lng: 36.0200,
    type: 'village', parent: 'Люботинська громада',
    aliases: ['Солоницевка', 'Солоніцівку'],
  },

  // === Oblast cities ===
  {
    canonical: 'Вовчанськ',
    lat: 50.2905, lng: 36.9408,
    type: 'city', parent: 'Харківська область',
    aliases: ['Волчанск', 'Вовчанськ'],
  },
  {
    canonical: "Куп'янськ",
    lat: 49.7139, lng: 37.6148,
    type: 'city', parent: 'Харківська область',
    aliases: ['Купянск', 'Купянськ'],
  },
  {
    canonical: 'Ізюм',
    lat: 49.2098, lng: 37.2615,
    type: 'city', parent: 'Харківська область',
    aliases: ['Изюм', 'Ізюм'],
  },
  {
    canonical: 'Чугуїв',
    lat: 49.8365, lng: 36.6879,
    type: 'city', parent: 'Харківська область',
    aliases: ['Чугуев', 'Чугуїв'],
  },
  {
    canonical: 'Балаклія',
    lat: 49.4628, lng: 36.8596,
    type: 'city', parent: 'Харківська область',
    aliases: ['Балаклея', 'Балаклію'],
  },
  {
    canonical: 'Лозова',
    lat: 48.8896, lng: 36.3192,
    type: 'city', parent: 'Харківська область',
    aliases: ['Лозовая', 'Лозову'],
  },
  {
    canonical: 'Бєлгород',
    lat: 50.5997, lng: 36.5876,
    type: 'city', parent: null,
    aliases: ['Белгород', 'Бєлгорода', 'Белгорода'],
  },

  // === Roads / landmarks ===
  {
    canonical: 'Окружна дорога',
    lat: 50.0500, lng: 36.2300,
    type: 'road', parent: 'Харків',
    aliases: ['окружная', 'окружна', 'окружной', "об'їзна", 'объездная', 'окружную'],
  },
  {
    canonical: 'Французький бульвар',
    lat: 50.0050, lng: 36.2400,
    type: 'landmark', parent: 'Шевченківський',
    aliases: ['Французкий Бульвар', 'Французский бульвар', 'Французький', 'Французкий'],
  },
  {
    canonical: 'Клочківська',
    lat: 50.0080, lng: 36.2450,
    type: 'road', parent: 'Шевченківський',
    aliases: ['Клочковская', 'Клочківська', 'Клочковской'],
  },
  {
    canonical: 'Московський проспект',
    lat: 49.9800, lng: 36.2600,
    type: 'road', parent: 'Слобідський',
    aliases: ['Московский проспект', 'Москпр', 'Московський'],
  },
  {
    canonical: 'Сумська вулиця',
    lat: 50.0000, lng: 36.2300,
    type: 'road', parent: 'Шевченківський',
    aliases: ['Сумская', 'Сумська', 'ул. Сумская'],
  },

  // === Kharkiv city districts ===
  {
    canonical: 'Салтівський район',
    lat: 50.0350, lng: 36.3000,
    type: 'district', parent: 'Харків',
    aliases: ['Салтовский район', 'Салтівський', 'Салтовский'],
  },
  {
    canonical: 'Київський район',
    lat: 50.0300, lng: 36.2100,
    type: 'district', parent: 'Харків',
    aliases: ['Киевский район', 'Київський', 'Киевский'],
  },
  {
    canonical: 'Шевченківський район',
    lat: 50.0100, lng: 36.2200,
    type: 'district', parent: 'Харків',
    aliases: ['Шевченковский район', 'Шевченківський', 'Шевченковский', 'Шевченковський'],
  },
  {
    canonical: 'Холодногірський район',
    lat: 49.9850, lng: 36.1900,
    type: 'district', parent: 'Харків',
    aliases: ['Холодногорский район', 'Холодногірський', 'Холодногорский'],
  },
  {
    canonical: 'Новобаварський район',
    lat: 49.9650, lng: 36.2000,
    type: 'district', parent: 'Харків',
    aliases: ['Новобаварский район', 'Новобаварський', 'Новобаварский'],
  },
  {
    canonical: "Основ'янський район",
    lat: 49.9500, lng: 36.1500,
    type: 'district', parent: 'Харків',
    aliases: ['Основянский район', "Основ'янський", 'Основянский'],
  },
  {
    canonical: 'Слобідський район',
    lat: 49.9800, lng: 36.2600,
    type: 'district', parent: 'Харків',
    aliases: ['Слободской район', 'Слобідський', 'Слободской'],
  },
  {
    canonical: 'Немишлянський район',
    lat: 49.9900, lng: 36.3100,
    type: 'district', parent: 'Харків',
    aliases: ['Немышлянский район', 'Немишлянський', 'Немышлянский'],
  },
  {
    canonical: 'Індустріальний район',
    lat: 49.9600, lng: 36.3500,
    type: 'district', parent: 'Харків',
    aliases: ['Индустриальный район', 'Індустріальний', 'Индустриальный'],
  },
];
