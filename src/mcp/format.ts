import type { Message as DbMessage, Chat as DbChat } from "../db.ts";

export function formatDbMessageForJson(msg: DbMessage) {
  return {
    id: msg.id,
    chat_jid: msg.chat_jid,
    chat_name: msg.chat_name ?? "Unknown Chat",
    sender_jid: msg.sender ?? null,
    sender_display: msg.sender ? msg.sender.split("@")[0] : msg.is_from_me ? "Me" : "Unknown",
    content: msg.content,
    timestamp: msg.timestamp?.toISOString?.() ?? null,
    is_from_me: msg.is_from_me,
    media_type: msg.media_type ?? null,
  };
}

export function formatDbChatForJson(chat: DbChat) {
  return {
    jid: chat.jid,
    name: chat.name ?? chat.jid.split("@")[0] ?? "Unknown Chat",
    is_group: chat.jid.endsWith("@g.us"),
    last_message_time: chat.last_message_time?.toISOString?.() ?? null,
    last_message_preview: chat.last_message ?? null,
    last_sender_jid: chat.last_sender ?? null,
    last_is_from_me: chat.last_is_from_me ?? null,
  };
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Wrap a tool handler so thrown errors (incl. SafetyError) become clean results. */
export function safeHandler<A extends any[]>(
  fn: (...args: A) => Promise<ToolResult>,
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e: any) {
      return errorResult(e?.message ?? String(e));
    }
  };
}
