import type { Message as DbMessage, Chat as DbChat } from "../db.ts";
import { scrubOutput, scrubText, dePseudonymizeArgs } from "../privacy.ts";

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
  return { content: [{ type: "text", text: JSON.stringify(scrubOutput(data), null, 2) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text: scrubText(text) }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${scrubText(message)}` }], isError: true };
}

/**
 * Wrap a tool handler so thrown errors (incl. SafetyError) become clean results.
 * Also reverses privacy-mode aliases in the incoming arguments, so a JID/phone
 * the model only ever saw as an alias is resolved back to the real value before
 * the handler runs.
 */
export function safeHandler<A extends any[]>(
  fn: (...args: A) => Promise<ToolResult>,
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      const scrubbed = (args.length ? [dePseudonymizeArgs(args[0]), ...args.slice(1)] : args) as A;
      return await fn(...scrubbed);
    } catch (e: any) {
      return errorResult(e?.message ?? String(e));
    }
  };
}
