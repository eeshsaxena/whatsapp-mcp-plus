# HANDOFF — whatsapp-mcp-plus

Last updated: 2026-08-11 (autonomous build session)

## What this is
A secure, zero-setup WhatsApp MCP server in TypeScript on Baileys. A maintained
successor to the abandoned `lharries/whatsapp-mcp` (6.1k stars). Goal: stars.
Strategy + research rationale live in `BUILD_PLAN.md`.

## Current state: BUILDS, BOOTS, MCP LAYER VERIFIED. Live WhatsApp UNtested.

### Done and verified (this session)
- **Architecture decided from real constraints:** Go was not installed on this
  machine, Node was. Chose single-process **TypeScript + Baileys** (also gives the
  `npx` one-command install that was the #1 wedge). Base = jlucaso1/whatsapp-mcp-ts
  (ISC), extended in place. Attribution in NOTICE/LICENSE.
- **Full codebase written** (`src/`): config + safety, node:sqlite storage,
  Baileys connection/parse/actions/media/msgcache, MCP server + 8 tool modules.
- **51 MCP tools** register and list correctly over stdio (incumbent had 12).
  Read/send/primitives/groups/presence + location/poll/contact/list_groups +
  chat mgmt (pin/mute/block/star/check-number/profile-pic/profile-status) +
  analytics (whatsapp_wrapped, **wrapped_card shareable SVG**, response_leaderboard,
  top_words, chat_stats with response times, export_chat) + get_me.
- **Raw proto persistence** (WAMCP_STORE_RAW): media download + true native
  forward work for any synced message, not just in-memory recent ones.
- **Packaging:** bin shebang survives build (npx works), Dockerfile + .dockerignore,
  GitHub Actions CI, `npm run demo` + `npm run card` generate real analytics /
  the shareable SVG (docs/sample-wrapped.svg) for README/launch screenshots.
- **Fixed:** QR was printed to stdout, corrupting the MCP transport (would break
  Claude Desktop pairing). Now on stderr. Caught by the MCP smoke test.
- **LAUNCH.md**: concrete 3-day launch plan. **CHANGELOG.md** written.
- `npm install` clean (0 vulns). `tsc --noEmit` clean. `tsc` build → `dist/` clean
  (import extensions rewritten `.ts`→`.js`).
- **Runtime verified without WhatsApp:**
  - boots, initializes SQLite, MCP "ready".
  - `get_status` → correct safety/connection JSON.
  - `whatsapp_wrapped` → renders the shareable card (empty DB).
  - `send_message` in read-only mode → correctly BLOCKED by the safety gate.
- **Test suite (`npm test`): 75 checks pass** across `test/pure-test.mjs` (13),
  `test/safety-test.mjs` (mode/allowlist/rate/confirm gate, 13),
  `test/logic-test.mjs` (22), `test/features-test.mjs` (chat_stats response times,
  export, date range, leaderboard, SVG card, proto round-trip, 27), plus
  `test/smoke-mcp.mjs` (tools/list = 51) and `test/smoke-call.mjs` (live calls +
  read-only block). None require WhatsApp. CI runs the deterministic subset.

### NOT yet tested (needs YOU — requires a live WhatsApp pairing / QR scan)
Everything that actually talks to WhatsApp. I cannot scan the QR with your phone.
To test end-to-end:
```bash
cd whatsapp-mcp-plus
npm run build && node dist/index.js   # scan the QR it prints, wait for history sync
```
Then, in an MCP client (or extend the smoke harness), exercise, in `assisted`
mode (`WAMCP_MODE=assisted`):
- read: list_chats / list_messages / search_messages against real data
- send_message (should stage a confirm token; then confirm_action)
- react / reply (reply_to_message_id) / edit / delete / mark_read
- group_info / group tools
- download_media + transcribe_voice_message (set WAMCP_TRANSCRIPTION_CMD)
- whatsapp_wrapped against real history (the shareable artifact)

## Known limitations / debug candidates
- **Media download, transcription, true forwarding** need the original message
  proto, held only in an in-memory LRU (`msgcache`, last 2000). Works for recent
  messages; older ones return a clear "not in cache" error. Persisting protos is a
  future improvement.
- **forward_message** is best-effort (re-sends stored text, not native forward).
- **Baileys API drift:** group/participant/edit/delete signatures are from Baileys
  6.7.x. If a call throws at runtime, check against the installed Baileys version.
- **send_voice_note** without ffmpeg won't render as a true PTT voice note for
  non-opus input. Consider bundling an ffmpeg step later.
- Timestamps from history sync depend on WhatsApp; wrapped stats are only as good
  as synced history.

## Suggested next steps (in order)
1. You: pair once, confirm read tools + wrapped against real data.
2. Flip to `assisted`, test the confirm-to-send flow + primitives.
3. Fix whatever throws (Baileys signature mismatches most likely).
4. Polish README demo (GIF of wrapped + a safe read query).
5. Decide launch name (currently `whatsapp-mcp-plus`); publish to npm; then the
   launch sequence in BUILD_PLAN.md section 7.

## Layout
```
src/
  config.ts              safe-by-default policy + env
  logger.ts              pino → files (stdout reserved for MCP)
  db.ts                  node:sqlite storage + allowlist/rate/settings + wrapped
  safety/                mode gate, allowlist, rate limit, confirm, injection guard
  whatsapp/              connection, parse, actions, media, msgcache
  mcp/server.ts          registers all tools, stdio transport
  mcp/tools/*.ts         read, send, primitives, groups, presence, media, analytics, admin
test/*.mjs               pure/logic/features tests + stdio smoke (no WhatsApp needed)
scripts/demo.mjs         seeds sample data, prints real wrapped/leaderboard output
Dockerfile, .dockerignore    one-image build
.github/workflows/ci.yml     typecheck + build + deterministic tests
_ref-ts/, _ref-go/       upstream clones for reference (gitignored)
```
