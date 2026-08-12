// Response-driven MCP stdio smoke test: initialize -> tools/list. No WhatsApp.
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, WAMCP_MODE: "read-only", WAMCP_NO_WA: "1" },
});

let buf = "";
const handlers = new Map(); // id -> fn(msg)
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && handlers.has(msg.id)) handlers.get(msg.id)(msg);
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");

function fail(reason) {
  console.log(reason);
  child.kill();
  process.exit(1);
}
const guard = setTimeout(() => fail("Timed out waiting for MCP responses."), 15000);

// Step 1: initialize, wait for its response, then list tools.
handlers.set(1, () => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  handlers.set(2, (msg) => {
    clearTimeout(guard);
    const names = msg.result?.tools?.map((t) => t.name) ?? [];
    console.log(`TOOLS (${names.length}):`);
    console.log(names.join(", "));
    child.kill();
    process.exit(names.length > 0 ? 0 : 1);
  });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
});

// give the process a moment to attach its stdin reader, then send.
setTimeout(() => send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } },
}), 300);
