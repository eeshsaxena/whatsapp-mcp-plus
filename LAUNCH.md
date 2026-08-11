# Launch plan — whatsapp-mcp-plus (3-day runway)

Goal: maximize GitHub stars at launch. The honest odds (see BUILD_PLAN.md) are a
distribution lottery; this plan stacks the deck. Realistic aim: revive the
abandoned incumbent's 6.1k-star demand as the maintained, safer successor.

## Positioning (one line)
"A secure, zero-setup WhatsApp MCP for your AI. Read-first, safe by default,
one command to install. The maintained successor to the abandoned whatsapp-mcp."

## The two hooks to lead with
1. **Zero-setup + secure by default** — the incumbent's setup is brutal and it has
   no safety layer (its own README admits the injection hole). This is the
   reason-to-switch.
2. **WhatsApp Wrapped** — the shareable SVG card + `response_leaderboard`
   ("who you leave on read the longest"). This is the screenshot that travels.

## Day 1 — prove it works + capture assets (the ONE blocker only Eesh can clear)
- [ ] Pair once: `npm run build && node dist/index.js`, scan the QR.
- [ ] Verify live: `list_chats`, `list_messages`, `whatsapp_wrapped`,
      `wrapped_card` on real data; then `WAMCP_MODE=assisted` and test
      `send_message` (confirm flow), `react`, `reply`, `edit`, `delete`,
      `group_info`. Fix any Baileys 6.7.x signature drift.
- [ ] Capture assets:
      - a real `wrapped_card` SVG (redact names) → convert to PNG for social.
      - a 15-30s screen recording: install → ask AI to summarize a chat →
        show the Wrapped card. This is the demo GIF.
- [ ] Replace docs/sample-wrapped.svg reference with a PNG in the README if
      GitHub doesn't render the SVG inline.

## Day 2 — publish + polish
- [ ] `npm publish` (name check first; `whatsapp-mcp-plus` is the working name).
- [ ] Push to GitHub `eeshsaxena/whatsapp-mcp-plus`, enable Actions (CI is set up).
- [ ] README top: demo GIF, one-line pitch, the npx command, the safety table.
- [ ] Add topics/tags: mcp, whatsapp, claude, baileys, model-context-protocol.
- [ ] Open a friendly issue/PR reference on the abandoned incumbent? No — don't
      spam. Instead, answer people already asking "is there a maintained fork?"
      in its issues/discussions with a genuine pointer (once, honestly).

## Day 3 — launch sequence (timing matters)
- [ ] **Show HN** early US morning (Tue-Thu best): title like
      "Show HN: Secure, zero-setup WhatsApp MCP (successor to an abandoned 6k-star repo)".
      First comment: what it is, why (the incumbent died), the safety model, the
      ToS caveat stated honestly. Be present to answer for the first 2-3 hours.
- [ ] **X/Twitter**: lead with the Wrapped card image + the leaderboard line.
      "I gave Claude access to my WhatsApp (safely). It made me a Wrapped card and
      told me who I leave on read the longest." Link repo.
- [ ] **Reddit**: r/LocalLLaMA, r/ClaudeAI (read each sub's self-promo rules first).
- [ ] MCP directories: submit to the awesome-mcp lists, mcpservers.org, glama,
      smithery (smithery.yaml exists in the base; add ours).
- [ ] Be honest everywhere about the WhatsApp ToS/ban risk — it builds trust and
      preempts the top comment.

## Pre-flight checklist
- [ ] `npm test` green (currently 75 checks + MCP smoke).
- [ ] README disclaimer present and prominent.
- [ ] LICENSE + NOTICE attribution correct (ISC + MIT upstreams).
- [ ] No secrets/auth_info/data committed (.gitignore covers them).
- [ ] `npx whatsapp-mcp-plus` works from a clean checkout.

## What NOT to do
- No cold outreach / bulk features in the launch framing. Position as a personal,
  read-first assistant. That framing is both safer for users' accounts and less
  likely to attract "this will get people banned" as the top HN comment.
