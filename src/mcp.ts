import { setting } from "./config.ts";
import { redact } from "./inference.ts";
import { ApiError } from "./errors.ts";
import { canonical, hash, id, now, type Actor } from "./store.ts";
import type { App } from "./app.ts";

// Remote MCP adapter (Streamable HTTP, stateless JSON responses). It is a thin
// client of the existing /v1 API, mirroring the Hermes atlas-memory plugin:
// same bearer agent credential, same recall request, same event envelope.
// Every tool call is dispatched in-process through App.fetch, so authorization,
// agent binding, idempotency, admission and audit are exactly the API's own.
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "the-atlas", version: "0.1.0-alpha.1" };
const CLIENT_ID = "mcp";
const PART = 90_000; // Same chunking as the plugin; the API accepts 100k per event.

const INSTRUCTIONS = [
  "The Atlas is long-term memory shared with your other agents.",
  "Call `recall` with the user's latest message before answering when past context could matter.",
  "Call `remember` with the verbatim user and assistant messages of each exchange worth keeping.",
  "Only genuine conversation enters memory: never tool calls, tool results, command output,",
  "file contents, status or delivery notices, summaries or anything you paraphrased or invented.",
].join(" ");
// Sent by the atlas-memory Claude Code plugin, whose hooks already capture the transcript.
const AUTOMATIC_INSTRUCTIONS = [
  "The Atlas is long-term memory shared with your other agents.",
  "This client captures the conversation and recalls memory for each prompt automatically;",
  "use `recall` or `graph` only for an extra lookup mid-task, and `forget` when asked to forget something.",
].join(" ");

const roleSchema = { type: "string", enum: ["user", "assistant"] };
const TOOLS = [
  {
    name: "recall",
    title: "Recall from Atlas memory",
    description:
      "Return a compact, query-specific Atlas memory packet for the user's latest message. " +
      "Pass the user's message verbatim as `query`; pass up to two prior messages as `recent_context` for follow-ups.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The user's latest message, verbatim (up to 16000 characters)." },
        thread_id: { type: "string", description: "Stable conversation/session identifier." },
        recent_context: {
          type: "array", maxItems: 2,
          items: { type: "object", properties: { role: roleSchema, content: { type: "string" } }, required: ["role", "content"] },
        },
        session_start: { type: "boolean", description: "True for the first message of a conversation." },
        token_budget: { type: "integer", minimum: 0, maximum: 4000, default: 1200 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "remember",
    title: "Remember conversation messages",
    description:
      "Store genuine conversation messages in Atlas memory, verbatim. Only user and assistant messages " +
      "exchanged with the person: never tool calls/results, command output, file contents, status notices or paraphrase. " +
      "Re-sending a message with the same message_id is a no-op; changed content revises it.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Stable conversation/session identifier." },
        messages: {
          type: "array", minItems: 1, maxItems: 20,
          items: {
            type: "object",
            properties: {
              message_id: { type: "string", description: "Stable unique id of this message within the thread." },
              role: roleSchema,
              content: { type: "string", description: "The exact message text." },
              occurred_at: { type: "string", description: "ISO-8601 time the message was sent; defaults to now." },
            },
            required: ["message_id", "role", "content"],
            additionalProperties: false,
          },
        },
      },
      required: ["thread_id", "messages"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "forget",
    title: "Forget remembered messages",
    description: "Delete previously remembered messages (by thread_id and message_id) and the memories derived from them.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        message_ids: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
      },
      required: ["thread_id", "message_ids"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "graph",
    title: "Browse the Atlas memory graph",
    description: "List current memories as subject–predicate–object statements, optionally filtered by a literal text query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text filter (up to 300 characters)." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        include_history: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "status",
    title: "Atlas connection status",
    description: "Show which Atlas agent this connection is bound to and the memory scopes it can read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

class ToolInputError extends Error {}
const rpcError = (rpcId: unknown, code: number, message: string) =>
  ({ jsonrpc: "2.0", id: rpcId ?? null, error: { code, message } });
const str = (v: unknown, name: string, max: number) => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new ToolInputError(`${name} must be a nonempty string up to ${max} characters`);
  return v;
};

export class Mcp {
  constructor(private app: App) {}

  private headers(extra: Record<string, string> = {}) {
    return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra };
  }
  private reply(value: unknown, status = 200, extra: Record<string, string> = {}) {
    return Response.json(value, { status, headers: this.headers(extra) });
  }

  async fetch(request: Request): Promise<Response> {
    // Stateless server: no server-initiated SSE stream and no sessions to delete.
    if (request.method !== "POST")
      return this.reply(rpcError(null, -32000, "Method not allowed; POST JSON-RPC messages"), 405, { Allow: "POST" });
    // DNS-rebinding defence required by the transport spec. Bearer auth also applies.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return this.reply(rpcError(null, -32000, "Origin not allowed"), 403);
    const version = request.headers.get("mcp-protocol-version");
    if (version && !MCP_PROTOCOL_VERSIONS.includes(version))
      return this.reply(rpcError(null, -32000, "Unsupported MCP-Protocol-Version"), 400);
    const authorization = request.headers.get("authorization") ?? "";
    let actor: Actor;
    try {
      actor = this.app.store.authenticate(authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined);
      this.app.store.active(actor);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Unauthorized";
      return this.reply(rpcError(null, -32001, message), 401, { "WWW-Authenticate": 'Bearer realm="the-atlas"' });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return this.reply(rpcError(null, -32700, "Content-Type application/json required"), 415);
    const raw = await request.text();
    if (raw.length > 1_000_000) return this.reply(rpcError(null, -32600, "Request exceeds 1 MB"), 413);
    let message: any;
    try { message = JSON.parse(raw); } catch { return this.reply(rpcError(null, -32700, "Parse error"), 400); }
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string")
      return this.reply(rpcError(message?.id, -32600, "Invalid JSON-RPC request"), 400);
    // Notifications and client responses carry no id and expect no body.
    if (!("id" in message) || message.id === null) return new Response(null, { status: 202, headers: this.headers() });
    const automatic = request.headers.get("x-atlas-capture") === "automatic";
    const result = await this.dispatch(actor, authorization, message, automatic);
    return this.reply("error" in result ? { jsonrpc: "2.0", id: message.id, error: result.error } : { jsonrpc: "2.0", id: message.id, result: result.result });
  }

  private async dispatch(actor: Actor, authorization: string, m: any, automatic: boolean): Promise<{ result: any } | { error: any }> {
    // Automatic capture owns remembering; a model-relayed copy would duplicate it.
    const tools = automatic ? TOOLS.filter((t) => t.name !== "remember") : TOOLS;
    switch (m.method) {
      case "initialize": {
        const requested = m.params?.protocolVersion;
        return { result: {
          protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER,
          instructions: automatic ? AUTOMATIC_INSTRUCTIONS : INSTRUCTIONS,
        } };
      }
      case "ping": return { result: {} };
      case "tools/list": return { result: { tools } };
      case "tools/call": {
        const name = m.params?.name, args = m.params?.arguments ?? {};
        if (!tools.some((t) => t.name === name)) return { error: { code: -32602, message: `Unknown tool: ${String(name)}` } };
        if (!args || typeof args !== "object" || Array.isArray(args)) return { error: { code: -32602, message: "arguments must be an object" } };
        try {
          return { result: await this.call(actor, authorization, name, args) };
        } catch (e) {
          // Tool failures are results the model can read, never transport errors.
          const text = e instanceof ToolInputError ? `invalid_arguments: ${e.message}`
            : e instanceof ApiError ? `${e.code}: ${e.message}` : "internal_error: tool call failed";
          if (!(e instanceof ToolInputError) && !(e instanceof ApiError))
            console.error(JSON.stringify({ event: "atlas_mcp_tool_error", tool: name, error: String(e) }));
          return { result: { content: [{ type: "text", text }], isError: true } };
        }
      }
      default: return { error: { code: -32601, message: `Method not found: ${m.method}` } };
    }
  }

  /** Server-side binding: the credential decides the agent, never a tool argument. */
  private agent(actor: Actor) {
    const binding = this.app.store.one("SELECT agent_id FROM memory_bindings WHERE principal_id=? AND workspace_id=?", actor.id, actor.workspace_id);
    if (!binding) throw new ApiError(403, "agent_binding_required", "This credential is not bound to an Atlas agent");
    return binding.agent_id as string;
  }

  /** Same request the plugin makes over HTTP, served in-process by the API. */
  private async api(authorization: string, method: string, path: string, body?: unknown, key = id("mcp")) {
    const response = await this.app.fetch(new Request("http://atlas.internal" + path, {
      method,
      headers: { Authorization: authorization, "Content-Type": "application/json", "Idempotency-Key": key },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    }));
    const value: any = await response.json();
    if (!response.ok) throw new ApiError(response.status, value?.error?.code ?? "internal_error", value?.error?.message ?? "Request failed");
    return value;
  }

  private async call(actor: Actor, authorization: string, name: string, args: any) {
    const agent_id = this.agent(actor);
    if (name === "status") {
      const scopes = this.app.memory.authorize(actor, agent_id, "read");
      const value = { agent_id, principal: actor.name, workspace_id: actor.workspace_id, readable_scopes: scopes,
        user_messages_attributed_to_owner: ownerAgent(agent_id) };
      return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
    }
    if (name === "recall") {
      const query = typeof args.query === "string" && args.query.length <= 16_000 ? args.query
        : (() => { throw new ToolInputError("query must be text up to 16000 characters"); })();
      const thread_id = args.thread_id === undefined ? "mcp" : str(args.thread_id, "thread_id", 512);
      const recent = args.recent_context ?? [];
      if (!Array.isArray(recent) || recent.length > 2 || recent.some((x: any) => !x || !["user", "assistant"].includes(x.role) || typeof x.content !== "string"))
        throw new ToolInputError("recent_context must hold at most two user/assistant messages");
      const budget = args.token_budget ?? 1200;
      if (!Number.isInteger(budget) || budget < 0 || budget > 4000) throw new ToolInputError("token_budget must be an integer 0-4000");
      if (args.session_start !== undefined && typeof args.session_start !== "boolean") throw new ToolInputError("session_start must be boolean");
      const { data } = await this.api(authorization, "POST", "/v1/recall", {
        agent_id, thread_id, query,
        recent_context: recent.map((x: any) => ({ role: x.role, content: x.content.slice(-600) })),
        session_start: args.session_start === true, token_budget: budget, response_format: "native-v1",
      });
      const packet = String(data.context ?? "").trim();
      const memories = (data.memories ?? []).map((m: any) => ({ id: m.id, scope: m.scope, historical: m.historical, conflict: m.conflict }));
      return {
        content: [{ type: "text", text: packet || "No relevant Atlas memories for this message." }],
        structuredContent: { recall_id: data.recall_id, context: packet, memories },
      };
    }
    if (name === "remember") {
      const thread_id = str(args.thread_id, "thread_id", 300);
      if (!Array.isArray(args.messages) || !args.messages.length || args.messages.length > 20)
        throw new ToolInputError("messages must hold 1-20 messages");
      const results = [];
      for (const message of args.messages) results.push(await this.remember(actor, authorization, agent_id, thread_id, message));
      const stored = results.filter((r) => r.status === "accepted").length;
      return {
        content: [{ type: "text", text: `${stored} stored, ${results.length - stored} unchanged or skipped.\n` + JSON.stringify(results) }],
        structuredContent: { results },
      };
    }
    if (name === "forget") {
      const thread_id = str(args.thread_id, "thread_id", 300);
      if (!Array.isArray(args.message_ids) || !args.message_ids.length || args.message_ids.length > 20)
        throw new ToolInputError("message_ids must hold 1-20 ids");
      const results = [];
      for (const raw of args.message_ids) {
        const message_id = str(raw, "message_id", 80);
        const base = eventBase(agent_id, thread_id, message_id);
        const parts = this.app.store.all(
          `SELECT h.event_id,h.revision,e.role,e.author_id,e.agent_id,e.operation,e.thread_id,e.roots_json FROM memory_heads h JOIN memory_events e ON e.id=h.event_pk
           WHERE h.workspace_id=? AND h.client_id=? AND (h.event_id=? OR h.event_id LIKE ? ESCAPE '\\')`,
          actor.workspace_id, CLIENT_ID, base, likePrefix(base + ":part:"));
        let deleted = 0;
        for (const part of parts) {
          if (part.agent_id !== agent_id || part.operation === "delete") continue;
          const at = now();
          await this.api(authorization, "POST", "/v1/events", {
            client_id: CLIENT_ID, event_id: part.event_id, revision: part.revision + 1, operation: "delete",
            agent_id, thread_id: part.thread_id, role: part.role, author_id: part.author_id,
            occurred_at: at, observed_at: at, content: "", causal_parent_ids: [], evidence_root_ids: JSON.parse(part.roots_json),
            metadata: { source: "mcp", message_id },
          });
          deleted++;
        }
        results.push({ message_id, status: deleted ? "deleted" : "not_found" });
      }
      return { content: [{ type: "text", text: JSON.stringify(results) }], structuredContent: { results } };
    }
    // graph
    const query = args.query === undefined ? "" : str(args.query, "query", 300);
    const limit = args.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolInputError("limit must be an integer 1-100");
    if (args.include_history !== undefined && typeof args.include_history !== "boolean") throw new ToolInputError("include_history must be boolean");
    const { data } = await this.api(authorization, "POST", "/v1/memory/graph", {
      agent_id, query, limit, include_history: args.include_history === true,
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }

  private async remember(actor: Actor, authorization: string, agent_id: string, thread_id: string, message: any) {
    if (!message || typeof message !== "object") throw new ToolInputError("each message must be an object");
    const message_id = str(message.message_id, "message_id", 80);
    if (!["user", "assistant"].includes(message.role)) throw new ToolInputError("role must be user or assistant");
    if (typeof message.content !== "string" || !message.content.trim()) throw new ToolInputError("content must be nonempty text");
    const occurred_at = message.occurred_at === undefined ? now() : str(message.occurred_at, "occurred_at", 64);
    const base = eventBase(agent_id, thread_id, message_id);
    const author_id = message.role === "assistant" ? `agent:${agent_id}` : ownerAgent(agent_id) ? "alex" : "mcp:user:unknown";
    const content = message.content as string;
    const pieces: string[] = [];
    for (let i = 0; i < content.length; i += PART) pieces.push(content.slice(i, i + PART));
    let accepted = 0, unchanged = 0;
    for (const [index, piece] of pieces.entries()) {
      const event_id = `${base}:part:${index}`;
      const head = this.app.store.one(
        `SELECT h.revision,e.content,e.role,e.author_id,e.operation,e.agent_id FROM memory_heads h JOIN memory_events e ON e.id=h.event_pk
         WHERE h.workspace_id=? AND h.client_id=? AND h.event_id=?`, actor.workspace_id, CLIENT_ID, event_id);
      if (head && head.agent_id !== agent_id) throw new ApiError(409, "event_identity_conflict", "Event belongs to a different agent");
      if (head && head.operation === "upsert" && head.content === redact(piece) && head.role === message.role && head.author_id === author_id) {
        unchanged++; continue;
      }
      const body = {
        client_id: CLIENT_ID, event_id, revision: head ? head.revision + 1 : 1, operation: "upsert",
        agent_id, thread_id, role: message.role, author_id, occurred_at, observed_at: now(), content: piece,
        causal_parent_ids: [], evidence_root_ids: [base],
        metadata: { source: "mcp", message_id, part_index: index, part_count: pieces.length },
      };
      try {
        const { data } = await this.api(authorization, "POST", "/v1/events", body, "atlas-mcp:" + hash(canonical(body)));
        if (data.status === "accepted") accepted++; else unchanged++;
      } catch (e) {
        // Deterministic admission refusal is a handled skip, exactly like the plugin.
        if (e instanceof ApiError && e.code === "automatic_status_notification")
          return { message_id, status: "skipped", reason: e.code };
        throw e;
      }
    }
    // A shortened message drops trailing parts the earlier revision had.
    const stale = this.app.store.all(
      `SELECT h.event_id,h.revision,e.role,e.author_id FROM memory_heads h JOIN memory_events e ON e.id=h.event_pk
       WHERE h.workspace_id=? AND h.client_id=? AND h.event_id LIKE ? ESCAPE '\\' AND e.operation='upsert' AND e.agent_id=?`,
      actor.workspace_id, CLIENT_ID, likePrefix(base + ":part:"), agent_id)
      .filter((row: any) => Number(row.event_id.slice(base.length + 6)) >= pieces.length);
    for (const row of stale) {
      const at = now();
      await this.api(authorization, "POST", "/v1/events", {
        client_id: CLIENT_ID, event_id: row.event_id, revision: row.revision + 1, operation: "delete", agent_id, thread_id,
        role: row.role, author_id: row.author_id, occurred_at: at, observed_at: at, content: "",
        causal_parent_ids: [], evidence_root_ids: [base], metadata: { source: "mcp", message_id },
      });
    }
    return { message_id, status: accepted ? "accepted" : "unchanged", parts: pieces.length, unchanged_parts: unchanged };
  }
}

const eventBase = (agent: string, thread: string, message: string) => `mcp:${agent}:${thread}:${message}`;
const likePrefix = (prefix: string) => prefix.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
/** Like the plugin's owner_native_ids: only explicitly configured agents attribute user turns to the owner. */
export const ownerAgent = (agent: string) =>
  (setting("MCP_OWNER_AGENTS") ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(agent);
