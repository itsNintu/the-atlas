import { test, expect } from "bun:test";
import { fixture, statement, at } from "./helpers.ts";
import { App } from "../src/app.ts";
import { Worker } from "../src/worker.ts";
import { assertions } from "../src/store.ts";
import { timestamp } from "../src/errors.ts";

function barrier() {
  let release!: () => void;
  return {
    promise: new Promise<void>((r) => (release = r)),
    release: () => release(),
  };
}
test("hybrid context cannot return facts forgotten during embedding", async () => {
  const f = await fixture();
  try {
    const source = (await f.ingest()).body;
    await f.worker.runOnce();
    const wait = barrier();
    const provider = {
      name: "synthetic_fault_double",
      embedding_model: "test",
      embed: async () => {
        await wait.promise;
        return [[1, 0]];
      },
      extract: async () => [],
    };
    const app = new App(f.store, provider);
    const pending = app.fetch(
      new Request("http://localhost/v1/context", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${f.owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          space_ids: [f.space.id],
          query: "Mira",
          strategy: "hybrid",
        }),
      }),
    );
    await Bun.sleep(2);
    expect(
      (await f.call("DELETE", "/v1/sources/" + source.source_id, {})).status,
    ).toBe(200);
    wait.release();
    const response = await pending;
    const result = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(result.facts).toHaveLength(0);
    expect(result.context).toBe("");
    expect(result.matched_facts).toBe(0);
  } finally {
    f.store.close();
  }
});
test("credential revoked during streamed body is rejected before a write", async () => {
  const f = await fixture();
  try {
    const credential = f.store.issueKey(f.owner.principal_id);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => (controller = c),
    });
    const pending = f.app.fetch(
      new Request("http://localhost/v1/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "streamed",
        },
        body: stream,
      }),
    );
    await Bun.sleep(2);
    await f.call(
      "POST",
      `/v1/credentials/${credential.credential_id}/revoke`,
      {},
    );
    controller.enqueue(
      new TextEncoder().encode(JSON.stringify({ name: "Must not persist" })),
    );
    controller.close();
    expect((await pending).status).toBe(401);
    expect(
      f.store.one(
        "SELECT COUNT(*) n FROM projects WHERE name='Must not persist'",
      ).n,
    ).toBe(0);
  } finally {
    f.store.close();
  }
});
test("credential and space-grant revocation during inference both fail closed", async () => {
  for (const kind of ["credential", "grant"]) {
    const f = await fixture();
    try {
      await f.ingest();
      await f.worker.runOnce();
      const credential = f.store.issueKey(f.owner.principal_id);
      const wait = barrier();
      const provider = {
        name: "synthetic_fault_double",
        embedding_model: "test",
        embed: async () => {
          await wait.promise;
          return [[1, 0]];
        },
        extract: async () => [],
      };
      const pending = new App(f.store, provider).fetch(
        new Request("http://localhost/v1/context", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credential.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            space_ids: [f.space.id],
            query: "Mira",
            strategy: "hybrid",
          }),
        }),
      );
      await Bun.sleep(2);
      if (kind === "credential")
        await f.call(
          "POST",
          `/v1/credentials/${credential.credential_id}/revoke`,
          {},
        );
      else
        await f.call("POST", "/v1/grants", {
          space_id: f.space.id,
          principal_id: f.owner.principal_id,
          actions: [],
        });
      wait.release();
      const r = await pending;
      expect(r.status).toBe(kind === "credential" ? 401 : 404);
      expect(JSON.stringify(await r.json())).not.toContain("Lisbon");
    } finally {
      f.store.close();
    }
  }
});
test("forget during extraction prevents a subsequent embedding call", async () => {
  const f = await fixture();
  try {
    const source = (
      await f.ingest("x", { mode: "natural_language", assertions: undefined })
    ).body;
    const wait = barrier();
    let embedCalls = 0;
    const provider = {
      name: "synthetic_fault_double",
      embedding_model: "test",
      extract: async () => {
        await wait.promise;
        return assertions([statement()], at);
      },
      embed: async () => {
        embedCalls++;
        return [[1, 0]];
      },
    };
    const pending = new Worker(f.store, provider).runOnce();
    await Bun.sleep(2);
    await f.call("DELETE", "/v1/sources/" + source.source_id, {});
    wait.release();
    await pending;
    expect(embedCalls).toBe(0);
    expect(f.store.one("SELECT COUNT(*) n FROM facts").n).toBe(0);
  } finally {
    f.store.close();
  }
});
test("calendar normalization rejects impossible dates", () => {
  expect(() => timestamp("2026-02-30T00:00:00Z", "test")).toThrow();
});
