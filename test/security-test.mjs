// Security utility tests: filename sanitization, path confinement, null bytes.
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { sanitizeFilename, assertPathWithinRoots, assertNoNullByte } from "../dist/security.js";

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); console.log(`  ok  ${name}`); pass++; };
function throwsWith(name, fn, sub) {
  try { fn(); check(name + " (did NOT throw!)", false); }
  catch (e) { check(name, String(e.message).toLowerCase().includes(sub)); }
}

// --- sanitizeFilename (path traversal) ---------------------------------------
const s1 = sanitizeFilename("../../etc/passwd");
check(`sanitizeFilename strips separators (${s1})`, !/[\\/]/.test(s1));
check("sanitizeFilename keeps safe id", sanitizeFilename("ABC_123-def") === "ABC_123-def");
check("sanitizeFilename empty -> file", sanitizeFilename("") === "file");
check("sanitizeFilename '..' -> file", sanitizeFilename("..") === "file");
check("sanitizeFilename caps length", sanitizeFilename("x".repeat(500)).length <= 128);

// --- assertNoNullByte --------------------------------------------------------
assertNoNullByte("normal/path.svg"); check("assertNoNullByte allows clean", true);
throwsWith("assertNoNullByte rejects NUL", () => assertNoNullByte("a\0b"), "null byte");

// --- assertPathWithinRoots (anti-exfiltration) -------------------------------
const root = os.tmpdir();
assertPathWithinRoots(path.join(root, "sub", "ok.txt"), [root]);
check("path inside root is allowed", true);
throwsWith("path outside root is blocked", () => assertPathWithinRoots(path.join(root, "..", "evil.txt"), [root]), "outside");
assertPathWithinRoots("/anything/at/all", []); // empty roots = no restriction
check("empty roots = no restriction", true);

console.log(`\n${pass} checks passed.`);
