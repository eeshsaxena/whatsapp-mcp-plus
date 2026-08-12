import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  type WASocket,
} from "baileys";
import qrcode from "qrcode-terminal";
import type { Logger } from "pino";

import { config } from "../config.ts";
import {
  initializeDatabase,
  storeMessage,
  storeChat,
  storeContact,
  encodeRawMessage,
} from "../db.ts";
import { parseMessageForDb } from "./parse.ts";
import { rememberMessage } from "./msgcache.ts";

export type WhatsAppSocket = WASocket;

/**
 * Holds the live socket so MCP tools (which are invoked independently of the
 * connection lifecycle) can reach it. Set on every (re)connect.
 */
let currentSock: WhatsAppSocket | null = null;
export function getSock(): WhatsAppSocket | null {
  return currentSock;
}

export type ConnState = "connecting" | "open" | "close" | "logged-out";
let connState: ConnState = "connecting";
export function getConnectionState(): ConnState {
  return connState;
}

export async function startWhatsAppConnection(logger: Logger): Promise<WhatsAppSocket> {
  initializeDatabase();

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Using WA v${version.join(".")}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: true,
    // NOTE: unlike the base repo we do NOT ignore group JIDs — group support is
    // a first-class feature here.
    markOnlineOnConnect: false, // less "bot-like" presence on connect
  });
  currentSock = sock;

  sock.ev.process(async (events) => {
    if (events["connection.update"]) {
      const { connection, lastDisconnect, qr } = events["connection.update"];

      if (qr) {
        // Print a scannable QR directly in the terminal — no browser, no
        // third-party QR service (the base repo POSTed the QR to quickchart.io,
        // which leaks the pairing code to a remote host).
        // IMPORTANT: render the QR to stderr, never stdout. stdout is the MCP
        // JSON-RPC transport and any stray bytes there corrupt the protocol.
        qrcode.generate(qr, { small: true }, (art: string) => {
          process.stderr.write("\n" + art + "\n");
        });
        logger.info("QR code printed to terminal (stderr). Scan it with WhatsApp > Linked Devices.");
      }

      if (connection === "connecting") {
        connState = "connecting";
      } else if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        logger.warn(`Connection closed: ${DisconnectReason[statusCode] || "unknown"}`);
        if (statusCode !== DisconnectReason.loggedOut) {
          connState = "connecting";
          setTimeout(() => {
            startWhatsAppConnection(logger).catch((e) =>
              logger.error({ err: e }, "Reconnect attempt failed; will retry on next close."));
          }, 2000);
        } else {
          connState = "logged-out";
          logger.error("Logged out. Delete the auth_info directory and restart to re-pair.");
        }
      } else if (connection === "open") {
        connState = "open";
        logger.info(`Connected as ${sock.user?.name ?? sock.user?.id}`);
      }
    }

    if (events["creds.update"]) await saveCreds();

    if (events["messaging-history.set"]) {
      const { chats, contacts, messages } = events["messaging-history.set"];
      for (const c of contacts) {
        storeContact({
          jid: c.id,
          name: c.name ?? null,
          notify: c.notify ?? null,
          phoneNumber: (c as any).phoneNumber ?? null,
        });
      }
      for (const chat of chats) {
        storeChat({
          jid: chat.id,
          name: chat.name,
          last_message_time: chat.conversationTimestamp
            ? new Date(Number(chat.conversationTimestamp) * 1000)
            : undefined,
        });
      }
      let stored = 0;
      for (const msg of messages) {
        rememberMessage(msg);
        const parsed = parseMessageForDb(msg);
        if (parsed) {
          if (config.storeRaw) parsed.raw = encodeRawMessage(msg);
          storeMessage(parsed);
          stored++;
        }
      }
      logger.info(`History sync: ${contacts.length} contacts, ${chats.length} chats, ${stored} messages.`);
    }

    if (events["messages.upsert"]) {
      const { messages, type } = events["messages.upsert"];
      if (type === "notify" || type === "append") {
        for (const msg of messages) {
          rememberMessage(msg);
          const parsed = parseMessageForDb(msg);
          if (parsed) {
            if (config.storeRaw) parsed.raw = encodeRawMessage(msg);
            storeMessage(parsed);
          }
        }
      }
    }

    if (events["chats.update"]) {
      for (const cu of events["chats.update"]) {
        storeChat({
          jid: cu.id!,
          name: cu.name,
          last_message_time: cu.conversationTimestamp
            ? new Date(Number(cu.conversationTimestamp) * 1000)
            : undefined,
        });
      }
    }

    if (events["contacts.upsert"]) {
      for (const c of events["contacts.upsert"]) {
        storeContact({
          jid: c.id,
          name: c.name ?? null,
          notify: c.notify ?? null,
          phoneNumber: (c as any).phoneNumber ?? null,
        });
      }
    }
  });

  return sock;
}
