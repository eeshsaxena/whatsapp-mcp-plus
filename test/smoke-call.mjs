// Call a couple of read-only tools to confirm handlers execute end-to-end.
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
    if (line) { try { seen.push(JSON.parse(line)); } catch {} }
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");

setTimeout(() => send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "s", version: "0" } } }), 700);
setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "get_status", arguments: {} } });
  send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "whatsapp_wrapped", arguments: { period: "all", format: "card" } } });
  // A blocked write in read-only mode should return a safety error message.
  send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "send_message", arguments: { recipient: "15551234567", text: "hi" } } });
}, 1500);

setTimeout(() => {
  for (const id of [10, 11, 12]) {
    const r = seen.find((m) => m.id === id);
    const text = r?.result?.content?.[0]?.text ?? JSON.stringify(r);
    console.log(`\n----- id ${id} -----\n${String(text).slice(0, 400)}`);
  }
  child.kill();
  process.exit(0);
}, 3500);
