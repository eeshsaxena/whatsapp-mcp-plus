import {
  jidNormalizedUser,
  type WAMessageKey,
  type WASocket,
  type proto,
} from "baileys";
import fs from "node:fs";
import path from "node:path";

/**
 * Raw WhatsApp actions. These are intentionally "dumb" — they do NOT enforce
 * safety policy. The safety gate lives in src/safety and wraps every mutating
 * call before it reaches here.
 */

function assertSock(sock: WASocket | null): asserts sock is WASocket {
  if (!sock || !sock.user) {
    throw new Error("WhatsApp is not connected yet. Wait for pairing to complete.");
  }
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
  const res = await sock.sendMessage(jidNormalizedUser(jid), { text }, quoted ? { quoted } : undefined);
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
  const { kind, mimetype } = guessMimeAndKind(filePath);
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  let content: any;
  if (kind === "image") content = { image: buf, caption, mimetype };
  else if (kind === "video") content = { video: buf, caption, mimetype };
  else if (kind === "audio") content = { audio: buf, mimetype };
  else content = { document: buf, mimetype, fileName, caption };

  const res = await sock.sendMessage(jidNormalizedUser(jid), content);
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
  // Best sent as .ogg/opus; other formats may not render as a playable voice note.
  const res = await sock.sendMessage(jidNormalizedUser(jid), {
    audio: buf,
    ptt: true,
    mimetype: "audio/ogg; codecs=opus",
  });
  return res?.key.id ?? undefined;
}

export async function reactToMessage(
  sock: WASocket | null,
  key: WAMessageKey,
  emoji: string,
): Promise<void> {
  assertSock(sock);
  await sock.sendMessage(key.remoteJid!, { react: { text: emoji, key } });
}

/** Delete for everyone. */
export async function deleteMessage(sock: WASocket | null, key: WAMessageKey): Promise<void> {
  assertSock(sock);
  await sock.sendMessage(key.remoteJid!, { delete: key });
}

export async function editMessage(
  sock: WASocket | null,
  key: WAMessageKey,
  newText: string,
): Promise<void> {
  assertSock(sock);
  await sock.sendMessage(key.remoteJid!, { text: newText, edit: key });
}

/**
 * Forward is best-effort: WhatsApp's native forward needs the original proto
 * message which we don't persist. We re-send the stored text with a forwarded
 * marker instead. (A future version can keep the full proto to enable true
 * media forwarding.)
 */
export async function forwardText(
  sock: WASocket | null,
  toJid: string,
  contentText: string,
): Promise<string | undefined> {
  assertSock(sock);
  const res = await sock.sendMessage(jidNormalizedUser(toJid), {
    text: contentText,
  });
  return res?.key.id ?? undefined;
}

/** True native forward using the original message proto (incl. media). */
export async function forwardMessage(
  sock: WASocket | null,
  toJid: string,
  original: proto.IWebMessageInfo,
): Promise<string | undefined> {
  assertSock(sock);
  const res = await sock.sendMessage(jidNormalizedUser(toJid), { forward: original });
  return res?.key.id ?? undefined;
}

export async function markRead(sock: WASocket | null, keys: WAMessageKey[]): Promise<void> {
  assertSock(sock);
  await sock.readMessages(keys);
}

export type PresenceType = "available" | "unavailable" | "composing" | "recording" | "paused";
export async function sendPresence(
  sock: WASocket | null,
  jid: string,
  type: PresenceType,
): Promise<void> {
  assertSock(sock);
  await sock.sendPresenceUpdate(type, jidNormalizedUser(jid));
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
  const res = await sock.sendMessage(jidNormalizedUser(jid), {
    location: { degreesLatitude: latitude, degreesLongitude: longitude, name, address },
  });
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
  const res = await sock.sendMessage(jidNormalizedUser(jid), {
    poll: { name, values, selectableCount },
  });
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
  const vcard =
    "BEGIN:VCARD\n" +
    "VERSION:3.0\n" +
    `FN:${displayName}\n` +
    `TEL;type=CELL;type=VOICE;waid=${waid}:${phoneNumber}\n` +
    "END:VCARD";
  const res = await sock.sendMessage(jidNormalizedUser(jid), {
    contacts: { displayName, contacts: [{ vcard }] },
  });
  return res?.key.id ?? undefined;
}

/* ------------------------------------------------------------------ groups */

export async function createGroup(sock: WASocket | null, subject: string, participants: string[]) {
  assertSock(sock);
  return sock.groupCreate(subject, participants.map(jidNormalizedUser));
}

export async function groupParticipants(
  sock: WASocket | null,
  groupJid: string,
  participants: string[],
  action: "add" | "remove" | "promote" | "demote",
) {
  assertSock(sock);
  return sock.groupParticipantsUpdate(groupJid, participants.map(jidNormalizedUser), action);
}

export async function groupSetSubject(sock: WASocket | null, groupJid: string, subject: string) {
  assertSock(sock);
  await sock.groupUpdateSubject(groupJid, subject);
}

export async function groupSetDescription(sock: WASocket | null, groupJid: string, description: string) {
  assertSock(sock);
  await sock.groupUpdateDescription(groupJid, description);
}

export async function groupInviteLink(sock: WASocket | null, groupJid: string): Promise<string> {
  assertSock(sock);
  const code = await sock.groupInviteCode(groupJid);
  return `https://chat.whatsapp.com/${code}`;
}

export async function groupInfo(sock: WASocket | null, groupJid: string) {
  assertSock(sock);
  return sock.groupMetadata(groupJid);
}

export async function groupLeave(sock: WASocket | null, groupJid: string) {
  assertSock(sock);
  await sock.groupLeave(groupJid);
}

/* -------------------------------------------------- chat & account state */

export async function pinChat(sock: WASocket | null, jid: string, pin: boolean) {
  assertSock(sock);
  await sock.chatModify({ pin }, jidNormalizedUser(jid));
}

export async function muteChat(sock: WASocket | null, jid: string, durationMs: number | null) {
  assertSock(sock);
  await sock.chatModify({ mute: durationMs }, jidNormalizedUser(jid));
}

export async function starMessage(
  sock: WASocket | null,
  jid: string,
  messageId: string,
  fromMe: boolean,
  star: boolean,
) {
  assertSock(sock);
  await sock.chatModify(
    { star: { messages: [{ id: messageId, fromMe }], star } },
    jidNormalizedUser(jid),
  );
}

export async function setBlockStatus(sock: WASocket | null, jid: string, block: boolean) {
  assertSock(sock);
  await sock.updateBlockStatus(jidNormalizedUser(jid), block ? "block" : "unblock");
}

export async function checkOnWhatsApp(
  sock: WASocket | null,
  numbers: string[],
): Promise<{ input: string; jid: string | null; exists: boolean }[]> {
  assertSock(sock);
  const results = await sock.onWhatsApp(...numbers);
  return numbers.map((n) => {
    const match = results?.find((r) => r.jid.startsWith(n.replace(/[^0-9]/g, "")));
    return { input: n, jid: match?.jid ?? null, exists: Boolean(match?.exists) };
  });
}

export async function getProfilePicture(sock: WASocket | null, jid: string): Promise<string | null> {
  assertSock(sock);
  try {
    return (await sock.profilePictureUrl(jidNormalizedUser(jid), "image")) ?? null;
  } catch {
    return null; // no picture or not visible
  }
}

export async function setProfileStatus(sock: WASocket | null, status: string) {
  assertSock(sock);
  await sock.updateProfileStatus(status);
}

export async function setProfileName(sock: WASocket | null, name: string) {
  assertSock(sock);
  await sock.updateProfileName(name);
}
