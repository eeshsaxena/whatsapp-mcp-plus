import {
  type WAMessage,
  type WAMessageKey,
  isJidGroup,
  jidNormalizedUser,
} from "baileys";
import type { Message as DbMessage } from "../db.ts";

/** Detected media kind for a message, or null for plain text. */
export function detectMediaType(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.audioMessage) return "audio";
  if (m.documentMessage) return "document";
  if (m.stickerMessage) return "sticker";
  return null;
}

/** Convert a raw Baileys message into our DB row shape, or null if unsupported. */
export function parseMessageForDb(msg: WAMessage): DbMessage | null {
  if (!msg.message || !msg.key || !msg.key.remoteJid) return null;

  const m = msg.message;
  const messageType = Object.keys(m)[0] ?? "unknown";
  let content: string | null = null;

  if (m.conversation) content = m.conversation;
  else if (m.extendedTextMessage?.text) content = m.extendedTextMessage.text;
  else if (m.imageMessage) content = `[Image] ${m.imageMessage.caption ?? ""}`.trim();
  else if (m.videoMessage) content = `[Video] ${m.videoMessage.caption ?? ""}`.trim();
  else if (m.documentMessage)
    content = `[Document] ${m.documentMessage.caption || m.documentMessage.fileName || ""}`.trim();
  else if (m.audioMessage) content = m.audioMessage.ptt ? "[Voice message]" : "[Audio]";
  else if (m.stickerMessage) content = "[Sticker]";
  else if (m.locationMessage) content = `[Location] ${m.locationMessage.address ?? ""}`.trim();
  else if (m.contactMessage?.displayName) content = `[Contact] ${m.contactMessage.displayName}`;
  else if (m.pollCreationMessage?.name) content = `[Poll] ${m.pollCreationMessage.name}`;
  else if (m.reactionMessage?.text) content = `[Reaction ${m.reactionMessage.text}]`;

  if (!content) return null;

  let timestampSeconds: number;
  if (msg.messageTimestamp != null) timestampSeconds = Number(msg.messageTimestamp);
  else timestampSeconds = Date.now() / 1000;

  let senderJid: string | null | undefined = msg.key.participant;
  if (!msg.key.fromMe && !senderJid && !isJidGroup(msg.key.remoteJid)) {
    senderJid = msg.key.remoteJid;
  }
  if (msg.key.fromMe && !isJidGroup(msg.key.remoteJid)) senderJid = null;

  return {
    id: msg.key.id!,
    chat_jid: msg.key.remoteJid,
    sender: senderJid ? jidNormalizedUser(senderJid) : null,
    content,
    timestamp: new Date(timestampSeconds * 1000),
    is_from_me: msg.key.fromMe ?? false,
    message_type: messageType,
    media_type: detectMediaType(msg),
  };
}

/**
 * Reconstruct a Baileys WAMessageKey from stored fields. Needed by any action
 * that targets an existing message: react, delete, edit, mark-read, quote.
 */
export function reconstructKey(row: {
  id: string;
  chat_jid: string;
  is_from_me: boolean;
  sender?: string | null;
}): WAMessageKey {
  const isGroup = row.chat_jid.endsWith("@g.us");
  const key: WAMessageKey = {
    remoteJid: row.chat_jid,
    id: row.id,
    fromMe: row.is_from_me,
  };
  if (isGroup && row.sender) key.participant = row.sender;
  return key;
}
