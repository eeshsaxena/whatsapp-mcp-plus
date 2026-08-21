// Functional tests for the pure logic (DB + safety accounting) using a seeded
// temporary database. No WhatsApp connection required.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wamcp-test-"));
process.env.WAMCP_DATA_DIR = tmp;
process.env.WAMCP_AUTH_DIR = path.join(tmp, "auth");

const db = await import("../dist/db.js");

let pass = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  console.log(`  ok  ${name}`);
  pass++;
};

db.initializeDatabase();

// --- seed contacts + messages -------------------------------------------------
db.storeContact({ jid: "111@s.whatsapp.net", name: "Alice" });
db.storeContact({ jid: "222@s.whatsapp.net", name: "Bob" });

const T = (h) => new Date(Date.UTC(2026, 0, 10, h, 0, 0));
// Alice: 3 messages (2 from me, 1 from her, with an emoji)
db.storeMessage({ id: "a1", chat_jid: "111@s.whatsapp.net", sender: null, content: "hey", timestamp: T(9), is_from_me: true });
db.storeMessage({ id: "a2", chat_jid: "111@s.whatsapp.net", sender: "111@s.whatsapp.net", content: "hi there 😀", timestamp: T(9), is_from_me: false });
db.storeMessage({ id: "a3", chat_jid: "111@s.whatsapp.net", sender: null, content: "lunch? 😀", timestamp: T(12), is_from_me: true });
// Bob: 1 message from him (so Bob "messaged us first")
db.storeMessage({ id: "b1", chat_jid: "222@s.whatsapp.net", sender: "222@s.whatsapp.net", content: "yo", timestamp: T(12), is_from_me: false });
// Stranger: only outbound-less, never contacted
// (no messages for 999 — should be unknown)

// --- reads --------------------------------------------------------------------
const chats = db.getChats(20, 0, "last_active");
check("getChats returns 2 chats", chats.length === 2);

const msgs = db.getMessages("111@s.whatsapp.net", 20, 0);
check("getMessages returns 3 for Alice", msgs.length === 3);

const found = db.searchMessages("lunch");
check("searchMessages finds 'lunch'", found.length === 1 && found[0].id === "a3");

const contacts = db.searchDbForContacts("ali");
check("searchDbForContacts finds Alice", contacts.some((c) => c.name === "Alice"));

// --- allowlist / relationship logic ------------------------------------------
check("isKnownRecipient true for contact Alice", db.isKnownRecipient("111@s.whatsapp.net") === true);
check("isKnownRecipient FALSE for Bob (inbound-only, tightened default)", db.isKnownRecipient("222@s.whatsapp.net") === false);
check("isKnownRecipient false for stranger", db.isKnownRecipient("999@s.whatsapp.net") === false);
db.addToAllowlist("999@s.whatsapp.net");
check("isKnownRecipient true after allowlist_add", db.isKnownRecipient("999@s.whatsapp.net") === true);

// --- rate-limit accounting ----------------------------------------------------
db.logSend("111@s.whatsapp.net");
db.logSend("111@s.whatsapp.net");
const since = new Date(Date.now() - 60_000).toISOString();
check("countSendsSince counts 2 recent sends", db.countSendsSince(since) === 2);
check("lastSendTime is set", db.lastSendTime() instanceof Date);

// --- analytics (wrapped) ------------------------------------------------------
const w = db.computeWrapped(null, 10);
check("wrapped total = 4", w.totalMessages === 4);
check("wrapped sent = 2", w.sent === 2);
check("wrapped received = 2", w.received === 2);
check("wrapped activeChats = 2", w.activeChats === 2);
check("wrapped topContacts excludes groups, includes Alice top", w.topContacts[0]?.count === 3);
check("wrapped found emoji 😀 x2", w.topEmojis.some((e) => e.emoji === "😀" && e.count === 2));
check("wrapped busiestHour computed", w.busiestHour !== null);
check("wrapped wordsSent counts my words", w.wordsSent === 3);
check("wrapped longestStreakDays = 1 (all same day)", w.longestStreakDays === 1);

// --- top words ----------------------------------------------------------------
const words = db.computeTopWords(null, 10);
check("top_words finds 'lunch'", words.some((x) => x.word === "lunch"));
check("top_words filters stopwords (no 'hey')", !words.some((x) => x.word === "hey"));

// --- settings / mode persistence ---------------------------------------------
db.setSetting("mode", "assisted");
check("getSetting round-trips", db.getSetting("mode") === "assisted");

db.closeDatabase();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} checks passed.`);
