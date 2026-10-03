// Smoke test for the BWA MCP bridge: speaks MCP over stdio exactly like Claude Code or Codex would.
//   BWA_URL=http://127.0.0.1:3900 BWA_PROJECT_ID=p_xxx node scripts/mcp-smoke-test.mjs
// Warning: it claims and completes the next task of that project. Use a copy of your data.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Optional: test the desktop build's bundled bridge on BWA.exe, e.g.
//   BWA_BRIDGE_COMMAND="C:/.../BWA.exe" BWA_BRIDGE_SCRIPT="C:/.../app.asar.unpacked/dist-electron/bridge/mcp-server.mjs"
const desktopCommand = process.env.BWA_BRIDGE_COMMAND;
const transport = new StdioClientTransport({
  command: desktopCommand || process.execPath,
  args: [
    process.env.BWA_BRIDGE_SCRIPT ||
      new URL("../bridge/mcp-server.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  ],
  env: { ...process.env, BWA_AGENT_NAME: "smoke-test", ...(desktopCommand ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
});
const client = new Client({ name: "claude-code", version: "0.0.0" });
await client.connect(transport);

const text = (res) => res.content.map((c) => c.text).join("\n");
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${text(res)}`);
  return text(res);
};

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const { prompts } = await client.listPrompts();
console.log("prompts:", prompts.map((p) => p.name).join(", "));

const context = await call("get_project_context");
console.log("context:", context.split("\n")[0], `(${context.length} chars)`);
const prd = await call("get_prd");
console.log("prd:", prd.split("\n")[0]);

const next = await call("get_next_task", { claim: true });
const taskId = /^## (T\d+)/m.exec(next)?.[1];
console.log("claimed:", next.split("\n")[0]);
if (!taskId) throw new Error("no task claimed");

console.log("note:", await call("add_task_note", { task_id: taskId, note: "Smoke test sedang berjalan." }));
const done = await call("complete_task", {
  task_id: taskId,
  summary: "Smoke test: menandai task selesai lewat MCP.",
  files_changed: ["README.md"],
});
console.log("complete:\n" + done);
await client.close();
