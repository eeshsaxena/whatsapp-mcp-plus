# HANDOFF — whatsapp-mcp-plus

Last updated: 2026-08-20 (live end-to-end test + privacy work session)

## What this is
A secure, zero-setup WhatsApp MCP server in TypeScript on Baileys. Maintained
successor to the abandoned `lharries/whatsapp-mcp` (6.1k stars). Goal: stars.
Strategy in `BUILD_PLAN.md`; launch plan in `LAUNCH.md`.

## Current state: LIVE-TESTED END TO END. SECURITY-HARDENED. PUSHED. Near launch.
- `origin/main` @ **f43e2e5** (repo: github.com/eeshsaxena/whatsapp-mcp-plus).
- Deterministic suite green: **183 checks + MCP stdio smoke (52 tools)**, `npm test`.
  Verified with a full-stack integration debug (scopes + privacy + exclude +
  confirm compose correctly over stdio).
- **Lint + typecheck clean** (`npm run lint`, `npm run typecheck`); CI runs lint +
  typecheck + the full suite on Node 24.
- Working tree: clean except this HANDOFF (uncommitted by design).
- A real device is **paired** (auth_info/ populated) as **+91 99252 38809**
  (WhatsApp name "Deepak"); `data/whatsapp.db` holds ~2115 real messages + ~14k
  contacts. To unlink: WhatsApp > Linked Devices > log out. `data/` + `auth_info/`
  are gitignored.

## Done this session (4 commits, all pushed, no AI/Co-Authored line per his pref)
1. **1487aa8 — Fix live-sync gaps found in end-to-end testing**
   - `syncFullHistory` (config `WAMCP_SYNC_FULL_HISTORY`, default ON): a fresh
     pair used to sync only contacts + chat list, no message bodies, so analytics
     were empty. Now full history syncs (verified: 2115 msgs pulled).
   - `@lid` sender-name resolution: capture `pushName` from live messages +
     cross-link the lid/phone contact forms (`saveContact` in connection.ts).
     NOTE: only fixes names going forward / where a mapping is provided; the ~2511
     historical `@lid` rows that synced with no name CANNOT be back-filled
     (Baileys 6.7.24 exposes no LID->PN resolver).
   - Persist our own sent text/media/voice (Baileys emits no upsert for outgoing).
2. **a260639 — Persist all sent message types + parse polls/contacts**
   - Extended persist to location/poll/contact/forward sends.
   - Parser now handles `pollCreationMessageV2/V3` and `contact/contactsArrayMessage`
     (sent polls + contact cards were parsing to null → not stored → undeletable).
3. **b9f1fc5 — Privacy mode (default ON, `WAMCP_PRIVACY`)** — src/privacy.ts
   - Pseudonymize identifiers before results reach the LLM: JIDs/phones/emails/
     contact names -> stable local aliases (`waid-`, `wagrp-`, `waph-`, `waem-`,
     `waname-`) stored in new `pseudonyms` DB table. Reversed in `safeHandler`
     when the model passes an alias back, so sends still route.
   - Redact structured secrets in message text (irreversible): payment cards
     (Luhn), Aadhaar/PAN/SSN, IFSC, API keys (`sk-`,`ghp_/gho_`,AWS,slack,Bearer),
     OTP/CVV/password by keyword proximity, long high-entropy tokens.
   - Order fix: alias JIDs BEFORE secret redaction (a 12-digit `91…` phone in a
     JID was being eaten by the Aadhaar detector). Verified working + reversible.
   - Hooked centrally in `src/mcp/format.ts` (jsonResult/textResult/errorResult
     scrub output; safeHandler de-pseudonymizes input args). Documented in
     SECURITY.md + .env.example.
4. **3ccbb9c — Security hardening (pen-test pass)** — src/security.ts, media.ts
   - `send_file` always-on denylist: credential/secret files (.env, SSH/PGP keys,
     *.pem, .aws/.ssh/auth_info dirs, the message DB) are blocked even with no
     `WAMCP_SEND_FILE_ROOTS` — closes a default-open exfil path (a prompt-injected
     agent could otherwise send secrets to an allowlisted contact).
   - `download_media` bounded by `WAMCP_MAX_MEDIA_MB` (default 100) — disk/mem DoS.
   - Privacy redaction regexes made linear (ReDoS-safe, 120KB ~6ms); injection
     warning banner extended to get_last_interaction.
   - New `test/harden-test.mjs` (25 checks), wired into `npm test`.
5. **7484a58 — Close remaining pen-test findings**
   - Ban risk FIXED: global per-minute cap on ALL write actions
     (`WAMCP_ACTIONS_PER_MINUTE`, default 60) in `assertMutationsAllowed`, so
     react/edit/delete/mark_read/presence can't be looped.
   - Privacy FIXED: Wrapped/Rewind SVG cards pseudonymize contact names under
     privacy mode (was leaking real names into a shareable artifact).
   - At-rest: `data/`+`auth_info/` 0700, DB files 0600 (POSIX). Encryption-at-rest
     intentionally NOT done (needs a native dep; breaks zero-native-deps design).
   - harden-test.mjs -> 28 checks; features-test pins WAMCP_PRIVACY=0.

6. **4bcc85d — Deeper pen-test + pipeline optimization**
   - Arbitrary file write FIXED: wrapped_card/whatsapp_rewind output paths confined
     to data dir / send-file roots (assertWritablePath); was only NUL-checked.
   - Predictable pseudonyms FIXED: aliases now use a random suffix
     (waid-<10 hex>) instead of sequential — no alias-injection misrouting /
     contact enumeration. (Alias regex in privacy.ts updated to match.)
   - PERF: history sync batches each chunk in one transaction + cached prepared
     statements (db.ts runInTransaction). Benchmark 10k inserts 26.5s -> 0.95s (~28x).
   - harden-test -> 31 checks; suite 150.

7. **6d6007c — Destructive ops require confirm.** delete_message, block_contact,
   group_leave, group_update_participants(remove) now route through guardedMutation
   (stage->confirm), the no-recipient sibling of guardedSend. add/promote/demote +
   unblock stay direct.
8. **a3e240a — Engineering foundation.** ESLint (flat config, typescript-eslint) +
   `npm run lint`, all clean; CI now runs lint+typecheck+FULL suite on Node 24 (was
   3 of 9 suites); engines >=24 (node:sqlite is flagless there); repo/bugs/homepage
   metadata + .editorconfig; removed dead code the linter found.
9. **70a4c26 — Pen-test pass.** Prototype-pollution defense in the privacy walkers
   (drop __proto__/constructor/prototype); waCall timeout race no longer leaks an
   unhandledRejection.

## Recently closed (commits 10-11)
- **a9e17f8 — Allowlist tightened.** isKnownRecipient() now = explicitly
  allowlisted OR an established chat you've SENT to OR a group you're in. Synced-
  contact-only and inbound-stranger no longer auto-trusted (opt back in with
  WAMCP_ALLOWLIST_CONTACTS / WAMCP_ALLOWLIST_INBOUND).
- **b57db45 — Consent scopes + setup wizard (was the open decision, now BUILT).**
  Every tool has a feature scope (read/analytics/media/send/groups/profile);
  only enabled scopes work (WAMCP_SCOPES default read,analytics). Central gate
  wraps server.tool (src/mcp/server.ts + src/safety/scopes.ts). `npm run setup`
  wizard (scripts/setup.mjs, has --defaults path) writes .env. get_status shows
  scopes. Verified over stdio: send blocked / read allowed at default scopes.

## Remaining findings (LOW, documented, not code-fixed)
- **At-rest encryption** not implemented (node:sqlite has none without a native
  dep, which breaks the zero-native-deps design); mitigated by 0700/0600 perms.

Non-security work still open: per-chat exclude (`WAMCP_EXCLUDE_CHATS`, deferred);
live-test groups/media/transcription. Then npm publish + LAUNCH.md.

## Live testing performed this session (all cleaned up)
- **Read/analytics over real 2115-msg history:** get_status/get_me/list_chats/
  list_messages/chat_stats/search_contacts/whatsapp_wrapped(json+card)/top_words/
  response_leaderboard/wrapped_card(.svg)/whatsapp_rewind(6 cards). All returned
  real data. Rendered wrapped+rewind SVG->PNG via bundled `sharp`.
- **Full messaging suite vs a real recipient (+91 7976212108), assisted mode,
  stage->confirm, every test msg revoked after:** check_number, get_profile_picture,
  send_presence, send_message, react, edit, star, reply, send_location, send_poll,
  send_contact, send_file(image), forward_message, pin/mute. All worked.
- **Safety rails confirmed live:** read-only blocks sends; allowlist blocks a
  stranger; confirm-token flow works.

## Consent scopes + wizard + per-chat exclude — ALL DONE
- Scopes + wizard: b57db45 (see "Recently closed").
- **Per-chat exclude — DONE (f43e2e5).** `WAMCP_EXCLUDE_CHATS` hides chats from
  EVERY read/analytics path, enforced via DB views (v_messages/v_chats) that all
  read queries go through (writes still hit real tables; views rebuild each init).
  test/exclude-test.mjs (19 checks) proves zero leak. Also fixed: demo/card/rewind
  generators set WAMCP_PRIVACY=0 so sample screenshots show real names, not aliases.

## Known issues / leftovers
- **Leftover test msg**: `[wamcp test] reply B` sits in HIS OWN self-chat
  (919925238809) from the first assisted run (predates the persist fix, no
  recoverable id). He should delete it manually.
- **Leaked `gho_` token** in `.git/config` origin URL. Confirmed NOT public (only
  local config; not in any tracked file/commit/history/push). He chose to LEAVE
  it (used it to push). Advise: revoke at github.com/settings/tokens + reset the
  remote to `https://github.com/eeshsaxena/whatsapp-mcp-plus.git` eventually.
- **star_message** hit a transient 20s guard timeout once (retry worked).
- Cosmetic: card redaction can drop a following space (`[redacted-card]and`).
- **Untested live**: groups (create/participants/subject/invite), media download,
  voice transcription (needs WAMCP_TRANSCRIPTION_CMD + received media).

## Suggested next steps
1. Decide the consent model above; implement scope gating + setup wizard.
2. Test groups (create a temp group, then leave/delete) + media download.
3. Privacy polish: anonymize names by default in the shareable wrapped/rewind
   SVGs too (currently the local SVG files still embed real names/numbers).
4. Launch: `npm publish` + the LAUNCH.md sequence. Revoke/clean the token first.

## Layout
```
src/
  config.ts              policy + env (WAMCP_MODE, WAMCP_PRIVACY, WAMCP_SYNC_FULL_HISTORY, …)
  privacy.ts             NEW: pseudonymize identifiers + redact secrets (scrubOutput/scrubText/dePseudonymizeArgs)
  db.ts                  node:sqlite storage + pseudonyms table + getOrCreatePseudonym/resolvePseudonym
  safety/index.ts        mode gate, allowlist, rate limit, confirm, injection guard
  whatsapp/connection.ts pairing + history sync + saveContact cross-link + pushName capture
  whatsapp/actions.ts    send actions (all now persistSent), guards
  whatsapp/parse.ts      message parsing (poll V2/V3 + contact/contactsArray handled)
  mcp/format.ts          jsonResult/textResult/errorResult (privacy scrub) + safeHandler (arg reverse)
  mcp/tools/*.ts         read, send, primitives, groups, presence, media, analytics, chat, extras, admin
test/*.mjs               deterministic suites + stdio smoke (WAMCP_NO_WA=1; none need WhatsApp)
```
Related memory: project-whatsapp-mcp-plus, feedback-keep-handoff-updated,
feedback-oss-commit-ai-disclosure.
