// Security-hardening regression tests (pen-test findings -> fixes).
// No WhatsApp needed. Uses a throwaway DB dir for the pseudonym store.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const DATA = path.join(os.tmpdir(), `wamcp-harden-${process.pid}`);
process.env.WAMCP_DATA_DIR = DATA;
process.env.WAMCP_AUTH_DIR = path.join(DATA, "auth_info");
process.env.WAMCP_PRIVACY = "true";
process.env.WAMCP_ACTIONS_PER_MINUTE = "5";

const { initializeDatabase } = await import("../dist/db.js");
const { scrubOutput, scrubText, dePseudonymizeArgs, contactLabel } = await import("../dist/privacy.js");
const { assertNotSensitivePath, sanitizeFilename, assertWritablePath } = await import("../dist/security.js");
const { assertActionRate, guardedMutation, setMode, confirmAction } = await import("../dist/safety/index.js");

initializeDatabase();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ok  " + msg); } else { fail++; console.log("  FAIL " + msg); } };
const throws = (fn, msg) => { try { fn(); ok(false, msg + " (did not throw)"); } catch { ok(true, msg); } };
const nothrow = (fn, msg) => { try { fn(); ok(true, msg); } catch (e) { ok(false, msg + " (threw: " + e.message + ")"); } };
const athrows = async (fn, msg) => { try { await fn(); ok(false, msg + " (did not throw)"); } catch { ok(true, msg); } };

// --- #1 sensitive-path denylist (send-file exfil floor) ---
throws(() => assertNotSensitivePath("/home/u/.ssh/id_rsa"), "block id_rsa");
throws(() => assertNotSensitivePath("/home/u/project/.env"), "block .env");
throws(() => assertNotSensitivePath("/home/u/certs/server.pem"), "block .pem");
throws(() => assertNotSensitivePath("/srv/app/auth_info/creds.json"), "block auth_info/ dir");
throws(() => assertNotSensitivePath("/srv/app/data/whatsapp.db"), "block whatsapp.db");
throws(() => assertNotSensitivePath("/home/u/.aws/credentials"), "block .aws/credentials");
nothrow(() => assertNotSensitivePath("/home/u/Pictures/cat.jpg"), "allow a normal image");
nothrow(() => assertNotSensitivePath("/srv/app/data/media/abc123.jpg"), "allow downloaded media");

// --- #2 ReDoS: redaction must be linear/fast on crafted input ---
{
  const evil = "A".repeat(120000) + "1"; // long mixed alnum run
  const t0 = Date.now();
  const out = scrubText(evil);
  const dt = Date.now() - t0;
  ok(dt < 1000, `redaction stays fast on 120k input (${dt}ms)`);
  ok(out.includes("[redacted-token]"), "long high-entropy token redacted");
}

// --- secret redaction (irreversible) ---
ok(scrubText("card 4111 1111 1111 1111 please").includes("[redacted-card]"), "Luhn card redacted");
ok(!scrubText("card 4111 1111 1111 1112 please").includes("[redacted-card]"), "non-Luhn 16-digit NOT card-redacted");
ok(scrubText("key ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789").includes("[redacted-key]"), "github token redacted");
ok(scrubText("my OTP is 448291 now").includes("[redacted-code]"), "OTP code redacted");
ok(scrubText("PAN ABCDE1234F here").includes("[redacted-pan]"), "PAN redacted");
ok(scrubText("just a normal message") === "just a normal message", "normal text untouched");

// --- pseudonymization round-trip (reversible identifiers) ---
{
  const out = scrubOutput({ jid: "919925238809@s.whatsapp.net", name: "Ravi", is_group: false });
  ok(/^waid-[0-9a-f]+$/.test(out.jid), "jid pseudonymized to waid-N");
  ok(/^waname-[0-9a-f]+$/.test(out.name), "name pseudonymized to waname-N");
  const back = dePseudonymizeArgs({ chat_jid: out.jid });
  ok(back.chat_jid === "919925238809@s.whatsapp.net", "alias reverses to real jid");
  const grp = scrubOutput({ jid: "120363000000000000@g.us" });
  ok(/^wagrp-[0-9a-f]+$/.test(grp.jid), "group jid pseudonymized to wagrp-N");
  ok(dePseudonymizeArgs({ chat_jid: grp.jid }).chat_jid === "120363000000000000@g.us", "group alias reverses");
  ok(dePseudonymizeArgs({ chat_jid: "waid-deadbeef99" }).chat_jid === "waid-deadbeef99", "unknown alias left as-is (no false resolve)");
}

// --- 12-digit phone inside a JID must alias (regression: was eaten by Aadhaar) ---
ok(/^waid-[0-9a-f]+$/.test(scrubOutput({ jid: "911234567890@s.whatsapp.net" }).jid), "12-digit-JID aliases (not redacted-id)");

// --- shareable-card names pseudonymized under privacy mode ---
ok(/^waname-[0-9a-f]+$/.test(contactLabel("Carol", "555@s.whatsapp.net")), "card contact name aliased under privacy");

// --- arbitrary file write confinement (wrapped_card/rewind output paths) ---
throws(() => assertWritablePath("/etc/cron.d/evil", [DATA]), "block write outside data dir");
throws(() => assertWritablePath(path.join(DATA, "..", "..", "evil.svg"), [DATA]), "block write path traversal");
nothrow(() => assertWritablePath(path.join(DATA, "rewind", "cover.svg"), [DATA]), "allow write inside data dir");

// --- destructive ops require mode + two-step confirm (guardedMutation) ---
await athrows(() => guardedMutation({ action: "delete_message", description: "del", run: async () => {} }), "destructive op blocked in read-only mode");
setMode("assisted");
let ran = false;
const staged = await guardedMutation({ action: "delete_message", description: "del", run: async () => { ran = true; return "done"; } });
ok(staged.status === "needs_confirmation" && !!staged.token, "destructive op stages a confirm token in assisted mode");
ok(ran === false, "destructive op not executed until confirmed");
await confirmAction(staged.token);
ok(ran === true, "confirm_action executes the staged destructive op");

// --- anti-runaway action rate cap (ban protection) ---
let blocked = false;
for (let i = 0; i < 12 && !blocked; i++) { try { assertActionRate("react_to_message"); } catch { blocked = true; } }
ok(blocked, "per-minute action cap eventually blocks");

// --- filename sanitization (path traversal) ---
ok(!sanitizeFilename("../../etc/passwd").includes("/"), "sanitizeFilename strips slashes");
ok(sanitizeFilename("..") === "file", "sanitizeFilename neutralizes '..'");

try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
