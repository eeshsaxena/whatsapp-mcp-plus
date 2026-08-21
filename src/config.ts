import path from "node:path";
import fs from "node:fs";

/**
 * Central configuration + the safe-by-default policy.
 *
 * Everything here is tuned so that the DEFAULT behaviour is the low-ban-risk,
 * low-data-exfiltration-risk behaviour. A user has to opt in explicitly to the
 * riskier modes via environment variables.
 */

export type SafetyMode = "read-only" | "assisted" | "unrestricted";

export interface RateLimitConfig {
  /** Max sends allowed per rolling 60s window. */
  perMinute: number;
  /** Max sends allowed per rolling 24h window. */
  perDay: number;
  /** Minimum milliseconds enforced between two sends (human-like pacing). */
  minGapMs: number;
  /** Random extra jitter added on top of minGapMs, in ms. */
  jitterMs: number;
}

export interface Config {
  dataDir: string;
  authDir: string;
  mode: SafetyMode;
  /**
   * When true, a send tool must be called with an explicit confirmation token
   * (two-step). Prevents an injected prompt from firing a send in one shot.
   */
  requireConfirm: boolean;
  /**
   * When true, sends are only permitted to JIDs we already have a relationship
   * with. By default that means: explicitly allowlisted, an established chat you
   * have SENT to before, or a group you are a member of. The two flags below
   * (default OFF) loosen it to also trust any synced contact / any stranger who
   * messaged you first.
   */
  allowlistOnly: boolean;
  /** Also treat anyone in the synced address book as a known recipient. */
  allowlistContacts: boolean;
  /** Also treat anyone who has messaged you first as a known recipient. */
  allowlistInbound: boolean;
  rateLimit: RateLimitConfig;
  /** Optional path to a whisper-compatible transcription binary/endpoint. */
  transcriptionCmd: string | null;
  /** Persist the raw encoded message proto so media/forward work for old messages. */
  storeRaw: boolean;
  /**
   * Request the full message history from WhatsApp on first login. Without this,
   * a freshly linked device only receives the contact + chat list (no message
   * bodies), leaving the analytics tools (wrapped, chat_stats, leaderboard,
   * rewind) empty until new messages arrive live. Must be set before the initial
   * pairing to take effect. Set via WAMCP_SYNC_FULL_HISTORY (default on).
   */
  syncFullHistory: boolean;
  /**
   * Privacy mode (default ON). Before any tool result is returned to the MCP
   * client (and thus the LLM provider's cloud), pseudonymize identifiers (JIDs,
   * phone numbers, emails, contact names -> stable local aliases, reversed when
   * the model passes them back) and redact structured secrets in message content
   * (cards, gov IDs, API keys, OTP codes). Disable with WAMCP_PRIVACY=0.
   */
  privacy: boolean;
  /** Max bytes to accept when downloading media (anti disk/memory DoS). */
  maxMediaBytes: number;
  /**
   * Ceiling on ALL write actions per rolling minute (reactions, edits, deletes,
   * read receipts, presence, sends, group/profile ops). A generous anti-ban /
   * anti-runaway floor so a compromised agent cannot fire actions in a tight
   * loop; normal use stays well under it. WAMCP_ACTIONS_PER_MINUTE.
   */
  actionsPerMinute: number;
  /**
   * If non-empty, files may only be SENT from these directories. Anti-exfiltration
   * guard: a prompt-injected agent then cannot send e.g. ~/.ssh/id_rsa. Empty = no
   * restriction. Set via WAMCP_SEND_FILE_ROOTS (comma-separated).
   */
  sendFileRoots: string[];
  /**
   * Enabled feature scopes (consent). A tool only works if its scope is enabled.
   * Default is the minimal, safe set (read + analytics); the user opts into the
   * rest (media, send, groups, profile) via WAMCP_SCOPES or `npm run setup`.
   */
  scopes: Set<string>;
}

/** All recognized feature scopes, in a stable display order. */
export const ALL_SCOPES = ["read", "analytics", "media", "send", "groups", "profile"] as const;

function resolveScopes(): Set<string> {
  const raw = (process.env.WAMCP_SCOPES ?? "read,analytics").toLowerCase().trim();
  if (raw === "all" || raw === "*") return new Set(ALL_SCOPES);
  const set = new Set(
    raw.split(",").map((s) => s.trim()).filter((s) => (ALL_SCOPES as readonly string[]).includes(s)),
  );
  if (set.size === 0) return new Set(["read", "analytics"]);
  return set;
}

function resolveMode(): SafetyMode {
  const raw = (process.env.WAMCP_MODE || "read-only").toLowerCase().trim();
  if (raw === "assisted" || raw === "unrestricted" || raw === "read-only") {
    return raw;
  }
  return "read-only";
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase().trim());
}

const dataDir =
  process.env.WAMCP_DATA_DIR ||
  path.join(process.cwd(), "data");

const authDir =
  process.env.WAMCP_AUTH_DIR ||
  path.join(process.cwd(), "auth_info");

const mode = resolveMode();

/**
 * In unrestricted mode the safety rails default OFF (but can still be turned on).
 * In every other mode they default ON.
 */
const safeDefaults = mode !== "unrestricted";

export const config: Config = {
  dataDir,
  authDir,
  mode,
  requireConfirm: envBool("WAMCP_REQUIRE_CONFIRM", safeDefaults),
  allowlistOnly: envBool("WAMCP_ALLOWLIST_ONLY", safeDefaults),
  allowlistContacts: envBool("WAMCP_ALLOWLIST_CONTACTS", false),
  allowlistInbound: envBool("WAMCP_ALLOWLIST_INBOUND", false),
  rateLimit: {
    perMinute: envInt("WAMCP_RATE_PER_MINUTE", 8),
    perDay: envInt("WAMCP_RATE_PER_DAY", 200),
    minGapMs: envInt("WAMCP_MIN_GAP_MS", 3000),
    jitterMs: envInt("WAMCP_JITTER_MS", 2500),
  },
  transcriptionCmd: process.env.WAMCP_TRANSCRIPTION_CMD || null,
  storeRaw: envBool("WAMCP_STORE_RAW", true),
  syncFullHistory: envBool("WAMCP_SYNC_FULL_HISTORY", true),
  privacy: envBool("WAMCP_PRIVACY", true),
  maxMediaBytes: Math.max(1, envInt("WAMCP_MAX_MEDIA_MB", 100)) * 1024 * 1024,
  actionsPerMinute: Math.max(1, envInt("WAMCP_ACTIONS_PER_MINUTE", 60)),
  sendFileRoots: (process.env.WAMCP_SEND_FILE_ROOTS || "")
    .split(",").map((s) => s.trim()).filter(Boolean),
  scopes: resolveScopes(),
};

export function ensureDirs(): void {
  // data/ holds the message DB (all your chats) + logs + media; auth_info/ holds
  // pairing credentials. Both are private — create/lock them to owner-only where
  // the OS honors it (POSIX). No-op on Windows beyond the read-only bit.
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(config.authDir)) fs.mkdirSync(config.authDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(config.dataDir, 0o700); } catch { /* best effort */ }
  try { fs.chmodSync(config.authDir, 0o700); } catch { /* best effort */ }
}

/** Human-readable summary used by the get_status tool and startup banner. */
export function describeSafety(): string {
  return [
    `mode=${config.mode}`,
    `requireConfirm=${config.requireConfirm}`,
    `allowlistOnly=${config.allowlistOnly}`,
    `rate=${config.rateLimit.perMinute}/min,${config.rateLimit.perDay}/day`,
    `minGap=${config.rateLimit.minGapMs}ms+~${config.rateLimit.jitterMs}ms`,
  ].join(" ");
}
