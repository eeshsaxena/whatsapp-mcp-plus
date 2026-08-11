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
   * with (an existing contact, or a chat where they messaged us first).
   */
  allowlistOnly: boolean;
  rateLimit: RateLimitConfig;
  /** Open the QR in a browser in addition to printing it in the terminal. */
  openQrInBrowser: boolean;
  /** Optional path to a whisper-compatible transcription binary/endpoint. */
  transcriptionCmd: string | null;
  /** Persist the raw encoded message proto so media/forward work for old messages. */
  storeRaw: boolean;
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
  rateLimit: {
    perMinute: envInt("WAMCP_RATE_PER_MINUTE", 8),
    perDay: envInt("WAMCP_RATE_PER_DAY", 200),
    minGapMs: envInt("WAMCP_MIN_GAP_MS", 3000),
    jitterMs: envInt("WAMCP_JITTER_MS", 2500),
  },
  openQrInBrowser: envBool("WAMCP_OPEN_QR_BROWSER", false),
  transcriptionCmd: process.env.WAMCP_TRANSCRIPTION_CMD || null,
  storeRaw: envBool("WAMCP_STORE_RAW", true),
};

export function ensureDirs(): void {
  for (const d of [config.dataDir, config.authDir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
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
