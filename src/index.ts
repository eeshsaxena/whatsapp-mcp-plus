#!/usr/bin/env node
import { config, describeSafety, ensureDirs } from "./config.ts";
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

  try {
    await startWhatsAppConnection(waLogger);
  } catch (err) {
    logger.error({ err }, "WhatsApp connection failed to start; MCP tools will report disconnected.");
  }

  await startMcpServer(logger);
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
