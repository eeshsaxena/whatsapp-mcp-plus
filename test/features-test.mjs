// Tests for the newer DB features: chat_stats (response time), export_chat,
// get_last_interaction, contact_info, and date-range filtering. Seeded temp DB.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wamcp-feat-"));
process.env.WAMCP_DATA_DIR = tmp;
process.env.WAMCP_AUTH_DIR = path.join(tmp, "auth");
const db = await import("../dist/db.js");
const { renderWrappedSVG } = await import("../dist/analytics/card.js");
const { renderRewindCards } = await import("../dist/analytics/rewind.js");
const { proto } = await import("baileys");

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); console.log(`  ok  ${name}`); pass++; };

db.initializeDatabase();
const CHAT = "555@s.whatsapp.net";
db.storeContact({ jid: CHAT, name: "Carol" });

const t = (hh, mm, ss = 0) => new Date(Date.UTC(2026, 0, 10, hh, mm, ss));
// them 10:00:00 -> me 10:01:00 (60s) -> them 10:05:00 (240s) -> me 10:06:00 (60s)
db.storeMessage({ id: "m1", chat_jid: CHAT, sender: CHAT, content: "hi 👋", timestamp: t(10, 0, 0), is_from_me: false });
db.storeMessage({ id: "m2", chat_jid: CHAT, sender: null, content: "hey!", timestamp: t(10, 1, 0), is_from_me: true });
db.storeMessage({ id: "m3", chat_jid: CHAT, sender: CHAT, content: "you free? 👋", timestamp: t(10, 5, 0), is_from_me: false });
db.storeMessage({ id: "m4", chat_jid: CHAT, sender: null, content: "yes", timestamp: t(10, 6, 0), is_from_me: true });

// --- chat stats ---------------------------------------------------------------
const s = db.computeChatStats(CHAT);
check("chat_stats total = 4", s.total === 4);
check("chat_stats sent = 2 / received = 2", s.sent === 2 && s.received === 2);
check("chat_stats my avg response = 60s", s.avgMyResponseSec === 60);
check("chat_stats their avg response = 240s", s.avgTheirResponseSec === 240);
check("chat_stats myMessageShare = 0.5", s.myMessageShare === 0.5);
check("chat_stats top emoji 👋 x2", s.topEmojis.some((e) => e.emoji === "👋" && e.count === 2));

// --- last interaction ---------------------------------------------------------
const last = db.getLastInteraction(CHAT);
check("get_last_interaction returns newest (m4)", last?.id === "m4");

// --- contact info -------------------------------------------------------------
const info = db.getContactInfo(CHAT);
check("contact_info message_count = 4", info.message_count === 4);
check("contact_info known = true", info.known === true);
check("contact_info name = Carol", info.name === "Carol");

// --- date-range filtering -----------------------------------------------------
const midday = t(10, 3, 0).toISOString();
const afterMid = db.getMessages(CHAT, 50, 0, { after: midday });
check("date-range after filters to 2 messages", afterMid.length === 2);
const beforeMid = db.getMessages(CHAT, 50, 0, { before: midday });
check("date-range before filters to 2 messages", beforeMid.length === 2);

// --- export -------------------------------------------------------------------
const md = db.exportChat(CHAT, "markdown");
check("export markdown has header", md.includes("# WhatsApp chat: Carol"));
check("export contains a 'Me' line", md.includes("**Me**"));
check("export contains message content", md.includes("you free?"));
const txt = db.exportChat(CHAT, "text");
check("export text format has bracketed timestamp", /\[\d{4}-\d{2}-\d{2}/.test(txt));

// --- response leaderboard -----------------------------------------------------
const lb = db.computeResponseLeaderboard(1, 15);
check("leaderboard ranks Carol with my avg 60s", lb.fastest.some((e) => e.name === "Carol" && e.avgMyResponseSec === 60));
check("leaderboard excludes group chats", !lb.fastest.some((e) => e.jid.endsWith("@g.us")));

// --- SVG wrapped card ---------------------------------------------------------
const wrapped = db.computeWrapped(null, 10);
const svg = renderWrappedSVG(wrapped, { subtitle: "test" });
check("card is valid svg root", svg.startsWith("<?xml") && svg.includes("<svg"));
check("card renders total message count", svg.includes(String(wrapped.totalMessages)));
check("card includes a contact name", svg.includes("Carol"));
check("card is well-formed (balanced svg tag)", svg.includes("</svg>"));

// --- wrapped distributions + rewind cards -------------------------------------
check("wrapped exposes 24 hourly buckets", Array.isArray(wrapped.hourly) && wrapped.hourly.length === 24);
check("wrapped exposes 7 daily buckets", Array.isArray(wrapped.daily) && wrapped.daily.length === 7);
const board = db.computeResponseLeaderboard(1, 5);
const cards = renderRewindCards(wrapped, board, { subtitle: "test" });
check("rewind returns >= 5 story cards", cards.length >= 5);
check("every rewind card is valid svg 1080x1920", cards.every((c) => c.svg.startsWith("<?xml") && c.svg.includes('width="1080"') && c.svg.includes("</svg>")));
check("rewind cover shows total messages", cards[0].svg.includes(String(wrapped.totalMessages)));

// --- raw proto persistence round-trip ----------------------------------------
const rawMsg = proto.WebMessageInfo.create({
  key: { remoteJid: CHAT, id: "RAW1", fromMe: false },
  message: { conversation: "hello raw proto" },
  messageTimestamp: 1700000000,
});
const encoded = db.encodeRawMessage(rawMsg);
check("encodeRawMessage returns a base64 string", typeof encoded === "string" && encoded.length > 0);
db.storeMessage({ id: "RAW1", chat_jid: CHAT, sender: CHAT, content: "hello raw proto", timestamp: t(11, 0, 0), is_from_me: false, raw: encoded });
const decoded = db.getRawMessage("RAW1");
check("getRawMessage decodes back to a message", decoded !== null);
check("decoded conversation matches", decoded?.message?.conversation === "hello raw proto");
check("decoded key id matches", decoded?.key?.id === "RAW1");
check("getRawMessage null for unknown id", db.getRawMessage("NOPE") === null);

db.closeDatabase();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} checks passed.`);
