import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import { getMessageById } from "../../db.ts";
import {
  pinChat,
  muteChat,
  starMessage,
  setBlockStatus,
  checkOnWhatsApp,
  getProfilePicture,
  setProfileStatus,
  setProfileName,
} from "../../whatsapp/actions.ts";
import { assertMutationsAllowed } from "../../safety/index.ts";
import { jsonResult, textResult, safeHandler, errorResult } from "../format.ts";
import { normalizeRecipient } from "./send.ts";

export function registerChatTools(server: McpServer): void {
  server.tool(
    "check_number_on_whatsapp",
    { numbers: z.array(z.string()).min(1).describe("Phone numbers (with country code) to check") },
    safeHandler(async ({ numbers }: any) => {
      const res = await checkOnWhatsApp(getSock(), numbers);
      return jsonResult(res);
    }),
  );

  server.tool(
    "get_profile_picture",
    { jid: z.string().describe("Contact or group JID") },
    safeHandler(async ({ jid }: any) => {
      const url = await getProfilePicture(getSock(), normalizeRecipient(jid));
      return jsonResult({ url });
    }),
  );

  server.tool(
    "pin_chat",
    { chat_jid: z.string(), pinned: z.boolean().default(true) },
    safeHandler(async ({ chat_jid, pinned }: any) => {
      assertMutationsAllowed("pin_chat");
      await pinChat(getSock(), chat_jid, pinned);
      return textResult(`${pinned ? "Pinned" : "Unpinned"} ${chat_jid}`);
    }),
  );

  server.tool(
    "mute_chat",
    {
      chat_jid: z.string(),
      duration_hours: z.number().min(0).default(8).describe("Mute duration in hours; 0 unmutes"),
    },
    safeHandler(async ({ chat_jid, duration_hours }: any) => {
      assertMutationsAllowed("mute_chat");
      const ms = duration_hours > 0 ? Math.round(duration_hours * 3600_000) : null;
      await muteChat(getSock(), chat_jid, ms);
      return textResult(ms ? `Muted ${chat_jid} for ${duration_hours}h` : `Unmuted ${chat_jid}`);
    }),
  );

  server.tool(
    "star_message",
    { message_id: z.string(), star: z.boolean().default(true) },
    safeHandler(async ({ message_id, star }: any) => {
      assertMutationsAllowed("star_message");
      const row = getMessageById(message_id);
      if (!row) return errorResult(`Unknown message id ${message_id}`);
      await starMessage(getSock(), row.chat_jid, row.id, row.is_from_me, star);
      return textResult(`${star ? "Starred" : "Unstarred"} ${message_id}`);
    }),
  );

  server.tool(
    "block_contact",
    { jid: z.string(), block: z.boolean().default(true).describe("true=block, false=unblock") },
    safeHandler(async ({ jid, block }: any) => {
      assertMutationsAllowed("block_contact");
      await setBlockStatus(getSock(), normalizeRecipient(jid), block);
      return textResult(`${block ? "Blocked" : "Unblocked"} ${jid}`);
    }),
  );

  server.tool(
    "set_profile_status",
    { status: z.string().describe("Your new WhatsApp 'about' text") },
    safeHandler(async ({ status }: any) => {
      assertMutationsAllowed("set_profile_status");
      await setProfileStatus(getSock(), status);
      return textResult("Profile status updated");
    }),
  );

  server.tool(
    "set_profile_name",
    { name: z.string().min(1) },
    safeHandler(async ({ name }: any) => {
      assertMutationsAllowed("set_profile_name");
      await setProfileName(getSock(), name);
      return textResult("Profile name updated");
    }),
  );
}
