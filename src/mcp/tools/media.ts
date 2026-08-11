import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import { downloadMessageMedia, transcribeVoiceMessage } from "../../whatsapp/media.ts";
import { jsonResult, textResult, safeHandler } from "../format.ts";

export function registerMediaTools(server: McpServer): void {
  server.tool(
    "download_media",
    { message_id: z.string().describe("Id of a recent message that contains media") },
    safeHandler(async ({ message_id }: any) => {
      const { path, mediaType } = await downloadMessageMedia(getSock(), message_id);
      return jsonResult({ path, media_type: mediaType });
    }),
  );

  server.tool(
    "transcribe_voice_message",
    { message_id: z.string().describe("Id of a recent voice/audio message to transcribe") },
    safeHandler(async ({ message_id }: any) => {
      const { transcript, configured } = await transcribeVoiceMessage(getSock(), message_id);
      return textResult(configured ? transcript : `(transcription not configured)\n${transcript}`);
    }),
  );
}
