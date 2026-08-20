import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getMessages,
  getChats,
  getChat,
  getMessagesAround,
  getLastInteraction,
  searchDbForContacts,
  searchMessages,
  computeChatStats,
  exportChat,
  getContactInfo,
} from "../../db.ts";
import { formatDbMessageForJson, formatDbChatForJson, jsonResult, textResult, safeHandler } from "../format.ts";
import { annotateForInjection } from "../../safety/index.ts";

export function registerReadTools(server: McpServer): void {
  server.tool(
    "search_contacts",
    { query: z.string().min(1).describe("Name or phone-number fragment to search for") },
    safeHandler(async ({ query }: { query: string }) => {
      return jsonResult(searchDbForContacts(query));
    }),
  );

  server.tool(
    "list_chats",
    {
      query: z.string().optional().describe("Filter chats by name/jid"),
      limit: z.number().int().positive().max(100).default(20),
      page: z.number().int().min(0).default(0),
      sort_by: z.enum(["last_active", "name"]).default("last_active"),
    },
    safeHandler(async ({ query, limit, page, sort_by }: any) => {
      const chats = getChats(limit, page, sort_by, query, true);
      return jsonResult(chats.map(formatDbChatForJson));
    }),
  );

  server.tool(
    "get_chat",
    {
      chat_jid: z.string().describe("The JID of the chat, e.g. 12345@s.whatsapp.net or ...@g.us"),
      include_last_message: z.boolean().default(true),
    },
    safeHandler(async ({ chat_jid, include_last_message }: any) => {
      const chat = getChat(chat_jid, include_last_message);
      return jsonResult(chat ? formatDbChatForJson(chat) : null);
    }),
  );

  server.tool(
    "list_messages",
    {
      chat_jid: z.string().describe("The JID of the chat to read messages from"),
      limit: z.number().int().positive().max(200).default(20),
      page: z.number().int().min(0).default(0),
      after: z.string().optional().describe("ISO timestamp; only messages at/after this time"),
      before: z.string().optional().describe("ISO timestamp; only messages at/before this time"),
    },
    safeHandler(async ({ chat_jid, limit, page, after, before }: any) => {
      const messages = getMessages(chat_jid, limit, page, { after, before });
      const formatted = messages.map(formatDbMessageForJson);
      const injection = annotateForInjection(messages.map((m) => m.content));
      return jsonResult({ warning: injection.warning, messages: formatted });
    }),
  );

  server.tool(
    "get_last_interaction",
    { chat_jid: z.string().describe("Chat JID to fetch the most recent message from") },
    safeHandler(async ({ chat_jid }: any) => {
      const msg = getLastInteraction(chat_jid);
      if (!msg) return jsonResult(null);
      const injection = annotateForInjection([msg.content]);
      return jsonResult({ warning: injection.warning, message: formatDbMessageForJson(msg) });
    }),
  );

  server.tool(
    "contact_info",
    { jid: z.string().describe("Contact or chat JID") },
    safeHandler(async ({ jid }: any) => {
      const info = getContactInfo(jid);
      return jsonResult({
        ...info,
        last_message_time: info.last_message_time?.toISOString?.() ?? null,
      });
    }),
  );

  server.tool(
    "chat_stats",
    { chat_jid: z.string().describe("Chat JID to compute statistics for") },
    safeHandler(async ({ chat_jid }: any) => {
      const s = computeChatStats(chat_jid);
      return jsonResult({
        ...s,
        firstMessage: s.firstMessage?.toISOString?.() ?? null,
        lastMessage: s.lastMessage?.toISOString?.() ?? null,
      });
    }),
  );

  server.tool(
    "export_chat",
    {
      chat_jid: z.string(),
      format: z.enum(["markdown", "text"]).default("markdown"),
      limit: z.number().int().positive().max(20000).default(5000),
    },
    safeHandler(async ({ chat_jid, format, limit }: any) => {
      return textResult(exportChat(chat_jid, format, limit));
    }),
  );

  server.tool(
    "get_message_context",
    {
      message_id: z.string().describe("The message id to center context around"),
      before: z.number().int().min(0).max(50).default(5),
      after: z.number().int().min(0).max(50).default(5),
    },
    safeHandler(async ({ message_id, before, after }: any) => {
      const ctx = getMessagesAround(message_id, before, after);
      const all = [...ctx.before, ...(ctx.target ? [ctx.target] : []), ...ctx.after];
      const injection = annotateForInjection(all.map((m) => m.content));
      return jsonResult({
        warning: injection.warning,
        before: ctx.before.map(formatDbMessageForJson),
        target: ctx.target ? formatDbMessageForJson(ctx.target) : null,
        after: ctx.after.map(formatDbMessageForJson),
      });
    }),
  );

  server.tool(
    "search_messages",
    {
      query: z.string().min(1).describe("Substring to search message content for"),
      chat_jid: z.string().optional().describe("Restrict to a single chat"),
      limit: z.number().int().positive().max(100).default(10),
      page: z.number().int().min(0).default(0),
    },
    safeHandler(async ({ query, chat_jid, limit, page }: any) => {
      const messages = searchMessages(query, chat_jid ?? null, limit, page);
      const injection = annotateForInjection(messages.map((m) => m.content));
      return jsonResult({ warning: injection.warning, messages: messages.map(formatDbMessageForJson) });
    }),
  );
}
