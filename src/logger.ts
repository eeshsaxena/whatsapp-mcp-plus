import pino from "pino";
import path from "node:path";
import { config, ensureDirs } from "./config.ts";

ensureDirs();

/**
 * We log to files inside the data dir, never to stdout. stdout is reserved for
 * the MCP stdio transport; writing logs there would corrupt the protocol.
 */
const level = process.env.WAMCP_LOG_LEVEL || "info";

export const waLogger = pino(
  { level, timestamp: pino.stdTimeFunctions.isoTime },
  pino.destination(path.join(config.dataDir, "wa-logs.txt")),
);

export const logger = pino(
  { level, timestamp: pino.stdTimeFunctions.isoTime },
  pino.destination(path.join(config.dataDir, "mcp-logs.txt")),
);
