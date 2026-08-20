import { config } from "./config.ts";
import { getOrCreatePseudonym, resolvePseudonym } from "./db.ts";

/**
 * Privacy layer. When enabled (default), every value returned to the MCP client
 * — and therefore to the LLM provider's cloud — is scrubbed:
 *
 *  1. Structured secrets in free text are REDACTED (irreversibly): payment cards,
 *     government IDs, bank codes, API keys/tokens, OTP/2FA codes, passwords.
 *  2. Identifiers are PSEUDONYMIZED (reversibly): JIDs, phone numbers, emails and
 *     contact-name fields become stable local aliases (e.g. `waid-3`). The alias
 *     map lives only in the local DB; when the model passes an alias back as a
 *     tool argument we reverse it, so sends still route to the real contact.
 *
 * What is deliberately NOT touched: ordinary message text stays readable (so the
 * model can still summarize/search/reply). Semantic sensitivity ("I have cancer")
 * cannot be caught by patterns — for that use metadata-only reads or exclude the
 * chat. See SECURITY.md.
 */

// ---- reversible alias token shape (must round-trip through de-pseudonymize) ----
const ALIAS_RE = /\b(?:waid|wagrp|waph|waem|waname)-[0-9a-f]{6,}\b/g;
const ALIAS_EXACT = /^(?:waid|wagrp|waph|waem|waname)-[0-9a-f]{6,}$/;

// ---- structured-secret detectors (redacted, not reversible) ----
function luhnValid(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

function redactSecrets(text: string): string {
  let s = text;
  // Payment cards: 13-19 digits (spaces/dashes allowed), Luhn-valid.
  s = s.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? "[redacted-card]" : m;
  });
  // API keys / tokens.
  s = s.replace(/\b(?:sk|rk)-[A-Za-z0-9]{16,}\b/g, "[redacted-key]");
  s = s.replace(/\b(?:gh[opsu]_|github_pat_)[A-Za-z0-9_]{20,}\b/g, "[redacted-key]");
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]");
  s = s.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted-key]");
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi, "Bearer [redacted-token]");
  // Passwords / OTP / CVV by keyword proximity.
  s = s.replace(/\b(password|passcode|pwd|passwd)\b\s*[:=]?\s*\S+/gi, "$1: [redacted]");
  s = s.replace(/\b(otp|code|verification|passcode|pin)\b[^0-9]{0,20}(\d{4,8})\b/gi, (_m, w) => `${w} [redacted-code]`);
  s = s.replace(/\bcvv\b[^0-9]{0,5}(\d{3,4})\b/gi, "cvv [redacted]");
  // Government / bank ids.
  s = s.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "[redacted-pan]");          // India PAN
  s = s.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[redacted-id]");            // India Aadhaar (12 digits)
  s = s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]");              // US SSN
  s = s.replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "[redacted-ifsc]");          // India IFSC
  // Generic long high-entropy token (mixed letters+digits, >=32 chars). Matched
  // in a single linear pass (no lookaheads) so crafted input cannot trigger
  // catastrophic backtracking / ReDoS; the mixed-charset check is in the callback.
  s = s.replace(/[A-Za-z0-9_-]{32,}/g, (m) =>
    /[A-Za-z]/.test(m) && /[0-9]/.test(m) ? "[redacted-token]" : m);
  return s;
}

// ---- reversible identifier pseudonymization ----
const JID_RE = /\b[A-Za-z0-9._:-]+@(?:s\.whatsapp\.net|lid|g\.us)\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// A phone-ish run: 7-15 digits, optional +, with spaces/dashes/dots/parens.
const PHONE_RE = /(?<![\w-])\+?\d(?:[\d\s().-]{5,}\d)(?![\w-])/g;

function pseudonymizeJids(text: string): string {
  return text.replace(JID_RE, (m) => getOrCreatePseudonym(m.endsWith("@g.us") ? "wagrp" : "waid", m));
}

function pseudonymizeContacts(text: string): string {
  let s = text.replace(EMAIL_RE, (m) => getOrCreatePseudonym("waem", m));
  s = s.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 ? getOrCreatePseudonym("waph", m) : m;
  });
  return s;
}

/**
 * Scrub a free-text string. Order matters: alias JIDs FIRST (a JID's phone part
 * is often 12 digits and would otherwise be eaten by the card/ID redactors),
 * then redact structured secrets, then alias remaining emails / phone numbers.
 */
export function scrubText(text: unknown): any {
  if (!config.privacy || typeof text !== "string" || !text) return text;
  return pseudonymizeContacts(redactSecrets(pseudonymizeJids(text)));
}

const NAME_KEYS = new Set(["name", "chat_name", "sender_display", "displayName", "contact_name"]);
const NAME_SKIP = new Set(["Me", "Unknown", "Unknown Chat", "status", ""]);

/** Deep-scrub a value destined for the LLM (object graph, arrays, strings). */
export function scrubOutput(value: any, key?: string): any {
  if (!config.privacy) return value;
  if (typeof value === "string") {
    if (key && NAME_KEYS.has(key) && !NAME_SKIP.has(value) && !ALIAS_EXACT.test(value)) {
      // A human name field: alias the whole value.
      return getOrCreatePseudonym("waname", value);
    }
    return scrubText(value);
  }
  if (Array.isArray(value)) return value.map((v) => scrubOutput(v));
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubOutput(v, k);
    return out;
  }
  return value;
}

/**
 * Display label for a contact in shareable artifacts (Wrapped card, Rewind).
 * Under privacy mode the real name/number is replaced by a stable alias so a
 * card posted publicly does not leak your contacts. With privacy off, the real
 * name (or phone-number fallback) is shown.
 */
export function contactLabel(name: string | null | undefined, jid: string): string {
  if (config.privacy) {
    if (name) return getOrCreatePseudonym("waname", name);
    return getOrCreatePseudonym(jid.endsWith("@g.us") ? "wagrp" : "waid", jid);
  }
  return name ?? jid.split("@")[0];
}

/** Reverse alias tokens in tool-call arguments so the real identifier is used. */
export function dePseudonymizeArgs(args: any): any {
  if (!config.privacy || args == null) return args;
  if (typeof args === "string") {
    return args.replace(ALIAS_RE, (tok) => resolvePseudonym(tok) ?? tok);
  }
  if (Array.isArray(args)) return args.map(dePseudonymizeArgs);
  if (typeof args === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(args)) out[k] = dePseudonymizeArgs(v);
    return out;
  }
  return args;
}
