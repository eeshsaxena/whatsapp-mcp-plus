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
import { scopeForTool, scopeEnabled } from "../safety/scopes.ts";

/**
 * Wrap `server.tool` so every registered tool is gated by its feature scope
 * (consent). A tool whose scope is disabled stays listed but returns a clear
 * "enable this scope" error when called, instead of acting. Central, so no
 * per-tool edits are needed and the gate can never be forgotten.
 */
function withScopeGate(server: McpServer): McpServer {
  const orig = server.tool.bind(server);
  (server as unknown as { tool: (...a: unknown[]) => unknown }).tool = (...toolArgs: unknown[]) => {
    const name = toolArgs[0] as string;
    const handler = toolArgs[toolArgs.length - 1];
    const scope = scopeForTool(name);
    if (scope && typeof handler === "function") {
      const wrapped = async (...a: unknown[]) => {
        if (!scopeEnabled(scope)) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Error: the '${scope}' scope is not enabled, so '${name}' is unavailable. ` +
                  `Enable it via WAMCP_SCOPES (e.g. add '${scope}') or run \`npm run setup\`.`,
              },
            ],
            isError: true,
          };
        }
        return (handler as (...x: unknown[]) => unknown)(...a);
      };
      toolArgs[toolArgs.length - 1] = wrapped;
    }
    return (orig as (...x: unknown[]) => unknown)(...toolArgs);
  };
  return server;
}

export async function startMcpServer(logger: Logger): Promise<void> {
  const server = withScopeGate(new McpServer({
    name: "whatsapp-mcp-plus",
    version: "0.1.0",
  }));

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
