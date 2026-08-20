# Changelog

## 0.1.0 (unreleased)

First release. A secure, zero-setup WhatsApp MCP server in TypeScript on Baileys,
a maintained successor to the abandoned `lharries/whatsapp-mcp`.

**Tools (51):**
- Read: search_contacts, list_chats, list_groups, get_chat, list_messages
  (date range), get_last_interaction, contact_info, get_message_context,
  search_messages
- Send: send_message (with reply), send_file, send_voice_note, send_location,
  send_poll, send_contact
- Message actions: react, edit, delete, mark_read, forward (true native forward
  with media), star
- Groups: info, create, update participants, subject, description, invite link, leave
- Chat mgmt: pin, mute, block, check_number_on_whatsapp, get_profile_picture
- Presence/profile: send_presence, set_profile_status, set_profile_name
- Media: download_media, transcribe_voice_message (pluggable STT)
- Analytics: whatsapp_wrapped, wrapped_card (shareable SVG), response_leaderboard,
  top_words, chat_stats (with reply times), export_chat
- Control/safety: get_status, get_me, set_mode, confirm_action, allowlist_*

**Safety (safe by default):** read-only mode, contact allowlist, rate limiting,
confirm-to-send, prompt-injection guard.

**Privacy (default ON, `WAMCP_PRIVACY`):** before results reach the LLM,
identifiers (JIDs, phone numbers, emails, contact names) are pseudonymized to
reversible local aliases, and structured secrets in message text (payment cards,
government IDs, bank codes, API keys, OTP codes) are redacted.

**Infra:** zero native deps (node:sqlite), raw proto persistence for media/forward,
npx + Docker install, GitHub Actions CI, demo scripts, 75 tests + MCP smoke.

**Fixes:**
- QR code routed to stderr (was corrupting the MCP stdio transport).
- Sync full message history on first login (`syncFullHistory`, opt-out via
  `WAMCP_SYNC_FULL_HISTORY=0`) — a fresh pairing previously synced only the
  contact/chat list, leaving the analytics tools empty until new messages arrived.
- Resolve sender names for WhatsApp's privacy `@lid` identifiers by capturing
  `pushName` from live messages and cross-linking the lid/phone contact forms,
  so analytics show names instead of raw numbers.
- Persist our own sent messages (text, media, voice, location, poll, contact,
  forward) so they appear in `list_messages` and can be edited/deleted by id
  (Baileys emits no upsert for outgoing messages).
- Parse poll (V2/V3) and contact / contacts-array messages, so sent polls and
  contact cards are captured instead of silently dropped.

Derived from whatsapp-mcp-ts (ISC) and whatsapp-mcp (MIT); see NOTICE.
