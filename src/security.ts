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
 * Assert that `target` resolves inside one of `roots`. Used to optionally
 * confine which directories files may be SENT from (anti-exfiltration): a
 * prompt-injected agent then cannot send ~/.ssh/id_rsa to a contact.
 * Empty `roots` means "no restriction" (the default).
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
