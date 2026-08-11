import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import { getGroupChats } from "../../db.ts";
import { sendLocation, sendPoll, sendContactCard } from "../../whatsapp/actions.ts";
import { guardedSend } from "../../safety/index.ts";
import { formatDbChatForJson, jsonResult, safeHandler } from "../format.ts";
import { normalizeRecipient } from "./send.ts";

export function registerExtraTools(server: McpServer): void {
  server.tool(
    "list_groups",
    { limit: z.number().int().positive().max(200).default(50), page: z.number().int().min(0).default(0) },
    safeHandler(async ({ limit, page }: any) => {
      return jsonResult(getGroupChats(limit, page).map(formatDbChatForJson));
    }),
  );

  server.tool(
    "send_location",
    {
      recipient: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
      confirm_token: z.string().optional(),
    },
    safeHandler(async ({ recipient, latitude, longitude, name, address, confirm_token }: any) => {
      const jid = normalizeRecipient(recipient);
      const outcome = await guardedSend({
        action: "send_location",
        recipient: jid,
        description: `Send location (${latitude},${longitude}) to ${jid}`,
        confirmToken: confirm_token,
        run: () => sendLocation(getSock(), jid, latitude, longitude, name, address),
      });
      return jsonResult(outcome);
    }),
  );

  server.tool(
    "send_poll",
    {
      recipient: z.string(),
      question: z.string().min(1),
      options: z.array(z.string()).min(2).max(12),
      selectable_count: z.number().int().min(1).default(1),
      confirm_token: z.string().optional(),
    },
    safeHandler(async ({ recipient, question, options, selectable_count, confirm_token }: any) => {
      const jid = normalizeRecipient(recipient);
      const outcome = await guardedSend({
        action: "send_poll",
        recipient: jid,
        description: `Send poll "${question}" to ${jid}`,
        confirmToken: confirm_token,
        run: () => sendPoll(getSock(), jid, question, options, selectable_count),
      });
      return jsonResult(outcome);
    }),
  );

  server.tool(
    "send_contact",
    {
      recipient: z.string(),
      contact_name: z.string().min(1),
      contact_phone: z.string().min(1),
      confirm_token: z.string().optional(),
    },
    safeHandler(async ({ recipient, contact_name, contact_phone, confirm_token }: any) => {
      const jid = normalizeRecipient(recipient);
      const outcome = await guardedSend({
        action: "send_contact",
        recipient: jid,
        description: `Send contact card for ${contact_name} to ${jid}`,
        confirmToken: confirm_token,
        run: () => sendContactCard(getSock(), jid, contact_name, contact_phone),
      });
      return jsonResult(outcome);
    }),
  );
}
