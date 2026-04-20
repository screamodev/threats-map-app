import { AttackVector } from '../types';

export const attackVectors: AttackVector[] = [
  {
    id: 's300',
    weaponNameUk: 'С-300',
    weaponType: 'Зенітна ракета',
    origin: [50.60, 36.58], // Belgorod
    target: [49.99, 36.23], // Kharkiv center
    flightTimeLabel: '~49 сек',
    flightDurationMs: 6000, // animation speed
    directionUk: 'з Бєлгорода',
    color: '#ff4444',
  },
  {
    id: 'kab',
    weaponNameUk: 'КАБ',
    weaponType: 'Керована авіабомба',
    origin: [50.35, 37.10], // NE of Kharkiv
    target: [49.99, 36.23],
    flightTimeLabel: '3–4 хв',
    flightDurationMs: 10000,
    directionUk: 'з північного сходу',
    color: '#ff8800',
  },
  {
    id: 'shahed',
    weaponNameUk: 'Шахед-136',
    weaponType: 'Дрон-камікадзе',
    origin: [49.50, 38.00], // East
    target: [49.99, 36.23],
    flightTimeLabel: '30–60 хв',
    flightDurationMs: 18000,
    directionUk: 'зі сходу',
    color: '#aa66ff',
    dashArray: '8 6',
  },
  {
    id: 'iskander',
    weaponNameUk: 'Іскандер',
    weaponType: 'Балістична ракета',
    origin: [51.05, 35.40], // NW Russia
    target: [49.99, 36.23],
    flightTimeLabel: '~60 сек',
    flightDurationMs: 5000,
    directionUk: 'з північного заходу',
    color: '#ff2266',
  },
];
