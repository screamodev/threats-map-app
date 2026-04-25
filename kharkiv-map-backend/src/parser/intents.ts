import { GENERATED_PHRASE_INTENTS } from '../generated/phrase-intents.js';

type PhraseIntent = (typeof GENERATED_PHRASE_INTENTS)[number]['intent'];

const COMPILED_INTENTS: Array<{ intent: PhraseIntent; regex: RegExp }> = GENERATED_PHRASE_INTENTS.map((item) => ({
  intent: item.intent,
  regex: new RegExp(item.regex, 'i'),
}));

export function detectPhraseIntents(text: string): PhraseIntent[] {
  const found: PhraseIntent[] = [];
  for (const candidate of COMPILED_INTENTS) {
    if (candidate.regex.test(text)) {
      found.push(candidate.intent);
    }
  }
  return found;
}

