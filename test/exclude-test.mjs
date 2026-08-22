// Per-chat exclusion (WAMCP_EXCLUDE_CHATS) must hide a chat from EVERY read /
// analytics path. Seeds an excluded chat + a normal chat and asserts no leak.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wamcp-excl-"));
process.env.WAMCP_DATA_DIR = tmp;
process.env.WAMCP_AUTH_DIR = path.join(tmp, "auth");
const EXCLUDED = "999@s.whatsapp.net";
const NORMAL = "111@s.whatsapp.net";
process.env.WAMCP_EXCLUDE_CHATS = EXCLUDED; // set BEFORE importing config/db

const db = await import("../dist/db.js");
db.initializeDatabase();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ok  " + msg); } else { fail++; console.log("  FAIL " + msg); } };

const mk = (id, chat, content, fromMe, tsOffset) => ({
  id, chat_jid: chat, sender: fromMe ? null : chat, content,
  timestamp: new Date(1700000000000 + tsOffset * 1000),
  is_from_me: fromMe ? 1 : 0, message_type: "text", media_type: null, raw: null,
});

db.storeContact({ jid: EXCLUDED, name: "SecretPerson" });
db.storeContact({ jid: NORMAL, name: "PublicPerson" });
db.storeMessage(mk("x1", EXCLUDED, "zzsecretzz alpha", false, 1));
db.storeMessage(mk("x2", EXCLUDED, "zzsecretzz beta", true, 2));
db.storeMessage(mk("x3", EXCLUDED, "zzsecretzz gamma", false, 3));
db.storeMessage(mk("p1", NORMAL, "publicword hello", false, 4));
db.storeMessage(mk("p2", NORMAL, "publicword world", true, 5));

// list_chats / getChats
const chats = db.getChats(50, 0, "last_active", undefined, true);
ok(!chats.some((c) => c.jid === EXCLUDED), "getChats hides excluded chat");
ok(chats.some((c) => c.jid === NORMAL), "getChats still shows normal chat");

// getMessages / getLastInteraction / getChat / getMessageById
ok(db.getMessages(EXCLUDED, 50, 0).length === 0, "getMessages empty for excluded chat");
ok(db.getMessages(NORMAL, 50, 0).length === 2, "getMessages works for normal chat");
ok(db.getLastInteraction(EXCLUDED) === null, "getLastInteraction null for excluded");
ok(db.getChat(EXCLUDED) === null, "getChat null for excluded");
ok(db.getMessageById("x1") === null, "getMessageById null for excluded message");
ok(db.getMessageById("p1") !== null, "getMessageById works for normal message");

// search
const s = db.searchMessages("zzsecretzz");
ok(s.length === 0, "searchMessages finds nothing in excluded chat");
ok(db.searchMessages("publicword").length === 2, "searchMessages works for normal chat");

// analytics
const w = db.computeWrapped(null, 10);
ok(w.totalMessages === 2, "computeWrapped counts only non-excluded (2)");
ok(!w.topContacts.some((c) => c.jid === EXCLUDED), "wrapped topContacts excludes hidden chat");
const words = db.computeTopWords(null, 50, null).map((x) => x.word);
ok(!words.includes("zzsecretzz"), "computeTopWords excludes hidden-chat words");
ok(words.includes("publicword"), "computeTopWords includes normal words");

// per-chat analytics
ok(db.computeChatStats(EXCLUDED).total === 0, "computeChatStats zero for excluded");
ok(db.exportChat(EXCLUDED).length === 0 || !db.exportChat(EXCLUDED).includes("zzsecretzz"), "exportChat leaks nothing for excluded");
ok(db.getContactInfo(EXCLUDED).message_count === 0, "getContactInfo zero messages for excluded");

// isKnownRecipient: excluded chat you've sent to is NOT known (hidden) unless allowlisted
ok(db.isKnownRecipient(EXCLUDED) === false, "excluded chat not auto-known for sending");
db.addToAllowlist(EXCLUDED);
ok(db.isKnownRecipient(EXCLUDED) === true, "explicit allowlist overrides exclusion for sending");

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
