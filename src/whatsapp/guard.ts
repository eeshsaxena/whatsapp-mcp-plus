/**
 * Hardening helpers for live WhatsApp (Baileys) calls.
 *
 * Baileys throws a mix of Boom errors, plain Errors, and can hang when the
 * socket is mid-reconnect. These wrappers turn all of that into clear,
 * actionable messages and bound every call with a timeout so an MCP tool never
 * freezes the client.
 */

/** Extract a readable message from a Baileys/Boom/unknown error. */
export function cleanErr(e: any): string {
  if (!e) return "unknown error";
  const status = e?.output?.statusCode ?? e?.data?.statusCode ?? e?.status;
  const msg =
    e?.output?.payload?.message ??
    e?.message ??
    (typeof e === "string" ? e : JSON.stringify(e));
  return status ? `${msg} (status ${status})` : String(msg);
}

/** Reject if a promise does not settle within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms (WhatsApp may be reconnecting)`)),
      ms,
    );
  });
  // If the timeout wins, `p` may still reject later; swallow that so it never
  // surfaces as an unhandledRejection (which can crash the process).
  p.catch(() => {});
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Run a Baileys call with a timeout and normalized error context.
 * Defaults to a 20s bound; pass a longer one for uploads/downloads.
 */
export async function waCall<T>(label: string, fn: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  try {
    return await withTimeout(Promise.resolve().then(fn), timeoutMs, label);
  } catch (e: any) {
    // Preserve our own timeout message; wrap everything else with context.
    if (e instanceof Error && e.message.includes("timed out after")) throw e;
    throw new Error(`${label} failed: ${cleanErr(e)}`);
  }
}

/** Validate a value looks like a group JID. */
export function assertGroupJid(jid: string): void {
  if (!jid || !jid.endsWith("@g.us")) {
    throw new Error(`Expected a group JID ending in @g.us, got "${jid}". Use list_groups to find it.`);
  }
}

/** Validate a value looks like a WhatsApp user JID (or a bare number to normalize). */
export function assertUserJid(jid: string): void {
  const ok = /@s\.whatsapp\.net$/.test(jid) || /@lid$/.test(jid);
  if (!ok) {
    throw new Error(`Expected a user JID ending in @s.whatsapp.net, got "${jid}".`);
  }
}

/** True for a plausible emoji reaction (or empty string to clear a reaction). */
export function isValidReaction(text: string): boolean {
  if (text === "") return true; // clearing
  // one or two grapheme-ish emoji; keep it permissive but non-empty and short
  return text.length > 0 && text.length <= 8;
}
