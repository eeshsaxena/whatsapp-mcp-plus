import path from "node:path";

/**
 * Centralized security utilities. WhatsApp message content is untrusted, and an
 * agent driving these tools may be steered by a prompt-injection attempt, so
 * anything that touches the filesystem is validated here.
 */

/** Reject strings containing a NUL byte (path-poisoning defense). */
export function assertNoNullByte(s: string, label = "path"): void {
  if (s.includes("\0")) throw new Error(`Invalid ${label}: contains a null byte.`);
}

/**
 * Turn an arbitrary identifier (e.g. a WhatsApp message id, which a malicious
 * sender could craft) into a safe filename component. Prevents path traversal
 * like "../../etc/foo" when building media file paths.
 */
export function sanitizeFilename(id: string): string {
  const cleaned = String(id).replace(/[^A-Za-z0-9_.-]/g, "_");
  // Guard against empty / dot-only names that could resolve to a directory.
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  return cleaned.slice(0, 128);
}

/**
 * Filenames and path components that must NEVER be sent, regardless of whether
 * WAMCP_SEND_FILE_ROOTS is configured. This is the always-on floor of the
 * anti-exfiltration guard: even with no roots set (the permissive default), a
 * prompt-injected agent cannot exfiltrate credentials/secrets.
 */
const SENSITIVE_BASENAMES = [
  /^\.env(\..*)?$/i,           // .env, .env.local, ...
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pem|key|pfx|p12|keystore|ppk)$/i,
  /^\.(npmrc|pgpass|netrc|htpasswd)$/i,
  /^\.git-credentials$/i,
  /^known_hosts$/i,
  /^credentials$/i,           // aws/gcloud credentials files
  /^(id_rsa|id_ed25519)\.pub$/i,
  /^wallet\.dat$/i,
  /\.db(-wal|-shm)?$/i,        // the WhatsApp message DB (all your chats)
  /^(wa-logs|mcp-logs)\.txt$/i,
];
const SENSITIVE_DIRS = [".ssh", ".aws", ".gnupg", ".config", ".azure", ".kube", "auth_info"];

/** Always-on denylist: reject sending obviously-sensitive files (credentials,
 * keys, the app's own auth/data dirs), independent of the roots allowlist. */
export function assertNotSensitivePath(target: string, extraDenyDirs: string[] = []): void {
  assertNoNullByte(target, "file path");
  const resolved = path.resolve(target);
  const base = path.basename(resolved);
  if (SENSITIVE_BASENAMES.some((re) => re.test(base))) {
    throw new Error(`Blocked: "${base}" looks like a credential/secret file and cannot be sent.`);
  }
  const parts = resolved.split(/[\\/]+/).map((p) => p.toLowerCase());
  const denyDirs = [...SENSITIVE_DIRS, ...extraDenyDirs.map((d) => path.basename(path.resolve(d)).toLowerCase())];
  for (const d of denyDirs) {
    if (d && parts.includes(d)) {
      throw new Error(`Blocked: "${target}" is inside a protected directory ("${d}") and cannot be sent.`);
    }
  }
}

/**
 * Assert that `target` resolves inside one of `roots`. Used to optionally
 * confine which directories files may be SENT from (anti-exfiltration): a
 * prompt-injected agent then cannot send ~/.ssh/id_rsa to a contact.
 * Empty `roots` means "no root restriction" — but the sensitive-path denylist
 * above is ALWAYS enforced by callers, so secrets are blocked either way.
 */
export function assertPathWithinRoots(target: string, roots: string[]): void {
  assertNoNullByte(target, "file path");
  if (!roots.length) return;
  const resolved = path.resolve(target);
  const ok = roots.some((root) => {
    const base = path.resolve(root);
    const rel = path.relative(base, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!ok) {
    throw new Error(
      `Blocked: "${target}" is outside the allowed send-file directories ` +
        `(WAMCP_SEND_FILE_ROOTS). This guards against sending sensitive files.`,
    );
  }
}
