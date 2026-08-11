import { downloadMediaMessage, type WASocket } from "baileys";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { getCachedMessage } from "./msgcache.ts";
import { getRawMessage } from "../db.ts";
import { detectMediaType } from "./parse.ts";

/**
 * Download the media of a (recently seen) message to disk and return the path.
 * Requires the original message to still be in the in-memory cache.
 */
export async function downloadMessageMedia(
  sock: WASocket | null,
  messageId: string,
): Promise<{ path: string; mediaType: string }> {
  // Prefer the in-memory cache; fall back to the persisted proto so downloads
  // work for any synced message, not just recent ones.
  const msg = getCachedMessage(messageId) ?? getRawMessage(messageId) ?? undefined;
  if (!msg) {
    throw new Error(
      "Message not found. It may predate history sync, or raw storage is disabled (WAMCP_STORE_RAW=0).",
    );
  }
  const mediaType = detectMediaType(msg) ?? "file";
  const buffer = (await downloadMediaMessage(
    msg,
    "buffer",
    {},
    { logger: logger as any, reuploadRequest: (sock as any)?.updateMediaMessage },
  )) as Buffer;

  const mediaDir = path.join(config.dataDir, "media");
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
  const extByType: Record<string, string> = {
    image: ".jpg", video: ".mp4", audio: ".ogg", document: ".bin", sticker: ".webp", file: ".bin",
  };
  const outPath = path.join(mediaDir, `${messageId}${extByType[mediaType] ?? ".bin"}`);
  fs.writeFileSync(outPath, buffer);
  return { path: outPath, mediaType };
}

/**
 * Transcribe a voice message. Pluggable: set WAMCP_TRANSCRIPTION_CMD to a shell
 * command template containing {input}; it should print the transcript to stdout.
 * Example: WAMCP_TRANSCRIPTION_CMD="whisper {input} --model base --output_format txt --output_dir - "
 * If no command is configured we return a clear, non-fatal message.
 */
export async function transcribeVoiceMessage(
  sock: WASocket | null,
  messageId: string,
): Promise<{ transcript: string; configured: boolean }> {
  const { path: audioPath } = await downloadMessageMedia(sock, messageId);

  if (!config.transcriptionCmd) {
    return {
      configured: false,
      transcript:
        `Audio downloaded to ${audioPath}, but transcription is not configured. ` +
        `Set WAMCP_TRANSCRIPTION_CMD (a command containing {input}) to enable STT.`,
    };
  }

  const cmd = config.transcriptionCmd.replace("{input}", audioPath);
  const parts = cmd.split(" ").filter(Boolean);
  const bin = parts[0]!;
  const args = parts.slice(1);
  const res = spawnSync(bin, args, { encoding: "utf-8", timeout: 120_000 });
  if (res.status !== 0) {
    throw new Error(`Transcription command failed: ${res.stderr || res.error?.message || "unknown"}`);
  }
  return { configured: true, transcript: (res.stdout || "").trim() };
}
