#!/usr/bin/env node
import { describeSafety, ensureDirs } from "./config.ts";
import { logger, waLogger } from "./logger.ts";
import { initializeDatabase, closeDatabase } from "./db.ts";
import { startWhatsAppConnection } from "./whatsapp/connection.ts";
import { startMcpServer } from "./mcp/server.ts";

/**
 * whatsapp-mcp-plus entry point.
 *
 * Single process:
 *   1. init SQLite
 *   2. connect to WhatsApp (prints QR on first run)
 *   3. start the MCP server on stdio
 *
 * stdout is reserved for the MCP protocol; all human logs go to files in the
 * data dir. The QR code is the one exception (printed to stderr via the logger's
 * terminal renderer) so first-time pairing is possible.
 */
async function main(): Promise<void> {
  ensureDirs();
  logger.info(`Starting whatsapp-mcp-plus | ${describeSafety()}`);
  initializeDatabase();

  // Start the MCP server FIRST so a client can connect and call tools
  // immediately (they report "not connected" until WhatsApp is ready). The
  // WhatsApp connection then proceeds in the background — never block the
  // protocol on a network call.
  await startMcpServer(logger);

  // WAMCP_NO_WA=1 runs the MCP server without connecting to WhatsApp — used by
  // the smoke tests and the demo so they are deterministic and network-free.
  if (process.env.WAMCP_NO_WA === "1") {
    logger.info("WAMCP_NO_WA=1: skipping WhatsApp connection (server-only mode).");
    return;
  }

  startWhatsAppConnection(waLogger).catch((err) => {
    logger.error({ err }, "WhatsApp connection failed to start; MCP tools will report disconnected.");
  });
}

function shutdown(): void {
  try { closeDatabase(); } catch { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  logger.error({ err }, "Fatal error in main");
  process.exit(1);
});
