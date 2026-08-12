// Edge-case probes to surface real bugs. Seeded temp DB, no WhatsApp.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wamcp-bug-"));
process.env.WAMCP_DATA_DIR = tmp;
process.env.WAMCP_AUTH_DIR = path.join(tmp, "auth");
const db = await import("../dist/db.js");
const { reconstructKey } = await import("../dist/whatsapp/parse.js");

let pass = 0, fails = 0;
const check = (name, cond) => {
  if (cond) { console.log(`  ok  ${name}`); pass++; }
  else { console.log(`  FAIL ${name}`); fails++; }
};

db.initializeDatabase();
const C = "888@s.whatsapp.net";
const G = "111-222@g.us";
db.storeContact({ jid: C, name: "Probe" });

const t = (h, m, s = 0) => new Date(Date.UTC(2026, 0, 5, h, m, s));

// --- SQL LIKE metacharacter handling -----------------------------------------
db.storeMessage({ id: "p1", chat_jid: C, sender: C, content: "50% off today", timestamp: t(9, 0), is_from_me: false });
db.storeMessage({ id: "p2", chat_jid: C, sender: null, content: "hello world", timestamp: t(9, 1), is_from_me: true });
db.storeMessage({ id: "p3", chat_jid: C, sender: C, content: "under_score name", timestamp: t(9, 2), is_from_me: false });

// Searching a literal "_" should NOT match every message (LIKE wildcard bug).
const underscoreHits = db.searchMessages("_");
check(`search "_" matches only literal underscores (got ${underscoreHits.length}, expect 1)`, underscoreHits.length === 1);
// Searching "%" should match only the literal percent message.
const pctHits = db.searchMessages("%");
check(`search "%" matches only literal percent (got ${pctHits.length}, expect 1)`, pctHits.length === 1);
// A normal search still works.
check("search 'hello' still works", db.searchMessages("hello").length === 1);

// --- reconstructKey ----------------------------------------------------------
const dk = reconstructKey({ id: "x", chat_jid: C, is_from_me: false, sender: C });
check("direct key has no participant", dk.participant === undefined && dk.remoteJid === C && dk.fromMe === false);
const gk = reconstructKey({ id: "y", chat_jid: G, is_from_me: false, sender: "999@s.whatsapp.net" });
check("group key sets participant", gk.participant === "999@s.whatsapp.net" && gk.remoteJid === G);

// --- chat stats edge cases ---------------------------------------------------
const solo = "777@s.whatsapp.net";
db.storeMessage({ id: "s1", chat_jid: solo, sender: solo, content: "only one", timestamp: t(10, 0), is_from_me: false });
const st = db.computeChatStats(solo);
check("single-message chat: avg response null", st.avgMyResponseSec === null && st.avgTheirResponseSec === null);
check("single-message chat: myMessageShare 0 (no sent)", st.myMessageShare === 0);

// --- date range boundaries (inclusive) ---------------------------------------
const boundary = t(9, 1).toISOString();
const afterB = db.getMessages(C, 50, 0, { after: boundary });
check(`date 'after' is inclusive (got ${afterB.length}, expect 2: p2,p3)`, afterB.length === 2);

// --- wrapped with only-received ----------------------------------------------
const w = db.computeWrapped(null);
check("wrapped wordsSent counts only my words", w.wordsSent === 2); // "hello world"
check("wrapped totals add up", w.totalMessages === w.sent + w.received);

// --- top words apostrophe / short --------------------------------------------
db.storeMessage({ id: "w1", chat_jid: C, sender: C, content: "spectacular spectacular banana", timestamp: t(11, 0), is_from_me: false });
const words = db.computeTopWords(C, 10);
check("top_words ranks repeated 'spectacular' first", words[0]?.word === "spectacular" && words[0]?.count === 2);

// --- emoji extraction (sequence-aware) ---------------------------------------
check("emoji keeps variation selector (❤️)", db.extractEmojis("love ❤️ you").includes("❤️"));
check("emoji ZWJ family stays one token", db.extractEmojis("👨‍👩‍👧").length === 1);
check("emoji counts repeats", db.extractEmojis("🔥🔥🔥").length === 3);
check("emoji ignores plain text", db.extractEmojis("no emoji here").length === 0);

db.closeDatabase();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails} failed.`);
if (fails > 0) process.exit(1);
