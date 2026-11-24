import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./helpers.ts";
import { hash } from "../src/store.ts";
import { transcriptMessages } from "../plugins/atlas-memory/scripts/atlas.ts";

const SCRIPT = join(import.meta.dir, "../plugins/atlas-memory/scripts/atlas.ts");
const TOKEN = "synthetic-claude-code-agent-token";
const line = (v: any) => JSON.stringify(v);

// Synthetic transcript covering every entry kind seen in real Claude Code sessions.
function transcript(extra: any[] = []) {
  return [
    { type: "session-owner" },
    { type: "user", uuid: "u1", timestamp: "2026-01-01T00:00:00.000Z", origin: { kind: "human" },
      message: { role: "user", content: [{ type: "text", text: "Fictional: please remember Mira prefers tea." }] } },
    { type: "attachment", uuid: "att" },
    { type: "assistant", uuid: "a1a", timestamp: "2026-01-01T00:00:01.000Z", message: { id: "msg_1", role: "assistant", content: [{ type: "thinking", thinking: "SECRET_THINKING" }] } },
    { type: "assistant", uuid: "a1b", timestamp: "2026-01-01T00:00:02.000Z", message: { id: "msg_1", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", uuid: "tr1", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "SECRET_TOOL_OUTPUT" }] } },
    { type: "assistant", uuid: "a2", timestamp: "2026-01-01T00:00:04.000Z", message: { id: "msg_2", role: "assistant", content: [{ type: "text", text: "Noted: Mira prefers tea." }] } },
    { type: "assistant", uuid: "a2b", timestamp: "2026-01-01T00:00:05.000Z", message: { id: "msg_2", role: "assistant", content: [{ type: "text", text: "Anything else?" }] } },
    { type: "user", uuid: "meta", isMeta: true, message: { role: "user", content: "<system-reminder>SECRET_REMINDER</system-reminder>" } },
    { type: "user", uuid: "cmd", message: { role: "user", content: "<command-name>/goal</command-name>\n<command-args>x</command-args>" } },
    { type: "user", uuid: "out", message: { role: "user", content: "<local-command-stdout>SECRET_STDOUT</local-command-stdout>" } },
    { type: "user", uuid: "task", message: { role: "user", content: "<task-notification>SECRET_TASK</task-notification>" } },
    { type: "user", uuid: "agentish", origin: { kind: "task-notification" }, message: { role: "user", content: "SECRET_NONHUMAN" } },
    { type: "user", uuid: "side", isSidechain: true, origin: { kind: "human" }, message: { role: "user", content: "SECRET_SIDECHAIN" } },
    { type: "assistant", uuid: "syn", message: { id: "msg_syn", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "SECRET_SYNTHETIC" }] } },
    { type: "user", uuid: "u2", timestamp: "2026-01-01T00:01:00.000Z", origin: { kind: "human" },
      message: { role: "user", content: "Second fictional message<system-reminder>SECRET_INLINE</system-reminder>" } },
    ...extra,
  ].map(line).join("\n") + "\n{\"type\":\"user\",\"trunc";
}

test("transcript parsing admits only typed human prompts and assistant reply text", () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-plugin-"));
  try {
    const path = join(dir, "t.jsonl");
    writeFileSync(path, transcript());
    const messages = transcriptMessages(path);
    expect(messages).toEqual([
      { key: "u:u1", role: "user", content: "Fictional: please remember Mira prefers tea.", occurred_at: "2026-01-01T00:00:00.000Z" },
      { key: "a:msg_2", role: "assistant", content: "Noted: Mira prefers tea.\n\nAnything else?", occurred_at: "2026-01-01T00:00:04.000Z" },
      { key: "u:u2", role: "user", content: "Second fictional message", occurred_at: "2026-01-01T00:01:00.000Z" },
    ]);
    expect(JSON.stringify(messages)).not.toContain("SECRET");
    expect(transcriptMessages(join(dir, "missing.jsonl"))).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

async function setup() {
  const f = await fixture();
  expect((await f.call("POST", "/v1/memory/agents", { agent_id: "claude-code", name: "Claude Code", token_hash: hash(TOKEN) })).status).toBe(200);
  let up = true;
  const server = Bun.serve({ port: 0, fetch: (r) => up ? f.app.fetch(r) : new Response("down", { status: 503 }) });
  const dir = mkdtempSync(join(tmpdir(), "atlas-plugin-"));
  const cred = join(dir, "claude-code.json"), settings = join(dir, "settings.json"), data = join(dir, "data"), path = join(dir, "t.jsonl");
  writeFileSync(cred, JSON.stringify({ url: `http://localhost:${server.port}`, agent_id: "claude-code", name: "Claude Code", token: TOKEN }), { mode: 0o600 });
  writeFileSync(settings, JSON.stringify({ owner_author_id: "alex", recall_timeout_seconds: 5 }));
  writeFileSync(path, transcript());
  const hook = async (mode: string, input: any = {}) => {
    const proc = Bun.spawn([process.execPath, SCRIPT, mode, data], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "session-1", transcript_path: path, cwd: dir, ...input })),
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, ATLAS_CREDENTIAL_FILE: cred, ATLAS_SETTINGS_FILE: settings },
    });
    const [stdout, stderr, code] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text(), await proc.exited];
    return { stdout, stderr, code };
  };
  const events = () => f.store.all("SELECT event_id,revision,role,author_id,thread_id,content,operation FROM memory_events WHERE client_id='claude-code' ORDER BY event_id,revision");
  return { f, server, dir, path, cred, hook, events, setUp: (v: boolean) => { up = v; },
    close: () => { server.stop(true); f.store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("hooks capture genuine communication through the durable outbox, idempotently, with recall on prompt", async () => {
  const s = await setup();
  try {
    const prompt = await s.hook("prompt", { prompt: "What does Mira prefer?" });
    expect(prompt.code).toBe(0);
    if (prompt.stdout) expect(JSON.parse(prompt.stdout).hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(s.events()).toHaveLength(0); // The prompt path never delivers.
    const recall = s.f.store.one("SELECT * FROM memory_recalls WHERE agent_id='claude-code'");
    expect(recall.thread_id).toBe("session-1");

    expect((await s.hook("stop")).code).toBe(0);
    const events = s.events();
    expect(events.map((e: any) => [e.event_id, e.role, e.author_id, e.thread_id, e.revision])).toEqual([
      ["claude-code:claude-code:session-1:a:msg_2:part:0", "assistant", "agent:claude-code", "session-1", 1],
      ["claude-code:claude-code:session-1:u:u1:part:0", "user", "alex", "session-1", 1],
      ["claude-code:claude-code:session-1:u:u2:part:0", "user", "alex", "session-1", 1],
    ]);
    expect(JSON.stringify(events)).not.toContain("SECRET");

    expect((await s.hook("stop")).code).toBe(0);
    expect((await s.hook("end")).code).toBe(0);
    expect(s.events()).toHaveLength(3);

    const status = await s.hook("status");
    expect(JSON.parse(status.stdout).outbox).toEqual({ delivered: 3 });
  } finally { s.close(); }
});

test("an outage leaves captures pending; the next hook delivers the identical bodies", async () => {
  const s = await setup();
  try {
    s.setUp(false);
    expect((await s.hook("prompt", { prompt: "hello" })).stdout).toBe("");
    expect((await s.hook("stop")).code).toBe(0);
    expect(s.events()).toHaveLength(0);
    // A new reply arrives while Atlas is down; then Atlas recovers.
    writeFileSync(s.path, transcript([{ type: "assistant", uuid: "a3", timestamp: "2026-01-01T00:02:00.000Z", message: { id: "msg_3", role: "assistant", content: [{ type: "text", text: "Fictional later reply." }] } }]));
    s.setUp(true);
    expect((await s.hook("stop")).code).toBe(0);
    expect(s.events().map((e: any) => e.event_id)).toContain("claude-code:claude-code:session-1:a:msg_3:part:0");
    expect(s.events()).toHaveLength(4);
    const failures = new (await import("bun:sqlite")).Database(join(s.dir, "data", "outbox.sqlite"))
      .query("SELECT kind FROM receipts WHERE kind='recall_failure'").all();
    expect(failures).toHaveLength(1);
  } finally { s.close(); }
});

test("headers helper returns the private bearer and marks automatic capture; MCP then hides remember", async () => {
  const s = await setup();
  try {
    const headers = JSON.parse((await s.hook("headers")).stdout);
    expect(headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "X-Atlas-Capture": "automatic" });
    const list = await fetch(`http://localhost:${s.server.port}/mcp`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }).then((r) => r.json()) as any;
    expect(list.result.tools.map((t: any) => t.name).sort()).toEqual(["forget", "graph", "recall", "status"]);
    const call = await fetch(`http://localhost:${s.server.port}/mcp`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "remember", arguments: {} } }),
    }).then((r) => r.json()) as any;
    expect(call.error.code).toBe(-32602);
  } finally { s.close(); }
});

test("an unconfigured host stays silent and never fails the turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-plugin-"));
  try {
    const proc = Bun.spawn([process.execPath, SCRIPT, "prompt", join(dir, "data")], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "s", prompt: "hi" })), stdout: "pipe", stderr: "pipe",
      env: { ...process.env, ATLAS_CREDENTIAL_FILE: join(dir, "missing.json") },
    });
    expect(await new Response(proc.stdout).text()).toBe("");
    expect(await proc.exited).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("plugin manifests are consistent", () => {
  const root = join(import.meta.dir, "..");
  const market = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(root, "plugins/atlas-memory/.claude-plugin/plugin.json"), "utf8"));
  expect(market.plugins[0].name).toBe(plugin.name);
  expect(market.plugins[0].source).toBe("./plugins/atlas-memory");
  const hooks = JSON.parse(readFileSync(join(root, "plugins/atlas-memory/hooks/hooks.json"), "utf8")).hooks;
  expect(Object.keys(hooks).sort()).toEqual(["SessionEnd", "Stop", "UserPromptSubmit"]);
  const mcp = JSON.parse(readFileSync(join(root, "plugins/atlas-memory/.mcp.json"), "utf8")).mcpServers.atlas;
  expect(mcp.type).toBe("http");
  expect(mcp.headers).toBeUndefined(); // The bearer never lives in config.
});
