import { test, expect } from "bun:test";
import { fixture } from "./helpers.ts";
import { hash } from "../src/store.ts";

const AGENT_TOKEN = "synthetic-mcp-agent-token";

async function setup(owner = false) {
  const f = await fixture();
  const provisioned = await f.call("POST", "/v1/memory/agents", { agent_id: "claude-code", name: "Claude Code", token_hash: hash(AGENT_TOKEN) });
  expect(provisioned.status).toBe(200);
  const previous = process.env.THE_ATLAS_MCP_OWNER_AGENTS;
  if (owner) process.env.THE_ATLAS_MCP_OWNER_AGENTS = "claude-code";
  else delete process.env.THE_ATLAS_MCP_OWNER_AGENTS;
  let n = 0;
  const rpc = async (method: string, params?: any, token: string | null = AGENT_TOKEN, headers: Record<string, string> = {}) => {
    const response = await f.app.fetch(new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, ...(params ? { params } : {}) }),
    }));
    return { status: response.status, headers: response.headers, body: (await response.json()) as any };
  };
  const tool = async (name: string, args: any = {}) => (await rpc("tools/call", { name, arguments: args })).body.result;
  const restore = () => {
    if (previous === undefined) delete process.env.THE_ATLAS_MCP_OWNER_AGENTS;
    else process.env.THE_ATLAS_MCP_OWNER_AGENTS = previous;
    f.store.close();
  };
  return { f, rpc, tool, restore };
}

test("MCP initialize, tools/list and notifications follow the stateless Streamable HTTP contract", async () => {
  const s = await setup();
  try {
    const init = await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    expect(init.status).toBe(200);
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    expect(init.body.result.capabilities.tools).toBeDefined();
    expect(init.body.result.serverInfo.name).toBe("the-atlas");
    const unknownVersion = await s.rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    expect(unknownVersion.body.result.protocolVersion).toBe("2025-11-25");
    const list = await s.rpc("tools/list");
    expect(list.body.result.tools.map((t: any) => t.name).sort()).toEqual(["forget", "graph", "recall", "remember", "status"]);
    const notification = await s.f.app.fetch(new Request("http://localhost/mcp", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${AGENT_TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }));
    expect(notification.status).toBe(202);
    expect((await s.rpc("nope")).body.error.code).toBe(-32601);
    expect((await s.f.app.fetch(new Request("http://localhost/mcp"))).status).toBe(405);
    expect((await s.rpc("ping", undefined, AGENT_TOKEN, { "MCP-Protocol-Version": "1999-01-01" })).status).toBe(400);
  } finally { s.restore(); }
});

test("MCP requires a valid bearer credential, rejects foreign origins and never accepts browser cookies", async () => {
  const s = await setup();
  try {
    const missing = await s.rpc("tools/list", undefined, null);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect((await s.rpc("tools/list", undefined, "wrong-token")).status).toBe(401);
    expect((await s.rpc("tools/list", undefined, null, { Cookie: "atlas_session=anything" })).status).toBe(401);
    expect((await s.rpc("tools/list", undefined, AGENT_TOKEN, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await s.rpc("tools/list", undefined, AGENT_TOKEN, { Origin: "http://localhost" })).status).toBe(200);
  } finally { s.restore(); }
});

test("the agent comes from the server-side binding, not from tool arguments", async () => {
  const s = await setup();
  try {
    const status = await s.tool("status");
    expect(status.isError).toBeUndefined();
    expect(status.structuredContent.agent_id).toBe("claude-code");
    expect(status.structuredContent.readable_scopes.sort()).toEqual(["agent:claude-code", "business:alex", "user:alex"]);
    expect(status.structuredContent.user_messages_attributed_to_owner).toBe(false);
    const smuggled = await s.rpc("tools/call", { name: "recall", arguments: { query: "hi", agent_id: "default" } });
    expect(smuggled.body.result.isError).toBeUndefined();
    // The unbound bootstrap administrator has no agent graph and gets a readable tool error.
    const unbound = await s.rpc("tools/call", { name: "status", arguments: {} }, s.f.owner.token);
    expect(unbound.body.result.isError).toBe(true);
    expect(unbound.body.result.content[0].text).toContain("agent_binding_required");
  } finally { s.restore(); }
});

test("recall issues the plugin's native-v1 request against the bound agent", async () => {
  const s = await setup();
  try {
    const result = await s.tool("recall", { query: "What did we decide about the launch?", thread_id: "session-1",
      recent_context: [{ role: "user", content: "earlier" }], token_budget: 800 });
    expect(result.isError).toBeUndefined();
    expect(typeof result.content[0].text).toBe("string");
    expect(result.structuredContent.recall_id).toMatch(/^recall/);
    const row = s.f.store.one("SELECT * FROM memory_recalls WHERE id=?", result.structuredContent.recall_id);
    expect(row.agent_id).toBe("claude-code");
    expect(row.thread_id).toBe("session-1");
    expect((await s.tool("recall", { query: "x", recent_context: [{ role: "tool", content: "output" }] })).isError).toBe(true);
    expect((await s.tool("recall", {})).isError).toBe(true);
  } finally { s.restore(); }
});

test("remember stores verbatim user/assistant events idempotently, revises changes and forgets them", async () => {
  const s = await setup();
  try {
    const messages = [
      { message_id: "m1", role: "user", content: "Fictional: my favourite colour is teal." },
      { message_id: "m2", role: "assistant", content: "Noted, teal it is." },
    ];
    const first = await s.tool("remember", { thread_id: "session-1", messages });
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent.results.map((r: any) => r.status)).toEqual(["accepted", "accepted"]);
    const events = s.f.store.all("SELECT * FROM memory_events WHERE client_id='mcp' ORDER BY event_id");
    expect(events.map((e: any) => [e.event_id, e.role, e.author_id, e.agent_id, e.thread_id, e.revision])).toEqual([
      ["mcp:claude-code:session-1:m1:part:0", "user", "mcp:user:unknown", "claude-code", "session-1", 1],
      ["mcp:claude-code:session-1:m2:part:0", "assistant", "agent:claude-code", "claude-code", "session-1", 1],
    ]);
    expect(events[0].content).toBe(messages[0].content);
    expect(s.f.store.one("SELECT COUNT(*) AS n FROM memory_jobs").n).toBe(2);

    const again = await s.tool("remember", { thread_id: "session-1", messages });
    expect(again.structuredContent.results.map((r: any) => r.status)).toEqual(["unchanged", "unchanged"]);
    expect(s.f.store.one("SELECT COUNT(*) AS n FROM memory_events WHERE client_id='mcp'").n).toBe(2);

    const revised = await s.tool("remember", { thread_id: "session-1", messages: [{ ...messages[0], content: "Fictional: my favourite colour is green." }] });
    expect(revised.structuredContent.results[0].status).toBe("accepted");
    const head = s.f.store.one("SELECT e.revision,e.content FROM memory_heads h JOIN memory_events e ON e.id=h.event_pk WHERE h.event_id='mcp:claude-code:session-1:m1:part:0'");
    expect(head).toEqual({ revision: 2, content: "Fictional: my favourite colour is green." });

    const forgotten = await s.tool("forget", { thread_id: "session-1", message_ids: ["m1", "missing"] });
    expect(forgotten.structuredContent.results).toEqual([{ message_id: "m1", status: "deleted" }, { message_id: "missing", status: "not_found" }]);
    const deleted = s.f.store.one("SELECT e.operation,e.content FROM memory_heads h JOIN memory_events e ON e.id=h.event_pk WHERE h.event_id='mcp:claude-code:session-1:m1:part:0'");
    expect(deleted).toEqual({ operation: "delete", content: null });
  } finally { s.restore(); }
});

test("remember admits only communication: tool roles and automatic notices never enter memory", async () => {
  const s = await setup();
  try {
    const tool = await s.tool("remember", { thread_id: "t", messages: [{ message_id: "x", role: "tool", content: "command output" }] });
    expect(tool.isError).toBe(true);
    const notice = await s.tool("remember", { thread_id: "t", messages: [{ message_id: "n", role: "user", content: "[kanban-wake] task ready" }] });
    expect(notice.structuredContent.results[0]).toEqual({ message_id: "n", status: "skipped", reason: "automatic_status_notification" });
    expect(s.f.store.one("SELECT COUNT(*) AS n FROM memory_events").n).toBe(0);
  } finally { s.restore(); }
});

test("only explicitly configured owner agents attribute user messages to the owner, and long messages are split", async () => {
  const s = await setup(true);
  try {
    const long = "Fictional long message. ".repeat(4000);
    const r = await s.tool("remember", { thread_id: "t", messages: [{ message_id: "long", role: "user", content: long }] });
    expect(r.structuredContent.results[0]).toMatchObject({ status: "accepted", parts: 2 });
    const parts = s.f.store.all("SELECT author_id,content FROM memory_events WHERE client_id='mcp' ORDER BY event_id");
    expect(parts.map((p: any) => p.author_id)).toEqual(["alex", "alex"]);
    expect(parts.map((p: any) => p.content).join("")).toBe(long);
    const shorter = await s.tool("remember", { thread_id: "t", messages: [{ message_id: "long", role: "user", content: "Fictional short now." }] });
    expect(shorter.structuredContent.results[0].status).toBe("accepted");
    const heads = s.f.store.all("SELECT h.event_id,e.operation FROM memory_heads h JOIN memory_events e ON e.id=h.event_pk WHERE h.client_id='mcp' ORDER BY h.event_id");
    expect(heads.map((h: any) => h.operation)).toEqual(["upsert", "delete"]);
  } finally { s.restore(); }
});

test("graph lists the bound agent's readable memories", async () => {
  const s = await setup();
  try {
    const result = await s.tool("graph", { query: "teal", limit: 10 });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeDefined();
    expect((await s.tool("graph", { limit: 1000 })).isError).toBe(true);
  } finally { s.restore(); }
});
