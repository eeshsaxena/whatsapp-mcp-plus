import type { WrappedStats } from "../db.ts";
import { contactLabel } from "../privacy.ts";

/**
 * Render a shareable "WhatsApp Wrapped" card as a self-contained SVG string.
 * No dependencies, no fonts to embed (uses system sans). This is the viral
 * artifact: users export it and post it.
 */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtHour(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}

export interface CardOptions {
  title?: string;
  subtitle?: string;
  accent?: string;
}

export function renderWrappedSVG(stats: WrappedStats, opts: CardOptions = {}): string {
  const W = 620, H = 820;
  const accent = opts.accent ?? "#25D366";
  const bg = "#0b141a";
  const panel = "#111b21";
  const fg = "#e9edef";
  const muted = "#8696a0";
  const title = opts.title ?? "WhatsApp Wrapped";
  const subtitle = opts.subtitle ?? "your year in messages";

  const topContacts = stats.topContacts.slice(0, 5);
  const topEmojis = stats.topEmojis.slice(0, 6);

  const contactRows = topContacts.map((c, i) => {
    const y = 468 + i * 46;
    const name = esc(contactLabel(c.name, c.jid).slice(0, 20));
    const max = topContacts[0]?.count || 1;
    const barW = Math.max(6, Math.round((c.count / max) * 250));
    return `
      <text x="56" y="${y}" fill="${fg}" font-size="20" font-weight="600">${i + 1}. ${name}</text>
      <rect x="300" y="${y - 16}" width="260" height="20" rx="10" fill="#20303a"/>
      <rect x="300" y="${y - 16}" width="${barW}" height="20" rx="10" fill="${accent}"/>
      <text x="568" y="${y}" fill="${muted}" font-size="16" text-anchor="end">${c.count}</text>`;
  }).join("");

  const emojiRow = topEmojis.map((e, i) =>
    `<text x="${64 + i * 92}" y="748" font-size="40" text-anchor="middle">${esc(e.emoji)}</text>
     <text x="${64 + i * 92}" y="778" fill="${muted}" font-size="15" text-anchor="middle">${e.count}</text>`,
  ).join("");

  const hour = stats.busiestHour ? fmtHour(stats.busiestHour.hour) : "-";
  const day = stats.busiestDay?.day ?? "-";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" rx="28" fill="${bg}"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="20" fill="${panel}"/>

  <text x="56" y="92" fill="${accent}" font-size="18" font-weight="700" letter-spacing="3">WHATSAPP</text>
  <text x="56" y="132" fill="${fg}" font-size="40" font-weight="800">${esc(title)}</text>
  <text x="56" y="162" fill="${muted}" font-size="18">${esc(subtitle)}</text>
  <text x="56" y="192" fill="${accent}" font-size="16" font-weight="600">${stats.wordsSent.toLocaleString()} words sent · ${stats.longestStreakDays}-day streak</text>

  <text x="56" y="250" fill="${muted}" font-size="16">TOTAL MESSAGES</text>
  <text x="56" y="316" fill="${fg}" font-size="72" font-weight="800">${stats.totalMessages.toLocaleString()}</text>

  <g>
    <text x="330" y="250" fill="${muted}" font-size="16">SENT</text>
    <text x="330" y="292" fill="${accent}" font-size="34" font-weight="700">${stats.sent.toLocaleString()}</text>
    <text x="470" y="250" fill="${muted}" font-size="16">RECEIVED</text>
    <text x="470" y="292" fill="${fg}" font-size="34" font-weight="700">${stats.received.toLocaleString()}</text>
  </g>

  <line x1="56" y1="352" x2="564" y2="352" stroke="#20303a" stroke-width="1"/>

  <g>
    <text x="56" y="392" fill="${muted}" font-size="16">BUSIEST HOUR</text>
    <text x="56" y="424" fill="${fg}" font-size="26" font-weight="700">${hour}</text>
    <text x="240" y="392" fill="${muted}" font-size="16">BUSIEST DAY</text>
    <text x="240" y="424" fill="${fg}" font-size="26" font-weight="700">${esc(day)}</text>
    <text x="420" y="392" fill="${muted}" font-size="16">ACTIVE CHATS</text>
    <text x="420" y="424" fill="${fg}" font-size="26" font-weight="700">${stats.activeChats}</text>
  </g>

  <text x="56" y="452" fill="${muted}" font-size="16">TOP PEOPLE</text>
  ${contactRows}

  <text x="56" y="716" fill="${muted}" font-size="16">TOP EMOJIS</text>
  ${emojiRow}

  <text x="${W - 56}" y="${H - 40}" fill="${muted}" font-size="14" text-anchor="end">whatsapp-mcp-plus</text>
</svg>`;
}
