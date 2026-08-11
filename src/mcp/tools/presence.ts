import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import { sendPresence } from "../../whatsapp/actions.ts";
import { assertMutationsAllowed } from "../../safety/index.ts";
import { textResult, safeHandler } from "../format.ts";
import { normalizeRecipient } from "./send.ts";

export function registerPresenceTools(server: McpServer): void {
  server.tool(
    "send_presence",
    {
      recipient: z.string().describe("Phone number or chat JID"),
      state: z.enum(["available", "unavailable", "composing", "recording", "paused"]),
    },
    safeHandler(async ({ recipient, state }: any) => {
      assertMutationsAllowed("send_presence");
      const jid = normalizeRecipient(recipient);
      await sendPresence(getSock(), jid, state);
      return textResult(`Presence '${state}' sent to ${jid}`);
    }),
  );
}
