// Pure tests for the Baileys hardening helpers. No DB/WhatsApp.
import assert from "node:assert";
import {
  cleanErr,
  withTimeout,
  assertGroupJid,
  assertUserJid,
  isValidReaction,
} from "../dist/whatsapp/guard.js";

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); console.log(`  ok  ${name}`); pass++; };
async function throwsWith(name, fn, sub) {
  try { await fn(); check(name + " (did NOT throw!)", false); }
  catch (e) { check(name, String(e.message).toLowerCase().includes(sub)); }
}

// --- cleanErr -----------------------------------------------------------------
check("cleanErr formats Boom with status", cleanErr({ output: { statusCode: 401, payload: { message: "unauthorized" } } }) === "unauthorized (status 401)");
check("cleanErr from Error", cleanErr(new Error("boom")) === "boom");
check("cleanErr from string", cleanErr("nope") === "nope");
check("cleanErr from null", cleanErr(null) === "unknown error");

// --- withTimeout --------------------------------------------------------------
check("withTimeout resolves fast promise", (await withTimeout(Promise.resolve(42), 1000, "x")) === 42);
await throwsWith("withTimeout rejects slow promise", () => withTimeout(new Promise((r) => setTimeout(r, 300)), 40, "slowop"), "timed out");

// --- validators ---------------------------------------------------------------
assertGroupJid("123-456@g.us"); check("assertGroupJid accepts @g.us", true);
await throwsWith("assertGroupJid rejects user jid", async () => assertGroupJid("111@s.whatsapp.net"), "group jid");
assertUserJid("111@s.whatsapp.net"); check("assertUserJid accepts @s.whatsapp.net", true);
await throwsWith("assertUserJid rejects group jid", async () => assertUserJid("123@g.us"), "user jid");

// --- isValidReaction ----------------------------------------------------------
check("empty reaction (clear) valid", isValidReaction("") === true);
check("emoji reaction valid", isValidReaction("👍") === true);
check("overlong reaction invalid", isValidReaction("not an emoji at all") === false);

console.log(`\n${pass} checks passed.`);
