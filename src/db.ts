import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { proto, type WAMessage } from "baileys";
import { config, ensureDirs } from "./config.ts";

/**
 * Storage layer. Derived from whatsapp-mcp-ts (ISC) and extended with:
 *  - sent_log         : rate-limiting / anti-ban accounting
 *  - allowlist        : explicit send permissions
 *  - settings         : persisted runtime settings (e.g. current mode override)
 *  - richer message columns (message_type, media_type) for key reconstruction
 *  - analytics queries used by the "WhatsApp Wrapped" feature
 *
 * Uses Node's built-in node:sqlite (DatabaseSync) — no native build step, which
 * is a core part of the zero-setup goal.
 */

export interface Chat {
  jid: string;
  name?: string | null;
  last_message_time?: Date | null;
  last_message?: string | null;
  last_sender?: string | null;
  last_is_from_me?: boolean | null;
}

export interface Message {
  id: string;
  chat_jid: string;
  sender?: string | null;
  content: string;
  timestamp: Date;
  is_from_me: boolean;
  chat_name?: string | null;
  message_type?: string | null;
  media_type?: string | null;
  /** base64 of the encoded proto.WebMessageInfo (for media download / forward). */
  raw?: string | null;
}

let dbInstance: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!dbInstance) {
    ensureDirs();
    dbInstance = new DatabaseSync(path.join(config.dataDir, "whatsapp.db"));
  }
  return dbInstance;
}

export function initializeDatabase(): DatabaseSync {
  const db = getDb();
  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      message_type TEXT,
      media_type TEXT,
      raw TEXT,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      notify TEXT,
      phone_number TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      recipient TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS allowlist (
      jid TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages (chat_jid);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_last_message_time ON chats (last_message_time);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_log_ts ON sent_log (ts);`);

  // Best-effort migration for older DBs missing the new columns.
  for (const col of ["message_type", "media_type", "raw"]) {
    try {
      db.exec(`ALTER TABLE messages ADD COLUMN ${col} TEXT`);
    } catch {
      /* column already exists */
    }
  }

  return db;
}

/**
 * Escape LIKE wildcards so a user searching for "%" or "_" gets literal matches
 * instead of matching everything. Pair with `LIKE ? ESCAPE '\'`.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

function parseDateSafe(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    chat_jid: row.chat_jid,
    sender: row.sender,
    content: row.content,
    timestamp: parseDateSafe(row.timestamp)!,
    is_from_me: Boolean(row.is_from_me),
    chat_name: row.chat_name,
    message_type: row.message_type,
    media_type: row.media_type,
  };
}

function rowToChat(row: any): Chat {
  return {
    jid: row.jid,
    name: row.name,
    last_message_time: parseDateSafe(row.last_message_time),
    last_message: row.last_message,
    last_sender: row.last_sender,
    last_is_from_me: row.last_is_from_me !== null && row.last_is_from_me !== undefined
      ? Boolean(row.last_is_from_me)
      : null,
  };
}

/* ------------------------------------------------------------------ writes */

export function storeChat(chat: Partial<Chat> & { jid: string }): void {
  const db = getDb();
  try {
    const stmt = db.prepare(`
      INSERT INTO chats (jid, name, last_message_time)
      VALUES (@jid, @name, @last_message_time)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(excluded.name, name),
        last_message_time = COALESCE(excluded.last_message_time, last_message_time)
    `);
    stmt.run({
      jid: chat.jid,
      name: chat.name ?? null,
      last_message_time:
        chat.last_message_time instanceof Date
          ? chat.last_message_time.toISOString()
          : chat.last_message_time == null
            ? null
            : String(chat.last_message_time),
    });
  } catch (e) {
    console.error("storeChat error", e);
  }
}

export function storeMessage(message: Message): void {
  const db = getDb();
  try {
    storeChat({ jid: message.chat_jid, last_message_time: message.timestamp });
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO messages
        (id, chat_jid, sender, content, timestamp, is_from_me, message_type, media_type, raw)
      VALUES (@id, @chat_jid, @sender, @content, @timestamp, @is_from_me, @message_type, @media_type, @raw)
    `);
    stmt.run({
      id: message.id,
      chat_jid: message.chat_jid,
      sender: message.sender ?? null,
      content: message.content,
      timestamp: message.timestamp.toISOString(),
      is_from_me: message.is_from_me ? 1 : 0,
      message_type: message.message_type ?? null,
      media_type: message.media_type ?? null,
      raw: message.raw ?? null,
    });
    db.prepare(`
      UPDATE chats
      SET last_message_time = MAX(COALESCE(last_message_time, '1970-01-01T00:00:00.000Z'), @ts)
      WHERE jid = @jid
    `).run({ ts: message.timestamp.toISOString(), jid: message.chat_jid });
  } catch (e) {
    console.error("storeMessage error", e);
  }
}

export function storeContact(contact: {
  jid: string;
  name?: string | null;
  notify?: string | null;
  phoneNumber?: string | null;
}): void {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO contacts (jid, name, notify, phone_number)
      VALUES (@jid, @name, @notify, @phone_number)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(excluded.name, name),
        notify = COALESCE(excluded.notify, notify),
        phone_number = COALESCE(excluded.phone_number, phone_number)
    `).run({
      jid: contact.jid,
      name: contact.name ?? null,
      notify: contact.notify ?? null,
      phone_number: contact.phoneNumber ?? null,
    });
  } catch (e) {
    console.error("storeContact error", e);
  }
}

/* ------------------------------------------------------------------- reads */

export interface DateRange {
  after?: string | null;
  before?: string | null;
}

export function getMessages(
  chatJid: string,
  limit = 20,
  page = 0,
  range?: DateRange,
): Message[] {
  const db = getDb();
  try {
    let sql = `
      SELECT m.*, c.name as chat_name
      FROM messages m JOIN chats c ON m.chat_jid = c.jid
      WHERE m.chat_jid = ?
    `;
    const params: (string | number)[] = [chatJid];
    if (range?.after) { sql += ` AND m.timestamp >= ?`; params.push(range.after); }
    if (range?.before) { sql += ` AND m.timestamp <= ?`; params.push(range.before); }
    sql += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, page * limit);
    return (db.prepare(sql).all(...params) as any[]).map(rowToMessage);
  } catch (e) {
    console.error("getMessages error", e);
    return [];
  }
}

/** Most recent message in a chat, or null. */
export function getLastInteraction(chatJid: string): Message | null {
  const db = getDb();
  try {
    const row = db.prepare(`
      SELECT m.*, c.name as chat_name
      FROM messages m JOIN chats c ON m.chat_jid = c.jid
      WHERE m.chat_jid = ?
      ORDER BY m.timestamp DESC LIMIT 1
    `).get(chatJid) as any | undefined;
    return row ? rowToMessage(row) : null;
  } catch (e) {
    console.error("getLastInteraction error", e);
    return null;
  }
}

export function getChats(
  limit = 20,
  page = 0,
  sortBy: "last_active" | "name" = "last_active",
  query?: string | null,
  includeLastMessage = true,
): Chat[] {
  const db = getDb();
  try {
    let sql = `
      SELECT c.jid,
             COALESCE(c.name, ct.name, ct.notify, ct.phone_number) as name,
             c.last_message_time
             ${includeLastMessage ? `,
             (SELECT m.content FROM messages m WHERE m.chat_jid = c.jid ORDER BY m.timestamp DESC LIMIT 1) as last_message,
             (SELECT m.sender FROM messages m WHERE m.chat_jid = c.jid ORDER BY m.timestamp DESC LIMIT 1) as last_sender,
             (SELECT m.is_from_me FROM messages m WHERE m.chat_jid = c.jid ORDER BY m.timestamp DESC LIMIT 1) as last_is_from_me
             ` : ""}
      FROM chats c LEFT JOIN contacts ct ON c.jid = ct.jid
    `;
    const params: (string | number)[] = [];
    if (query) {
      const like = `%${escapeLike(query)}%`;
      sql += ` WHERE (LOWER(COALESCE(c.name, ct.name, ct.notify, ct.phone_number)) LIKE LOWER(?) ESCAPE '\\' OR c.jid LIKE ? ESCAPE '\\')`;
      params.push(like, like);
    }
    sql += sortBy === "last_active"
      ? ` ORDER BY c.last_message_time DESC NULLS LAST, c.jid ASC`
      : ` ORDER BY COALESCE(c.name, ct.name, ct.notify, ct.phone_number) ASC, c.jid ASC`;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, page * limit);
    return (db.prepare(sql).all(...params) as any[]).map(rowToChat);
  } catch (e) {
    console.error("getChats error", e);
    return [];
  }
}

export function getGroupChats(limit = 50, page = 0): Chat[] {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT c.jid, COALESCE(c.name, ct.name) as name, c.last_message_time
      FROM chats c LEFT JOIN contacts ct ON c.jid = ct.jid
      WHERE c.jid LIKE '%@g.us'
      ORDER BY c.last_message_time DESC NULLS LAST
      LIMIT ? OFFSET ?
    `).all(limit, page * limit) as any[];
    return rows.map(rowToChat);
  } catch (e) {
    console.error("getGroupChats error", e);
    return [];
  }
}

export function getChat(jid: string, includeLastMessage = true): Chat | null {
  const db = getDb();
  try {
    const sql = `
      SELECT c.jid,
             COALESCE(c.name, ct.name, ct.notify, ct.phone_number) as name,
             c.last_message_time
             ${includeLastMessage ? `,
             (SELECT m.content FROM messages m WHERE m.chat_jid = c.jid ORDER BY m.timestamp DESC LIMIT 1) as last_message,
             (SELECT m.sender FROM messages m WHERE m.chat_jid = c.jid ORDER BY m.timestamp DESC LIMIT 1) as last_sender,
             (SELECT m.is_from_me FROM messages m WHERE m.chat_jid = c.jid ORDER BY m.timestamp DESC LIMIT 1) as last_is_from_me
             ` : ""}
      FROM chats c LEFT JOIN contacts ct ON c.jid = ct.jid
      WHERE c.jid = ?
    `;
    const row = db.prepare(sql).get(jid) as any | undefined;
    return row ? rowToChat(row) : null;
  } catch (e) {
    console.error("getChat error", e);
    return null;
  }
}

export function getMessageById(messageId: string): Message | null {
  const db = getDb();
  try {
    const row = db.prepare(`
      SELECT m.*, c.name as chat_name
      FROM messages m JOIN chats c ON m.chat_jid = c.jid
      WHERE m.id = ? LIMIT 1
    `).get(messageId) as any | undefined;
    return row ? rowToMessage(row) : null;
  } catch (e) {
    console.error("getMessageById error", e);
    return null;
  }
}

/** Encode a raw Baileys message to a base64 string for storage. */
export function encodeRawMessage(msg: WAMessage): string | null {
  try {
    return Buffer.from(proto.WebMessageInfo.encode(msg as any).finish()).toString("base64");
  } catch {
    return null;
  }
}

/** Decode a stored raw message back into a Baileys WAMessage, or null. */
export function getRawMessage(messageId: string): WAMessage | null {
  const db = getDb();
  try {
    const row = db.prepare(
      `SELECT raw FROM messages WHERE id = ? AND raw IS NOT NULL LIMIT 1`,
    ).get(messageId) as any | undefined;
    if (!row?.raw) return null;
    return proto.WebMessageInfo.decode(Buffer.from(row.raw, "base64")) as WAMessage;
  } catch (e) {
    console.error("getRawMessage error", e);
    return null;
  }
}

export function getMessagesAround(
  messageId: string,
  before = 5,
  after = 5,
): { before: Message[]; target: Message | null; after: Message[] } {
  const db = getDb();
  const result = { before: [] as Message[], target: null as Message | null, after: [] as Message[] };
  try {
    const targetRow = db.prepare(`
      SELECT m.*, c.name as chat_name
      FROM messages m JOIN chats c ON m.chat_jid = c.jid
      WHERE m.id = ?
    `).get(messageId) as any | undefined;
    if (!targetRow) return result;
    result.target = rowToMessage(targetRow);
    const ts = result.target.timestamp.toISOString();
    const chatJid = result.target.chat_jid;
    result.before = (db.prepare(`
      SELECT m.*, c.name as chat_name FROM messages m JOIN chats c ON m.chat_jid = c.jid
      WHERE m.chat_jid = ? AND m.timestamp < ? ORDER BY m.timestamp DESC LIMIT ?
    `).all(chatJid, ts, before) as any[]).map(rowToMessage).reverse();
    result.after = (db.prepare(`
      SELECT m.*, c.name as chat_name FROM messages m JOIN chats c ON m.chat_jid = c.jid
      WHERE m.chat_jid = ? AND m.timestamp > ? ORDER BY m.timestamp ASC LIMIT ?
    `).all(chatJid, ts, after) as any[]).map(rowToMessage);
    return result;
  } catch (e) {
    console.error("getMessagesAround error", e);
    return result;
  }
}

export function searchDbForContacts(query: string, limit = 20): { jid: string; name: string | null }[] {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT jid, COALESCE(name, notify, phone_number, jid) AS display_name
      FROM contacts
      WHERE LOWER(COALESCE(name, notify, phone_number, jid)) LIKE LOWER(?) ESCAPE '\\'
      LIMIT ?
    `).all(`%${escapeLike(query)}%`, limit) as { jid: string; display_name: string | null }[];
    return rows.map((r) => ({ jid: r.jid, name: r.display_name }));
  } catch (e) {
    console.error("searchDbForContacts error", e);
    return [];
  }
}

export function searchMessages(searchQuery: string, chatJid?: string | null, limit = 10, page = 0): Message[] {
  const db = getDb();
  try {
    let sql = `
      SELECT m.*, COALESCE(c.name, ct.name, ct.notify, ct.phone_number) as chat_name
      FROM messages m JOIN chats c ON m.chat_jid = c.jid
      LEFT JOIN contacts ct ON c.jid = ct.jid
      WHERE LOWER(m.content) LIKE LOWER(?) ESCAPE '\\'
    `;
    const params: (string | number | null)[] = [`%${escapeLike(searchQuery)}%`];
    if (chatJid) { sql += ` AND m.chat_jid = ?`; params.push(chatJid); }
    sql += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, page * limit);
    return (db.prepare(sql).all(...params) as any[]).map(rowToMessage);
  } catch (e) {
    console.error("searchMessages error", e);
    return [];
  }
}

/* --------------------------------------------------- allowlist / relations */

/**
 * A recipient is "known" (safe to message) if any of:
 *   - they are in our contacts
 *   - they have messaged us before (inbound message exists)
 *   - they were explicitly added to the allowlist
 */
export function isKnownRecipient(jid: string): boolean {
  const db = getDb();
  try {
    const inContacts = db.prepare(`SELECT 1 FROM contacts WHERE jid = ? LIMIT 1`).get(jid);
    if (inContacts) return true;
    const inbound = db.prepare(
      `SELECT 1 FROM messages WHERE chat_jid = ? AND is_from_me = 0 LIMIT 1`,
    ).get(jid);
    if (inbound) return true;
    const allowed = db.prepare(`SELECT 1 FROM allowlist WHERE jid = ? LIMIT 1`).get(jid);
    return Boolean(allowed);
  } catch (e) {
    console.error("isKnownRecipient error", e);
    return false;
  }
}

export function addToAllowlist(jid: string): void {
  getDb().prepare(`INSERT OR IGNORE INTO allowlist (jid, added_at) VALUES (?, ?)`)
    .run(jid, new Date().toISOString());
}

export function removeFromAllowlist(jid: string): void {
  getDb().prepare(`DELETE FROM allowlist WHERE jid = ?`).run(jid);
}

export function listAllowlist(): string[] {
  return (getDb().prepare(`SELECT jid FROM allowlist ORDER BY added_at DESC`).all() as any[])
    .map((r) => r.jid as string);
}

/* --------------------------------------------------------- rate accounting */

export function logSend(recipient: string): void {
  getDb().prepare(`INSERT INTO sent_log (ts, recipient) VALUES (?, ?)`)
    .run(new Date().toISOString(), recipient);
}

export function countSendsSince(sinceIso: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) as n FROM sent_log WHERE ts >= ?`).get(sinceIso) as any;
  return row?.n ?? 0;
}

export function lastSendTime(): Date | null {
  const row = getDb().prepare(`SELECT ts FROM sent_log ORDER BY ts DESC LIMIT 1`).get() as any;
  return row ? parseDateSafe(row.ts) : null;
}

/* ------------------------------------------------------------- settings kv */

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

/* --------------------------------------------------------------- analytics */

export interface WrappedStats {
  totalMessages: number;
  sent: number;
  received: number;
  firstMessage: Date | null;
  lastMessage: Date | null;
  topContacts: { jid: string; name: string | null; count: number }[];
  busiestHour: { hour: number; count: number } | null;
  busiestDay: { day: string; count: number } | null;
  topEmojis: { emoji: string; count: number }[];
  activeChats: number;
  wordsSent: number;
  longestStreakDays: number;
}

const STOPWORDS = new Set([
  "the", "and", "you", "for", "are", "but", "not", "was", "this", "that", "with",
  "have", "your", "will", "can", "just", "get", "got", "its", "it's", "i'm", "im",
  "was", "yeah", "yes", "no", "ok", "okay", "lol", "haha", "hey", "hi", "hello",
  "there", "what", "when", "how", "why", "who", "all", "any", "out", "now", "one",
  "about", "like", "know", "dont", "don't", "cant", "can't", "would", "could",
  "should", "from", "they", "them", "then", "than", "here", "some", "want", "going",
]);

/** Word-frequency across messages (optionally a single chat), stopword filtered. */
export function computeTopWords(
  chatJid?: string | null,
  limit = 20,
  sinceIso?: string | null,
): { word: string; count: number }[] {
  const db = getDb();
  const since = sinceIso ?? "1970-01-01T00:00:00.000Z";
  let sql = `SELECT content FROM messages WHERE timestamp >= ?`;
  const params: (string | number)[] = [since];
  if (chatJid) { sql += ` AND chat_jid = ?`; params.push(chatJid); }
  const rows = db.prepare(sql).all(...params) as any[];

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const words = String(r.content || "")
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, " ") // strip our [Image]/[Voice]/... markers
      .match(/[a-z']{3,}/g);
    if (!words) continue;
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      counts[w] = (counts[w] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

export function computeWrapped(sinceIso?: string | null, topN = 10): WrappedStats {
  const db = getDb();
  // Always filter with a positional since (epoch when unbounded) to keep the
  // node:sqlite binding types simple and consistent.
  const since = sinceIso ?? "1970-01-01T00:00:00.000Z";

  const totals = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN is_from_me = 1 THEN 1 ELSE 0 END) as sent,
           SUM(CASE WHEN is_from_me = 0 THEN 1 ELSE 0 END) as received,
           MIN(timestamp) as first_ts,
           MAX(timestamp) as last_ts,
           COUNT(DISTINCT chat_jid) as active_chats
    FROM messages WHERE timestamp >= ?
  `).get(since) as any;

  const topContacts = (db.prepare(`
    SELECT m.chat_jid as jid,
           COALESCE(c.name, ct.name, ct.notify, ct.phone_number) as name,
           COUNT(*) as count
    FROM messages m
    JOIN chats c ON m.chat_jid = c.jid
    LEFT JOIN contacts ct ON c.jid = ct.jid
    WHERE m.timestamp >= ? AND m.chat_jid NOT LIKE '%@g.us'
    GROUP BY m.chat_jid
    ORDER BY count DESC
    LIMIT ?
  `).all(since, topN) as any[]).map((r) => ({
    jid: r.jid, name: r.name, count: r.count,
  }));

  // Busiest hour / day computed in JS from timestamps (portable across sqlite builds).
  const rows = db.prepare(`SELECT timestamp FROM messages WHERE timestamp >= ?`).all(since) as any[];
  const hourCounts = new Array(24).fill(0);
  const dayCounts: Record<string, number> = {};
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const r of rows) {
    const d = parseDateSafe(r.timestamp);
    if (!d) continue;
    hourCounts[d.getHours()]++;
    const dn = days[d.getDay()]!;
    dayCounts[dn] = (dayCounts[dn] ?? 0) + 1;
  }
  let busiestHour: { hour: number; count: number } | null = null;
  hourCounts.forEach((c, h) => {
    if (!busiestHour || c > busiestHour.count) busiestHour = { hour: h, count: c };
  });
  let busiestDay: { day: string; count: number } | null = null;
  for (const [day, count] of Object.entries(dayCounts)) {
    if (!busiestDay || count > busiestDay.count) busiestDay = { day, count };
  }

  // Emoji frequency across message content.
  const emojiRegex = /(\p{Extended_Pictographic})/gu;
  const emojiCounts: Record<string, number> = {};
  const contentRows = db.prepare(`SELECT content FROM messages WHERE timestamp >= ?`).all(since) as any[];
  for (const r of contentRows) {
    const matches = String(r.content || "").match(emojiRegex);
    if (matches) for (const e of matches) emojiCounts[e] = (emojiCounts[e] ?? 0) + 1;
  }
  const topEmojis = Object.entries(emojiCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([emoji, count]) => ({ emoji, count }));

  // Words I sent.
  const myContent = db.prepare(
    `SELECT content FROM messages WHERE is_from_me = 1 AND timestamp >= ?`,
  ).all(since) as any[];
  let wordsSent = 0;
  for (const r of myContent) {
    const m = String(r.content || "").replace(/\[[^\]]*\]/g, " ").match(/\S+/g);
    if (m) wordsSent += m.length;
  }

  // Longest streak of consecutive active days.
  const daySet = new Set<string>();
  for (const r of rows) {
    const d = parseDateSafe(r.timestamp);
    if (d) daySet.add(d.toISOString().slice(0, 10));
  }
  const sortedDays = [...daySet].sort();
  let longestStreakDays = sortedDays.length ? 1 : 0;
  let run = sortedDays.length ? 1 : 0;
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1]!).getTime();
    const cur = new Date(sortedDays[i]!).getTime();
    if (cur - prev === 864e5) { run++; longestStreakDays = Math.max(longestStreakDays, run); }
    else run = 1;
  }

  return {
    totalMessages: totals?.total ?? 0,
    sent: totals?.sent ?? 0,
    received: totals?.received ?? 0,
    firstMessage: parseDateSafe(totals?.first_ts),
    lastMessage: parseDateSafe(totals?.last_ts),
    topContacts,
    busiestHour,
    busiestDay,
    topEmojis,
    activeChats: totals?.active_chats ?? 0,
    wordsSent,
    longestStreakDays,
  };
}

export interface ChatStats {
  chat_jid: string;
  name: string | null;
  total: number;
  sent: number;
  received: number;
  firstMessage: Date | null;
  lastMessage: Date | null;
  myMessageShare: number; // 0..1
  avgMyResponseSec: number | null; // avg time for me to reply to them
  avgTheirResponseSec: number | null;
  topEmojis: { emoji: string; count: number }[];
}

/** Per-chat statistics including average response latency in each direction. */
export function computeChatStats(chatJid: string): ChatStats {
  const db = getDb();
  const chat = getChat(chatJid, false);
  const rows = db.prepare(
    `SELECT content, timestamp, is_from_me FROM messages WHERE chat_jid = ? ORDER BY timestamp ASC`,
  ).all(chatJid) as any[];

  let sent = 0, received = 0;
  const myResponses: number[] = [];
  const theirResponses: number[] = [];
  let prev: { fromMe: boolean; t: number } | null = null;

  const emojiRegex = /(\p{Extended_Pictographic})/gu;
  const emojiCounts: Record<string, number> = {};

  for (const r of rows) {
    const fromMe = Boolean(r.is_from_me);
    const t = parseDateSafe(r.timestamp)?.getTime() ?? 0;
    if (fromMe) sent++; else received++;
    const em = String(r.content || "").match(emojiRegex);
    if (em) for (const e of em) emojiCounts[e] = (emojiCounts[e] ?? 0) + 1;

    if (prev && prev.fromMe !== fromMe && t >= prev.t) {
      const gapSec = (t - prev.t) / 1000;
      // Ignore implausibly long gaps (> 12h) so a quiet night doesn't skew it.
      if (gapSec <= 12 * 3600) {
        if (fromMe) myResponses.push(gapSec);
        else theirResponses.push(gapSec);
      }
    }
    prev = { fromMe, t };
  }

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const total = sent + received;
  const topEmojis = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([emoji, count]) => ({ emoji, count }));

  return {
    chat_jid: chatJid,
    name: chat?.name ?? null,
    total,
    sent,
    received,
    firstMessage: rows.length ? parseDateSafe(rows[0].timestamp) : null,
    lastMessage: rows.length ? parseDateSafe(rows[rows.length - 1].timestamp) : null,
    myMessageShare: total ? sent / total : 0,
    avgMyResponseSec: avg(myResponses),
    avgTheirResponseSec: avg(theirResponses),
    topEmojis,
  };
}

/** Export a chat's messages as a plain-text or markdown transcript string. */
export function exportChat(chatJid: string, format: "markdown" | "text" = "markdown", limit = 5000): string {
  const chat = getChat(chatJid, false);
  const db = getDb();
  const rows = db.prepare(
    `SELECT content, timestamp, is_from_me, sender FROM messages WHERE chat_jid = ? ORDER BY timestamp ASC LIMIT ?`,
  ).all(chatJid, limit) as any[];

  const title = chat?.name ?? chatJid.split("@")[0];
  const lines: string[] = [];
  if (format === "markdown") lines.push(`# WhatsApp chat: ${title}`, "");
  else lines.push(`WhatsApp chat: ${title}`, "");

  for (const r of rows) {
    const t = parseDateSafe(r.timestamp);
    const stamp = t ? t.toISOString().replace("T", " ").slice(0, 16) : "";
    const who = r.is_from_me ? "Me" : (r.sender ? String(r.sender).split("@")[0] : "Them");
    if (format === "markdown") lines.push(`**${who}** _(${stamp})_: ${r.content}`);
    else lines.push(`[${stamp}] ${who}: ${r.content}`);
  }
  return lines.join("\n");
}

export interface ContactInfo {
  jid: string;
  name: string | null;
  is_group: boolean;
  message_count: number;
  last_message: string | null;
  last_message_time: Date | null;
  known: boolean;
}

export function getContactInfo(jid: string): ContactInfo {
  const db = getDb();
  const chat = getChat(jid, true);
  const cnt = db.prepare(`SELECT COUNT(*) as n FROM messages WHERE chat_jid = ?`).get(jid) as any;
  return {
    jid,
    name: chat?.name ?? null,
    is_group: jid.endsWith("@g.us"),
    message_count: cnt?.n ?? 0,
    last_message: chat?.last_message ?? null,
    last_message_time: chat?.last_message_time ?? null,
    known: isKnownRecipient(jid),
  };
}

export interface ResponseLeaderEntry {
  jid: string;
  name: string | null;
  avgMyResponseSec: number;
  messages: number;
}

/**
 * Rank your direct chats by how fast you reply to them. Great shareable stat
 * ("who you leave on read"). Group chats excluded; chats with too little
 * back-and-forth are skipped.
 */
export function computeResponseLeaderboard(minResponses = 3, limit = 15): {
  fastest: ResponseLeaderEntry[];
  slowest: ResponseLeaderEntry[];
} {
  const db = getDb();
  const chatRows = db.prepare(
    `SELECT DISTINCT chat_jid FROM messages WHERE chat_jid NOT LIKE '%@g.us'`,
  ).all() as any[];

  const entries: ResponseLeaderEntry[] = [];
  for (const { chat_jid } of chatRows) {
    const s = computeChatStats(chat_jid);
    if (s.avgMyResponseSec != null && s.received >= minResponses) {
      entries.push({
        jid: chat_jid,
        name: s.name,
        avgMyResponseSec: s.avgMyResponseSec,
        messages: s.total,
      });
    }
  }
  const byFast = [...entries].sort((a, b) => a.avgMyResponseSec - b.avgMyResponseSec);
  return { fastest: byFast.slice(0, limit), slowest: byFast.slice(-limit).reverse() };
}

export function closeDatabase(): void {
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
    dbInstance = null;
  }
}
