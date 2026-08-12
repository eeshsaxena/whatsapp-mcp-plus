import type { WAMessage } from "baileys";

/**
 * Bounded in-memory cache of full raw messages, keyed by message id.
 *
 * Some Baileys operations (media download, transcription, true forwarding)
 * require the original message proto, which we do not persist to SQLite. We keep
 * the most recent N in memory so those operations work for recent messages.
 * Older messages return a clear "not in cache" error rather than failing oddly.
 */
const parsedMax = Number(process.env.WAMCP_MSG_CACHE);
// Guard against a non-numeric env value producing NaN (which would disable
// eviction entirely and leak memory).
const MAX = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 2000;
const cache = new Map<string, WAMessage>();

export function rememberMessage(msg: WAMessage): void {
  const id = msg.key?.id;
  if (!id) return;
  if (cache.has(id)) cache.delete(id); // refresh recency
  cache.set(id, msg);
  while (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedMessage(id: string): WAMessage | undefined {
  return cache.get(id);
}

export function cacheSize(): number {
  return cache.size;
}
