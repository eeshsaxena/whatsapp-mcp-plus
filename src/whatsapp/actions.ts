import {
  jidNormalizedUser,
  type WAMessageKey,
  type WASocket,
  type proto,
} from "baileys";
import fs from "node:fs";
import path from "node:path";
import { getConnectionState } from "./connection.ts";
import { waCall, assertGroupJid, isValidReaction } from "./guard.ts";

/**
 * Raw WhatsApp actions. These do NOT enforce safety policy (that is the job of
 * src/safety), but every live Baileys call IS hardened here: bounded by a
 * timeout and wrapped so failures surface as clear, actionable messages instead
 * of raw Boom errors or a frozen tool call.
 */

const SEND_TIMEOUT = 30_000;
const MEDIA_TIMEOUT = 90_000;
const QUERY_TIMEOUT = 20_000;

function assertSock(sock: WASocket | null): asserts sock is WASocket {
  if (sock && sock.user) return;
  const state = getConnectionState();
  if (state === "logged-out") {
    throw new Error("WhatsApp is logged out. Delete the auth_info directory and restart to re-pair.");
  }
  throw new Error(
    `WhatsApp is not connected yet (state: ${state}). Wait for pairing/sync to finish, then retry. Use get_status to check.`,
  );
}

function guessMimeAndKind(filePath: string): { kind: "image" | "video" | "audio" | "document"; mimetype: string } {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, { kind: "image" | "video" | "audio" | "document"; mimetype: string }> = {
    ".jpg": { kind: "image", mimetype: "image/jpeg" },
    ".jpeg": { kind: "image", mimetype: "image/jpeg" },
    ".png": { kind: "image", mimetype: "image/png" },
    ".gif": { kind: "image", mimetype: "image/gif" },
    ".webp": { kind: "image", mimetype: "image/webp" },
    ".mp4": { kind: "video", mimetype: "video/mp4" },
    ".mov": { kind: "video", mimetype: "video/quicktime" },
    ".mp3": { kind: "audio", mimetype: "audio/mpeg" },
    ".ogg": { kind: "audio", mimetype: "audio/ogg; codecs=opus" },
    ".m4a": { kind: "audio", mimetype: "audio/mp4" },
    ".wav": { kind: "audio", mimetype: "audio/wav" },
    ".pdf": { kind: "document", mimetype: "application/pdf" },
  };
  return map[ext] ?? { kind: "document", mimetype: "application/octet-stream" };
}

/* -------------------------------------------------------------- messaging */

export async function sendText(
  sock: WASocket | null,
  jid: string,
  text: string,
  quoted?: proto.IWebMessageInfo,
): Promise<string | undefined> {
  assertSock(sock);
  const res = await waCall("send_message", () =>
    sock.sendMessage(jidNormalizedUser(jid), { text }, quoted ? { quoted } : undefined), SEND_TIMEOUT);
  return res?.key.id ?? undefined;
}

export async function sendMediaFile(
  sock: WASocket | null,
  jid: string,
  filePath: string,
  caption?: string,
): Promise<string | undefined> {
  assertSock(sock);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
  if (stat.size > 95 * 1024 * 1024) throw new Error("File exceeds WhatsApp's ~100MB limit.");

  const { kind, mimetype } = guessMimeAndKind(filePath);
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  let content: any;
  if (kind === "image") content = { image: buf, caption, mimetype };
  else if (kind === "video") content = { video: buf, caption, mimetype };
  else if (kind === "audio") content = { audio: buf, mimetype };
  else content = { document: buf, mimetype, fileName, caption };

  const res = await waCall("send_file", () => sock.sendMessage(jidNormalizedUser(jid), content), MEDIA_TIMEOUT);
  return res?.key.id ?? undefined;
}

export async function sendVoiceNote(
  sock: WASocket | null,
  jid: string,
  filePath: string,
): Promise<string | undefined> {
  assertSock(sock);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const buf = fs.readFileSync(filePath);
  const res = await waCall("send_voice_note", () => sock.sendMessage(jidNormalizedUser(jid), {
    audio: buf,
    ptt: true,
    mimetype: "audio/ogg; codecs=opus",
  }), MEDIA_TIMEOUT);
  return res?.key.id ?? undefined;
}

export async function reactToMessage(
  sock: WASocket | null,
  key: WAMessageKey,
  emoji: string,
): Promise<void> {
  assertSock(sock);
  if (!isValidReaction(emoji)) throw new Error(`Invalid reaction "${emoji}" (use a single emoji, or "" to clear).`);
  if (!key.remoteJid) throw new Error("Message key is missing remoteJid.");
  await waCall("react_to_message", () => sock.sendMessage(key.remoteJid!, { react: { text: emoji, key } }), SEND_TIMEOUT);
}

/** Delete for everyone. */
export async function deleteMessage(sock: WASocket | null, key: WAMessageKey): Promise<void> {
  assertSock(sock);
  if (!key.remoteJid) throw new Error("Message key is missing remoteJid.");
  await waCall("delete_message", () => sock.sendMessage(key.remoteJid!, { delete: key }), SEND_TIMEOUT);
}

export async function editMessage(
  sock: WASocket | null,
  key: WAMessageKey,
  newText: string,
): Promise<void> {
  assertSock(sock);
  if (!key.remoteJid) throw new Error("Message key is missing remoteJid.");
  await waCall("edit_message", () => sock.sendMessage(key.remoteJid!, { text: newText, edit: key }), SEND_TIMEOUT);
}

/** Text-only fallback forward (used when the original proto is unavailable). */
export async function forwardText(
  sock: WASocket | null,
  toJid: string,
  contentText: string,
): Promise<string | undefined> {
  assertSock(sock);
  const res = await waCall("forward_message", () =>
    sock.sendMessage(jidNormalizedUser(toJid), { text: contentText }), SEND_TIMEOUT);
  return res?.key.id ?? undefined;
}

/** True native forward using the original message proto (incl. media). */
export async function forwardMessage(
  sock: WASocket | null,
  toJid: string,
  original: proto.IWebMessageInfo,
): Promise<string | undefined> {
  assertSock(sock);
  const res = await waCall("forward_message", () =>
    sock.sendMessage(jidNormalizedUser(toJid), { forward: original }), MEDIA_TIMEOUT);
  return res?.key.id ?? undefined;
}

export async function markRead(sock: WASocket | null, keys: WAMessageKey[]): Promise<void> {
  assertSock(sock);
  if (!keys.length) return;
  await waCall("mark_read", () => sock.readMessages(keys), QUERY_TIMEOUT);
}

export type PresenceType = "available" | "unavailable" | "composing" | "recording" | "paused";
export async function sendPresence(
  sock: WASocket | null,
  jid: string,
  type: PresenceType,
): Promise<void> {
  assertSock(sock);
  await waCall("send_presence", () => sock.sendPresenceUpdate(type, jidNormalizedUser(jid)), QUERY_TIMEOUT);
}

export async function sendLocation(
  sock: WASocket | null,
  jid: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
): Promise<string | undefined> {
  assertSock(sock);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("Invalid coordinates (lat must be -90..90, lng -180..180).");
  }
  const res = await waCall("send_location", () => sock.sendMessage(jidNormalizedUser(jid), {
    location: { degreesLatitude: latitude, degreesLongitude: longitude, name, address },
  }), SEND_TIMEOUT);
  return res?.key.id ?? undefined;
}

export async function sendPoll(
  sock: WASocket | null,
  jid: string,
  name: string,
  values: string[],
  selectableCount = 1,
): Promise<string | undefined> {
  assertSock(sock);
  if (values.length < 2) throw new Error("A poll needs at least 2 options.");
  const res = await waCall("send_poll", () => sock.sendMessage(jidNormalizedUser(jid), {
    poll: { name, values, selectableCount },
  }), SEND_TIMEOUT);
  return res?.key.id ?? undefined;
}

export async function sendContactCard(
  sock: WASocket | null,
  jid: string,
  displayName: string,
  phoneNumber: string,
): Promise<string | undefined> {
  assertSock(sock);
  const waid = phoneNumber.replace(/[^0-9]/g, "");
  if (!waid) throw new Error("contact_phone must contain digits.");
  const vcard =
    "BEGIN:VCARD\n" +
    "VERSION:3.0\n" +
    `FN:${displayName}\n` +
    `TEL;type=CELL;type=VOICE;waid=${waid}:${phoneNumber}\n` +
    "END:VCARD";
  const res = await waCall("send_contact", () => sock.sendMessage(jidNormalizedUser(jid), {
    contacts: { displayName, contacts: [{ vcard }] },
  }), SEND_TIMEOUT);
  return res?.key.id ?? undefined;
}

/* ------------------------------------------------------------------ groups */

export async function createGroup(sock: WASocket | null, subject: string, participants: string[]) {
  assertSock(sock);
  if (!participants.length) throw new Error("Provide at least one participant.");
  return waCall("create_group", () => sock.groupCreate(subject, participants.map(jidNormalizedUser)), 30_000);
}

export async function groupParticipants(
  sock: WASocket | null,
  groupJid: string,
  participants: string[],
  action: "add" | "remove" | "promote" | "demote",
) {
  assertSock(sock);
  assertGroupJid(groupJid);
  if (!participants.length) throw new Error("Provide at least one participant.");
  return waCall("group_update_participants", () =>
    sock.groupParticipantsUpdate(groupJid, participants.map(jidNormalizedUser), action), QUERY_TIMEOUT);
}

export async function groupSetSubject(sock: WASocket | null, groupJid: string, subject: string) {
  assertSock(sock);
  assertGroupJid(groupJid);
  await waCall("group_set_subject", () => sock.groupUpdateSubject(groupJid, subject), QUERY_TIMEOUT);
}

export async function groupSetDescription(sock: WASocket | null, groupJid: string, description: string) {
  assertSock(sock);
  assertGroupJid(groupJid);
  await waCall("group_set_description", () => sock.groupUpdateDescription(groupJid, description), QUERY_TIMEOUT);
}

export async function groupInviteLink(sock: WASocket | null, groupJid: string): Promise<string> {
  assertSock(sock);
  assertGroupJid(groupJid);
  const code = await waCall("group_invite_link", () => sock.groupInviteCode(groupJid), QUERY_TIMEOUT);
  return `https://chat.whatsapp.com/${code}`;
}

export async function groupInfo(sock: WASocket | null, groupJid: string) {
  assertSock(sock);
  assertGroupJid(groupJid);
  return waCall("group_info", () => sock.groupMetadata(groupJid), QUERY_TIMEOUT);
}

export async function groupLeave(sock: WASocket | null, groupJid: string) {
  assertSock(sock);
  assertGroupJid(groupJid);
  await waCall("group_leave", () => sock.groupLeave(groupJid), QUERY_TIMEOUT);
}

/* -------------------------------------------------- chat & account state */

export async function pinChat(sock: WASocket | null, jid: string, pin: boolean) {
  assertSock(sock);
  await waCall("pin_chat", () => sock.chatModify({ pin }, jidNormalizedUser(jid)), QUERY_TIMEOUT);
}

export async function muteChat(sock: WASocket | null, jid: string, durationMs: number | null) {
  assertSock(sock);
  await waCall("mute_chat", () => sock.chatModify({ mute: durationMs }, jidNormalizedUser(jid)), QUERY_TIMEOUT);
}

export async function starMessage(
  sock: WASocket | null,
  jid: string,
  messageId: string,
  fromMe: boolean,
  star: boolean,
) {
  assertSock(sock);
  await waCall("star_message", () => sock.chatModify(
    { star: { messages: [{ id: messageId, fromMe }], star } },
    jidNormalizedUser(jid),
  ), QUERY_TIMEOUT);
}

export async function setBlockStatus(sock: WASocket | null, jid: string, block: boolean) {
  assertSock(sock);
  await waCall("block_contact", () =>
    sock.updateBlockStatus(jidNormalizedUser(jid), block ? "block" : "unblock"), QUERY_TIMEOUT);
}

export async function checkOnWhatsApp(
  sock: WASocket | null,
  numbers: string[],
): Promise<{ input: string; jid: string | null; exists: boolean }[]> {
  assertSock(sock);
  const results = await waCall("check_number_on_whatsapp", () => sock.onWhatsApp(...numbers), QUERY_TIMEOUT);
  return numbers.map((n) => {
    const digits = n.replace(/[^0-9]/g, "");
    const match = results?.find((r) => (r.jid.split("@")[0] ?? "") === digits);
    return { input: n, jid: match?.jid ?? null, exists: Boolean(match?.exists) };
  });
}

export async function getProfilePicture(sock: WASocket | null, jid: string): Promise<string | null> {
  assertSock(sock);
  try {
    return (await waCall("get_profile_picture", () =>
      sock.profilePictureUrl(jidNormalizedUser(jid), "image"), QUERY_TIMEOUT)) ?? null;
  } catch {
    return null; // no picture, private, or not reachable — treated as "none"
  }
}

export async function setProfileStatus(sock: WASocket | null, status: string) {
  assertSock(sock);
  await waCall("set_profile_status", () => sock.updateProfileStatus(status), QUERY_TIMEOUT);
}

export async function setProfileName(sock: WASocket | null, name: string) {
  assertSock(sock);
  await waCall("set_profile_name", () => sock.updateProfileName(name), QUERY_TIMEOUT);
}
