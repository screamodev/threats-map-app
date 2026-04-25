import type { LiveIncident } from './types';

interface WeaponVisualMeta {
  shape: 'circle' | 'diamond' | 'triangle' | 'hex' | 'square' | 'pill';
  icon: string;
  iconPath?: string;
  threatNote: string;
}

export interface TargetInfo {
  canonicalType: string;
  interpretedSlang?: string | null;
  confidence: number;
  threatNotes?: string | null;
  detectionSource?: string | null;
  ambiguityFlags?: string[];
}

const DEFAULT_VISUAL: WeaponVisualMeta = {
  shape: 'circle',
  icon: '?',
  threatNote: 'Тип цілі уточнюється, дотримуйтесь базових правил укриття.',
};

const VISUALS: Record<string, WeaponVisualMeta> = {
  shahed: {
    shape: 'diamond',
    icon: 'SH',
    iconPath: '/icons/shahed.png',
    threatNote: 'Повільна, але тривала загроза; можливі маневри над містом.',
  },
  bpla: {
    shape: 'circle',
    icon: 'UAV',
    iconPath: '/icons/bpla.png',
    threatNote: 'Ймовірний дорозвід/удар, маршрут може швидко змінюватись.',
  },
  fpv: {
    shape: 'triangle',
    icon: 'FPV',
    threatNote: 'Низька висота і коротке плече, критично важлива швидка реакція.',
  },
  molniya: {
    shape: 'hex',
    icon: 'M',
    threatNote: 'Швидший БпЛА з ризиком раптової зміни напряму.',
  },
  lancet: {
    shape: 'square',
    icon: 'L',
    threatNote: 'Баражуючий боєприпас, небезпечний для відкритої місцевості.',
  },
  ballistic: {
    shape: 'pill',
    icon: 'B',
    threatNote: 'Балістична загроза з мінімальним підльотним часом.',
  },
  rszo: {
    shape: 'square',
    icon: 'R',
    iconPath: '/icons/rszo.png',
    threatNote: 'Залпові ураження, можливі серії з короткими інтервалами.',
  },
  missile: {
    shape: 'triangle',
    icon: 'MS',
    threatNote: 'Ракетна загроза, слідкуйте за оновленнями напрямку польоту.',
  },
  iskander: {
    shape: 'pill',
    icon: 'ISK',
    threatNote: 'Висока швидкість ураження, рекомендоване негайне укриття.',
  },
  s300: {
    shape: 'pill',
    icon: 'S3',
    threatNote: 'Високошвидкісна загроза, не ігноруйте навіть короткі попередження.',
  },
  kab: {
    shape: 'hex',
    icon: 'KAB',
    threatNote: 'Керована авіабомба, ризик ураження поблизу лінії заходу.',
  },
};

export function getWeaponVisualMeta(weaponType: string): WeaponVisualMeta {
  return VISUALS[weaponType] ?? DEFAULT_VISUAL;
}

export function getTargetInfo(inc: LiveIncident): TargetInfo {
  const meta = getWeaponVisualMeta(inc.weaponType);
  return {
    canonicalType: inc.weaponType,
    interpretedSlang: inc.weaponTypeLabel,
    confidence: inc.confidence,
    threatNotes: meta.threatNote,
    detectionSource: 'live-correlation',
    ambiguityFlags:
      inc.confidence < 0.65
        ? ['low_confidence']
        : [],
  };
}
