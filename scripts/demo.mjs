// Seeds a temporary database with sample data, then drives the real MCP server
// to print the actual whatsapp_wrapped / response_leaderboard / chat_stats output.
// Useful for README screenshots and a quick end-to-end sanity check (no WhatsApp).
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wamcp-demo-"));
process.env.WAMCP_DATA_DIR = tmp;
process.env.WAMCP_AUTH_DIR = path.join(tmp, "auth");
process.env.WAMCP_MODE = "read-only";
process.env.WAMCP_NO_WA = "1";

// --- seed -------------------------------------------------------------------
const db = await import("../dist/db.js");
db.initializeDatabase();

const people = [
  { jid: "1001@s.whatsapp.net", name: "Mom", replySec: 45 },
  { jid: "1002@s.whatsapp.net", name: "Aisha", replySec: 120 },
  { jid: "1003@s.whatsapp.net", name: "Dev Group Buddy", replySec: 900 },
  { jid: "1004@s.whatsapp.net", name: "Landlord", replySec: 7200 },
];
const emojis = ["😀", "😂", "🔥", "👍", "❤️", "🙏"];
let base = Date.UTC(2026, 0, 1, 8, 0, 0);
for (const p of people) {
  db.storeContact({ jid: p.jid, name: p.name });
  let t = base;
  for (let i = 0; i < 40; i++) {
    // them
    const em = emojis[(i + p.name.length) % emojis.length];
    db.storeMessage({ id: `${p.jid}-t${i}`, chat_jid: p.jid, sender: p.jid, content: `msg ${i} ${em}`, timestamp: new Date(t), is_from_me: false });
    // me, replySec later
    t += p.replySec * 1000;
    db.storeMessage({ id: `${p.jid}-m${i}`, chat_jid: p.jid, sender: null, content: `reply ${i} 👍`, timestamp: new Date(t), is_from_me: true });
    t += 3600_000 + (i % 5) * 600_000; // gap to next inbound
  }
}
db.closeDatabase();

// --- drive the server -------------------------------------------------------
const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "ignore"], env: process.env });
let buf = "";
const seen = [];
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line) { try { seen.push(JSON.parse(line)); } catch {} }
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");

setTimeout(() => send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "demo", version: "0" } } }), 800);
setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "whatsapp_wrapped", arguments: { period: "all", format: "card" } } });
  send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "response_leaderboard", arguments: { min_responses: 3, limit: 5 } } });
  send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "chat_stats", arguments: { chat_jid: "1001@s.whatsapp.net" } } });
}, 1600);
setTimeout(() => {
  for (const id of [10, 11, 12]) {
    const r = seen.find((m) => m.id === id);
    console.log("\n" + (r?.result?.content?.[0]?.text ?? JSON.stringify(r)));
  }
  child.kill();
  // Best-effort cleanup; on Windows the DB file may still be locked by the
  // exiting child, which is harmless for a throwaway temp dir.
  setTimeout(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(0);
  }, 300);
}, 4000);
