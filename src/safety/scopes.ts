import { config } from "../config.ts";

/**
 * Per-feature consent. Every tool belongs to a scope; a tool only runs if its
 * scope is enabled (WAMCP_SCOPES, default "read,analytics"). Control tools that
 * manage the server itself (get_status, set_mode, confirm_action, allowlist_*)
 * have no scope and are always available. This is the plug-and-play consent
 * model: the assistant can read + analyze out of the box, and the user opts into
 * sending, media, group management, and profile changes explicitly.
 */
export const TOOL_SCOPES: Record<string, string> = {
  // read
  search_contacts: "read",
  list_chats: "read",
  get_chat: "read",
  list_messages: "read",
  get_last_interaction: "read",
  contact_info: "read",
  chat_stats: "read",
  export_chat: "read",
  get_message_context: "read",
  search_messages: "read",
  list_groups: "read",
  group_info: "read",
  check_number_on_whatsapp: "read",
  get_profile_picture: "read",
  // analytics
  wrapped_card: "analytics",
  top_words: "analytics",
  whatsapp_rewind: "analytics",
  response_leaderboard: "analytics",
  whatsapp_wrapped: "analytics",
  // media
  download_media: "media",
  transcribe_voice_message: "media",
  // send (messages + message actions + presence)
  send_message: "send",
  send_file: "send",
  send_voice_note: "send",
  react_to_message: "send",
  edit_message: "send",
  delete_message: "send",
  mark_read: "send",
  forward_message: "send",
  send_location: "send",
  send_poll: "send",
  send_contact: "send",
  send_presence: "send",
  // groups (membership / metadata changes)
  create_group: "groups",
  group_update_participants: "groups",
  group_set_subject: "groups",
  group_set_description: "groups",
  group_invite_link: "groups",
  group_leave: "groups",
  // profile / chat management
  pin_chat: "profile",
  mute_chat: "profile",
  star_message: "profile",
  block_contact: "profile",
  set_profile_status: "profile",
  set_profile_name: "profile",
};

export function scopeForTool(name: string): string | undefined {
  return TOOL_SCOPES[name];
}

export function scopeEnabled(scope: string): boolean {
  return config.scopes.has(scope);
}
