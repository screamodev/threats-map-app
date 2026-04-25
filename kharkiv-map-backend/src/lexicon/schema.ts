import { z } from 'zod';

export const weaponTypeSchema = z.enum([
  'shahed',
  'bpla',
  's300',
  'kab',
  'iskander',
  'missile',
  'unknown',
  'fpv',
  'molniya',
  'lancet',
  'ballistic',
  'rszo',
]);

export type CanonicalWeaponType = z.infer<typeof weaponTypeSchema>;

const locationEntrySchema = z.object({
  canonical: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).default(1),
  notes: z.string().optional(),
});

const weaponEntrySchema = z.object({
  canonical: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).default(1),
});

const phrasePatternSchema = z.object({
  intent: z.string().min(1),
  regex: z.string().min(1),
});

const ambiguousTermSchema = z.object({
  term: z.string().min(1),
  possible_mappings: z.array(z.string().min(1)).default([]),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

const hotspotSchema = z.object({
  canonical: z.string().min(1),
  priority_rank: z.number().int().positive(),
});

export const lexiconSchema = z.object({
  location_dictionary: z.array(locationEntrySchema).default([]),
  weapon_dictionary: z.array(weaponEntrySchema).default([]),
  phrase_patterns: z.array(phrasePatternSchema).default([]),
  top_ambiguous_terms: z.array(ambiguousTermSchema).default([]),
  priority_hotspots: z.array(hotspotSchema).default([]),
});

export type Lexicon = z.infer<typeof lexiconSchema>;
