import type { WrappedStats, ResponseLeaderEntry } from "../db.ts";

/**
 * "WhatsApp Rewind" — a Spotify-Wrapped-style set of shareable story cards
 * (1080x1920). Each card is a self-contained SVG (no external assets/fonts).
 *
 * Design follows the dataviz method: pick the form first (hero number / stat
 * tile / magnitude bars / hour histogram), a single accent hue per data mark,
 * direct labels on every value (so color is never the sole encoding), 4px-style
 * rounded bar ends scaled to the canvas, and a recessive baseline.
 */

const W = 1080, H = 1920;
const INK = "#F6F8F9";
const INK2 = "rgba(255,255,255,0.74)";
const INK3 = "rgba(255,255,255,0.5)";
const FONT = `-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(n: number): string { return n.toLocaleString("en-US"); }
function hourLabel(h: number): string {
  const ap = h < 12 ? "AM" : "PM"; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${ap}`;
}
function humanDur(sec: number): string {
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

interface Grad { id: string; from: string; to: string; angle?: number }
function frame(grad: Grad, inner: string, page: string): string {
  const a = grad.angle ?? 160;
  const rad = (a * Math.PI) / 180;
  const x2 = (Math.cos(rad) * 0.5 + 0.5).toFixed(3);
  const y2 = (Math.sin(rad) * 0.5 + 0.5).toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs>
    <linearGradient id="${grad.id}" x1="0" y1="0" x2="${x2}" y2="${y2}">
      <stop offset="0" stop-color="${grad.from}"/>
      <stop offset="1" stop-color="${grad.to}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${grad.id})"/>
  ${inner}
  <text x="80" y="${H - 90}" fill="${INK3}" font-size="30" font-weight="600" letter-spacing="1">whatsapp-mcp-plus</text>
  <text x="${W - 80}" y="${H - 90}" fill="${INK3}" font-size="30" font-weight="700" text-anchor="end">${page}</text>
</svg>`;
}

function kicker(y: number, text: string, color = INK2): string {
  return `<text x="80" y="${y}" fill="${color}" font-size="34" font-weight="800" letter-spacing="6">${esc(text.toUpperCase())}</text>`;
}

/* --------------------------------------------------------------- the cards */

function coverCard(s: WrappedStats, subtitle: string): string {
  const inner = `
    ${kicker(300, "WhatsApp", "rgba(255,255,255,0.85)")}
    <text x="80" y="470" fill="${INK}" font-size="150" font-weight="900" letter-spacing="-2">Rewind</text>
    <text x="80" y="540" fill="rgba(255,255,255,0.9)" font-size="40" font-weight="600">${esc(subtitle)}</text>

    <text x="80" y="1120" fill="rgba(255,255,255,0.85)" font-size="40" font-weight="700" letter-spacing="2">YOU SENT &amp; RECEIVED</text>
    <text x="72" y="1330" fill="${INK}" font-size="230" font-weight="900" letter-spacing="-4">${fmt(s.totalMessages)}</text>
    <text x="80" y="1410" fill="rgba(255,255,255,0.9)" font-size="46" font-weight="600">messages across ${s.activeChats} chats</text>`;
  return frame({ id: "g1", from: "#075E54", to: "#25D366", angle: 150 }, inner, "01");
}

function topPeopleCard(s: WrappedStats): string {
  const people = s.topContacts.slice(0, 5);
  const max = people[0]?.count || 1;
  const x = 80, top = 760, rowH = 190, barW = 920, barH = 26;
  const rows = people.map((c, i) => {
    const y = top + i * rowH;
    const w = Math.max(30, Math.round((c.count / max) * barW));
    const name = esc((c.name ?? c.jid.split("@")[0]).slice(0, 24));
    return `
      <text x="${x}" y="${y}" fill="${INK}" font-size="52" font-weight="800">${i + 1}. ${name}</text>
      <text x="${x + barW}" y="${y}" fill="${INK2}" font-size="46" font-weight="700" text-anchor="end">${fmt(c.count)}</text>
      <rect x="${x}" y="${y + 26}" width="${barW}" height="${barH}" rx="13" fill="rgba(255,255,255,0.12)"/>
      <rect x="${x}" y="${y + 26}" width="${w}" height="${barH}" rx="13" fill="#25D366"/>`;
  }).join("");
  const inner = `
    ${kicker(300, "Your people")}
    <text x="80" y="470" fill="${INK}" font-size="120" font-weight="900" letter-spacing="-2">Top 5 chats</text>
    <text x="80" y="560" fill="${INK2}" font-size="42" font-weight="600">who filled your inbox this year</text>
    ${rows}`;
  return frame({ id: "g2", from: "#0b141a", to: "#1f4d3f", angle: 165 }, inner, "02");
}

function rhythmCard(s: WrappedStats): string {
  const max = Math.max(1, ...s.hourly);
  const x0 = 80, x1 = W - 80, baseY = 1500, plotH = 520;
  const n = 24, gap = 8;
  const bw = (x1 - x0 - gap * (n - 1)) / n;
  const peakHour = s.hourly.indexOf(max);
  const bars = s.hourly.map((c, h) => {
    const bh = Math.round((c / max) * plotH);
    const bx = x0 + h * (bw + gap);
    const by = baseY - bh;
    const isPeak = h === peakHour;
    return `<rect x="${bx.toFixed(1)}" y="${by}" width="${bw.toFixed(1)}" height="${Math.max(4, bh)}" rx="8" fill="${isPeak ? "#25D366" : "rgba(37,211,102,0.45)"}"/>`;
  }).join("");
  const axis = [0, 6, 12, 18].map((h) => {
    const bx = x0 + h * (bw + gap) + bw / 2;
    return `<text x="${bx.toFixed(1)}" y="${baseY + 46}" fill="${INK3}" font-size="30" font-weight="600" text-anchor="middle">${hourLabel(h)}</text>`;
  }).join("");
  const busiestDayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.daily.indexOf(Math.max(...s.daily))] ?? "-";
  const inner = `
    ${kicker(300, "Your rhythm")}
    <text x="80" y="470" fill="${INK}" font-size="120" font-weight="900" letter-spacing="-2">Peak hour</text>
    <text x="72" y="700" fill="#7CF3B0" font-size="150" font-weight="900" letter-spacing="-3">${hourLabel(peakHour)}</text>
    <text x="80" y="770" fill="${INK2}" font-size="42" font-weight="600">busiest day: ${busiestDayName}</text>
    ${bars}
    <line x1="${x0}" y1="${baseY}" x2="${x1}" y2="${baseY}" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
    ${axis}
    <text x="80" y="${baseY + 120}" fill="${INK3}" font-size="34" font-weight="600">messages by hour of day</text>`;
  return frame({ id: "g3", from: "#0d2b26", to: "#0f766e", angle: 160 }, inner, "03");
}

function emojiCard(s: WrappedStats): string {
  const top = s.topEmojis.slice(0, 6);
  const hero = top[0];
  const cells = top.map((e, i) => {
    const col = i % 2, rowi = Math.floor(i / 2);
    const cx = 150 + col * 500, cy = 1050 + rowi * 260;
    return `
      <text x="${cx}" y="${cy}" font-size="130" text-anchor="middle">${esc(e.emoji)}</text>
      <text x="${cx}" y="${cy + 80}" fill="${INK2}" font-size="44" font-weight="800" text-anchor="middle">${fmt(e.count)}</text>`;
  }).join("");
  const inner = `
    ${kicker(300, "Your mood")}
    <text x="80" y="470" fill="${INK}" font-size="120" font-weight="900" letter-spacing="-2">Top emojis</text>
    ${hero ? `<text x="${W / 2}" y="800" font-size="240" text-anchor="middle">${esc(hero.emoji)}</text>
    <text x="${W / 2}" y="700" fill="${INK2}" font-size="40" font-weight="700" text-anchor="middle" letter-spacing="2">MOST USED · ${fmt(hero.count)}×</text>` : ""}
    ${cells}`;
  return frame({ id: "g4", from: "#241047", to: "#6d28d9", angle: 155 }, inner, "04");
}

function leaderboardCard(board: { fastest: ResponseLeaderEntry[]; slowest: ResponseLeaderEntry[] }): string {
  const fast = board.fastest.slice(0, 3);
  const slow = board.slowest.slice(0, 3);
  const rowsFrom = (arr: ResponseLeaderEntry[], y0: number, color: string) => arr.map((e, i) => {
    const y = y0 + i * 130;
    const name = esc((e.name ?? e.jid.split("@")[0]).slice(0, 22));
    return `<text x="80" y="${y}" fill="${INK}" font-size="52" font-weight="800">${i + 1}. ${name}</text>
      <text x="${W - 80}" y="${y}" fill="${color}" font-size="52" font-weight="900" text-anchor="end">${humanDur(e.avgMyResponseSec)}</text>`;
  }).join("");
  const inner = `
    ${kicker(300, "Reply speed")}
    <text x="80" y="470" fill="${INK}" font-size="110" font-weight="900" letter-spacing="-2">Left on read?</text>

    <text x="80" y="650" fill="#7CF3B0" font-size="46" font-weight="800">⚡ You reply fastest to</text>
    ${rowsFrom(fast, 760, "#7CF3B0")}

    <text x="80" y="1260" fill="#FFCE73" font-size="46" font-weight="800">🐌 You leave on read longest</text>
    ${rowsFrom(slow, 1370, "#FFCE73")}`;
  return frame({ id: "g5", from: "#0b141a", to: "#14532d", angle: 165 }, inner, "05");
}

function numbersCard(s: WrappedStats): string {
  const tile = (x: number, y: number, big: string, label: string) => `
    <text x="${x}" y="${y}" fill="${INK}" font-size="120" font-weight="900" letter-spacing="-2">${big}</text>
    <text x="${x + 4}" y="${y + 60}" fill="${INK2}" font-size="38" font-weight="700" letter-spacing="1">${esc(label.toUpperCase())}</text>`;
  const inner = `
    ${kicker(300, "By the numbers")}
    <text x="80" y="470" fill="${INK}" font-size="120" font-weight="900" letter-spacing="-2">Your year</text>
    ${tile(80, 760, fmt(s.wordsSent), "words sent")}
    ${tile(600, 760, `${s.longestStreakDays}d`, "longest streak")}
    ${tile(80, 1080, fmt(s.sent), "sent")}
    ${tile(600, 1080, fmt(s.received), "received")}
    ${tile(80, 1400, fmt(s.activeChats), "active chats")}
    ${tile(600, 1400, fmt(s.totalMessages), "total messages")}`;
  return frame({ id: "g6", from: "#052e2b", to: "#0a7d68", angle: 160 }, inner, "06");
}

export interface RewindCard { name: string; svg: string }

export function renderRewindCards(
  stats: WrappedStats,
  leaderboard: { fastest: ResponseLeaderEntry[]; slowest: ResponseLeaderEntry[] },
  opts: { subtitle?: string } = {},
): RewindCard[] {
  const subtitle = opts.subtitle ?? "your year in messages";
  const cards: RewindCard[] = [
    { name: "01-cover", svg: coverCard(stats, subtitle) },
    { name: "02-people", svg: topPeopleCard(stats) },
    { name: "03-rhythm", svg: rhythmCard(stats) },
    { name: "04-emojis", svg: emojiCard(stats) },
  ];
  if (leaderboard.fastest.length || leaderboard.slowest.length) {
    cards.push({ name: "05-replies", svg: leaderboardCard(leaderboard) });
  }
  cards.push({ name: "06-numbers", svg: numbersCard(stats) });
  return cards;
}
