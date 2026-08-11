// Minimal MCP stdio smoke test: initialize + tools/list, no WhatsApp needed.
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, WAMCP_MODE: "read-only" },
});

let buf = "";
const seen = [];
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try { seen.push(JSON.parse(line)); } catch { /* non-json */ }
  }
});

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

setTimeout(() => {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  }});
}, 800);

setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
}, 1600);

setTimeout(() => {
  const listResp = seen.find((m) => m.id === 2);
  if (listResp?.result?.tools) {
    const names = listResp.result.tools.map((t) => t.name);
    console.log(`TOOLS (${names.length}):`);
    console.log(names.join(", "));
  } else {
    console.log("No tools/list response captured. Raw messages:");
    console.log(JSON.stringify(seen, null, 2).slice(0, 1500));
  }
  child.kill();
  process.exit(0);
}, 3500);
