import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { config } from '../config.js';

let telegramClient: TelegramClient | null = null;

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (telegramClient) return telegramClient;

  // Load or create session
  let sessionString = '';
  if (existsSync(config.tg.sessionPath)) {
    sessionString = readFileSync(config.tg.sessionPath, 'utf-8').trim();
    console.log('[telegram] Loaded existing session');
  }

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, config.tg.apiId, config.tg.apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => config.tg.phone || await prompt('Phone number: '),
    password: async () => await prompt('2FA password (if enabled): '),
    phoneCode: async () => await prompt('Verification code: '),
    onError: (err) => console.error('[telegram] Auth error:', err),
  });

  // Save session
  const newSession = client.session.save() as unknown as string;
  writeFileSync(config.tg.sessionPath, newSession, { mode: 0o600 });
  console.log('[telegram] Session saved');

  telegramClient = client;
  return client;
}

export async function disconnectTelegram(): Promise<void> {
  if (telegramClient) {
    await telegramClient.disconnect();
    telegramClient = null;
  }
}
