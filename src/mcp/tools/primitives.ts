import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import { getMessageById } from "../../db.ts";
import { reconstructKey } from "../../whatsapp/parse.ts";
import {
  reactToMessage,
  deleteMessage,
  editMessage,
  markRead,
  forwardText,
} from "../../whatsapp/actions.ts";
import { assertMutationsAllowed, guardedSend } from "../../safety/index.ts";
import { textResult, jsonResult, safeHandler, errorResult } from "../format.ts";

function keyForMessage(messageId: string) {
  const row = getMessageById(messageId);
  if (!row) return null;
  return reconstructKey({
    id: row.id,
    chat_jid: row.chat_jid,
    is_from_me: row.is_from_me,
    sender: row.sender,
  });
}

export function registerPrimitiveTools(server: McpServer): void {
  server.tool(
    "react_to_message",
    {
      message_id: z.string(),
      emoji: z.string().min(1).describe("Emoji to react with; empty string removes the reaction"),
    },
    safeHandler(async ({ message_id, emoji }: any) => {
      assertMutationsAllowed("react_to_message");
      const key = keyForMessage(message_id);
      if (!key) return errorResult(`Unknown message id ${message_id}`);
      await reactToMessage(getSock(), key, emoji);
      return textResult(`Reacted ${emoji} to ${message_id}`);
    }),
  );

  server.tool(
    "edit_message",
    {
      message_id: z.string().describe("Id of one of YOUR sent messages to edit"),
      new_text: z.string().min(1),
    },
    safeHandler(async ({ message_id, new_text }: any) => {
      assertMutationsAllowed("edit_message");
      const row = getMessageById(message_id);
      if (!row) return errorResult(`Unknown message id ${message_id}`);
      if (!row.is_from_me) return errorResult("You can only edit messages you sent.");
      const key = reconstructKey({ id: row.id, chat_jid: row.chat_jid, is_from_me: true, sender: row.sender });
      await editMessage(getSock(), key, new_text);
      return textResult(`Edited ${message_id}`);
    }),
  );

  server.tool(
    "delete_message",
    {
      message_id: z.string(),
      for_everyone: z.boolean().default(true).describe("Delete for everyone (only works for your own recent messages)"),
    },
    safeHandler(async ({ message_id }: any) => {
      assertMutationsAllowed("delete_message");
      const key = keyForMessage(message_id);
      if (!key) return errorResult(`Unknown message id ${message_id}`);
      await deleteMessage(getSock(), key);
      return textResult(`Requested deletion of ${message_id}`);
    }),
  );

  server.tool(
    "mark_read",
    {
      message_ids: z.array(z.string()).min(1).describe("Message ids to mark as read"),
    },
    safeHandler(async ({ message_ids }: any) => {
      assertMutationsAllowed("mark_read");
      const keys = message_ids.map(keyForMessage).filter(Boolean) as any[];
      if (keys.length === 0) return errorResult("None of the given message ids were found.");
      await markRead(getSock(), keys);
      return textResult(`Marked ${keys.length} message(s) as read`);
    }),
  );

  server.tool(
    "forward_message",
    {
      message_id: z.string().describe("Id of the message to forward"),
      recipient: z.string().describe("Phone number or chat JID to forward to"),
      confirm_token: z.string().optional(),
    },
    safeHandler(async ({ message_id, recipient, confirm_token }: any) => {
      const row = getMessageById(message_id);
      if (!row) return errorResult(`Unknown message id ${message_id}`);
      const jid = recipient.includes("@") ? recipient : `${recipient.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
      const outcome = await guardedSend({
        action: "forward_message",
        recipient: jid,
        description: `Forward message ${message_id} to ${jid}`,
        confirmToken: confirm_token,
        run: () => forwardText(getSock(), jid, row.content),
      });
      return jsonResult(outcome);
    }),
  );
}
