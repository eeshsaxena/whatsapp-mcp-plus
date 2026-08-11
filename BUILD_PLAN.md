# WhatsApp MCP+ (working name) — Build Plan

A secure, zero-setup, read-first WhatsApp MCP server. A better, maintained successor to
the abandoned `lharries/whatsapp-mcp` (6.1k stars, last touched Jul 2025).

## 1. The wedge (why this wins where the incumbent stalled)

The incumbent proved demand (6.1k stars) then died. Its three weaknesses are our three
selling points:

1. **Setup is brutal** → we ship **one-command install**.
2. **It is a thin read/send wrapper** (12 tools) → we add the missing WhatsApp primitives
   + intelligence features.
3. **Its own README admits the prompt-injection hole and does nothing** → we are
   **secure and safe-by-default**, which also directly lowers users' ban risk.

Positioning line: **"A secure, read-first WhatsApp assistant for your AI. One command to
install. Safe by default."** Not an outreach/marketing automation tool (that framing is a
ban-and-abuse magnet we explicitly avoid).

## 2. What we reuse from lharries/whatsapp-mcp (MIT — fork + attribute)

License is MIT, so we fork and keep attribution in NOTICE/README. Reusable as-is:

- **Go bridge (`whatsapp-bridge/main.go`)** — the hard part. whatsmeow connection, QR
  auth, `events.Message`/`HistorySync`/`Connected`/`LoggedOut` handling, SQLite writes,
  media up/download. Keep this as the foundation.
- **SQLite schema** (`chats`, `messages` tables) and the read queries in `whatsapp.py`.
- **`audio.py`** — ffmpeg conversion to `.ogg` Opus for voice notes.
- **Message formatting helpers** in `whatsapp.py`.

whatsmeow itself (MPL-2.0) is used as a dependency — fine, no obligations beyond keeping
any modified whatsmeow files open (we will not modify it).

## 3. Architecture

Keep the **two-process split** (it is the reason we can reuse so much), but fix the
packaging that made it painful:

```
[WhatsApp Web multi-device protocol]
            |
   Go bridge (whatsmeow)  ── owns connection, auth, SQLite, send/download
            |  local REST (localhost only)
   Python MCP server      ── tools, SAFETY LAYER, reads SQLite directly
            |  stdio / streamable-http
        MCP client (Claude Desktop / Cursor / Claude Code)
```

Incumbent exposed only 2 REST endpoints (`/api/send`, `/api/download`). We extend the
bridge with endpoints for the new primitives (react, reply, edit, delete, mark-read,
groups, presence) — all supported by whatsmeow, just never wired up.

**Packaging upgrades (this is a headline feature):**
- **Docker one-liner** that runs both processes: `docker run ... whatsapp-mcp-plus`.
- Prebuilt Go binaries per-OS (no `go run`, no CGO/MSYS2 pain on Windows).
- `uvx` / `pipx` entry for the Python side; a single `wamcp init` that wires the client
  config automatically instead of hand-edited JSON with path substitution.

## 4. Safe-by-default design (core — bakes ban-avoidance + injection defense in)

Ban risk is mostly behavioral, so the tool controls it. Reading is low-risk; cold/bulk
sending is high-risk. We bias hard toward the safe zone by default.

| Safety feature | Kills which ban / attack vector | Default |
|---|---|---|
| **Read-only mode** | removes ~all sending risk | **ON by default** |
| **Contact allowlist** (only message existing contacts / people who messaged first) | cold-outreach ban trigger (#1) | ON |
| **Confirm-before-send** (tool returns a preview, requires explicit approve) | injection-driven mass-send + accidental spam | ON |
| **Rate limiting** (per-minute + daily caps, human-like jitter) | volume/velocity fingerprint | ON |
| **Block bulk / identical broadcasts** | spam pattern | ON |
| **Injection guard** (flag/quarantine tool-triggering text found *inside* messages) | the "lethal trifecta" the incumbent ignores | ON |
| **Presence/typing emulation, mirror normal hours** | machine-like behavior | optional |
| **Docs: aged number not fresh SIM, avoid VOIP** | account-reputation factor | guidance |

Modes: `read-only` (default) → `assisted` (send allowed, allowlist + confirm) →
`unrestricted` (explicit opt-in, loud warnings). This is the security-story differentiator
and it is Eesh's AI-security wheelhouse. chaindead's Telegram MCP proves people star ACL.

## 5. Tool roadmap (phased)

**Phase 0 — reuse baseline (fork works end to end)**
Existing 12 tools running: search_contacts, list_messages, list_chats, get_chat,
get_direct_chat_by_contact, get_contact_chats, get_last_interaction, get_message_context,
send_message, send_file, send_audio_message, download_media.

**Phase 1 — safety layer**
Read-only default, allowlist, confirm-before-send, rate limiter, injection guard, modes.

**Phase 2 — missing primitives (whatsmeow supports all; add bridge endpoints + tools)**
react, reply/quote, edit, delete (for-me / for-everyone), mark-read/unread, forward,
star/pin.

**Phase 3 — groups + presence**
create_group, add/remove_participant, promote/demote_admin, set name/description,
get_invite_link, list_participants; typing/online/last-seen; mute/archive/pin chat.

**Phase 4 — killer intelligence features**
- **Voice-note transcription (STT, whisper)** — auto-transcribe voice messages. Beloved,
  nobody exposes it.
- **Image understanding / OCR** on received media.
- **Real-time triggers / webhooks** — react to incoming messages (opt-in auto-reply
  agents). Turns read-tool into an automation platform (gated behind safety layer).

**Phase 5 — viral hook**
- **"WhatsApp Wrapped" / analytics** command: who you talk to most, response times,
  message counts, busiest hours. Screenshot-able, shareable, the repost engine.

**Phase 6 — nice-to-haves**
polls (create/read), location, stickers, vCard contacts, status/stories, Channels.

## 6. One-month milestone plan (heavy nights + weekends)

- **Week 1** — Fork, get baseline running cross-platform. Ship Docker one-liner +
  `wamcp init`. This alone is a migration magnet.
- **Week 2** — Safety layer (Phase 1) + primitives (Phase 2). Write the security README
  section (read-only default, ban-avoidance guidance).
- **Week 3** — Groups/presence (Phase 3) + voice transcription (start Phase 4). Record a
  crisp demo GIF.
- **Week 4** — WhatsApp Wrapped (Phase 5) + polish + docs. **Launch.**

## 7. Launch framing (see separate LAUNCH.md when we get there)

- Lead with the two things the abandoned incumbent cannot counter: **zero-setup** and
  **secure by default**.
- Demo hooks: voice-note transcription + WhatsApp Wrapped (the shareable artifact).
- Honest ceiling from research: WhatsApp is the one 1k+ opening we found, but it carries
  ToS/ban baggage. Target = revive the 6.1k demand as the maintained, safer successor.
- Channels: HN ("Show HN: a secure, zero-setup successor to the abandoned WhatsApp MCP"),
  the incumbent's stale issue tracker/forks (people looking for a live alternative), X,
  relevant subreddits.

## 8. Legal / risk notes

- **MIT fork**: keep lharries attribution (NOTICE + README credit). Clean.
- **whatsmeow MPL-2.0**: dependency only, no obligations if unmodified.
- **WhatsApp ToS reality**: this is an unofficial client; ban risk cannot be zeroed, only
  reduced. Ship a clear disclaimer. Frame as personal read-first assistant, never as bulk
  outreach. This framing is both ethical and self-protective (fewer bans = fewer angry
  issues on your name).

## 9. Naming options (pick one)

- `whatsapp-mcp-plus` (current working dir)
- `wamcp`
- `safewa` / `whatsapp-mcp-secure`
- `wa-assistant-mcp`

Prefer something short + npm/pip-installable + signals "secure/maintained successor."

## 10. Open decisions for Eesh

1. Name.
2. Keep Go+Python split (max reuse) vs attempt single-language rewrite (cleaner, slower)?
   → Recommendation: keep the split, win on packaging instead.
3. Ship `assisted`/`unrestricted` send modes at launch, or **read-only only for v1** to
   keep the ban-risk/abuse surface minimal and the story clean? → Recommendation:
   read-only + confirm-gated assisted at launch; unrestricted later.
