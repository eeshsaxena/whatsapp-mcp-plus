// Seeds sample data and writes docs/sample-wrapped.svg for the README + a quick
// visual check of the shareable card. No WhatsApp needed.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wamcp-card-"));
process.env.WAMCP_DATA_DIR = tmp;
process.env.WAMCP_AUTH_DIR = path.join(tmp, "auth");

const db = await import("../dist/db.js");
const { renderWrappedSVG } = await import("../dist/analytics/card.js");
db.initializeDatabase();

const people = [
  { jid: "1@s.whatsapp.net", name: "Mom", n: 412 },
  { jid: "2@s.whatsapp.net", name: "Aisha ❤", n: 388 },
  { jid: "3@s.whatsapp.net", name: "Study Group", n: 274 },
  { jid: "4@s.whatsapp.net", name: "Rohan", n: 201 },
  { jid: "5@s.whatsapp.net", name: "Coach", n: 96 },
];
const emojis = ["😂", "❤️", "🔥", "👍", "🙏", "😭", "💀", "✨"];
let t = Date.UTC(2026, 0, 1, 9, 0, 0);
for (const p of people) {
  db.storeContact({ jid: p.jid, name: p.name });
  for (let i = 0; i < p.n; i++) {
    const em = emojis[(i * 7 + p.name.length) % emojis.length];
    const fromMe = i % 2 === 0;
    // spread across hours, bias to evening (busiest ~ 21:00)
    const hour = 9 + ((i * 3) % 14);
    const ts = t + i * 3600_000 + (hour - 9) * 60_000;
    db.storeMessage({ id: `${p.jid}-${i}`, chat_jid: p.jid, sender: fromMe ? null : p.jid, content: `msg ${i} ${em}`, timestamp: new Date(ts), is_from_me: fromMe });
  }
}
const stats = db.computeWrapped(null, 10);
const svg = renderWrappedSVG(stats, { subtitle: "2026 · sample data" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "docs");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "sample-wrapped.svg");
fs.writeFileSync(out, svg, "utf-8");
console.log(`Wrote ${out} (${svg.length} bytes). total=${stats.totalMessages} sent=${stats.sent} recv=${stats.received}`);

db.closeDatabase();
fs.rmSync(tmp, { recursive: true, force: true });
