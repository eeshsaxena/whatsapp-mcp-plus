import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Logger } from "pino";

import { registerReadTools } from "./tools/read.ts";
import { registerSendTools } from "./tools/send.ts";
import { registerPrimitiveTools } from "./tools/primitives.ts";
import { registerGroupTools } from "./tools/groups.ts";
import { registerPresenceTools } from "./tools/presence.ts";
import { registerMediaTools } from "./tools/media.ts";
import { registerAnalyticsTools } from "./tools/analytics.ts";
import { registerAdminTools } from "./tools/admin.ts";
import { registerExtraTools } from "./tools/extras.ts";
import { registerChatTools } from "./tools/chat.ts";

export async function startMcpServer(logger: Logger): Promise<void> {
  const server = new McpServer({
    name: "whatsapp-mcp-plus",
    version: "0.1.0",
  });

  registerReadTools(server);
  registerSendTools(server);
  registerPrimitiveTools(server);
  registerGroupTools(server);
  registerPresenceTools(server);
  registerMediaTools(server);
  registerAnalyticsTools(server);
  registerAdminTools(server);
  registerExtraTools(server);
  registerChatTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server connected over stdio; ready.");
}
