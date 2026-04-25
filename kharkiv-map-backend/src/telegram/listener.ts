import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { Raw } from 'telegram/events/Raw.js';
import type { Entity } from 'telegram/define.js';
import { getTelegramClient } from './client.js';
import { insertRawMessage } from '../db/client.js';
import { config } from '../config.js';

export type MessageCallback = (
  text: string,
  rawMessageId: number,
  channelName: string,
  timestamp: number,
  replyToTelegramId?: number | null,
  groupedId?: number | null,
) => void;

function toNumericOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object' && value && 'toString' in value && typeof value.toString === 'function') {
    const n = Number(value.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function startListening(onMessage: MessageCallback): Promise<void> {
  const client = await getTelegramClient();
  const channels = config.tg.channels;

  if (channels.length === 0) {
    console.warn('[telegram] No channels configured. Set TG_CHANNELS in .env');
    return;
  }

  console.log(`[telegram] Subscribing to ${channels.length} channels: ${channels.join(', ')}`);

  // Prime the update stream. Without this call, GramJS often does not receive
  // UpdateNewChannelMessage updates until the user opens the channel in a
  // real client. Fetching dialogs forces the server to start streaming updates
  // for all subscribed channels.
  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    console.log(`[telegram] Primed update stream (${dialogs.length} dialogs loaded)`);
  } catch (err) {
    console.warn('[telegram] Could not load dialogs (updates may be delayed):', err);
  }

  // Resolve channel entities
  const channelEntities: Array<{ id: number; name: string; entity: Entity }> = [];
  for (const ch of channels) {
    try {
      const entity = await client.getEntity(ch);
      const id = Number(entity.id);
      channelEntities.push({ id, name: ch, entity });
      console.log(`[telegram] Resolved channel: ${ch} → ${id}`);
    } catch (err) {
      console.error(`[telegram] Failed to resolve channel: ${ch}`, err);
    }
  }

  if (channelEntities.length === 0) {
    console.error('[telegram] No channels could be resolved');
    return;
  }

  const channelIds = new Set(channelEntities.map(c => c.id));
  const channelNameMap = new Map(channelEntities.map(c => [c.id, c.name]));

  const debug = process.env.TG_DEBUG === '1';

  // Always-on raw catch-all. Logs the class name of every update GramJS
  // dispatches, plus the channelId when present.
  client.addEventHandler((update: unknown) => {
    const u = update as {
      className?: string;
      channelId?: { toString?: () => string } | number | string;
      message?: { peerId?: { channelId?: { toString?: () => string } | number | string } };
    } | undefined;
    if (!u || !u.className) return;
    let chId: string | undefined;
    const rawCh = u.channelId ?? u.message?.peerId?.channelId;
    if (rawCh !== undefined && rawCh !== null) {
      chId = typeof rawCh === 'object' ? rawCh.toString?.() : String(rawCh);
    }
    console.log(`[telegram:raw] ${u.className}${chId ? ` ch=${chId}` : ''}`);
  }, new Raw({}));

  // Heartbeat: proves the Node event loop is alive and confirms the user is
  // still considered connected.
  setInterval(async () => {
    try {
      const connected = client.connected ?? false;
      console.log(`[telegram:heartbeat] connected=${connected}`);
    } catch (err) {
      console.warn('[telegram:heartbeat] error:', err);
    }
  }, 30_000).unref();

  client.addEventHandler(async (event: NewMessageEvent) => {
    const message = event.message;
    if (!message) {
      if (debug) console.log('[telegram:debug] event with no message');
      return;
    }

    const peerId = message.peerId;
    const rawChannelId = peerId && 'channelId' in peerId ? Number(peerId.channelId) : null;
    const textPreview = (message.text || '').slice(0, 80);

    if (debug) {
      console.log(
        `[telegram:debug] peer=${peerId?.className ?? 'n/a'} channelId=${rawChannelId} text="${textPreview}"`,
      );
    }

    if (!peerId) return;
    if (!rawChannelId || !channelIds.has(rawChannelId)) {
      if (debug) console.log('[telegram:debug] channel not in subscription set; skipping');
      return;
    }

    if (!message.text) {
      if (debug) console.log('[telegram:debug] message has no text (media without caption?); skipping');
      return;
    }

    const channelName = channelNameMap.get(rawChannelId) || 'unknown';
    const text = message.text;
    const timestamp = message.date || Math.floor(Date.now() / 1000);
    const replyToTelegramId = toNumericOrNull(
      (message as unknown as { replyTo?: { replyToMsgId?: unknown } }).replyTo?.replyToMsgId,
    );
    const groupedId = toNumericOrNull(
      (message as unknown as { groupedId?: unknown }).groupedId,
    );

    const rawId = insertRawMessage(
      message.id,
      rawChannelId,
      channelName,
      text,
      timestamp,
      replyToTelegramId,
      groupedId,
    );

    if (rawId > 0) {
      console.log(`[telegram] New message from ${channelName}: ${text.slice(0, 80)}...`);
      onMessage(text, rawId, channelName, timestamp, replyToTelegramId, groupedId);
    } else if (debug) {
      console.log('[telegram:debug] duplicate message (ignored by INSERT OR IGNORE)');
    }
  }, new NewMessage({}));

  console.log('[telegram] Listening for new messages...');

  // --- Polling fallback ---------------------------------------------------
  // Some user-client sessions do not receive UpdateNewChannelMessage push for
  // specific channels (Telegram throttles broadcast delivery per session).
  // We poll each channel every POLL_INTERVAL_MS and dispatch any messages
  // whose Telegram ID is higher than the last one we've seen. The DB's
  // INSERT OR IGNORE on (channel_id, telegram_id) deduplicates against
  // messages also delivered via push, so running both is safe.
  const POLL_INTERVAL_MS = Number(process.env.TG_POLL_INTERVAL_MS || 15_000);
  const lastSeenId = new Map<number, number>();

  // Seed lastSeenId with the most recent message currently in the channel so
  // we don't re-process historical posts on first poll.
  for (const c of channelEntities) {
    try {
      const msgs = await client.getMessages(c.entity, { limit: 1 });
      const topId = msgs[0]?.id ?? 0;
      lastSeenId.set(c.id, topId);
      if (debug) console.log(`[telegram:poll] seeded ${c.name} lastId=${topId}`);
    } catch (err) {
      console.warn(`[telegram:poll] seed failed for ${c.name}:`, err);
      lastSeenId.set(c.id, 0);
    }
  }

  async function pollOnce() {
    for (const c of channelEntities) {
      try {
        const minId = lastSeenId.get(c.id) ?? 0;
        const msgs = await client.getMessages(c.entity, { limit: 20, minId });
        if (!msgs.length) continue;

        // Messages come newest-first; iterate oldest→newest so trajectory order is preserved.
        const sorted = [...msgs].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        for (const m of sorted) {
          const mid = m.id ?? 0;
          if (mid <= minId) continue;
          lastSeenId.set(c.id, Math.max(lastSeenId.get(c.id) ?? 0, mid));

          const text = m.text || '';
          if (!text) {
            if (debug) console.log(`[telegram:poll] ${c.name} msg ${mid} has no text, skipping`);
            continue;
          }
          const ts = m.date || Math.floor(Date.now() / 1000);
          const replyToTelegramId = toNumericOrNull(
            (m as unknown as { replyTo?: { replyToMsgId?: unknown } }).replyTo?.replyToMsgId,
          );
          const groupedId = toNumericOrNull((m as unknown as { groupedId?: unknown }).groupedId);
          const rawId = insertRawMessage(mid, c.id, c.name, text, ts, replyToTelegramId, groupedId);
          if (rawId > 0) {
            console.log(`[telegram:poll] New message from ${c.name}: ${text.slice(0, 80)}...`);
            onMessage(text, rawId, c.name, ts, replyToTelegramId, groupedId);
          } else if (debug) {
            console.log(`[telegram:poll] ${c.name} msg ${mid} already stored (dedup)`);
          }
        }
      } catch (err) {
        console.warn(`[telegram:poll] failed for ${c.name}:`, err);
      }
    }
  }

  setInterval(() => {
    pollOnce().catch((err) => console.warn('[telegram:poll] tick error:', err));
  }, POLL_INTERVAL_MS).unref();

  console.log(`[telegram] Polling every ${POLL_INTERVAL_MS}ms as fallback`);
}
