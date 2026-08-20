# Security

whatsapp-mcp-plus connects a personal WhatsApp account to an AI agent. That is a
powerful and sensitive capability, so security is a first-class concern.

## Threat model & mitigations

**Prompt injection / the "lethal trifecta".** WhatsApp message content is
untrusted data that flows into an LLM's context. A crafted message could try to
make the agent exfiltrate your data or send messages on your behalf. Mitigations:
- **Read-only by default.** No send/mutating tool works until you opt into
  `assisted` mode.
- **Confirm-to-send.** In safe modes a send is staged and returns a token; nothing
  goes out until `confirm_action` is called, so a single injected instruction
  cannot fire a message.
- **Injection guard.** Incoming messages that look like instructions to an AI are
  flagged, and message lists returned to the model carry a warning banner telling
  it to treat content as data, not commands.
- **Allowlist.** Sends are restricted to known contacts by default.

**Local data.** All messages are stored in a local SQLite DB and never leave your
machine except through an explicit tool call by your agent. Pairing credentials
live in `auth_info/` (created with `0700` where the OS honors it) and are
git-ignored. Do not commit `data/` or `auth_info/`. The DB, logs, and downloaded
media are stored in plaintext, so keep the project out of a cloud-synced folder
(OneDrive/Dropbox/Drive) and off shared machines.

**Data goes to your LLM.** Reading is not the same as private: any tool result
(messages, contacts, analytics) is returned to whatever MCP client / LLM provider
you connect, and is processed in their cloud. Only connect a provider you trust
with this data. Privacy mode (below) reduces, but does not eliminate, what leaves.

**Privacy mode (default ON, `WAMCP_PRIVACY`).** Before any result is returned to
the model, it is scrubbed:
- *Pseudonymized identifiers* — JIDs, phone numbers, emails and contact names
  become stable local aliases (e.g. `waid-3`). The alias map lives only in the
  local DB; when the model passes an alias back as a tool argument it is reversed,
  so sends still reach the real contact. The model never sees real numbers/names.
- *Redacted secrets* — structured secrets in message text are removed
  irreversibly: payment cards (Luhn), government IDs (Aadhaar/PAN/SSN), bank codes
  (IFSC), API keys/tokens, and OTP/2FA codes.
- *Limits* — ordinary message text stays readable (so the model can still
  summarize/reply), and pattern matching cannot catch *semantic* sensitivity
  (e.g. a health disclosure). For that, read with metadata-only intent or avoid
  syncing those chats. Set `WAMCP_PRIVACY=0` to send real values.

**Filesystem hardening.**
- **Path traversal:** WhatsApp message ids (which a sender can craft) are
  sanitized before being used in media filenames, so a crafted id cannot write
  outside the media directory. Output paths are rejected if they contain a NUL byte.
- **Exfiltration guard:** set `WAMCP_SEND_FILE_ROOTS` to a comma-separated list of
  directories to restrict which files may be *sent*. With it set, a prompt-injected
  agent cannot send `~/.ssh/id_rsa` or other sensitive files to a contact.
- **No shell:** the optional transcription command runs via `spawnSync` with an
  argument array (no shell), so message content cannot inject shell commands.
- **Parameterized SQL** throughout; `LIKE` patterns escape user wildcards.

**Account safety.** This uses an unofficial WhatsApp client (Baileys); misuse can
get your number banned. Rate limiting, allowlisting, and read-only defaults are
designed to keep usage in the low-risk zone. See the README disclaimer.

## Reporting a vulnerability

Please report security issues privately via a GitHub Security Advisory on the
repository (Security → Report a vulnerability), or open a minimal issue asking for
a private contact channel. Do not disclose exploitable details in a public issue
until a fix is available. I aim to acknowledge reports within a few days.

## Not in scope

- Bans resulting from usage against WhatsApp's Terms of Service (inherent to any
  unofficial client; mitigated, not eliminated).
- Vulnerabilities in upstream dependencies (report those upstream), though I will
  bump/patch promptly once notified.
