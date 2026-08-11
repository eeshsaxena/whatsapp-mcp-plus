import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import { describeSafety } from "../../config.ts";
import { cacheSize } from "../../whatsapp/msgcache.ts";
import {
  addToAllowlist,
  removeFromAllowlist,
  listAllowlist,
} from "../../db.ts";
import {
  getMode,
  setMode,
  confirmAction,
  listPending,
} from "../../safety/index.ts";
import { jsonResult, textResult, safeHandler } from "../format.ts";
import { normalizeRecipient } from "./send.ts";

export function registerAdminTools(server: McpServer): void {
  server.tool(
    "get_status",
    {},
    safeHandler(async () => {
      const sock = getSock();
      return jsonResult({
        connected: Boolean(sock?.user),
        me: sock?.user?.id ?? null,
        mode: getMode(),
        safety: describeSafety(),
        cached_messages: cacheSize(),
        pending_confirmations: listPending(),
      });
    }),
  );

  server.tool(
    "set_mode",
    { mode: z.enum(["read-only", "assisted", "unrestricted"]) },
    safeHandler(async ({ mode }: any) => {
      setMode(mode);
      return textResult(`Mode set to '${mode}'. ${describeSafety()}`);
    }),
  );

  server.tool(
    "confirm_action",
    { token: z.string().describe("Token from a staged send that needs confirmation") },
    safeHandler(async ({ token }: any) => {
      const result = await confirmAction(token);
      return jsonResult({ status: "done", result });
    }),
  );

  server.tool(
    "allowlist_add",
    { recipient: z.string().describe("Phone number or JID to allow messaging") },
    safeHandler(async ({ recipient }: any) => {
      const jid = normalizeRecipient(recipient);
      addToAllowlist(jid);
      return textResult(`Added ${jid} to allowlist`);
    }),
  );

  server.tool(
    "allowlist_remove",
    { recipient: z.string() },
    safeHandler(async ({ recipient }: any) => {
      const jid = normalizeRecipient(recipient);
      removeFromAllowlist(jid);
      return textResult(`Removed ${jid} from allowlist`);
    }),
  );

  server.tool(
    "allowlist_list",
    {},
    safeHandler(async () => jsonResult(listAllowlist())),
  );
}
