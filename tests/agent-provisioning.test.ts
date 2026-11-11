import { test, expect } from "bun:test";
import { fixture } from "./helpers.ts";
import { hash } from "../src/store.ts";

const input = { agent_id: "paradev-growth", name: "Paradev growth", token_hash: hash("synthetic-new-agent-token") };

test("administrator atomically provisions a dedicated dynamic agent without returning secrets", async () => {
  const f = await fixture();
  try {
    const result = await f.call("POST", "/v1/memory/agents", input, f.owner.token, "provision-one");
    expect(result.status).toBe(200);
    const receipt = result.body.data;
    expect(receipt.agent_id).toBe(input.agent_id);
    expect(receipt.scopes).toEqual(["agent:paradev-growth", "user:alex", "business:alex"]);
    expect(JSON.stringify(result.body)).not.toContain(input.token_hash);
    expect(JSON.stringify(result.body)).not.toContain("synthetic-new-agent-token");
    const a = f.store.authenticate("synthetic-new-agent-token");
    expect(a.id).toBe(receipt.principal_id);
    expect(a.is_admin).toBe(0);
    for (const action of ["read", "write", "delete"])
      expect(f.app.memory.authorize(a, input.agent_id, action).sort()).toEqual([...receipt.scopes].sort());
    expect(() => f.app.memory.authorize(a, "default")).toThrow("server-bound");
    expect(() => f.app.memory.authorize(a, "builder")).toThrow("server-bound");
    expect(f.store.all("SELECT * FROM grants WHERE principal_id=?", a.id)).toHaveLength(0);
    expect((await f.call("POST", "/v1/memory/agents", input, f.owner.token, "provision-one")).body.data).toEqual({ ...receipt, idempotent_replay: true });
    expect(f.store.one("SELECT COUNT(*) AS n FROM credentials WHERE principal_id=?", a.id).n).toBe(1);
    expect((await f.call("POST", "/v1/memory/agents", { ...input, token_hash: hash("changed") }, f.owner.token, "provision-one")).status).toBe(409);
    expect((await f.call("POST", "/v1/memory/agents", { ...input, token_hash: hash("other") })).status).toBe(409);
    const denied = await f.call("POST", "/v1/memory/agents", { ...input, agent_id: "impostor" }, "synthetic-new-agent-token");
    expect(denied.status).toBe(403);
    const revoke = await f.call("POST", `/v1/credentials/${receipt.credential_id}/revoke`, {});
    expect(revoke.status).toBe(200);
    expect((await f.call("POST", "/v1/recall", { agent_id: input.agent_id }, "synthetic-new-agent-token")).status).toBe(401);
  } finally { f.store.close(); }
});

test("invalid names, hashes, raw secrets and duplicate hashes do not leave partial agents", async () => {
  const f = await fixture();
  try {
    const before = f.store.one("SELECT COUNT(*) AS n FROM principals").n;
    for (const body of [
      { ...input, agent_id: "../default" }, { ...input, agent_id: "Default" },
      { ...input, agent_id: " agent" }, { ...input, agent_id: "a".repeat(65) },
      { ...input, token_hash: "bad" }, { ...input, token: "never-accept-raw-secret" },
      { ...input, token_hash: hash(f.owner.token) },
    ]) {
      const r = await f.call("POST", "/v1/memory/agents", body);
      expect([400, 409]).toContain(r.status);
      expect(f.store.one("SELECT COUNT(*) AS n FROM principals").n).toBe(before);
    }
    const foreign = await f.call("POST", "/v1/memory/agents", input, f.other.token);
    expect(foreign.status).toBe(200);
    const a = f.store.authenticate("synthetic-new-agent-token");
    expect(a.workspace_id).toBe(f.other.workspace_id);
    expect((await f.call("POST", "/v1/memory/bind", { principal_id: a.id, agent_id: "paradev-growth" })).status).toBe(404);
  } finally { f.store.close(); }
});

test("dynamic bindings remain admin-only, immutable, and preserve legacy names", async () => {
  const f = await fixture();
  try {
    const a = f.store.authenticate(f.owner.token);
    f.app.memory.bind(a, a.id, "default");
    expect(() => f.app.memory.bind(a, a.id, "paradev-growth")).toThrow("already bound");
    expect(f.app.memory.authorize(a, "default")).toEqual(["agent:default", "business:alex", "user:alex"]);
  } finally { f.store.close(); }
});
