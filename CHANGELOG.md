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

**Security hardening (pen-test pass):**
- Always-on send-file denylist blocks credential/secret files (`.env`, SSH keys,
  `*.pem`, `.aws`/`.ssh`/`auth_info/`, the message DB) even with no
  `WAMCP_SEND_FILE_ROOTS` set — closes a default-open exfiltration path.
- Media downloads bounded by `WAMCP_MAX_MEDIA_MB` (default 100) against
  disk/memory DoS.
- Privacy redaction regexes made linear (ReDoS-safe); injection warning banner
  extended to `get_last_interaction`.
- Global per-minute cap on ALL write actions (`WAMCP_ACTIONS_PER_MINUTE`,
  default 60) — reactions/edits/deletes/read-receipts/presence were previously
  unbounded (ban risk if the agent looped them).
- Shareable Wrapped/Rewind SVG cards pseudonymize contact names under privacy
  mode, so a posted card doesn't leak your contacts.
- `data/` + `auth_info/` locked to `0700` and DB files to `0600` (POSIX).
- Analytics card output paths (`wrapped_card`/`whatsapp_rewind`) confined to the
  data dir / `WAMCP_SEND_FILE_ROOTS` — closes an arbitrary-file-write path.
- Pseudonym aliases use an unguessable random suffix (were sequential), blocking
  alias-injection misrouting and contact-count enumeration.
- Destructive actions (delete_message, block_contact, group_leave, group
  participant-remove) now require the same two-step confirm as sends, so a
  prompt-injected agent can't fire them in one shot.
- Prototype-pollution defense: the privacy object-walkers drop `__proto__`/
  `constructor`/`prototype` keys instead of copying them.
- No unhandled rejection from the Baileys call-timeout race (was a possible crash).
- Added `test/harden-test.mjs` (37 checks) covering the above.

**Performance:** history sync batches each chunk into a single transaction and
reuses cached prepared statements — ~28x faster bulk message inserts (10k rows:
~26.5s -> ~0.95s in a local benchmark).

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
