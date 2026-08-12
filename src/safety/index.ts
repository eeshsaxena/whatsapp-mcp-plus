import { randomUUID } from "node:crypto";
import { config, type SafetyMode } from "../config.ts";
import {
  countSendsSince,
  lastSendTime,
  logSend,
  isKnownRecipient,
  getSetting,
  setSetting,
} from "../db.ts";

export { scanForInjection, annotateForInjection } from "./injection.ts";

/**
 * The safe-by-default gate. Every mutating tool must pass through here.
 *
 * Layers, in order:
 *   1. Mode        — read-only blocks all mutations outright.
 *   2. Allowlist   — only message known recipients (kills cold-outreach bans).
 *   3. Rate limit  — per-minute + per-day caps + human-like min gap.
 *   4. Confirm     — two-step token so an injected prompt can't fire in one shot.
 */

export class SafetyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SafetyError";
  }
}

interface PendingAction {
  token: string;
  description: string;
  createdAt: number;
  run: () => Promise<unknown>;
}

const pending = new Map<string, PendingAction>();
const PENDING_TTL_MS = 5 * 60_000;

export function getMode(): SafetyMode {
  const override = getSetting("mode");
  if (override === "read-only" || override === "assisted" || override === "unrestricted") {
    return override;
  }
  return config.mode;
}

export function setMode(mode: SafetyMode): void {
  setSetting("mode", mode);
}

/** Throw unless mutations are allowed in the current mode. */
export function assertMutationsAllowed(action: string): void {
  if (getMode() === "read-only") {
    throw new SafetyError(
      "read_only",
      `Blocked: '${action}' is a write action but the server is in read-only mode. ` +
        `Set WAMCP_MODE=assisted (and re-approve) to enable sending.`,
    );
  }
}

/** Enforce the recipient allowlist when enabled. */
export function assertRecipientAllowed(jid: string): void {
  if (!config.allowlistOnly) return;
  // Never allowlist-block group messaging you're already part of is handled by
  // isKnownRecipient (group chats you have history with count as known).
  if (!isKnownRecipient(jid)) {
    throw new SafetyError(
      "not_allowlisted",
      `Blocked: ${jid} is not a known contact and has not messaged you first. ` +
        `Messaging strangers is the #1 WhatsApp ban trigger. Add them explicitly ` +
        `with allowlist_add if you are sure.`,
    );
  }
}

/** Check + reserve a rate-limit slot. Returns the delay (ms) to wait before sending. */
export function checkRateLimit(): { delayMs: number } {
  const now = Date.now();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const dayAgo = new Date(now - 24 * 3600_000).toISOString();

  const inLastMinute = countSendsSince(minuteAgo);
  if (inLastMinute >= config.rateLimit.perMinute) {
    throw new SafetyError(
      "rate_minute",
      `Blocked: per-minute send limit reached (${config.rateLimit.perMinute}/min). ` +
        `Slow down to stay under WhatsApp's spam radar.`,
    );
  }
  const inLastDay = countSendsSince(dayAgo);
  if (inLastDay >= config.rateLimit.perDay) {
    throw new SafetyError(
      "rate_day",
      `Blocked: daily send limit reached (${config.rateLimit.perDay}/day).`,
    );
  }

  const last = lastSendTime();
  let delayMs = 0;
  if (last) {
    const since = now - last.getTime();
    if (since < config.rateLimit.minGapMs) delayMs = config.rateLimit.minGapMs - since;
  }
  // Human-like jitter on top.
  delayMs += Math.floor(Math.random() * config.rateLimit.jitterMs);
  return { delayMs };
}

export function recordSend(recipient: string): void {
  logSend(recipient);
}

/* ------------------------------------------------- two-step confirmation */

export function needsConfirm(): boolean {
  return config.requireConfirm && getMode() !== "unrestricted";
}

function prunePending(): void {
  const now = Date.now();
  for (const [tok, action] of pending) {
    if (now - action.createdAt > PENDING_TTL_MS) pending.delete(tok);
  }
}

export function stageAction(description: string, run: () => Promise<unknown>): string {
  prunePending(); // drop expired staged actions so the map stays bounded
  const token = randomUUID().slice(0, 8);
  pending.set(token, { token, description, createdAt: Date.now(), run });
  return token;
}

export async function confirmAction(token: string): Promise<unknown> {
  const action = pending.get(token);
  if (!action) throw new SafetyError("bad_token", `No pending action with token ${token} (it may have expired).`);
  if (Date.now() - action.createdAt > PENDING_TTL_MS) {
    pending.delete(token);
    throw new SafetyError("expired", `Pending action ${token} expired. Re-issue the request.`);
  }
  pending.delete(token);
  return action.run();
}

export function listPending(): { token: string; description: string; ageSec: number }[] {
  const now = Date.now();
  return [...pending.values()].map((p) => ({
    token: p.token,
    description: p.description,
    ageSec: Math.round((now - p.createdAt) / 1000),
  }));
}

/**
 * The one call every send-style tool uses. It runs the mode/allowlist/rate
 * checks, then either stages the action for confirmation (returning a token) or
 * executes it after the human-like delay.
 */
export async function guardedSend(opts: {
  action: string;
  recipient: string;
  description: string;
  confirmToken?: string;
  run: () => Promise<unknown>;
}): Promise<{ status: "done" | "needs_confirmation"; token?: string; result?: unknown; note: string }> {
  // If a token was supplied, this IS the confirmation step.
  if (opts.confirmToken) {
    const result = await confirmAction(opts.confirmToken);
    return { status: "done", result, note: "Confirmed and executed." };
  }

  assertMutationsAllowed(opts.action);
  assertRecipientAllowed(opts.recipient);
  const { delayMs } = checkRateLimit();

  const doRun = async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const result = await opts.run();
    recordSend(opts.recipient);
    return result;
  };

  if (needsConfirm()) {
    const token = stageAction(opts.description, doRun);
    return {
      status: "needs_confirmation",
      token,
      note:
        `${opts.description}\n\nThis is a write action. Confirm by calling confirm_action ` +
        `with token "${token}" (expires in 5 min).`,
    };
  }

  const result = await doRun();
  return { status: "done", result, note: "Executed." };
}
