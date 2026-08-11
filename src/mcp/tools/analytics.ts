import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { computeWrapped, computeResponseLeaderboard, computeTopWords } from "../../db.ts";
import { renderWrappedSVG } from "../../analytics/card.ts";
import { config } from "../../config.ts";
import { jsonResult, textResult, safeHandler } from "../format.ts";

/** Turn a period keyword into an ISO "since" cutoff. */
function periodToSince(period: string): string | null {
  const now = Date.now();
  switch (period) {
    case "week": return new Date(now - 7 * 864e5).toISOString();
    case "month": return new Date(now - 30 * 864e5).toISOString();
    case "year": return new Date(now - 365 * 864e5).toISOString();
    case "all": default: return null;
  }
}

function renderCard(stats: ReturnType<typeof computeWrapped>, period: string): string {
  const line = "─".repeat(34);
  const hour = stats.busiestHour
    ? `${String(stats.busiestHour.hour).padStart(2, "0")}:00 (${stats.busiestHour.count} msgs)`
    : "n/a";
  const top = stats.topContacts.slice(0, 5)
    .map((c, i) => `  ${i + 1}. ${(c.name ?? c.jid.split("@")[0]).slice(0, 22).padEnd(22)} ${c.count}`)
    .join("\n");
  const emojis = stats.topEmojis.slice(0, 8).map((e) => `${e.emoji}${e.count}`).join("  ");
  return [
    line,
    `   📊  WhatsApp Wrapped — ${period}`,
    line,
    `   Total messages : ${stats.totalMessages}`,
    `   Sent / Received: ${stats.sent} / ${stats.received}`,
    `   Active chats   : ${stats.activeChats}`,
    `   Busiest hour   : ${hour}`,
    `   Busiest day    : ${stats.busiestDay ? `${stats.busiestDay.day} (${stats.busiestDay.count})` : "n/a"}`,
    ``,
    `   Top people:`,
    top || "  (none)",
    ``,
    `   Top emojis: ${emojis || "(none)"}`,
    line,
  ].join("\n");
}

export function registerAnalyticsTools(server: McpServer): void {
  server.tool(
    "wrapped_card",
    {
      period: z.enum(["week", "month", "year", "all"]).default("all"),
      output_path: z.string().optional().describe("Where to write the .svg (defaults to the data dir)"),
      title: z.string().optional(),
      subtitle: z.string().optional(),
    },
    safeHandler(async ({ period, output_path, title, subtitle }: any) => {
      const stats = computeWrapped(periodToSince(period), 10);
      const svg = renderWrappedSVG(stats, { title, subtitle });
      const out = output_path || path.join(config.dataDir, `whatsapp-wrapped-${period}.svg`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, svg, "utf-8");
      return jsonResult({
        path: out,
        note: "Shareable SVG card written. Open it or convert to PNG to post.",
        stats: { total: stats.totalMessages, sent: stats.sent, received: stats.received },
      });
    }),
  );

  server.tool(
    "top_words",
    {
      chat_jid: z.string().optional().describe("Restrict to one chat; omit for all chats"),
      period: z.enum(["week", "month", "year", "all"]).default("all"),
      limit: z.number().int().positive().max(50).default(20),
    },
    safeHandler(async ({ chat_jid, period, limit }: any) => {
      return jsonResult(computeTopWords(chat_jid ?? null, limit, periodToSince(period)));
    }),
  );

  server.tool(
    "response_leaderboard",
    {
      min_responses: z.number().int().min(1).max(50).default(3).describe("Minimum replies required to rank a chat"),
      limit: z.number().int().positive().max(30).default(10),
    },
    safeHandler(async ({ min_responses, limit }: any) => {
      const board = computeResponseLeaderboard(min_responses, limit);
      const fmt = (e: any, i: number) => {
        const secs = e.avgMyResponseSec;
        const human = secs < 90 ? `${secs}s` : secs < 5400 ? `${Math.round(secs / 60)}m` : `${(secs / 3600).toFixed(1)}h`;
        return `  ${i + 1}. ${(e.name ?? e.jid.split("@")[0]).slice(0, 22).padEnd(22)} ${human}`;
      };
      const card = [
        "⚡ You reply FASTEST to:",
        ...board.fastest.map(fmt),
        "",
        "🐌 You leave on read the LONGEST:",
        ...board.slowest.map(fmt),
      ].join("\n");
      return textResult(card);
    }),
  );

  server.tool(
    "whatsapp_wrapped",
    {
      period: z.enum(["week", "month", "year", "all"]).default("all"),
      format: z.enum(["card", "json"]).default("card").describe("card = shareable text card, json = raw stats"),
      top_n: z.number().int().positive().max(25).default(10),
    },
    safeHandler(async ({ period, format, top_n }: any) => {
      const stats = computeWrapped(periodToSince(period), top_n);
      if (format === "json") return jsonResult({ period, ...stats });
      return textResult(renderCard(stats, period));
    }),
  );
}
