import type { WrappedStats, ResponseLeaderEntry } from "../db.ts";
import { contactLabel } from "../privacy.ts";

/**
 * "WhatsApp Rewind" — premium, Spotify-Wrapped-style story cards (1080x1920),
 * each a self-contained SVG (no external assets/fonts).
 *
 * Visual language ("Ethereal Glass"): OLED-black base, glowing mesh-gradient
 * orbs, film-grain overlay, eyebrow pill badges, nested glass trays with an
 * inner top highlight, and soft-glowing hero numerals. Data marks follow the
 * dataviz method: single-accent magnitude bars with rounded ends + gaps, an
 * hour histogram with the peak labeled, and a direct label on every value.
 */

const W = 1080, H = 1920;
const INK = "#F7FAF9";
const INK2 = "rgba(255,255,255,0.72)";
const INK3 = "rgba(255,255,255,0.46)";
// Premium system stack; avoids the "template" system-default look.
const FONT = `'SF Pro Display','Segoe UI Variable Display','Segoe UI',system-ui,sans-serif`;

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

interface Orb { cx: number; cy: number; r: number; color: string; opacity?: number }
interface CardTheme {
  id: string;
  base: string;      // deep background
  wash: string;      // gradient wash toward
  accent: string;    // primary data/accent hue
  glow: string;      // brighter accent for hero glow
  orbs: Orb[];
  page: string;
}

/** Shared defs + background: gradient wash, glowing orbs, and a grain overlay. */
function frame(t: CardTheme, ghost: string, content: string): string {
  const orbs = t.orbs.map((o, i) =>
    `<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="url(#orb-${t.id}-${i})" opacity="${o.opacity ?? 0.55}" filter="url(#soft-${t.id})"/>`,
  ).join("");
  const orbGrads = t.orbs.map((o, i) =>
    `<radialGradient id="orb-${t.id}-${i}"><stop offset="0" stop-color="${o.color}" stop-opacity="0.9"/><stop offset="1" stop-color="${o.color}" stop-opacity="0"/></radialGradient>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs>
    <linearGradient id="bg-${t.id}" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${t.base}"/><stop offset="1" stop-color="${t.wash}"/>
    </linearGradient>
    ${orbGrads}
    <filter id="soft-${t.id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="120"/></filter>
    <filter id="glow-${t.id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="18"/></filter>
    <filter id="grain-${t.id}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg-${t.id})"/>
  ${orbs}
  ${ghost}
  ${content}
  <rect width="${W}" height="${H}" filter="url(#grain-${t.id})" opacity="0.04"/>
  <text x="80" y="${H - 84}" fill="${INK3}" font-size="28" font-weight="600" letter-spacing="1">whatsapp-mcp-plus</text>
  <text x="${W - 80}" y="${H - 84}" fill="${INK3}" font-size="28" font-weight="700" text-anchor="end">${t.page} / 06</text>
</svg>`;
}

/** Eyebrow: a hairline pill badge with tracked uppercase label. */
function eyebrow(x: number, y: number, text: string, accent: string): string {
  const w = 44 + text.length * 21;
  return `
    <rect x="${x}" y="${y - 40}" width="${w}" height="56" rx="28" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.14)"/>
    <circle cx="${x + 30}" cy="${y - 12}" r="7" fill="${accent}"/>
    <text x="${x + 52}" y="${y - 2}" fill="${INK2}" font-size="26" font-weight="700" letter-spacing="4">${esc(text.toUpperCase())}</text>`;
}

/** A nested "glass tray": translucent panel, hairline ring, inner top highlight. */
function tray(x: number, y: number, w: number, h: number): string {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="40" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.09)"/>
    <rect x="${x + 24}" y="${y + 2}" width="${w - 48}" height="2" rx="1" fill="rgba(255,255,255,0.18)"/>`;
}

/** Big faint ghost text for editorial depth. */
function ghostText(text: string, x: number, y: number, size: number): string {
  return `<text x="${x}" y="${y}" fill="rgba(255,255,255,0.045)" font-size="${size}" font-weight="900" letter-spacing="-6">${esc(text)}</text>`;
}

function heroNumber(t: CardTheme, x: number, y: number, value: string, size: number): string {
  return `
    <text x="${x}" y="${y}" fill="${t.glow}" font-size="${size}" font-weight="900" letter-spacing="-4" filter="url(#glow-${t.id})" opacity="0.7">${esc(value)}</text>
    <text x="${x}" y="${y}" fill="${INK}" font-size="${size}" font-weight="900" letter-spacing="-4">${esc(value)}</text>`;
}

/* --------------------------------------------------------------- the cards */

function coverCard(s: WrappedStats, subtitle: string): string {
  const t: CardTheme = {
    id: "c1", base: "#03110c", wash: "#0a2c22", accent: "#25D366", glow: "#7CF3B0", page: "01",
    orbs: [{ cx: 880, cy: 360, r: 420, color: "#25D366", opacity: 0.5 }, { cx: 120, cy: 1500, r: 460, color: "#0f766e", opacity: 0.45 }],
  };
  const content = `
    ${eyebrow(80, 300, "WhatsApp", t.accent)}
    <text x="76" y="490" fill="${INK}" font-size="164" font-weight="900" letter-spacing="-4">Rewind</text>
    <text x="80" y="560" fill="${INK2}" font-size="40" font-weight="600">${esc(subtitle)}</text>
    <text x="80" y="1120" fill="${INK2}" font-size="34" font-weight="800" letter-spacing="3">YOU SENT &amp; RECEIVED</text>
    ${heroNumber(t, 72, 1330, fmt(s.totalMessages), 232)}
    <text x="80" y="1410" fill="${INK2}" font-size="44" font-weight="600">messages across ${s.activeChats} chats</text>`;
  return frame(t, ghostText("’26", 470, 1720, 640), content);
}

function topPeopleCard(s: WrappedStats): string {
  const t: CardTheme = {
    id: "c2", base: "#04120e", wash: "#0a231c", accent: "#25D366", glow: "#7CF3B0", page: "02",
    orbs: [{ cx: 980, cy: 520, r: 360, color: "#25D366", opacity: 0.4 }],
  };
  const people = s.topContacts.slice(0, 5);
  const max = people[0]?.count || 1;
  const x = 128, top = 820, rowH = 176, barW = 824, barH = 22;
  const rows = people.map((c, i) => {
    const y = top + i * rowH;
    const w = Math.max(28, Math.round((c.count / max) * barW));
    const name = esc(contactLabel(c.name, c.jid).slice(0, 22));
    return `
      <text x="${x}" y="${y}" fill="${INK}" font-size="50" font-weight="800">${i + 1}. ${name}</text>
      <text x="${x + barW}" y="${y}" fill="${INK2}" font-size="44" font-weight="700" text-anchor="end">${fmt(c.count)}</text>
      <rect x="${x}" y="${y + 26}" width="${barW}" height="${barH}" rx="11" fill="rgba(255,255,255,0.10)"/>
      <rect x="${x}" y="${y + 26}" width="${w}" height="${barH}" rx="11" fill="${t.accent}"/>`;
  }).join("");
  const content = `
    ${eyebrow(80, 300, "Your people", t.accent)}
    <text x="76" y="470" fill="${INK}" font-size="122" font-weight="900" letter-spacing="-3">Top 5 chats</text>
    <text x="80" y="560" fill="${INK2}" font-size="40" font-weight="600">who filled your inbox this year</text>
    ${tray(80, 720, W - 160, 5 * rowH + 40)}
    ${rows}`;
  return frame(t, ghostText("5", 620, 1180, 900), content);
}

function rhythmCard(s: WrappedStats): string {
  const t: CardTheme = {
    id: "c3", base: "#04140f", wash: "#0b3b34", accent: "#25D366", glow: "#7CF3B0", page: "03",
    orbs: [{ cx: 160, cy: 420, r: 380, color: "#10b981", opacity: 0.4 }, { cx: 980, cy: 1450, r: 360, color: "#0f766e", opacity: 0.4 }],
  };
  const max = Math.max(1, ...s.hourly);
  const x0 = 128, x1 = W - 128, baseY = 1480, plotH = 460;
  const n = 24, gap = 8;
  const bw = (x1 - x0 - gap * (n - 1)) / n;
  const peakHour = s.hourly.indexOf(max);
  const bars = s.hourly.map((c, h) => {
    const bh = Math.round((c / max) * plotH);
    const bx = x0 + h * (bw + gap);
    const by = baseY - bh;
    const isPeak = h === peakHour;
    return `<rect x="${bx.toFixed(1)}" y="${by}" width="${bw.toFixed(1)}" height="${Math.max(4, bh)}" rx="7" fill="${isPeak ? t.accent : "rgba(37,211,102,0.4)"}"/>`;
  }).join("");
  const axis = [0, 6, 12, 18].map((h) => {
    const bx = x0 + h * (bw + gap) + bw / 2;
    return `<text x="${bx.toFixed(1)}" y="${baseY + 46}" fill="${INK3}" font-size="28" font-weight="600" text-anchor="middle">${hourLabel(h)}</text>`;
  }).join("");
  const busiestDayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.daily.indexOf(Math.max(...s.daily))] ?? "-";
  const content = `
    ${eyebrow(80, 300, "Your rhythm", t.accent)}
    <text x="76" y="470" fill="${INK}" font-size="122" font-weight="900" letter-spacing="-3">Peak hour</text>
    ${heroNumber(t, 72, 720, hourLabel(peakHour), 168)}
    <text x="80" y="800" fill="${INK2}" font-size="42" font-weight="600">busiest day · ${busiestDayName}</text>
    ${tray(80, 980, W - 160, 640)}
    ${bars}
    <line x1="${x0}" y1="${baseY}" x2="${x1}" y2="${baseY}" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
    ${axis}
    <text x="128" y="1060" fill="${INK3}" font-size="30" font-weight="700" letter-spacing="2">MESSAGES BY HOUR OF DAY</text>`;
  return frame(t, "", content);
}

function emojiCard(s: WrappedStats): string {
  const t: CardTheme = {
    id: "c4", base: "#0b0620", wash: "#2a1152", accent: "#c084fc", glow: "#e9d5ff", page: "04",
    orbs: [{ cx: 860, cy: 380, r: 420, color: "#7c3aed", opacity: 0.5 }, { cx: 180, cy: 1520, r: 420, color: "#db2777", opacity: 0.42 }],
  };
  const top = s.topEmojis.slice(0, 6);
  const hero = top[0];
  const rest = top.slice(1, 5);
  const cells = rest.map((e, i) => {
    const col = i % 2, rowi = Math.floor(i / 2);
    const cx = 300 + col * 480, cy = 1180 + rowi * 250;
    return `
      <text x="${cx}" y="${cy}" font-size="120" text-anchor="middle">${esc(e.emoji)}</text>
      <text x="${cx}" y="${cy + 72}" fill="${INK2}" font-size="42" font-weight="800" text-anchor="middle">${fmt(e.count)}×</text>`;
  }).join("");
  const content = `
    ${eyebrow(80, 300, "Your mood", t.accent)}
    <text x="76" y="470" fill="${INK}" font-size="122" font-weight="900" letter-spacing="-3">Top emojis</text>
    ${hero ? `<text x="${W / 2}" y="640" fill="${INK2}" font-size="34" font-weight="800" text-anchor="middle" letter-spacing="4">MOST USED · ${fmt(hero.count)}×</text>
    <text x="${W / 2}" y="880" font-size="240" text-anchor="middle">${esc(hero.emoji)}</text>` : ""}
    ${tray(80, 1010, W - 160, 620)}
    ${cells}`;
  return frame(t, "", content);
}

function leaderboardCard(board: { fastest: ResponseLeaderEntry[]; slowest: ResponseLeaderEntry[] }): string {
  const t: CardTheme = {
    id: "c5", base: "#04120b", wash: "#0a2c18", accent: "#25D366", glow: "#7CF3B0", page: "05",
    orbs: [{ cx: 940, cy: 640, r: 340, color: "#25D366", opacity: 0.38 }, { cx: 160, cy: 1400, r: 360, color: "#f59e0b", opacity: 0.3 }],
  };
  const fast = board.fastest.slice(0, 3);
  const slow = board.slowest.slice(0, 3);
  const rows = (arr: ResponseLeaderEntry[], y0: number, color: string) => arr.map((e, i) => {
    const y = y0 + i * 118;
    const name = esc(contactLabel(e.name, e.jid).slice(0, 20));
    return `<text x="128" y="${y}" fill="${INK}" font-size="50" font-weight="800">${i + 1}. ${name}</text>
      <text x="${W - 128}" y="${y}" fill="${color}" font-size="50" font-weight="900" text-anchor="end">${humanDur(e.avgMyResponseSec)}</text>`;
  }).join("");
  const content = `
    ${eyebrow(80, 300, "Reply speed", t.accent)}
    <text x="76" y="470" fill="${INK}" font-size="112" font-weight="900" letter-spacing="-3">Left on read?</text>
    ${tray(80, 600, W - 160, 470)}
    <text x="128" y="690" fill="${t.glow}" font-size="42" font-weight="800">⚡ You reply fastest to</text>
    ${rows(fast, 800, t.glow)}
    ${tray(80, 1140, W - 160, 470)}
    <text x="128" y="1230" fill="#FFCE73" font-size="42" font-weight="800">🐌 You leave on read longest</text>
    ${rows(slow, 1340, "#FFCE73")}`;
  return frame(t, "", content);
}

function numbersCard(s: WrappedStats): string {
  const t: CardTheme = {
    id: "c6", base: "#03140e", wash: "#08312a", accent: "#25D366", glow: "#7CF3B0", page: "06",
    orbs: [{ cx: 900, cy: 1500, r: 420, color: "#25D366", opacity: 0.42 }],
  };
  const tiles = [
    [fmt(s.wordsSent), "words sent"], [`${s.longestStreakDays}d`, "longest streak"],
    [fmt(s.sent), "sent"], [fmt(s.received), "received"],
    [fmt(s.activeChats), "active chats"], [fmt(s.totalMessages), "total messages"],
  ];
  const tw = (W - 160 - 40) / 2, th = 300;
  const cells = tiles.map(([big, label], i) => {
    const col = i % 2, rowi = Math.floor(i / 2);
    const tx = 80 + col * (tw + 40), ty = 720 + rowi * (th + 40);
    return `${tray(tx, ty, tw, th)}
      <text x="${tx + 44}" y="${ty + 170}" fill="${INK}" font-size="104" font-weight="900" letter-spacing="-2">${esc(big)}</text>
      <text x="${tx + 48}" y="${ty + 228}" fill="${INK2}" font-size="34" font-weight="700" letter-spacing="1">${esc(String(label).toUpperCase())}</text>`;
  }).join("");
  const content = `
    ${eyebrow(80, 300, "By the numbers", t.accent)}
    <text x="76" y="470" fill="${INK}" font-size="122" font-weight="900" letter-spacing="-3">Your year</text>
    ${cells}`;
  return frame(t, "", content);
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
