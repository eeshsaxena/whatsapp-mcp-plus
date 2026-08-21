#!/usr/bin/env node
// Plug-and-play setup wizard. Asks, in plain language, what the assistant is
// allowed to do (feature scopes + safety mode + privacy), then writes .env and
// prints the MCP client config snippet. Non-interactive: pass --defaults (or
// --yes) to write the safe defaults without prompting.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout, argv } from "node:process";

const ENV_PATH = path.join(process.cwd(), ".env");
const nonInteractive = argv.includes("--defaults") || argv.includes("--yes") || argv.includes("-y");

const SCOPES = [
  { key: "read", q: "Allow the assistant to READ your chats, messages and contacts?", def: true },
  { key: "analytics", q: "Allow ANALYTICS (WhatsApp Wrapped, stats, top words)?", def: true },
  { key: "send", q: "Allow SENDING messages / reactions / replies?", def: false },
  { key: "media", q: "Allow MEDIA download + voice transcription?", def: false },
  { key: "groups", q: "Allow GROUP management (create, add/remove, rename, leave)?", def: false },
  { key: "profile", q: "Allow PROFILE / chat management (pin, mute, block, set name)?", def: false },
];

function mergeEnv(existing, updates) {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const keys = new Set(Object.keys(updates));
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && keys.has(m[1])) { out.push(`${m[1]}=${updates[m[1]]}`); seen.add(m[1]); }
    else out.push(line);
  }
  for (const k of keys) if (!seen.has(k)) out.push(`${k}=${updates[k]}`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n*$/, "\n");
}

function summarize(updates) {
  console.log("\nConfiguration:");
  for (const [k, v] of Object.entries(updates)) console.log(`  ${k}=${v}`);
  const clientSnippet = {
    mcpServers: {
      "whatsapp-mcp-plus": {
        command: "npx",
        args: ["-y", "whatsapp-mcp-plus"],
        env: updates,
      },
    },
  };
  console.log("\nMCP client config (e.g. Claude Desktop) — add to your config:");
  console.log(JSON.stringify(clientSnippet, null, 2));
  console.log("\nFirst run prints a QR to scan (WhatsApp > Linked Devices). Done.");
}

async function main() {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";

  if (nonInteractive) {
    const updates = {
      WAMCP_MODE: "read-only",
      WAMCP_SCOPES: "read,analytics",
      WAMCP_PRIVACY: "true",
    };
    fs.writeFileSync(ENV_PATH, mergeEnv(existing, updates));
    console.log(`Wrote safe defaults to ${ENV_PATH}`);
    summarize(updates);
    return;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const yesno = async (q, def) => {
    const ans = (await rl.question(`${q} ${def ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    if (ans === "") return def;
    return ans === "y" || ans === "yes";
  };

  console.log("whatsapp-mcp-plus setup — choose what the assistant may do.\n");
  const enabled = [];
  for (const s of SCOPES) if (await yesno(s.q, s.def)) enabled.push(s.key);
  if (enabled.length === 0) enabled.push("read");

  let mode = (await rl.question("\nSafety mode — read-only / assisted / unrestricted [read-only]: ")).trim().toLowerCase();
  if (!["read-only", "assisted", "unrestricted"].includes(mode)) mode = "read-only";

  const privacy = await yesno("\nPrivacy mode (pseudonymize contacts + redact secrets before they reach the LLM)?", true);
  rl.close();

  if ((mode === "read-only") && (enabled.includes("send") || enabled.includes("groups") || enabled.includes("profile"))) {
    console.log("\nNote: mode is read-only, so send/groups/profile scopes stay blocked until you set mode to 'assisted'.");
  }

  const updates = {
    WAMCP_MODE: mode,
    WAMCP_SCOPES: enabled.join(","),
    WAMCP_PRIVACY: String(privacy),
  };
  fs.writeFileSync(ENV_PATH, mergeEnv(existing, updates));
  console.log(`\nWrote ${ENV_PATH}`);
  summarize(updates);
}

main().catch((e) => { console.error("setup failed:", e?.message || e); process.exit(1); });
