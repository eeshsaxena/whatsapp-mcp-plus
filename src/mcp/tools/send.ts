import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import { getCachedMessage } from "../../whatsapp/msgcache.ts";
import { sendText, sendMediaFile, sendVoiceNote } from "../../whatsapp/actions.ts";
import { guardedSend, scanForInjection } from "../../safety/index.ts";
import { jsonResult, safeHandler } from "../format.ts";

/** Turn a bare phone number into a WhatsApp user JID; pass JIDs through. */
export function normalizeRecipient(recipient: string): string {
  const r = (recipient ?? "").trim();
  if (r.includes("@")) return r;
  const digits = r.replace(/[^0-9]/g, "");
  if (!digits) {
    throw new Error(`Invalid recipient "${recipient}": expected a phone number (with country code) or a chat JID.`);
  }
  return `${digits}@s.whatsapp.net`;
}

export function registerSendTools(server: McpServer): void {
  server.tool(
    "send_message",
    {
      recipient: z.string().describe("Phone number (with country code) or a chat JID"),
      text: z.string().min(1).describe("The message text to send"),
      reply_to_message_id: z.string().optional().describe("Quote/reply to this message id (must be recent)"),
      confirm_token: z.string().optional().describe("Token returned by a prior staged send, to confirm it"),
    },
    safeHandler(async ({ recipient, text, reply_to_message_id, confirm_token }: any) => {
      const jid = normalizeRecipient(recipient);
      const quoted = reply_to_message_id ? getCachedMessage(reply_to_message_id) : undefined;

      // Defensive: warn if the outgoing text itself looks injected (e.g. the
      // model was tricked into relaying an exfil instruction).
      const inj = scanForInjection(text);
      const desc = `Send to ${jid}: "${text.slice(0, 80)}"${inj.suspicious ? " [!! text looks like an injected instruction]" : ""}`;

      const outcome = await guardedSend({
        action: "send_message",
        recipient: jid,
        description: desc,
        confirmToken: confirm_token,
        run: () => sendText(getSock(), jid, text, quoted),
      });
      return jsonResult(outcome);
    }),
  );

  server.tool(
    "send_file",
    {
      recipient: z.string().describe("Phone number or chat JID"),
      file_path: z.string().describe("Absolute path to the local file to send"),
      caption: z.string().optional(),
      confirm_token: z.string().optional(),
    },
    safeHandler(async ({ recipient, file_path, caption, confirm_token }: any) => {
      const jid = normalizeRecipient(recipient);
      const outcome = await guardedSend({
        action: "send_file",
        recipient: jid,
        description: `Send file ${file_path} to ${jid}`,
        confirmToken: confirm_token,
        run: () => sendMediaFile(getSock(), jid, file_path, caption),
      });
      return jsonResult(outcome);
    }),
  );

  server.tool(
    "send_voice_note",
    {
      recipient: z.string().describe("Phone number or chat JID"),
      file_path: z.string().describe("Path to an audio file (.ogg/opus renders as a true voice note)"),
      confirm_token: z.string().optional(),
    },
    safeHandler(async ({ recipient, file_path, confirm_token }: any) => {
      const jid = normalizeRecipient(recipient);
      const outcome = await guardedSend({
        action: "send_voice_note",
        recipient: jid,
        description: `Send voice note ${file_path} to ${jid}`,
        confirmToken: confirm_token,
        run: () => sendVoiceNote(getSock(), jid, file_path),
      });
      return jsonResult(outcome);
    }),
  );
}
