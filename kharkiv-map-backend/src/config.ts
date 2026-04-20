import dotenv from 'dotenv';
dotenv.config();

export const config = {
  tg: {
    apiId: parseInt(process.env.TG_API_ID || '0', 10),
    apiHash: process.env.TG_API_HASH || '',
    phone: process.env.TG_PHONE || '',
    channels: (process.env.TG_CHANNELS || '').split(',').filter(Boolean),
    sessionPath: process.env.TG_SESSION_PATH || '.telegram-session',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    contextMessages: parseInt(process.env.OPENAI_CONTEXT_MESSAGES || '6', 10),
    contextWindowMin: parseInt(process.env.OPENAI_CONTEXT_WINDOW_MIN || '20', 10),
  },
  port: parseInt(process.env.PORT || '3001', 10),
  dbPath: process.env.DB_PATH || 'data/kharkiv.db',
};
