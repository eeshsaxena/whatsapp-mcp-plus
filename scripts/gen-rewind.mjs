// Seeds sample data and writes the WhatsApp Rewind story cards to docs/rewind/.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wamcp-rewind-"));
process.env.WAMCP_DATA_DIR = tmp;
process.env.WAMCP_AUTH_DIR = path.join(tmp, "auth");
process.env.WAMCP_PRIVACY = "0"; // synthetic demo data — show real sample names

const db = await import("../dist/db.js");
const { renderRewindCards } = await import("../dist/analytics/rewind.js");
db.initializeDatabase();

const people = [
  { jid: "1@s.whatsapp.net", name: "Mom", n: 512, reply: 40 },
  { jid: "2@s.whatsapp.net", name: "Aisha ❤️", n: 468, reply: 95 },
  { jid: "3@s.whatsapp.net", name: "Study Group", n: 331, reply: 700 },
  { jid: "4@s.whatsapp.net", name: "Rohan", n: 240, reply: 210 },
  { jid: "5@s.whatsapp.net", name: "Landlord", n: 88, reply: 9000 },
];
const emojis = ["😂", "❤️", "🔥", "👍", "🙏", "😭", "💀", "✨", "🥹"];
let base = Date.UTC(2026, 0, 1, 8, 0, 0);
for (const p of people) {
  db.storeContact({ jid: p.jid, name: p.name });
  for (let i = 0; i < p.n; i++) {
    const em = emojis[(i * 5 + p.name.length) % emojis.length];
    const fromMe = i % 2 === 0;
    // bias activity toward evenings (peak ~21:00)
    const hourBias = [21, 22, 20, 19, 13, 12, 23, 18][i % 8];
    const ts = base + i * 3600_000 + hourBias * 60_000;
    // them then me (reply gap) to populate response times
    if (!fromMe) {
      db.storeMessage({ id: `${p.jid}-t${i}`, chat_jid: p.jid, sender: p.jid, content: `hey ${i} ${em}`, timestamp: new Date(ts), is_from_me: false });
      db.storeMessage({ id: `${p.jid}-m${i}`, chat_jid: p.jid, sender: null, content: `reply ${i} ${em} spectacular`, timestamp: new Date(ts + p.reply * 1000), is_from_me: true });
    }
  }
}
const stats = db.computeWrapped(null, 10);
const board = db.computeResponseLeaderboard(3, 3);
const cards = renderRewindCards(stats, board, { subtitle: "2026 · sample data" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "docs", "rewind");
fs.mkdirSync(outDir, { recursive: true });
for (const c of cards) fs.writeFileSync(path.join(outDir, `${c.name}.svg`), c.svg, "utf-8");
console.log(`Wrote ${cards.length} cards to ${outDir}: ${cards.map((c) => c.name).join(", ")}`);
console.log(`stats: total=${stats.totalMessages} words=${stats.wordsSent} streak=${stats.longestStreakDays} peakHour=${stats.hourly.indexOf(Math.max(...stats.hourly))}`);

db.closeDatabase();
fs.rmSync(tmp, { recursive: true, force: true });
